# Marco 5.4 — Webhook, confirmação e fulfillment financeiro v1.2

## Objetivo

Fechar o ciclo de pagamento de curso da v1.2 após o checkout do Marco 5.3:

1. receber eventos de pagamento do Asaas;
2. autenticar e persistir o evento de forma idempotente;
3. responder rapidamente ao provedor;
4. processar a confirmação de pagamento de forma assíncrona;
5. validar o estado do provedor contra pedido/transação canônicos;
6. marcar pedido e transação como pagos de forma atômica;
7. criar a matrícula canônica `enrollments` com `source=order` e `orderId`;
8. auditar toda a mudança;
9. permitir reconciliação segura quando um evento for perdido ou chegar fora de ordem.

Este marco permanece **staging/sandbox-first**. Nenhuma alteração de produção faz parte do Marco 5.4.

## Base já existente

O Marco 5.3 já entrega:

- `orders/{orderId}` canônico e idempotente;
- `payment_transactions/{transactionId}`;
- `financial_provider_customers/{customerId}`;
- `financial_checkout_leases/{transactionId}`;
- `externalReference` de cobrança `BJJEX-V12-ORDER-<orderId>`;
- `providerPaymentId` persistido na transação;
- checkout PIX no Asaas Sandbox;
- snapshot financeiro imutável;
- ausência de entitlement enquanto o pagamento permanece pendente.

O domínio financeiro já permite as transições:

- `order: pending_payment -> paid`;
- `transaction: pending -> paid`.

## Documentação Asaas considerada

Contrato atual do provedor considerado para este incremento:

- Webhooks usam entrega **at least once**;
- o mesmo evento reenviado mantém o mesmo campo `id`;
- `id` do evento deve ser usado como chave de idempotência;
- o endpoint deve persistir antes de responder e retornar HTTP `2xx` rapidamente;
- o processamento de negócio deve ocorrer de forma assíncrona;
- `authToken` é obrigatório na configuração de novos Webhooks;
- o token configurado é enviado no header `asaas-access-token`;
- a API Key Asaas não deve ser reutilizada como token de Webhook;
- `PAYMENT_CONFIRMED` representa pagamento concluído ainda sem saldo disponível;
- `PAYMENT_RECEIVED` representa pagamento recebido com saldo disponível.

Referências oficiais pesquisadas em setembro de 2026:

- `https://docs.asaas.com/docs/sobre-os-webhooks`
- `https://docs.asaas.com/docs/como-implementar-idempotencia-em-webhooks`
- `https://docs.asaas.com/docs/criar-novo-webhook-pela-api`
- `https://docs.asaas.com/docs/webhook-para-cobrancas`
- changelog de 20/02/2026 sobre obrigatoriedade de `authToken`.

## Arquitetura

Fluxo obrigatório:

```text
Asaas
  |
  | POST + asaas-access-token
  v
webhookAsaasPagamentosV12 (HTTP ingress)
  |
  | autentica token
  | normaliza projeção segura
  | persiste evento idempotente
  v
payment_webhook_events/{eventDocId}
  |
  | trigger Firestore assíncrono
  v
processarWebhookPagamentoV12 (worker)
  |
  | consulta/reconcilia cobrança no Asaas quando necessário
  | valida order + transaction + provider payment
  | transação Firestore atômica
  v
order=paid + transaction=paid + enrollment + audit
```

### Separação de responsabilidades

O ingress HTTP **não concede entitlement**.

Responsabilidades do ingress:

- validar método POST;
- validar `asaas-access-token`;
- validar estrutura mínima do envelope;
- gerar ID determinístico do documento a partir de `provider + event.id`;
- persistir uma projeção sanitizada do evento;
- tratar reentrega do mesmo `event.id` como sucesso idempotente;
- responder `2xx` após persistência confirmada.

Responsabilidades do worker:

- classificar o evento;
- ignorar eventos fora do escopo sem falhar a fila;
- revalidar pagamento no provedor antes do fulfillment;
- localizar a transação pelo `providerPaymentId` e/ou referência canônica;
- validar identidade, valor, referência e estado financeiro;
- realizar fulfillment atômico e idempotente;
- registrar status final do evento e auditoria.

## Autenticação do Webhook

Será usado secret dedicado:

`ASAAS_WEBHOOK_TOKEN`

Regras:

