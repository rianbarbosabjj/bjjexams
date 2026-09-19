# Marco 5.5 — Fechamento técnico

## Escopo encerrado

O Marco 5.5 fecha o domínio course-first de cancelamento pré-pagamento, refund integral, refund parcial em reconciliação e chargeback/recovery, mantendo o Asaas como provedor e o estado canônico do BJJ Exams como fonte de verdade.

Produção permaneceu fora do escopo em todos os gates deste marco.

## Evidência de validação

### Domínio e emuladores

Os gates locais validaram:

- domínio de reversões;
- integração de estados canônicos;
- persistência e fulfillment transacional;
- worker HTTP/Firestore;
- callables administrativas;
- adapter Asaas Sandbox;
- reconciliação de `financial_reversal_requests`;
- idempotência e precedência de eventos fora de ordem.

Execuções finais relevantes:

```text
FINANCIAL_REVERSAL_ADMIN_REQUEST_RECONCILER_EMULATOR_V1_2=7/7
FINANCIAL_REVERSAL_FULFILLMENT_EMULATOR_V1_2=14/14
FINANCIAL_REVERSAL_FUNCTIONS_EMULATOR_V1_2=8/8
```

### Staging / Asaas Sandbox

O webhook dedicado `BJJ Exams Staging` foi configurado para os eventos de pagamento e reversão necessários ao Marco 5.5.

O smoke de cancelamento real confirmou:

```text
pending_payment -> PAYMENT_DELETED -> cancelled/cancelled
ENROLLMENT_CREATED=False
```

O smoke de refund real confirmou o comportamento assíncrono observado no Sandbox:

```text
PAYMENT_REFUND_DENIED -> financial_reversal_request.needs_reconciliation
order=paid
transaction=paid
enrollment=active
```

Esse caminho é intencionalmente fail-safe: quando o provedor nega o refund, o sistema não simula sucesso e não revoga o entitlement.

O Sandbox não forneceu um fluxo de chargeback real reproduzível e seguro durante este marco. Chargeback, disputa, recuperação e precedência de refund final permanecem cobertos pelos testes de domínio, Firestore Emulator e Functions Emulator.

## Propriedade das transições de estado

As tabelas genéricas `ORDER_STATUS_TRANSITIONS` e `TRANSACTION_STATUS_TRANSITIONS` permanecem deliberadamente conservadoras. Em especial, elas não abrem genericamente `chargeback -> paid`.

As transições excepcionais de reversão pertencem ao domínio contextual do Marco 5.5:

- `financial-reversal-domain.js` decide a transição permitida a partir do evento e do contexto;
- `financial-reversal-state-domain.js` valida o par canônico e materializa o próximo estado;
- `financial-reversal-fulfillment.js` exige evidência de recuperação antes de permitir `chargeback -> paid` e preserva a precedência de `refunded`.

Essa separação é uma fronteira de segurança: um chamador genérico do domínio financeiro não pode restaurar um chargeback apenas por escolher o próximo status. A recuperação exige evidência contextual do provedor.

## Firestore Rules

`orders`, `payment_transactions` e `payment_webhook_events` possuem bloqueios explícitos para clientes. As novas coleções internas do Marco 5.5:

- `financial_reversal_requests`;
- `financial_chargeback_recovery`;

também permanecem inacessíveis ao cliente porque a regra final `match /{document=**}` nega `read` e `write` por padrão. Portanto, não existe abertura de acesso cliente introduzida pelo Marco 5.5.

Como hardening de legibilidade e prevenção de regressão, o Marco 5.8 deve adicionar matches explícitos dessas duas coleções e respectivos testes de rules, mesmo que o deny-by-default atual já as proteja.

## Decisões operacionais preservadas

- cancelamento pré-pagamento não é refund;
- refund integral só revoga acesso após confirmação final do provedor;
- refund parcial não revoga integralmente o entitlement e exige reconciliação;
- `PAYMENT_REFUND_DENIED` mantém pagamento e acesso e marca a solicitação administrativa para reconciliação;
- chargeback revoga entitlement sem apagar progresso/conclusão histórica;
- recuperação de chargeback exige evidência canônica anterior de reversão da disputa;
- evento positivo atrasado não pode reativar acesso;
- refund final prevalece sobre chargeback tardio;
- secrets continuam server-side;
- runtime real do Marco 5.5 permanece restrito a staging/Sandbox até gate posterior de produção.

## Pendências deliberadamente fora do Marco 5.5

- UI/operacional para revisão de `needs_reconciliation` — Marco 5.6;
- financeiro de exames oficiais — Marco 5.7;
- matches explícitos de Firestore Rules para coleções internas de reversão — Marco 5.8;
- atualização planejada de `firebase-functions` e hardening final de dependências — Marco 5.8;
- homologação real de chargeback com o provedor quando houver fluxo seguro/reproduzível — produção readiness, nunca por simulação em produção.

## Critério de fechamento

Com os gates locais verdes, cancelamento real validado em staging, refund negado corretamente reconciliado em staging e nenhuma operação em produção, o Marco 5.5 está tecnicamente apto para integração em `develop-v1.2`.
