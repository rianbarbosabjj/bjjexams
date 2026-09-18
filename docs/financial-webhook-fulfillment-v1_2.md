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

Comportamento idempotente:

- enrollment inexistente: cria;
- enrollment existente com mesmo `courseId`, `userId`, `source=order` e mesmo `orderId`: reutiliza;
- enrollment `active`/`completed` compatível não é duplicado;
- enrollment existente incompatível falha fechado e exige revisão operacional;
- matrícula gratuita anterior para curso pago não é silenciosamente convertida.

## Timestamps

`paidAt` do order e `confirmedAt` da transaction representam o primeiro fulfillment confirmado no domínio canônico.

Retry ou segundo evento pago não deve reescrever esses timestamps históricos.

`processedAt` pertence ao evento específico e pode ser diferente entre `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED`.

## Auditoria

No fulfillment inicial criar, no mínimo:

```text
financial.payment.confirmed
course.enrollment.payment_granted
```

A auditoria deve registrar IDs e estados necessários, mas não secrets nem payload bruto do Asaas.

Retry idempotente sem mudança de estado não cria auditoria duplicada de fulfillment.

## Tratamento de eventos fora de ordem

A ordem de chegada do Webhook não é assumida como fonte de verdade.

Exemplo:

- `PAYMENT_RECEIVED` pode ser processado antes de `PAYMENT_CONFIRMED`;
- o primeiro evento que comprovar estado pago faz o fulfillment;
- o segundo evento é processado idempotentemente sem nova matrícula/auditoria de concessão.

A consulta ativa ao provedor é usada para confirmar o estado atual e evitar que um evento antigo sobrescreva estado mais novo.

## Reconciliação

O Marco 5.4 deve expor uma função/service server-side de reconciliação que receba uma transação/pedido canônico e consulte o Asaas por `providerPaymentId` ou `externalReference`.

Objetivos:

- recuperar webhook perdido;
- completar evento que ficou em erro transitório;
- confirmar estado sem duplicar fulfillment;
- nunca recalcular snapshot financeiro.

Reconciliação não substitui o Webhook como caminho primário.

## HTTP e retry

Ingress autenticado e persistido com sucesso deve retornar `2xx` mesmo se a regra de negócio ainda não tiver sido processada.

Falha antes da persistência retorna não-2xx para permitir retry do Asaas.

Evento duplicado persistido retorna `2xx`.

Worker com erro transitório mantém o evento recuperável; erro de integridade canônica permanece fail-closed e exige observabilidade/reconciliação.

## Segurança de Firestore

Continuam fechadas para cliente:

```text
orders
payment_transactions
payment_webhook_events
enrollments
```

Nenhuma leitura/escrita direta pelo navegador é adicionada no Marco 5.4.

## Legado

O Marco 5.4 não escreve em:

```text
pedidos
matriculas
cursos_teoricos
```

O fulfillment usa exclusivamente `orders`, `payment_transactions`, `enrollments` e domínio de curso v1.2.

## Gates

### Gate 1 — contrato e domínio puro

- contrato versionado;
- normalização de envelope Asaas;
- ID determinístico de evento;
- classificação de evento;
- projeção sanitizada;
- testes unitários sem Firebase/Asaas.

### Gate 2 — persistência idempotente do ingress

- service Firestore para reservar/persistir evento;
- concorrência e reentrega;
- identidade incompatível fail-closed;
- Firestore Emulator.

### Gate 3 — fulfillment transacional

- validação order/transaction/provider projection;
- criação idempotente de enrollment `source=order`;
- order/transaction `paid` atomicamente;
- auditoria;
- testes unitários + Firestore Emulator.

### Gate 4 — endpoint e worker com provider fake

- `webhookAsaasPagamentosV12` HTTP;
- `processarWebhookPagamentoV12` Firestore trigger/worker;
- autenticação via secret dedicado;
- provider fake local;
- Functions Emulator;
- nenhum acesso Secret Manager no modo fake/demo.

### Gate 5 — staging infrastructure

- criar/validar `ASAAS_WEBHOOK_TOKEN` em staging;
- deploy somente das superfícies 5.4 necessárias;
- validar invoker do ingress;
- configurar/reconciliar Webhook no Asaas Sandbox;
- apenas eventos necessários;
- produção proibida.

### Gate 6 — smoke real Sandbox

- provocar confirmação de um pagamento Sandbox controlado;
- confirmar persistência de evento;
- confirmar order/transaction `paid`;
- confirmar enrollment `source=order`;
- reenviar/reprocessar mesmo evento e validar idempotência;
- confirmar ausência de escrita legada;
- registrar evidências sanitizadas.

### Gate 7 — merge

Somente após Gates 1–6 verdes.

## Fora do Marco 5.4

- refund;
- chargeback;
- revogação de entitlement;
- política para curso concluído após estorno;
- interface de checkout;
- histórico do comprador;
- venda em produção;
- deploy em `bjj-exams`.

Esses itens permanecem nos Marcos 5.5, 5.6 e 5.8 conforme roadmap.