- diferente de `ASAAS_API_KEY`;
- server-side only;
- nunca persistido em Firestore;
- nunca logado;
- comparação do header feita de forma resistente a timing attacks quando os comprimentos forem compatíveis;
- no Marco 5.4, secret vinculado somente ao projeto exato `bjj-exams-staging`;
- produção permanece sem endpoint operacional do Marco 5.4.

Header esperado:

```text
asaas-access-token: <ASAAS_WEBHOOK_TOKEN>
```

Token ausente ou divergente retorna `401`/`403` sem persistir o evento.

## Modelo de `payment_webhook_events`

Documento:

`payment_webhook_events/{eventDocId}`

`eventDocId` é SHA-256 determinístico de:

```text
payment-webhook-event-v1:asaas:<providerEventId>
```

Campos mínimos:

```text
provider: asaas
providerEventId
providerEventType
providerEventCreatedAt
providerPaymentId
providerPaymentStatus
providerCustomerId
externalReference
billingType
valueCents
status: received | processing | processed | ignored | error
processingAttempts
orderId
transactionId
receivedAt
processingStartedAt
processedAt
errorCode
```

Não persistir:

- `authToken`;
- API Key;
- QR Code PIX;
- payload bruto completo;
- dados pessoais desnecessários do cliente.

O documento guarda apenas a projeção necessária para auditoria e processamento.

## Idempotência de ingresso

O mesmo `providerEventId` deve produzir o mesmo `eventDocId`.

Reentrega válida:

- não cria novo documento;
- não incrementa fulfillment;
- não cria matrícula duplicada;
- responde `2xx`;
- se o documento existente tiver identidade incompatível com o novo payload, falha fechado e registra erro operacional sem sobrescrever a identidade original.

Concorrência de duas entregas iguais deve ser serializada por transação Firestore.

## Eventos do Marco 5.4

Eventos elegíveis para confirmação:

```text
PAYMENT_CONFIRMED
PAYMENT_RECEIVED
```

Ambos podem originar tentativa de fulfillment, mas o resultado é idempotente.

Demais eventos são persistidos e classificados como `ignored` neste marco, salvo quando a configuração do Webhook limitar previamente os eventos recebidos.

Eventos de refund/chargeback pertencem ao Marco 5.5 e **não** devem reverter entitlement no 5.4.

## Validação antes do fulfillment

Antes de alterar qualquer estado para pago, o worker precisa confirmar no mínimo:

1. `provider === asaas`;
2. ambiente financeiro `sandbox`;
3. evento é elegível para confirmação;
4. `providerPaymentId` existe;
5. cobrança atual no Asaas existe;
6. cobrança atual está em estado pago compatível (`CONFIRMED` ou `RECEIVED`);
7. `externalReference` corresponde exatamente ao pedido canônico;
8. `providerPaymentId` corresponde à `payment_transaction` canônica;
9. `order.currentTransactionId` corresponde à transação processada;
10. `order.status` é `pending_payment` ou já `paid` pela mesma transação;
11. `transaction.status` é `pending` ou já `paid`;
12. `order.amountCents === transaction.amountCents`;
13. valor do provedor convertido para centavos corresponde ao valor canônico;
14. moeda canônica é `BRL`;
15. `billingType` é `PIX` para o fluxo do Marco 5.3;
16. snapshot de order e transaction permanece consistente;
17. comprador, produto e IDs canônicos permanecem coerentes.

Qualquer divergência falha fechado: não cria matrícula e não marca o pedido como pago.

## Fulfillment atômico

Para curso (`productType=course`), uma única transação Firestore deve:

1. reler `orders/{orderId}`;
2. reler `payment_transactions/{transactionId}`;
3. reler `enrollments/{enrollmentId}`;
4. validar novamente os estados e identidades;
5. atualizar order para `paid`, preservando todo snapshot;
6. atualizar transaction para `paid`;
7. preencher timestamps de confirmação somente quando ainda ausentes;
8. criar enrollment, se inexistente;
9. atualizar o evento para `processed`;
10. criar auditorias financeiras e de entitlement.

Nenhuma etapa intermediária pode deixar pedido pago sem entitlement ou entitlement pago sem pedido/transação confirmados.

## Enrollment pago

ID:

`enrollmentDocumentId(courseId, buyerUserId)`

Formato mínimo:

```text
courseId
userId
source: order
orderId
status: active
progressPercent: 0
startedAt
completedAt: null
createdAt
updatedAt
```

