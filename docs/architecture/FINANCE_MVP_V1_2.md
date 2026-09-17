# Financeiro canônico — BJJ Exams v1.2

## Objetivo

Construir o domínio financeiro canônico da v1.2 de forma reutilizável para cursos e, depois, exames oficiais, sem acoplar o novo fluxo ao legado `pedidos` / `matriculas`.

A primeira implementação será **course-first** e **staging/sandbox-first**. Nenhuma venda em produção faz parte dos primeiros incrementos.

## Estado atual relevante

A v1.2 já possui:

- `courses/{courseId}` com `priceCents`, `currency` e `financialRuleId`;
- `enrollments` com `source=order` e `orderId` obrigatório para matrícula originada de pagamento;
- proteção de ambiente que exige Asaas `sandbox` em `bjj-exams-staging` e Asaas `production` em `bjj-exams`;
- cliente Asaas legado capaz de criar cliente, cobrança PIX, consultar cobrança e enviar `split`;
- fluxo financeiro legado em `pedidos` / `matriculas`, que permanece somente como compatibilidade e não será fonte de verdade da v1.2.

## Princípios não negociáveis

1. Valores monetários internos são armazenados em **centavos inteiros**.
2. Percentuais financeiros internos são armazenados em **basis points (bps)**. `10000 bps = 100%`.
3. A taxa administrativa padrão da plataforma é **1000 bps (10%)**.
4. A taxa padrão é configurável pelo Administrador da Plataforma e pode ser sobrescrita por produto por meio de regra financeira específica.
5. Cada pedido e cada transação registram um **snapshot imutável da regra efetivamente aplicada**.
6. Alterar uma regra financeira não altera pedidos ou transações anteriores.
7. O navegador não escreve diretamente em pedidos, transações, regras financeiras, eventos de webhook ou liquidações.
8. Entitlement pago somente nasce após confirmação server-side de pagamento válido.
9. Webhooks e fulfillment são idempotentes.
10. Estorno, refund e chargeback precisam atualizar o estado financeiro e o entitlement de forma controlada e auditável.
11. Segredos Asaas nunca são enviados ao cliente.
12. Staging utiliza exclusivamente Asaas sandbox. Produção permanece fora de escopo até um gate explícito de release.
13. Nenhum cálculo financeiro crítico depende de `float` vindo do cliente.
14. Toda decisão financeira relevante precisa ser auditável: regra aplicada, versão, valor bruto, taxa da plataforma, recebedores, arredondamento e identificadores do provedor.

## Modelo canônico proposto

### `financial_rules/{ruleId}`

Regra financeira configurável pelo sistema.

Campos mínimos:

```text
name
status: active | inactive
scope: platform_default | product_override
productType: null | course | belt_exam
productId: null | <id>
platformFeeBps
recipientMode: product_owner | explicit
recipientShares[]
version
createdBy
updatedBy
createdAt
updatedAt
```

`recipientShares` representa a distribuição do **pool líquido após a taxa da plataforma**.

Cada item:

```text
recipientType: platform | user | organization
recipientId: <id ou null para platform>
shareBps
```

Invariantes:

- `platformFeeBps` entre `0` e `10000`;
- regra padrão inicial: `1000 bps`;
- em `recipientMode=explicit`, a soma dos `shareBps` precisa ser exatamente `10000`;
- regra inativa não pode originar novo snapshot;
- override de produto deve corresponder ao `productType` / `productId` usado na compra.

### `orders/{orderId}`

Pedido canônico, independente do provedor de pagamento.

Campos mínimos:

```text
buyerUserId
productType: course | belt_exam
productId
quantity
amountCents
currency: BRL
status
financialSnapshot
provider
providerCustomerId
currentTransactionId
idempotencyKey
createdAt
updatedAt
paidAt
cancelledAt
expiredAt
refundedAt
chargebackAt
```

Status iniciais:

```text
pending_payment
paid
cancelled
expired
refunded
chargeback
```

Transições devem ser validadas por domínio e nunca aceitas diretamente do cliente.

### `payment_transactions/{transactionId}`

