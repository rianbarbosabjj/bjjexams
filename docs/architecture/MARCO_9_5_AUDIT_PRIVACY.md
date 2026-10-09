# Marco 9 — Gate 9.5A: auditoria de erros operacionais e privacidade

**Situação: PARTIAL_RUNTIME_HARDENING / NO_DEPLOY / NO_ENFORCEMENT.** Corrigimos dois registros de erro dos webhooks. Isto não equivale à auditoria de todos os logs do sistema, nem à aprovação da retenção de dados. LGPD continua exigindo avaliação por categoria e finalidade.

## Alterações concretas

Em `functions/index.js`, a falha do webhook Asaas legado deixava o `logger.error` receber o objeto `Error` completo. O objeto pode carregar `message`, `stack` e campos anexos contendo payload, referência de pagamento ou até token. Agora esse ponto e o ingresso canônico em `functions/src/finance/financial-webhook-functions.js` usam `sanitizeOperationalError(error)` de `functions/src/security/operational-error-sanitizer.js`.

O helper retorna SOMENTE `{name: 'Error'}` ou outro nome de classe de exceção de allowlist fechada; nunca serializa erro bruto, mensagem, stack, CPF, request, resposta HTTP, headers, segredo ou `eventId`. Um nome customizado que contenha dados pessoais é reclassificado como `Error`. Erros com getters inseguros também produzem saída neutra. Os testes `tests/marco9-privacy-logging-v1_2.test.js` incluem mensagens artificiais com dados sensíveis.

Preservados: verificação de autenticação própria do webhook, código HTTP, ACK/retry, idempotência, processamento do evento, Asaas Sandbox e tratamento de erro operacional. A mudança elimina informação de diagnóstico de exceção detalhada **nesse log**, que deverá ser substituída futuramente por códigos de evento controlados e métricas agregadas.

## Plano de dados e retenção (RETENTION_UNAPPROVED)

| Classe de dado | Restrição mínima proposta | Prazo aprovado? |
| --- | --- | --- |
| Token de sessão, App Check, token do webhook, segredo HMAC e API key Asaas | Não registrar valor bruto; acesso exclusivamente ao serviço autorizado | Não aplicável; nenhuma cópia em logs deve existir |
| CPF, e-mail, telefone, nome e identificadores diretos | Minimizar, mascarar quando inevitável; proteger trilha administrativa | RETENTION_UNAPPROVED |
| Ledger financeiro, webhook e reprocessamento | Guardar somente eventos/IDs indispensáveis, idempotência e status sanitizado; sem payload bruto em logs | RETENTION_UNAPPROVED |
| Nota, gabarito, respostas e certificado | Nunca escrever gabarito/resposta em logs; proteger consulta e histórico com Auth/RBAC | RETENTION_UNAPPROVED |
| App Check e contadores HMAC | Agregados de VALID/MISSING/INVALID e contadores com TTL previsto; sem UID em claro | RETENTION_UNAPPROVED |
| Logs operacionais de erros e auditoria de administração | Classes e códigos limitados, controle de leitura, correlação não identificável | RETENTION_UNAPPROVED |

É necessária decisão de governança sobre finalidade, categoria, prazo de retenção, perfis de acesso, eliminação, monitoramento de incidentes e exceções legais antes de afirmar conformidade. Não inventar períodos em dias e não aplicar Firestore TTL a coleções financeiras ou de auditoria sem aprovação.

## Riscos não resolvidos

- O repositório ainda contém outros pontos de logging em `functions/index.js` e módulos administrativos; eles precisam de inspeção individual, simulação de erro e evidência de sanitização. Este gate não modifica todos esses fluxos.
- É necessário confirmar permissões de acesso e retenção do Cloud Logging **no projeto `bjj-exams-staging`**, especialmente erros, payloads de webhook, identificadores de tentativas, audit_logs e pagamentos. Nada foi consultado neste gate.
- Não houve retro-limpeza de logs históricos, correção de dados já gravados ou migração. A equipe deverá decidir se há necessidade de investigação ou ação LGPD.
- A reclassificação sanitizada evita mensagens sensíveis no fluxo alterado, mas não protege contra outros pontos de exfiltração. Revisão externa/manual permanece obrigatória.

## Aceite do Gate 9.5A

Testes locais de erro com token falso, CPF fictício, e-mail fictício e getter malicioso; revisão do diff confirmando somente dois pontos de logging atualizados; CI com 133/133 regressões e demais gates existentes aprovados; nenhuma alteração a cobrança, regras, banco ou Hosting.

**Status:** `WEBHOOK_ERROR_LOG_SANITIZATION=2/2`, `RETENTION_UNAPPROVED`, `LIVE_LOG_AUDIT=NOT_RUN`, `NO_DEPLOY`, `NO_ENFORCEMENT`. Exemplo de teste somente no Asaas Sandbox; produção `bjj-exams` intocada.
