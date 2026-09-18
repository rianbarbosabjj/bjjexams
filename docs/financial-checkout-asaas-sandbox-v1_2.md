# Marco 5.3 — Checkout de curso no Asaas Sandbox

## Objetivo

Implementar o primeiro checkout financeiro canônico de cursos pagos da v1.2 usando Asaas **exclusivamente em Sandbox**, preservando as invariantes definidas nos Marcos 5.1 e 5.2.

Nenhuma venda em produção, webhook de confirmação, fulfillment pago, refund ou chargeback faz parte deste incremento.

## Escopo fechado

O Marco 5.3 entrega:

- criação idempotente de `orders/{orderId}`;
- persistência do snapshot financeiro antes de qualquer chamada ao provedor;
- criação/reuso de cliente Asaas server-side;
- criação de cobrança PIX em Asaas Sandbox;
- split derivado exclusivamente do snapshot persistido;
- `externalReference` canônica e determinística;
- reconciliação antes de recriar operação externa após timeout/retentativa;
- resposta PIX sanitizada;
- criação de `payment_transactions/{transactionId}`;
- nenhuma criação/ativação de `enrollments` antes da confirmação server-side do pagamento.

## Fora do escopo

Não implementar neste marco:

- produção;
- Asaas Production;
- confirmação por webhook;
- alteração de pedido para `paid`;
- fulfillment;
- enrollment com `source=order`;
- refund;
- chargeback;
- UI final de compra;
- migração de `pedidos`, `matriculas` ou wallets legadas.

## Ambiente

O checkout 5.3 é **sandbox-only**.

Permitido:

- Firebase `bjj-exams-staging`;
- ambiente financeiro `sandbox`;
- emuladores locais com dependências injetadas/fakes e sem tráfego externo real.

Bloqueado:

- Firebase `bjj-exams`;
- ambiente financeiro `production`;
- projeto Firebase desconhecido;
- chave Asaas incompatível com Sandbox.

Mesmo que o código seja acidentalmente implantado em produção, a superfície do 5.3 deve falhar fechada antes de criar cliente ou cobrança.

## Idempotência do pedido

A mera persistência de `idempotencyKey` não é suficiente.

O `orderId` do 5.3 é determinístico e derivado server-side de:

```text
buyerUserId
courseId
idempotencyKey
```

A forma lógica é:

```text
sha256("financial-order-v1:<buyerUserId>:<courseId>:<idempotencyKey>")
```

Invariantes:

1. repetir exatamente a mesma intenção retorna o mesmo `orderId`;
2. o pedido existente é validado antes de ser reutilizado;
3. a repetição não cria novo audit log;
4. a repetição não recalcula preço, regra ou snapshot;
5. mudança posterior de preço/regra não altera o pedido já criado;
6. uma nova intenção de compra exige novo `idempotencyKey`.

## Snapshot antes do provedor

A ordem é obrigatória:

1. autenticar usuário;
2. carregar curso canônico;
3. resolver regra financeira efetiva;
4. construir snapshot em centavos/bps;
5. persistir `order` + audit de criação atomicamente;
6. somente depois iniciar qualquer operação Asaas.

O navegador nunca envia como verdade:

- preço;
- taxa da plataforma;
- recebedores;
- wallets;
- valor de split;
- `providerCustomerId`;
- `providerPaymentId`.

## Cliente Asaas canônico

O 5.3 não reutiliza silenciosamente identificadores de cliente legados.

Será usada coleção server-side canônica:

```text
financial_provider_customers/{accountId}
```

Identidade lógica:

```text
provider + environment + userId
```

Campos mínimos:

```text
provider: asaas
environment: sandbox
userId
providerCustomerId
externalReference
createdAt
updatedAt
```

Nenhuma PII adicional precisa ser duplicada nessa coleção.

Para criação do cliente, os dados vêm do perfil canônico server-side. O checkout não aceita nome, CPF, e-mail ou telefone enviados pelo navegador como fonte autoritativa.

Antes de criar cliente novo:

1. reutilizar vínculo canônico persistido quando válido;
2. se não houver vínculo, procurar no Asaas por identificador reconciliável;
3. só então criar cliente;
4. após criação, persistir `providerCustomerId` canônico.

O `externalReference` do cliente deve ser determinístico e não conter PII em claro.

## Transação canônica

Cada pedido do 5.3 possui uma transação Asaas canônica em:

```text
payment_transactions/{transactionId}
```

O `transactionId` deve ser determinístico para o par pedido/provedor no fluxo inicial do 5.3.

A transação copia o snapshot do pedido e nasce antes da confirmação do pagamento.

Status esperados neste marco:

```text
created
pending
failed
cancelled
expired
```

