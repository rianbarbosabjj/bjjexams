# Marco 9 — Gates 9.6A + 9.7A: restauração e resiliência com dados sintéticos

**Status: DEMO_EMULATOR_ONLY / NO_DEPLOY / NO_ENFORCEMENT.** Esta entrega prepara os testes isolados e NÃO valida backups gerenciados nem desempenho de Cloud Functions reais. Não existe acesso, escrita, exportação ou restauração em `bjj-exams-staging` ou produção `bjj-exams`.

## Limite obrigatório de execução

O runner `tests/helpers/marco9-demo-emulator-boundary-v1_2.js` aceita somente `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` (ou `localhost:8080`) e `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `FIREBASE_PROJECT_ID` iguais a `demo-bjj-exams-resilience`. Rejeita variáveis de credenciais de serviço e `FIREBASE_TOKEN`, e inicializa Firebase Admin somente **depois** do preflight. Não importa o `functions/main.js`, não lê contas reais e não chama Asaas. `firebase emulators:exec` sobe e encerra o Firestore Emulator para o projeto `demo-`, conforme documentação oficial do Firebase.

## Gate 9.6A — ciclo de recuperação sintético, efetivamente testado

- Quatro documentos de exemplo, sem dados pessoais verdadeiros ou operações financeiras: aluno falso, curso falso, pedido falso e exame falso.
- Cria dados na coleção reservada `_marco9_recovery_fixture_v12` do projeto fictício; lê snapshot em memória com SHA-256 e metadados de namespace/projeto; rejeita snapshot adulterado e projeto divergente **antes** de qualquer gravação.
- Simula perda dos documentos de origem, restaura os mesmos quatro registros na coleção separada `_marco9_recovery_restored_v12`, confirma igualdade e hash do conteúdo, exclui origem e destino e verifica que os oito caminhos estão ausentes.
- Não cria arquivo de backup persistente, bucket Cloud Storage, agendamento, credencial, snapshot de banco inteiro ou comando de restore para os ambientes reais.
- **Não substitui** testes oficiais de Firestore managed export/import ou scheduled backups: formatos de export gerenciado e os backups do serviço são distintos de um snapshot sintético em memória. Backups agendados do Firestore incluem dados e índices, mas não políticas TTL, que precisam constar do runbook operacional.

### Requisitos abertos para o Gate 9.6B real

- Inventariar escopo exato de dados e dependências: Firestore (usuários, organizações, provas, cursos, certificados, pedidos, transações, webhooks, audit_logs), Storage quando usado, Auth, índices, Rules, configurações de secrets, IDs externos do Asaas, eventos pendentes e integridade transacional.
- Definir e aprovar **RPO/RTO** com proprietário de negócio. Não inventar metas em minutos/horas; escolher mecanismo (scheduled backup e/ou PITR) compatível com custo, retenção, acesso IAM e requisitos regulatórios.
- Definir frequência/retention de backups de forma explícita, separar ambientes, papéis de restauração e testes em banco de destino isolado. Sempre escolher `bjj-exams-staging` somente após autorização operacional, nunca restaurar sobre banco original nem usar dados financeiros reais no CI.
- Verificar que backup/restauração não reativam cobranças, redeliveries, triggers ou emissão de certificados indevida. Confirmar que TTL, Rules, Auth, Storage e configurações externas são tratados à parte conforme mecanismo escolhido.
- Produzir evidência sanitizada: quantidade de registros, hash/consistência por domínio, integridade de referências, auditoria de cleanup, tempos do procedimento e decisão formal de recuperação.

## Gate 9.7A — carga limitada e injeção de falhas em emulador

- `tests/marco9-bounded-load-demo-emulator-v1_2.test.js` envia **24 checagens artificiais** da biblioteca de rate limit, com teto de quatro workers simultâneos e quatro UIDs fictícios, seis checagens por principal.
- Cada janela de `checkout_mutation` tem cota 5: espera 20 aceitas e 4 `RATE_LIMITED`. Essas são somente transações de contadores no Firestore Emulator — **não** há checkout, PIX, idempotência bancária, Asaas nem função financeira executados.
- Mede p50/p95 das durações locais do emulador, mas não impõe SLA numérico de produção: o hardware GitHub Actions é compartilhado. Resultados do emulador não equivalem a latência, cold starts, limite de custo, throughput ou escala do Firebase real.
- Injeta falha explícita de datastore com texto sintético privado e confirma `GUARD_UNAVAILABLE` (fail-closed) para `checkout_mutation`, mas `DEGRADED_READ_ONLY` (fail-open) somente para leitura pública, sem vazamento da mensagem do erro.
- Apaga todos os contadores sintéticos e verifica que a coleção não contém documentos do teste. O rate limiting do backend permanece `enabled: false`.

### Requisitos abertos para o Gate 9.7B real

- Definir perfil de demanda, limite de carga total, custo de Firebase Functions/Firestore, latência p95/p99, taxas de erro, capacidade máxima, cold starts, alertas e critério de parada.
- Testar retries, concorrência com provas em andamento e webhooks, idempotência e cobranças apenas via Asaas Sandbox **com autorização específica de staging**. Preservar exportação de eventos sensíveis, não executar carga em projetos reais sem janela e rollback.
- Não usar o teste artificial de contadores como prova de capacidade dos endpoints nem como aprovação de quotas definitivas.

## Reprodução técnica restrita (CI de PR, sem credenciais)

```bash
GCLOUD_PROJECT=demo-bjj-exams-resilience \
GOOGLE_CLOUD_PROJECT=demo-bjj-exams-resilience \
FIREBASE_PROJECT_ID=demo-bjj-exams-resilience \
npm exec --yes --package=firebase-tools@14.27.0 -- \
  firebase emulators:exec --only firestore \
  --project demo-bjj-exams-resilience \
  'node tests/marco9-recovery-demo-emulator-v1_2.test.js && node tests/marco9-bounded-load-demo-emulator-v1_2.test.js'
```

O script exige que o CLI configure `FIRESTORE_EMULATOR_HOST` no subprocesso. CI usa Java 21 e Node 22.23.2. Não usar `.firebaserc`, alias staging, senha, tokens, `--import` de dados reais, bucket ou credenciais de serviço.

## Estado de segurança e aceitação

Para integrar o código, exigir 133/133 regressões, contratos Marcos 9 anteriores, **ambos** testes de emulador com finalização e cleanup, CI do HEAD exato concluído success e diff limitado a scripts/tests/docs/workflow. **Nenhum deploy, alteração de regra/índice, nova Function, acesso Asaas ou escrita externa**.

**Gate 9.6A = DEMO_ROUNDTRIP_ONLY**, **Gate 9.7A = BOUNDED_EMULATOR_ONLY**, **RPO_RTO = NOT_APPROVED**, **MANAGED_BACKUP = NOT_VALIDATED**, **STAGING_LOAD = NOT_RUN**, **NO_DEPLOY**, **NO_ENFORCEMENT**.

Referências: https://firebase.google.com/docs/emulator-suite/connect_firestore ; https://firebase.google.com/docs/firestore/disaster-recovery ; https://firebase.google.com/docs/firestore/backups
