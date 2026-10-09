# Marco 9 — Rate limiting (antiabuso) para BJJ Exams v1.2

## Situação

- **Gate 9.2A — núcleo atômico; Gate 9.2B1 — Firestore Emulator; Gate 9.2B2 — integração com uma leitura autenticada em modo desligado** (`NO_ENFORCEMENT`, `NO_DEPLOY`).
- Base inicial: `develop-v1.2` no commit `44de17254f4c8e06f1889540349cb8508798bd2f`, integração do PR #27.
- App Check Gate 9.1C2B ainda depende da configuração externa no Firebase staging e da homologação com tokens reais. O rate limiting é uma camada independente e não substitui App Check.
- Projeto de homologação permitido: `bjj-exams-staging`; projeto de produção `bjj-exams` bloqueado.

## Modelo e escopo

`functions/src/security/rate-limit-core.js` contém a matriz inicial **PROVISÓRIA** de orçamentos por janela fixa de 60 segundos, a chave HMAC-SHA256 e uma implementação com transações Firestore atômicas. Somente o contexto administrativo autenticado (`obterContextoAdministrativoV12`) recebe um guard criado em `functions/main.js` com `enabled: false` no Gate 9.2B2; a verificação não consulta nem grava Firestore, não requer segredo HMAC e não muda respostas. Nenhum deploy foi feito. Os números abaixo ainda não são limites em execução e devem ser calibrados por métricas reais e experiência de aluno/professor.

| Política | Orçamento candidato / 60s | Falha da infraestrutura | Exemplos de fluxos candidatos |
| --- | ---: | --- | --- |
| `public_read` | 90 | Aberta apenas para leitura pública | Catálogo e detalhes públicos de cursos |
| `authenticated_read` | 120 | Aberta para leitura, com autorização backend preservada | Leituras autenticadas |
| `exam_mutation` | 12 | Fechada | Iniciar/finalizar prova oficial |
| `checkout_mutation` | 5 | Fechada | Iniciar pagamento curso/exame, somente Asaas Sandbox |
| `admin_mutation` | 10 | Fechada | Reprocessar webhook e comandos administrativos |
| `certificate_mutation` | 8 | Fechada | Emitir/revogar certificado, mantendo regra canônica |

**Não aplicar automaticamente aos webhooks HTTP externos.** `asaasWebhook` (legado) e `webhookAsaasPagamentosV12` (canônico) permanecem com autenticação, assinatura/token e idempotência próprias. Qualquer limitação do ingresso externo requer plano de retries do provedor, janela independente e evidência de não perda de eventos.

## Garantias técnicas

- `createRateLimitGuard()` vem com `enabled=false` e retorna `NOT_ENABLED` sem consultar banco, HMAC, segredo ou relógio; portanto não altera o produto enquanto não for explicitamente conectado e ativado.
- `enabled=true` só pode ser criado no projeto exato `bjj-exams-staging` e exige segredo HMAC de pelo menos 32 bytes, store atômico e relógio válido. O segredo NÃO é gerado, armazenado ou vinculado no código; um gate posterior avaliará integração ao Secret Manager **de staging**.
- Chaves de documento são `HMAC-SHA256(projeto, política, identidade de confiança) + índice da janela`. Identidade, IP, e-mail, UID, CPF, tokens e segredo não são persistidos no contador, e tampouco retornam no resultado. A identidade deve vir de Firebase Auth verificado ou de origem de rede validada no servidor, nunca do payload ou de `X-Forwarded-For` arbitrário enviado pelo cliente.
- Contadores são gravados sob `_bjj_exams_rate_limits_v12` apenas quando houver tentativa permitida. Cada bucket guarda somente `count` e `expiresAt` (Date). Antes de ativar, configurar **TTL Firestore** no campo `expiresAt` e avaliar índices/regras/admin IAM, com política de descarte de metadados e custo.
- A transação evita excesso em testes concorrentes, mas a infraestrutura Firestore tem limites próprios de contenção. Erros de transação têm resultado sanitizado: `GUARD_UNAVAILABLE` e negação para mutações sensíveis; `DEGRADED_READ_ONLY` apenas para leituras.
- Resultados `RATE_LIMITED` indicam retry após o fim da janela, mas nenhuma resposta HTTP `resource-exhausted`, `Retry-After` ou UX de espera é aplicada por este gate. Evitar retries em massa, looping e duplicação de pagamentos.
- Política de idempotência do checkout, do exame, dos certificados e dos webhooks fica integralmente no backend canônico. A chave idempotente não é usada como bypass do limite neste gate; antes do enforcement avaliar retomada legítima de checkout e retry após timeout para não prejudicar operações reais.
- Limites não devem ser usados como autorização ou comprovação de App Check; Auth, RBAC, visibilidade de dados, defesa de webhooks e acesso a recursos permanecem independentes.