O 5.3 não promove para `paid`; isso pertence ao Marco 5.4.

## External reference da cobrança

A cobrança Asaas usa referência canônica determinística ligada ao pedido.

Formato lógico:

```text
BJJEX-V12-ORDER-<orderId>
```

Essa referência é usada para:

- localizar cobrança após timeout;
- impedir recriação cega;
- reconciliação operacional;
- validação futura do webhook.

Antes de criar nova cobrança após retentativa inconclusiva, o serviço deve consultar o Asaas por `externalReference`.

## Concorrência e lease

Idempotência do pedido não elimina corrida na chamada ao provedor.

O checkout deve possuir trava/lease server-side canônica por pedido/transação.

Objetivos:

- um único executor ganha o direito de criar/reconciliar a cobrança;
- chamadas concorrentes não criam duas cobranças;
- lease expira para recuperação após crash;
- após lease expirado, o novo executor reconcilia por `externalReference` antes de criar.

Uma chamada que encontrar lease ativo pode retornar estado `processing` sanitizado para nova consulta/retry do mesmo checkout.

## Readiness dos recebedores

A readiness financeira é revalidada no momento do checkout.

Para cada `recipientAllocation` não pertencente à plataforma:

- identidade canônica precisa existir;
- `financial_recipient_accounts` precisa existir para `asaas + sandbox`;
- status precisa ser `ready`;
- `walletId` precisa estar presente;
- nenhuma wallet legada é fallback.

Recebedor `platform` usa a conta principal e não gera item de split para a própria wallet emissora.

## Split e tarifa do Asaas

Decisão aprovada para o Marco 5.3:

**a tarifa do Asaas é absorvida pela parcela da plataforma.**

Consequência:

- cada recebedor externo recebe `fixedValue` exatamente igual ao `amountCents` calculado para ele no snapshot;
- o `fixedValue` é convertido de centavos para decimal apenas na borda do adapter;
- a plataforma não é incluída como recebedora da própria cobrança;
- o saldo líquido não distribuído permanece na conta principal;
- a tarifa do Asaas reduz a parcela econômica da plataforma, não a alocação histórica do recebedor.

Exemplo conceitual:

```text
Venda: R$ 100,00
Taxa plataforma no snapshot: R$ 10,00
Seller pool: R$ 90,00
Recebedor externo: R$ 90,00 fixedValue
Tarifa Asaas hipotética: R$ 2,00
Resultado econômico:
- recebedor externo: R$ 90,00
- plataforma: R$ 8,00
```

Se o valor líquido disponível no Asaas não comportar a soma dos `fixedValue` externos, o checkout falha fechado. Não há redução automática do valor dos recebedores e não há recalculo silencioso do snapshot.

## Provider split snapshot

A transação persiste o split efetivamente enviado ao provedor para auditoria/reconciliação.

Campos lógicos por item:

```text
recipientType
recipientId
walletId
fixedValueCents
externalReference
```

Esse estado é server-side e não é retornado integralmente ao navegador.

## Cobrança PIX

A cobrança do 5.3 usa:

```text
billingType: PIX
currency: BRL
```

O valor é sempre derivado de `order.amountCents`.

A resposta ao cliente pode conter apenas dados necessários ao pagamento, por exemplo:

```text
orderId
transactionId
status
paymentId
pix.encodedImage
pix.payload
pix.expirationDate
```

Não retornar:

- chave da API;
- wallets;
- split completo;
- dados internos de auditoria;
- resposta bruta irrestrita do Asaas.

## Entitlement

O checkout não concede acesso ao curso.

Durante todo o Marco 5.3:

```text
order.status = pending_payment
transaction.status = created | pending | failed | cancelled | expired
```

Nenhuma operação cria `enrollments`.

A confirmação válida de pagamento e o fulfillment ficam para o Marco 5.4.

## Auditoria mínima

A trilha deve permitir reconstruir:

- quem iniciou o checkout;
- pedido canônico;
- regra e versão do snapshot;
- valor bruto;
- alocações;
- transação;
- provider payment ID;
- externalReference;
- resultado de reconciliação/criação;
- falha do provedor sem persistir segredo ou payload sensível desnecessário.

## Gates do Marco 5.3

1. contrato + idempotência real do pedido, sem Asaas;
2. domínio/adapter de split e referências, com testes unitários;
3. customer binding + readiness + transaction/lease em Firestore Emulator;
4. callable do checkout em Functions Emulator, com adapter fake;
5. integração real somente em `bjj-exams-staging` + Asaas Sandbox;
6. smoke confirmando PIX pendente e ausência de enrollment;
7. merge em `develop-v1.2` somente após todos os gates.

Produção permanece proibida durante todo o Marco 5.3.
