# Marco 9 — Gate 9.1C: observabilidade do App Check em staging

## Estado do gate

- **Gate 9.1C1 — ferramenta offline de análise de logs: IMPLEMENTADA NO CÓDIGO, sem coleta real.**
- **Gate 9.1C2 — validação real de App Check no Firebase staging: PENDENTE** de registro de app/key, configuração do site e homologação de tráfego autorizado.
- **NO_ENFORCEMENT / NO_DEPLOY / PRODUCTION_ACCESS=FORBIDDEN**. Este documento não autoriza changes em projetos, Functions, Firestore, Hosting, Asaas ou produção.
- Base inicial: PR #25, merge `d9432089c573612f55a351a6b4a3a55ae56f4187` na `develop-v1.2`.

## Referências oficiais e evidência

- Firebase: https://firebase.google.com/docs/app-check/monitor-functions-metrics
- App Check em Cloud Functions: https://firebase.google.com/docs/app-check/cloud-functions
- Configurar reCAPTCHA Enterprise Web: https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- A verificação de callables gera logs estruturados `callable-request-verification`. O exemplo da documentação usa `jsonPayload.verifications.app`, enquanto a instrução de métrica em logs menciona `jsonPayload.verifications.appCheck`. O analisador reconhece ambos e marca `UNKNOWN` se divergirem; o caminho efetivo precisa ser confirmado nos logs de staging antes de criar métricas persistentes.

## 9.1C1 — Análise offline, somente dados exportados

Foi criado `scripts/analyze-appcheck-staging-logs-v1_2.js`, independente de credenciais e SDK. Aceita exportações JSON (array, `{ entries: [...] }`) ou NDJSON e devolve **apenas contagens agregadas por Function**, por `VALID`, `MISSING`, `INVALID` e `UNKNOWN`, sem copiar payload, token, e-mail, CPF ou ID do usuário.

O filtro exige **projeto exato `bjj-exams-staging`**, região `southamerica-east1`, evento `callable-request-verification` e recurso do tipo `cloud_function` ou `cloud_run_revision`. Para Cloud Run é usado `resource.labels.service_name`; para Cloud Functions é usado `resource.labels.function_name`. Registros sem esses campos são descartados: jamais interpretar ausência de evidência como `VALID`.

**Status de evidência:** `NO_VERIFIABLE_STAGING_EVENTS` quando não houver eventos elegíveis. A saída sempre permanece `BLOCKED_REQUIRES_MANUAL_GATE_9_1D` para enforcement, mesmo que a amostra tenha 100% de tokens válidos. O relatório não afirma homologação real e não autoriza uma decisão automática de segurança.

### Exportação controlada pelo operador, após disponibilização de staging

1. Operar **somente** no projeto `bjj-exams-staging` e em janela de testes controlados, usando uma conta autorizada à leitura dos logs.
2. Executar a consulta no Cloud Logging ou, em terminal autenticado com `gcloud`, um comando equivalente a:

```powershell
$Project = 'bjj-exams-staging'
$Filter = 'resource.labels.project_id="bjj-exams-staging" AND labels.firebase-log-type="callable-request-verification"'
New-Item -ItemType Directory -Path '.appcheck-logs' -Force | Out-Null
gcloud logging read $Filter --project=$Project --freshness=48h --limit=5000 --format=json | Out-File -FilePath '.appcheck-logs/appcheck-staging-export.json' -Encoding utf8
node scripts/analyze-appcheck-staging-logs-v1_2.js '.appcheck-logs/appcheck-staging-export.json'
```

Se a versão do `gcloud` emitir BOM UTF-8 ou o formato de exportação divergir do JSON esperado, adequar a codificação/exportação antes de rodar o script. **Não enviar nem versionar o JSON bruto**: a análise contém somente agregados; os logs originais podem ter metadados pessoais e identificadores de transações.

### Métrica de logs (configurar futuramente, no mesmo projeto)

Filtro conceitual para uma Function de staging, adaptando o nome real e a região:

```text
resource.labels.project_id="bjj-exams-staging"
labels.firebase-log-type="callable-request-verification"
```

Separar por função e estado da verificação; não copiar cegamente o filtro de exemplo da documentação que usa `us-central1` — este sistema usa `southamerica-east1`. Em Gen2 confirmar no Cloud Logging se o recurso é `cloud_run_revision` ou `cloud_function` e qual campo de verificação (`app` ou `appCheck`) está presente.

## 9.1C2 — Homologação REAL em staging (pendente)

Pré-requisitos obrigatórios:

1. Registrar o aplicativo Web de **`bjj-exams-staging`** no Firebase App Check com provedor reCAPTCHA Enterprise (site key **pública** do projeto correto e domínios staging autorizados).
2. Publicar a chave pública no bootstrap do site de staging (`window.__BJJ_EXAMS_APP_CHECK_SITE_KEY__`, antes do FirebaseApp) e implantar seletivamente os arquivos aprovados. Esta operação NÃO foi feita no 9.1C1 e exige autorização independente do merge.
3. Confirmar funcionalidade e recebimento efetivo de token `X-Firebase-AppCheck` nas chamadas HTTP diretas, com usuário anônimo (catálogo), aluno (exames), professor, administração, certificados e compras somente no Asaas Sandbox.
4. Conferir logs/percentuais por callable e perfil de cliente, distinguindo navegadores legados, acesso anônimo e cliente autenticado; coletar amostra representativa em período acordado, nunca só uma requisição.
5. Demonstrar que webhook Asaas (`onRequest`) continua autenticado pelo token externo e **não** foi incluído na regra de enforcement de callables.
6. Registrar falhas, correções e plano de rollback antes de propor qualquer `enforceAppCheck: true` no Gate 9.1D.

## Matriz de evidências por fluxo (preencher só após testes REAIS)

| Fluxo | Auth | App Check token observado | Log `VALID/MISSING/INVALID` | Resultado |
| --- | --- | --- | --- | --- |
| Catálogo público | Anônimo | Pendente | Pendente | Não homologado |
| Detalhe do curso | Anônimo | Pendente | Pendente | Não homologado |
| Compra de curso | Firebase Auth + Asaas Sandbox | Pendente | Pendente | Não homologado |
| Exame oficial | Firebase Auth | Pendente | Pendente | Não homologado |
| Emissão/consulta de certificado | Autorização conforme contrato canônico | Pendente | Pendente | Não homologado |
| Painel administrativo | RBAC | Pendente | Pendente | Não homologado |
| Reprocessamento administrativo de webhook | RBAC | Pendente | Pendente | Não homologado |
| Callback Asaas `onRequest` | Token de webhook próprio (fora do App Check navegador) | Não aplicável | Não aplicável | Não testado |

## Gates e critérios

- 9.1C1: script estático seguro, regressões e testes sintéticos; não há logs reais. Status apenas `TOOLING_READY`.
- 9.1C2: registro no Firebase do staging, chave pública configurada, staging homologado, logs com evidência real verificável e rollback. Sem isso: `REAL_STAGING_VALIDATION=PENDING`.
- 9.1D: enforcement seletivo depende de decisão separada, revisão de funções elegíveis, client coverage e rollback; resultado do script **nunca** libera automaticamente.

## Segurança operacional

- Nunca adicionar logs brutos ao Git, CI, documentos compartilhados ou mensagens de chat.
- Nunca analisar/logar token App Check completo, Firebase ID token, API keys privadas, webhooks, CPF, gabarito, `payment_transactions` ou dados financeiros.
- Nenhuma dependência de rede no analisador. Os exemplos do documento são comandos para execução manual autorizada em staging; nenhuma coleta foi executada nesta entrega.

**Resultado esperado do Gate 9.1C1: `TOOLING_READY`, `REAL_STAGING_VALIDATION=PENDING`, `APP_CHECK_ENFORCEMENT=NOT_ENABLED`.**
