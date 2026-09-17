# Contrato 5.1 — Fundação financeira v1.2

## Status

Planejado para implementação no Marco 5.1.

Este contrato define somente domínio, matemática e persistência canônica. Não autoriza chamada ao Asaas, webhook ou venda em produção.

## Objetivo

Definir uma fundação financeira determinística e auditável para que checkout, split, webhook, refund e entitlement pago sejam implementados posteriormente sem depender do legado.

## Constantes

```text
CURRENCY = BRL
BPS_DENOMINATOR = 10000
DEFAULT_PLATFORM_FEE_BPS = 1000
```

`1000 bps = 10%`.

## Tipos suportados no domínio

### Produto

```text
course
belt_exam   # reservado para integração posterior
```

O Marco 5.1 implementa e testa o tipo `course`. `belt_exam` permanece reservado no enum para evitar um segundo domínio financeiro incompatível.

### Recebedor

```text
platform
user
organization
```

### Status de regra

```text
active
inactive
```

### Escopo de regra

```text
platform_default
product_override
```

### Modo de recebedor

```text
product_owner
explicit
```

## Regra financeira normalizada

```js
{
  id: '...',
  name: '...',
  status: 'active',
  scope: 'platform_default',
  productType: null,
  productId: null,
  platformFeeBps: 1000,
  recipientMode: 'product_owner',
  recipientShares: [],
  version: 1,
  createdBy: 'uid',
  updatedBy: 'uid',
  createdAt: timestamp,
  updatedAt: timestamp
}
```

### Invariantes de regra

1. `platformFeeBps` é inteiro entre `0` e `10000`.
2. `version` é inteiro maior ou igual a `1`.
3. regra `platform_default` não possui `productType` nem `productId`;
4. regra `product_override` exige `productType` e `productId`;
5. regra `active` pode originar snapshot; regra `inactive` não pode;
6. em `recipientMode=product_owner`, `recipientShares` precisa estar vazio;
7. em `recipientMode=explicit`, `recipientShares` precisa conter pelo menos um item;
8. a soma de `recipientShares.shareBps` deve ser exatamente `10000`;
9. cada `shareBps` é inteiro positivo;
10. não pode haver recebedor duplicado pelo par `recipientType + recipientId`;
11. recebedor `platform` usa `recipientId=null`;
12. recebedor `user` ou `organization` exige `recipientId` válido.

## Precedência de regra

`resolveEffectiveFinancialRule` recebe:

- produto canônico;
- regra referenciada por `financialRuleId`, quando houver;
- regra padrão ativa da plataforma.

Ordem:

1. se o produto possui `financialRuleId`, a regra precisa existir, estar ativa e corresponder ao produto;
2. se não possui override, usa a regra padrão ativa;
3. se a resolução falhar, a compra falha fechada.

Não existe fallback silencioso de override inválido para regra padrão.

## Resolução de recebedores

### `recipientMode=product_owner`

Para curso:

- `ownerType=platform` -> plataforma recebe 100% do seller pool;
- `ownerType=user` -> `ownerId` recebe 100% do seller pool;
- `ownerType=organization` -> `ownerId` recebe 100% do seller pool.

### `recipientMode=explicit`

A regra já contém os recebedores e participações do seller pool.

Esse modo permite, por exemplo, dividir o líquido entre instrutor e academia sem alterar a taxa administrativa da plataforma.

O Marco 5.1 não resolve wallet Asaas. Ele resolve somente identidade financeira canônica.

## Matemática da taxa da plataforma

Entrada:

```text
grossAmountCents >= 1
platformFeeBps entre 0 e 10000
```

Cálculo da taxa:

```text
raw = grossAmountCents * platformFeeBps
platformFeeCents = floor((raw + 5000) / 10000)
sellerPoolCents = grossAmountCents - platformFeeCents
```

Isso implementa arredondamento half-up usando somente inteiros.

Não existe taxa mínima em centavos no Marco 5.1.

## Distribuição do seller pool

Se houver somente um recebedor, ele recebe todo `sellerPoolCents`.

Com múltiplos recebedores:

1. para cada recebedor, calcula `numerator = sellerPoolCents * shareBps`;
2. valor base = `floor(numerator / 10000)`;
3. resto fracionário = `numerator % 10000`;
4. calcula quantos centavos ainda não foram distribuídos;
5. distribui os centavos residuais pela ordem de maior resto fracionário;
6. empate de resto é resolvido de forma estável pela chave `recipientType:recipientId` em ordem lexicográfica;
7. a soma final precisa ser exatamente `sellerPoolCents`.

Essa política é determinística e precisa ser coberta por testes.

## Snapshot financeiro

`buildFinancialSnapshot` produz estrutura imutável:

```js
{
  ruleId: 'platform-default',
  ruleVersion: 1,
  productType: 'course',
  productId: 'course-id',
  currency: 'BRL',
  grossAmountCents: 10000,
  platformFeeBps: 1000,
  platformFeeCents: 1000,
  sellerPoolCents: 9000,
  recipientMode: 'product_owner',
  recipientAllocations: [
    {
      recipientType: 'user',
      recipientId: 'uid',
      shareBps: 10000,
      amountCents: 9000
    }
  ],
  resolvedAt: timestamp
}
```

### Invariantes do snapshot