## Testes já cobertos em 9.2A

- `tests/marco9-rate-limit-core-v1_2.test.js`: 12 solicitações concorrentes de checkout com limite 5, exatamente 5 permits; transação serial simulada sem serviço externo.
- Chave HMAC não contém principal em texto claro, não reutiliza hash entre escopos/janelas e rejeita chave curta/injeção de CRLF.
- Identidade ausente, escopo desconhecido, projeto de produção e infraestrutura indisponível são negados quando sensíveis.
- Leituras degradam somente para permitir a continuidade de consulta; acesso autenticado continua exigindo Auth/RBAC real do endpoint.
- No Gate 9.2A o código não estava ligado à composition root; no Gate 9.2B2 `functions/main.js` conecta o guard **desligado** exclusivamente ao contexto administrativo autenticado. A suíte de 133 testes permanece em CI; o Gate 9.2B1 já executou testes reais **somente no Firestore Emulator** com projeto demo.

## Gate 9.2B — Integração futura (NÃO realizado)

1. Em emulador Firebase de teste, validar transações Firestore simultâneas reais, TTL, alta contenção e comportamento sob indisponibilidade (os testes 9.2A usam store simulado).
2. Medir distribuição de tráfego por rota e papel antes de fixar budgets. Especificar quotas, exceções e política para retries, idempotência e usuários atrás de IPs compartilhados.
3. Provisionar uma chave HMAC de staging fora do Git, com rotação planejada, e configurar o TTL da coleção no projeto correto.
4. Integrar limitação em **uma callable elegível por PR**, após validação de Auth e antes do trabalho oneroso. Testar acessos legítimos, de negação, burst, retries e atomicidade sem chamar Asaas produção.
5. Garantir falha fechada nas mutações, com erro `resource-exhausted` sanitizado, sem expor chaves de contador ou dados pessoais; observabilidade apenas agregada. No Gate 9.2B2 a leitura autenticada usa `resource-exhausted` somente em teste injetado, sem ativar cotas de backend.
6. Homologar seletivamente em `bjj-exams-staging` somente com autorização específica. Manter rollback e projeto `bjj-exams` sem qualquer mutação.

## Riscos e critérios de liberação

Limites fixos podem atrapalhar estudantes com conexão instável, exames com retomada e administradores em operação em lote. Um erro de proteção não pode criar nova cobrança, alterar nota, emitir ou revogar certificado. Os limites propostos não significam autorização de deploy: iniciar pelo catálogo público e testes de emulador, depois avançar para outras classes quando houver telemetria e negociação de segurança/UX.

Referências:
- https://firebase.google.com/docs/functions/quotas
- https://firebase.google.com/docs/functions/manage-functions
- https://firebase.google.com/docs/app-check/cloud-functions

**Entrega atual máxima: `GATE_9_2A=CORE_READY_OFFLINE`, `BACKEND_ENFORCEMENT=NOT_ENABLED`, `STAGING_DEPLOY=NOT_RUN`, `PRODUCTION_ACCESS=FORBIDDEN`.**

## Gate 9.2B1 — Transações REAIS no Firestore Emulator (sem recursos cloud)

O Gate 9.2A usou store simulada. Este gate adiciona `tests/marco9-rate-limit-emulator-v1_2.test.js`, que executa `firebase-admin` e **transações reais** contra o Firestore Emulator exclusivamente sob o projeto fictício `demo-bjj-exams-rate-limit`. O Firebase recomenda projetos `demo-` porque não têm recursos cloud reais.

- Preflight recusa qualquer execução sem `FIRESTORE_EMULATOR_HOST` apontando para `127.0.0.1:8080` ou `localhost:8080`. Rejeita divergências de `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT` e `FIREBASE_PROJECT_ID` de `demo-bjj-exams-rate-limit`.
- A instância de dados do Admin SDK usa **`demo-bjj-exams-rate-limit`**, e nunca o projeto de staging ou produção. O contrato do guard continua recebendo o literal de política `bjj-exams-staging`; é apenas o argumento de política em memória, **não** o destino das operações do Firestore no teste.
- `firebase emulators:exec --only firestore --project demo-bjj-exams-rate-limit` inicia e desliga automaticamente o banco de demonstração. Não exige login, credencial cloud ou deploy; a CLI e o JDK são obtidos pelo GitHub Actions durante o job.
- Testa 12 checagens concorrentes de checkout com limite 5 e exige exatamente 5 aceitas, 7 recusadas por `RATE_LIMITED`; verifica armazenamento real de `count`, `expiresAt` e chave HMAC sem principal em claro.
- Testa isolamento por usuário, política e janela; contador corrompido com falha fechada; escopo HTTP externo não autorizado; modo desativado sem escrita Firestore.
- Não executa `functions/main.js`, não importa nem chama provedores financeiros e não altera Functions, Firestore Rules, `firebase.json`, coleção canônica de negócio, app de produção ou staging.