Tentativa/transação financeira associada a um pedido.

Campos mínimos:

```text
orderId
buyerUserId
provider: asaas
providerPaymentId
providerStatus
status
amountCents
currency
financialSnapshot
providerSplitSnapshot
createdAt
updatedAt
confirmedAt
refundedAt
chargebackAt
```

Cada nova transação copia o snapshot financeiro do pedido. Retry do mesmo pedido não recalcula a regra.

### `payment_webhook_events/{eventId}`

Registro idempotente de webhook.

Campos mínimos:

```text
provider
providerEventId
providerPaymentId
eventType
status: received | processing | processed | ignored | error
orderId
transactionId
receivedAt
processedAt
errorCode
```

Payload bruto completo não deve ser persistido sem necessidade. Dados sensíveis devem ser minimizados.

## Snapshot financeiro

Estrutura lógica mínima:

```text
ruleId
ruleVersion
platformFeeBps
grossAmountCents
platformFeeCents
sellerPoolCents
recipientAllocations[]
resolvedAt
```

Cada `recipientAllocation` registra:

```text
recipientType
recipientId
shareBps
amountCents
```

O snapshot é histórico. Após sua criação, nenhuma alteração de regra pode reescrevê-lo.

## Arredondamento

O motor financeiro usa matemática inteira.

Fluxo:

1. calcula a taxa da plataforma em centavos a partir de `grossAmountCents` e `platformFeeBps`;
2. define `sellerPoolCents = grossAmountCents - platformFeeCents`;
3. distribui o pool líquido entre os recebedores segundo `shareBps`;
4. qualquer centavo residual de arredondamento precisa seguir algoritmo determinístico documentado;
5. a soma final de `platformFeeCents + recipientAllocations.amountCents` precisa ser exatamente igual ao valor bruto.

A política exata de desempate de centavos será congelada no contrato 5.1 e coberta por testes unitários.

## Resolução de regra

Ordem de precedência:

1. regra explícita referenciada pelo produto (`financialRuleId`);
2. regra padrão ativa da plataforma;
3. falha fechada se nenhuma regra válida puder ser resolvida.

A regra padrão nasce com taxa administrativa de 10%.

Para `recipientMode=product_owner`, o recebedor líquido é resolvido server-side a partir do proprietário canônico do produto.

Para divisão entre instrutor e academia, será usada regra `explicit` vinculada ao produto, com recebedores e participações declarados e validados antes da venda.

## Segurança e autorização

- `financial_rules`, `orders`, `payment_transactions` e `payment_webhook_events` ficam fechados para escrita direta do cliente;
- leitura do cliente ocorre somente por views sanitizadas/callables específicas;
- administração de regras financeiras exige papel global autorizado;
- `super_admin` sempre possui precedência global;
- `platform_admin` pode administrar a configuração padrão quando o contrato do incremento permitir;
- suporte a `finance_admin` deve respeitar a fonte autoritativa de claims e não será presumido antes dessa governança existir;
- preço, productId, recebedores e taxa nunca são aceitos como verdade a partir do cliente durante checkout.

## Relação com Asaas

O Asaas é provedor, não fonte de verdade do domínio.

A v1.2 deve encapsular o provedor atrás de adapter/service próprio. O legado `asaas-helpers.js` pode servir de referência, mas não define os contratos canônicos.

Regras:

- `externalReference` deve apontar de forma inequívoca para pedido/transação canônicos;
- split enviado ao Asaas deriva exclusivamente do snapshot persistido;
- IDs de wallet/conta do provedor são resolvidos server-side;
- webhook nunca confia apenas no evento: valida pedido, transação, valor, moeda e referência antes do fulfillment;
- consulta/reconciliação ativa ao provedor é fallback operacional, não substitui idempotência de webhook.

## Relação com entitlement

Curso pago:

1. checkout cria pedido/transação, mas **não cria entitlement**;
2. pagamento confirmado muda pedido/transação para estado pago;
3. fulfillment cria/atualiza `enrollments` canônico com `source=order` e `orderId`;
4. operação é idempotente;
5. refund/chargeback revoga o entitlement conforme contrato do Marco 5.5.