Se a matrícula já existir, ela só pode ser reutilizada quando corresponder exatamente ao mesmo usuário/curso/pedido e estiver em estado compatível. Caso contrário, o fulfillment falha fechado.

## Gates de implementação

### Gate 1 — domínio puro

Concluído:

- normalização/sanitização de envelope Asaas;
- classificação de eventos;
- chave determinística por `event.id`;
- conversão monetária segura;
- comparação de identidade de reentrega;
- autenticação constant-time.

Validação registrada:

- `FINANCIAL_WEBHOOK_DOMAIN_V1_2=20/20`;
- `FINANCIAL_DOMAIN_V1_2=40/40`;
- `ASAAS_CHECKOUT_ADAPTER_V1_2=16/16`.

### Gate 2 — persistência idempotente

Concluído no Firestore Emulator:

- criação sanitizada de `payment_webhook_events`;
- retry idempotente;
- concorrência;
- conflito de identidade;
- eventos fora do escopo como `ignored`;
- refund/chargeback explicitamente deferidos ao 5.5.

Validação registrada:

- `FINANCIAL_WEBHOOK_PERSISTENCE_EMULATOR_V1_2=7/7`.

### Gate 3 — reconciliação e fulfillment

Concluído localmente + Firestore Emulator:

- `GET /payments/{id}` no adapter Asaas;
- confirmação apenas para `CONFIRMED`/`RECEIVED` + PIX;
- cruzamento estrito provider/event/order/transaction;
- transação atômica de pagamento e entitlement;
- idempotência, concorrência e segundo evento de confirmação;
- falhas permanentes fechadas;
- estado provider ainda pendente tratado como retryable.

Validação registrada:

- `ASAAS_PAYMENT_RECONCILIATION_V1_2=2/2`;
- `FINANCIAL_WEBHOOK_FULFILLMENT_EMULATOR_V1_2=9/9`;
- regressão de persistência `7/7`.

### Gate 4 — Functions Emulator end-to-end

Concluído em Auth + Firestore + Functions Emulator:

- ingress HTTP Gen2;
- autenticação por `asaas-access-token` antes de persistir;
- resposta `202` após persistência;
- trigger Firestore assíncrono com retry;
- fake provider isolado em projeto `demo-*` + emuladores;
- estado fake compartilhado via Firestore Emulator entre processos;
- checkout fake -> `PAYMENT_RECEIVED` -> worker -> `order/transaction=paid` -> `enrollment source=order`;
- reentrega idempotente;
- conflito de identidade retorna `409` sem corromper estado;
- nenhuma escrita em `pedidos` ou `matriculas`.

Validação registrada:

- `ASAAS_CHECKOUT_PROVIDER_FACTORY_V1_2=5/5`;
- `FINANCIAL_WEBHOOK_FUNCTIONS_EMULATOR_V1_2=9/9`;
- `git diff --check` limpo;
- worktree limpa.

Avisos observados no Emulator Suite e classificados como não bloqueantes para este gate:

- host Node 24 executando funções configuradas para Node 22;
- warning de versão de `firebase-functions`;
- deprecation warning de `url.parse()` em dependência do Emulator Suite;
- alerta genérico de ADC, sem acesso a serviço real no fluxo validado `demo-*`.

### Gate 5 — staging controlado

Preparado, ainda não executado:

1. criar de forma idempotente o secret dedicado `ASAAS_WEBHOOK_TOKEN` apenas em `bjj-exams-staging`, sem imprimir o valor;
2. validar branch, worktree, aliases Firebase, Node 22, CLI pinada, ausência de provider fake e secrets de staging;
3. confirmar `ASAAS_API_KEY` Sandbox e `ASAAS_WEBHOOK_TOKEN` habilitados;
4. fazer deploy somente de:
   - `webhookAsaasPagamentosV12`;
   - `processarWebhookPagamentoV12`;
5. executar smoke de infraestrutura sem evento válido e sem chamada ao Asaas;
6. somente depois configurar o Webhook no Asaas Sandbox e realizar o smoke real do fluxo.

Scripts de segurança do Gate 5:

- `scripts/bootstrap-staging-webhook-secret-marco5d.ps1`;
- `scripts/precheck-marco5d-staging.ps1`.

Produção permanece explicitamente fora do escopo.

## Não objetivos do Marco 5.4

- refund;
- chargeback;
- cancelamento/reversão de enrollment;
- checkout de exames;
- cobrança de créditos;
- produção;
- UI de compra.

Refund e chargeback permanecem no Marco 5.5.
