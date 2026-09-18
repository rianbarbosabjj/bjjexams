# Persistência operacional do checkout — BJJ Exams v1.2

## Escopo

Este documento complementa o contrato do Marco 5.3 para o estado server-side necessário antes da chamada ao Asaas. Todo o conteúdo deste incremento é `sandbox` only.

## `financial_provider_customers/{customerId}`

Vínculo canônico entre um usuário do BJJ Exams e o customer do provedor.

O `customerId` é determinístico a partir de:

```text
provider + environment + userId
```

Campos:

```text
provider: asaas
environment: sandbox
userId
providerCustomerId: null | <id Asaas>
externalReference
status: idle | provisioning | ready
leaseToken: null | <token interno>
leaseExpiresAt: null | <timestamp>
createdAt
updatedAt
```

Regras:

- `externalReference` é determinística e não contém PII em claro;
- `ready` exige `providerCustomerId`;
- `provisioning` exige lease ativa;
- duas tentativas concorrentes de provisionar o mesmo usuário convergem para o mesmo documento;
- uma lease ativa impede segunda criação concorrente de customer;
- uma lease expirada pode ser retomada;
- completar novamente o mesmo binding é idempotente;
- tentar substituir um binding `ready` por outro `providerCustomerId` falha fechado;
- o perfil canônico `usuarios/{uid}` precisa existir.

## `payment_transactions/{transactionId}`

No checkout inicial, o `transactionId` é determinístico para:

```text
provider + orderId
```

A transação nasce antes da chamada externa e copia o snapshot financeiro do pedido.

No Marco 5.3 ela também persiste `providerSplitSnapshot` com o split calculado server-side:

```text
recipientType
recipientId
walletId
fixedValueCents
externalReference
```

As wallets vêm exclusivamente de `financial_recipient_accounts` do ambiente `sandbox` e são revalidadas no checkout.

## Revalidação de recebedor

Para cada alocação externa do snapshot:

1. a identidade canônica atual precisa existir em `usuarios` ou `organizacoes`;
2. a conta determinística de recebedor precisa existir;
3. `provider` precisa ser `asaas`;
4. `environment` precisa ser `sandbox`;
5. `status` precisa ser `ready`;
6. `walletId` precisa estar presente;
7. o split é reconstruído a partir do snapshot e comparado com a transação existente em retries.

Uma conta que era válida quando a regra foi configurada, mas deixou de estar válida depois, bloqueia novo checkout.

## `financial_checkout_leases/{transactionId}`

Lease operacional para impedir duas chamadas concorrentes ao provedor para a mesma transação.

Campos:

```text
orderId
transactionId
provider: asaas
environment: sandbox
status: active | released
leaseToken
acquiredAt
expiresAt
updatedAt
```

Regras:

- somente um executor pode possuir lease ativa por transação;
- uma segunda chamada encontra `processing` enquanto a lease estiver válida;
- lease expirada pode ser retomada;
- release exige o `leaseToken` do executor atual;
- o token nunca é exposto ao navegador;
- no Gate 4, o executor que possui a lease é o único autorizado a reconciliar/criar a cobrança externa.

## Pedido e customer

Ao preparar a transação, o pedido canônico é atualizado somente server-side com:

```text
provider: asaas
currentTransactionId
providerCustomerId // apenas se já houver binding ready
updatedAt
```

Preço, produto, snapshot e idempotencyKey não são recalculados nem substituídos.

## Vínculo da cobrança do provedor

Quando uma cobrança é reconciliada ou criada, a persistência valida antes de gravar:

```text
providerPaymentId presente
externalReference == BJJEX-V12-ORDER-<orderId>
customer == providerCustomerId canônico
value == order.amountCents
```

Após validação, a transação passa para `pending`, grava `providerPaymentId` e `providerStatus`, o pedido grava o `providerCustomerId` canônico e a lease do checkout é liberada na mesma transação Firestore.

Nenhuma confirmação de pagamento ocorre neste passo. Mesmo que o provedor reporte um status posterior, o Marco 5.3 não promove `order.status` para `paid` e não cria entitlement.

## Callable do Gate 4

A superfície pública é:

```text
iniciarCheckoutCursoV12
```

Entrada permitida:

```text
courseId
idempotencyKey
```

Preço, taxa, wallet, CPF, customer ID, payment ID, split e vencimento não são aceitos como fonte autoritativa do cliente.

Resposta sanitizada:

```text
ok
orderId
transactionId
status: processing | pending_payment
processing
paymentId
pix.encodedImage
pix.payload
pix.expirationDate
```

Não são retornados `providerCustomerId`, wallets, `providerSplitSnapshot`, segredo Asaas ou payload bruto.

## Provider fake do Functions Emulator

O Gate 4 usa provider fake somente quando todas as condições forem verdadeiras:

```text
projectId começa com demo-
FUNCTIONS_EMULATOR=true
FIRESTORE_EMULATOR_HOST é loopback
BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE=true
```

Fora dessas condições o fake falha fechado. O caminho fake não lê `ASAAS_API_KEY`.

## Entitlement

Nenhuma coleção `enrollments` é criada ou alterada por esta camada. No Gate 3 a transação permanece `created`; no Gate 4 ela pode chegar a `pending` após vínculo da cobrança. Pagamento confirmado e fulfillment continuam pertencendo ao Marco 5.4.

## Segurança

As coleções de customer binding, lease, pedidos, transações, regras e contas de recebedores são estado interno de backend. O cliente não recebe wallets, lease tokens, snapshots de split ou identificadores internos de provisionamento.

Produção e Asaas Production permanecem bloqueados no Marco 5.3.