O legado `matriculas` não participa desse fluxo.

## Roadmap do Marco 5

### 5.1 — Fundação financeira e snapshots

Sem chamadas ao Asaas.

Entregas:

- domínio de regras financeiras;
- taxa padrão de 10% em bps;
- modelo de snapshot;
- matemática inteira e arredondamento determinístico;
- domínio de pedido e transação;
- máquinas de estado;
- regra de precedência default/override;
- Firestore rules fechando escrita direta;
- testes unitários e contrato versionado.

### 5.2 — Administração de regras e recebedores

Ainda sem cobrança real.

Entregas:

- callable para consultar configuração financeira sanitizada;
- callable administrativa para alterar taxa padrão;
- criação/ativação de regra específica por produto;
- validação de recebedores e readiness de conta/wallet;
- auditoria de toda mudança;
- impossibilidade de alterar snapshots históricos.

### 5.3 — Checkout de curso em Asaas sandbox

Entregas:

- criação idempotente de pedido canônico;
- resolução e persistência do snapshot antes de chamar o provedor;
- criação/reuso de cliente Asaas server-side;
- criação de cobrança PIX em sandbox;
- split Asaas derivado do snapshot;
- `externalReference` canônica;
- retorno sanitizado de dados do PIX ao cliente;
- nenhum entitlement antes do pagamento.

### 5.4 — Webhook, confirmação e fulfillment

Entregas:

- endpoint dedicado da v1.2;
- autenticação/validação do webhook;
- registro idempotente de evento;
- validação cruzada de valor, moeda, pedido e transação;
- confirmação atômica do pagamento;
- criação idempotente de enrollment com `source=order`;
- auditoria financeira e de entitlement;
- reconciliação segura para eventos perdidos.

### 5.5 — Cancelamento, refund e chargeback

Entregas:

- estados reversos do pedido/transação;
- tratamento idempotente de refund/chargeback;
- revogação controlada de entitlement;
- política para curso já concluído;
- trilha de auditoria;
- reconciliação financeira.

### 5.6 — Interface de compra e operação

Entregas:

- checkout do curso pago;
- QR Code / copia e cola PIX;
- estados pendente, pago, expirado, cancelado, reembolsado e chargeback;
- atualização segura após webhook/reconciliação;
- histórico sanitizado do comprador;
- visão operacional mínima para suporte financeiro.

### 5.7 — Integração financeira de exames oficiais

A fundação financeira é compartilhada, mas o fluxo de exames será modelado separadamente.

Antes de implementar:

- mapear o modelo legado de créditos de exame;
- decidir se o produto canônico será exame individual, pacote/crédito ou ambos;
- aplicar a mesma taxa padrão de plataforma e snapshots;
- evitar que semânticas específicas de curso contaminem o domínio de exame.

### 5.8 — Hardening e readiness de produção

Entregas:

- smoke end-to-end em staging/sandbox;
- observabilidade e alertas;
- reconciliação periódica;
- runbook de incidentes e webhook;
- políticas de retry e dead-letter operacional;
- revisão de IAM/Secrets/IaC;
- testes de refund e chargeback;
- gate explícito de produção.

**Nenhum deploy/venda em produção ocorre automaticamente ao concluir este marco.**

## Fora do 5.1

Não implementar no primeiro incremento:

- chamada ao Asaas;
- criação de cliente/cobrança;
- webhook;
- enrollment pago;
- refund;
- chargeback;
- UI de checkout;
- alteração de produção;
- migração automática de `pedidos` ou `matriculas` legados.

## Compatibilidade com legado

O código legado pode continuar funcionando enquanto a v1.2 é construída, mas:

- `pedidos` não é fonte canônica do novo financeiro;
- `matriculas` não é fonte canônica de entitlement;
- `curso.preco`, `professor_id` e `percentual_professor` não definem o contrato v1.2;
- não haverá dual-write silencioso entre os dois modelos;
- qualquer migração futura será explícita, auditável e tratada como projeto próprio.