- `grossAmountCents = platformFeeCents + soma(recipientAllocations.amountCents)`;
- `sellerPoolCents = soma(recipientAllocations.amountCents)`;
- `platformFeeCents >= 0`;
- nenhuma alocação possui valor negativo;
- `currency=BRL` no escopo atual;
- rule ID e versão são obrigatórios;
- produto e valor bruto são obrigatórios;
- snapshot não contém dados recebidos do navegador sem resolução server-side.

## Pedido canônico

### Status

```text
pending_payment
paid
cancelled
expired
refunded
chargeback
```

### Transições permitidas

```text
pending_payment -> pending_payment
pending_payment -> paid
pending_payment -> cancelled
pending_payment -> expired

paid -> paid
paid -> refunded
paid -> chargeback

cancelled -> cancelled
expired -> expired
refunded -> refunded
chargeback -> chargeback
```

Todas as demais transições falham.

### Estrutura mínima

```js
{
  buyerUserId: 'uid',
  productType: 'course',
  productId: 'course-id',
  quantity: 1,
  amountCents: 10000,
  currency: 'BRL',
  status: 'pending_payment',
  financialSnapshot: {},
  provider: null,
  providerCustomerId: null,
  currentTransactionId: null,
  idempotencyKey: '...',
  createdAt: timestamp,
  updatedAt: timestamp,
  paidAt: null,
  cancelledAt: null,
  expiredAt: null,
  refundedAt: null,
  chargebackAt: null
}
```

No checkout futuro, `amountCents` vem do produto canônico carregado no backend e não do cliente.

## Transação canônica

### Status

```text
created
pending
paid
failed
cancelled
expired
refunded
chargeback
```

### Transições permitidas

```text
created -> created | pending | failed | cancelled
pending -> pending | paid | failed | cancelled | expired
paid -> paid | refunded | chargeback
failed -> failed
cancelled -> cancelled
expired -> expired
refunded -> refunded
chargeback -> chargeback
```

### Estrutura mínima

```js
{
  orderId: 'order-id',
  buyerUserId: 'uid',
  provider: 'asaas',
  providerPaymentId: null,
  providerStatus: null,
  status: 'created',
  amountCents: 10000,
  currency: 'BRL',
  financialSnapshot: {},
  providerSplitSnapshot: null,
  createdAt: timestamp,
  updatedAt: timestamp,
  confirmedAt: null,
  refundedAt: null,
  chargebackAt: null
}
```

Cada transação recebe cópia integral do snapshot do pedido. Retry não recalcula regra financeira.

## Idempotência

O domínio 5.1 valida a presença de `idempotencyKey` no pedido, mas a geração e uso operacional ficam no 5.3.

Requisitos futuros já congelados:

- mesma intenção idempotente não pode criar cobranças duplicadas;
- `providerPaymentId` precisa ser único por provedor;
- fulfillment de pedido pago precisa ser idempotente;
- webhook repetido não pode duplicar enrollment, auditoria ou distribuição financeira.

## Auditoria

Mudanças financeiras futuras devem registrar `audit_logs` com tipos dedicados, no mínimo:

```text
financial_rule
financial_order
financial_transaction
financial_fulfillment
financial_refund
financial_chargeback
```

Snapshots históricos nunca são reconstruídos a partir da regra atual durante auditoria.

## Persistência e Firestore Rules

Coleções reservadas:

```text
financial_rules
orders
payment_transactions
payment_webhook_events
```

No 5.1:

- leitura e escrita direta do cliente ficam bloqueadas;
- backend Admin SDK é a única camada autorizada a persistir;
- views sanitizadas serão adicionadas em incrementos posteriores.

## Compatibilidade com enrollment

Ao chegar ao 5.4, curso pago confirmado cria enrollment canônico equivalente a:

```text
source = order
orderId = <orders/{orderId}>
status = active
```

Esse vínculo já é compatível com o domínio de enrollment v1.2.

## Casos mínimos de teste do 5.1

1. normaliza 10% como `1000 bps`;
2. rejeita bps negativos;
3. rejeita bps acima de 10000;
4. regra default rejeita productId;
5. override exige productId;
6. regra inativa não resolve;
7. override inválido falha fechado;
8. product_owner resolve plataforma;
9. product_owner resolve usuário;
10. product_owner resolve organização;
11. explicit exige soma de 10000 bps;
12. rejeita recebedor duplicado;
13. cálculo 10% de R$ 100,00 = R$ 10,00;
14. valores pequenos seguem half-up determinístico;
15. múltiplos recebedores preservam soma exata em centavos;
16. empate de arredondamento tem ordem estável;
17. snapshot preserva ruleId/version;
18. snapshot fecha exatamente o valor bruto;
19. máquina de estado do pedido rejeita regressão inválida;
20. máquina de estado da transação rejeita regressão inválida;
21. pedido exige snapshot válido;
22. transação copia snapshot sem recalcular;
23. moeda diferente de BRL falha no escopo atual;
24. valores monetários não inteiros falham;
25. regras financeiras não são lidas/escritas diretamente pelo cliente.

## Critério de conclusão do 5.1

O Marco 5.1 somente estará concluído quando:

- contrato estiver versionado;
- domínio puro estiver implementado em módulo isolado;
- testes unitários cobrirem matemática, invariantes e máquinas de estado;
- regras Firestore bloquearem acesso direto;
- `functions/main.js` puder compor os próximos módulos sem reabrir o monólito legado;
- nenhum código do 5.1 chamar Asaas;
- nenhum dado for escrito em produção;
- staging não precisar ser alterado para validar o domínio puro.
