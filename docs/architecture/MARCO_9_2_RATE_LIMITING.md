# Marco 9 — Rate limiting (antiabuso) para BJJ Exams v1.2

## Situação

- **Gate 9.2A — núcleo atômico testado, sem integração em Functions** (`NO_ENFORCEMENT`, `NO_DEPLOY`).
- Base inicial: `develop-v1.2` no commit `44de17254f4c8e06f1889540349cb8508798bd2f`, integração do PR #27.
- App Check Gate 9.1C2B ainda depende da configuração externa no Firebase staging e da homologação com tokens reais. O rate limiting é uma camada independente e não substitui App Check.
- Projeto de homologação permitido: `bjj-exams-staging`; projeto de produção `bjj-exams` bloqueado.

## Modelo e escopo

`functions/src/security/rate-limit-core.js` contém a matriz inicial **PROVISÓRIA** de orçamentos por janela fixa de 60 segundos, a chave HMAC-SHA256 e uma implementação com transações Firestore atômicas. Nenhum endpoint atual importa ou executa o módulo e nenhum deploy foi feito. Os números abaixo ainda não são limites em execução e devem ser calibrados por métricas reais e experiência de aluno/professor.

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
- O código não é conectado ao `functions/main.js` nem ao legado `functions/index.js`. A suíte existente de 133 testes continua no CI; nenhuma chamada real Firebase/Asaas foi executada.

## Gate 9.2B — Integração futura (NÃO realizado)

1. Em emulador Firebase de teste, validar transações Firestore simultâneas reais, TTL, alta contenção e comportamento sob indisponibilidade (os testes 9.2A usam store simulado).
2. Medir distribuição de tráfego por rota e papel antes de fixar budgets. Especificar quotas, exceções e política para retries, idempotência e usuários atrás de IPs compartilhados.
3. Provisionar uma chave HMAC de staging fora do Git, com rotação planejada, e configurar o TTL da coleção no projeto correto.
4. Integrar limitação em **uma callable elegível por PR**, após validação de Auth e antes do trabalho oneroso. Testar acessos legítimos, de negação, burst, retries e atomicidade sem chamar Asaas produção.
5. Garantir falha fechada nas mutações, com erro `resource-exhausted` sanitizado, sem expor chaves de contador ou dados pessoais; observabilidade apenas agregada.
6. Homologar seletivamente em `bjj-exams-staging` somente com autorização específica. Manter rollback e projeto `bjj-exams` sem qualquer mutação.

## Riscos e critérios de liberação

Limites fixos podem atrapalhar estudantes com conexão instável, exames com retomada e administradores em operação em lote. Um erro de proteção não pode criar nova cobrança, alterar nota, emitir ou revogar certificado. Os limites propostos não significam autorização de deploy: iniciar pelo catálogo público e testes de emulador, depois avançar para outras classes quando houver telemetria e negociação de segurança/UX.

Referências:
- https://firebase.google.com/docs/functions/quotas
- https://firebase.google.com/docs/functions/manage-functions
- https://firebase.google.com/docs/app-check/cloud-functions

**Entrega atual máxima: `GATE_9_2A=CORE_READY_OFFLINE`, `BACKEND_ENFORCEMENT=NOT_ENABLED`, `STAGING_DEPLOY=NOT_RUN`, `PRODUCTION_ACCESS=FORBIDDEN`.**