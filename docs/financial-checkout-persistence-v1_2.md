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

## Entitlement

Nenhuma coleção `enrollments` é criada ou alterada por esta camada. A transação permanece `created` até o próximo gate. Pagamento e fulfillment continuam pertencendo ao Marco 5.4.

## Segurança

As coleções de customer binding, lease, pedidos, transações, regras e contas de recebedores são estado interno de backend. O cliente não recebe wallets, lease tokens, snapshots de split ou identificadores internos de provisionamento.

Produção e Asaas Production permanecem bloqueados no Marco 5.3.