### Ambiente reprodutível / requisitos técnicos

- `node` **22.23.2**, `firebase-tools` **14.27.0**, **Java 21**, Firebase Admin instalado por `npm ci --prefix functions`.
- CI instala ferramentas de emulador sem credenciais, usa sempre CLI explícita de projeto `demo-` e variáveis de ambiente do job também `demo-`, com checks de segurança no início do script.
- Manualmente, realizar os mesmos passos somente em ambiente de testes local, usando `--project demo-bjj-exams-rate-limit` e variables `GCLOUD_PROJECT`/`GOOGLE_CLOUD_PROJECT` igualmente `demo-bjj-exams-rate-limit`. **Não usar o alias `staging` nem o projeto real.**
- Este emulador não comprova latência, contenção sob alta escala, regras de TTL efetivamente ativadas no Firebase, traffic mix, custo ou performance de rede na nuvem.

**Gate atual: `FIRESTORE_EMULATOR_INTEGRATION=VALIDATE_IN_CI`; `RATE_LIMIT_BACKEND_ENFORCEMENT=NOT_ENABLED`; `FIREBASE_STAGING_DATA_ACCESS=NOT_RUN`; `PRODUCTION_ACCESS=FORBIDDEN`.**

## Gate 9.2B2 — integração seletiva futura (ainda NÃO realizada)

Após CI do 9.2B1 verde, definir supervisão de lotes, tolerância de concorrência e política de retenção TTL. Uma mudança posterior deve proteger primeiro uma callable não financeira e testar fallback, retries e origem da identidade confiável. Operações de compra, exame, certificados e reprocessamento serão ativadas somente após gating separado e validação em staging. Webhooks do Asaas seguem fora da limitação por cliente navegador.

## Gate 9.2B2 — Primeiro ponto de integração: contexto administrativo autenticado (sem enforcement)

**Situação: WIRING_READY, DISABLED_BY_DEFAULT, NO_DEPLOY.** Escopo: callable `obterContextoAdministrativoV12`, uma leitura de baixo impacto já restrita a staging/demo-emulador. **Não** altera checkout, exame, certificados, webhooks externos ou catálogo público.

- `functions/main.js` importa `createRateLimitGuard` e cria `adminContextReadRateLimitGuard` somente quando `adminRuntimeAllowed`, usando o literal `createRateLimitGuard({ enabled: false })`. Não lê Secret Manager, não cria Firestore store, não grava contador nem adiciona configuração de enforcement.
- `functions/src/admin/admin-context-functions.js` aceita guard opcional no factory/handler, mantendo compatibilidade se ausente. Sequência: validar payload → identificar Firebase Auth `request.auth.uid` → resolver RBAC (view administrativa) → `check({ scope: "authenticated_read", identity: actor.uid })` → devolver a view original.
- A identidade de cobrança provém exclusivamente do UID verificado pelo Firebase Auth no backend, nunca de `request.data`, cabeçalhos HTTP ou `X-Forwarded-For`. Sem Auth, com payload inválido ou sem papel autorizado, a chamada retorna erros originais antes de qualquer consulta à quota.
- Se um teste injetar quota negada, o resultado vira `HttpsError("resource-exhausted")` com mensagem genérica sem dados privados. Um resultado inválido também é negado de maneira sanitizada.
- Política `authenticated_read` pode degradar para permitir leitura em falha do contador, sem dispensar autenticação/RBAC. Mutações financeiras e administrativas seguirão fail-closed em gates próprios.
- O teste `tests/marco9-rate-limit-admin-context-v1_2.test.js` verifica paridade de resposta no modo desligado, UID confiável, autorização antes da quota, erro sanitizado, fallback em leitura, ausência de ativação na composition root.
- O teste Firestore Emulator do Gate 9.2B1 continua no CI; não significa que a quota esteja ativa no projeto `bjj-exams-staging`.

### Ativação futura (fora deste PR)

Provisionar e rotacionar segredo HMAC exclusivamente em staging; configurar TTL Firestore para contadores; medir tráfego por papel e calibrar a cota candidata de `authenticated_read=120/min`. Validar concorrência no staging, erros e interface para `resource-exhausted` antes de retirar `enabled: false`. Preparar rollback auditável e homologar App Check do Gate 9.1C2B separadamente.

**Aceite do Gate 9.2B2:** 133/133 regressões + gates anteriores e 9.2B2 verdes no HEAD exato; produção, Asaas, regras do Firestore e deploy intocados.
