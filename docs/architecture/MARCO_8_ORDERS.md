# Marco 8.5 - Pedidos Operacionais

## 1. Objetivo

O Gate 8.5 adiciona a superficie **Pedidos** ao Painel Operacional do
Marco 8.

Essa superficie e estritamente operacional e read-only.

Ela nao substitui o dominio financeiro canonico, nao cria ledger paralelo,
nao altera pedidos e nao concede acesso ao Console Financeiro.

## 2. Fontes autoritativas

A leitura operacional deve reutilizar exclusivamente fontes canonicas ja
existentes:

- `orders`
- `payment_transactions`
- `courses`
- `exam_sessions`
- `enrollments`
- `exam_registrations`
- `usuarios`
- `financial_reversal_requests`

Os nomes efetivamente existentes no codigo canonico continuam autoritativos.
Se algum nome fisico diferir, o service deve importar/reutilizar a constante
canonica correspondente em vez de criar uma nova collection.

Nao criar:

- `admin_orders`
- `operational_orders`
- `orders_v2`
- qualquer copia persistida para o Painel Operacional.

## 3. Boundary entre Painel Operacional e Console Financeiro

`ops.orders.read` e `console.finance.read` sao capacidades diferentes.

Pedidos deve permitir leitura operacional para os papeis definidos pela
matriz do Marco 8, sem transformar `support_admin` em administrador
financeiro.

O callable legado `listarOperacoesFinanceirasV12` nao e o contrato da
superficie Pedidos porque sua autorizacao atual pertence ao dominio
financeiro e exige autoridade financeira mais restrita.

O Gate 8.5 deve criar uma camada administrativa estreita e sanitizada sobre
as fontes financeiras canonicas.

Nenhum contrato deste gate pode:

- solicitar estorno;
- cancelar pagamento;
- reprocessar webhook;
- editar regra financeira;
- alterar split;
- editar ledger;
- alterar entitlement;
- alterar `exam_registration`;
- confiar em status financeiro enviado pelo cliente.

## 4. Capability

Leituras de Pedidos exigem:

`ops.orders.read`

Papeis com essa capability no contrato atual:

- `super_admin`
- `platform_admin`
- `finance_admin`
- `support_admin`

`content_admin` nao recebe `ops.orders.read`.

Role organizacional nunca autoriza essa superficie global.

Autenticacao e autorizacao devem ocorrer antes da validacao de filtros
enviados pelo cliente.

## 5. Contratos

Novos callables:

- `listarPedidosOperacionaisV12`
- `obterPedidoOperacionalV12`

Ambos:

- exigem Firebase Auth;
- exigem `ops.orders.read`;
- usam somente allowlist de payload;
- retornam erros sanitizados;
- nao recebem role/capability do cliente;
- nao vinculam secrets Asaas;
- permanecem staging/demo-emulator only.

## 6. OperationalOrderView

Campos de nivel superior permitidos:

- `orderId`
- `productType`
- `productSummary`
- `buyerSummary`
- `paymentStatus`
- `fulfillmentStatus`
- `reversalStatus`
- `reconciliationStatus`
- `createdAt`

Nenhum outro campo de nivel superior deve ser retornado.

### 6.1 productSummary

Campos permitidos:

- `productType`
- `productId`
- `label`

`productType` continua limitado aos tipos canonicos do financeiro:

- `course`
- `belt_exam`

### 6.2 buyerSummary

Campos permitidos:

- `userId`
- `displayName`
- `email`

A view nao retorna claims, memberships brutas, CPF, telefone, token ou
credenciais.

### 6.3 paymentStatus

Objeto sanitizado:

- `orderStatus`
- `transactionStatus`

Os valores devem derivar exclusivamente dos documentos canonicos
`orders` e `payment_transactions`.

### 6.4 fulfillmentStatus

Objeto sanitizado:

- `kind`
- `status`

`kind`:

- `enrollment` para `course`
- `exam_registration` para `belt_exam`

`status` deve ser derivado do documento canonico correspondente.

### 6.5 reversalStatus

Objeto sanitizado ou `null`:

- `status`
- `operation`

Nunca retornar payload do provider, resposta bruta do Asaas ou identificador
secreto.

### 6.6 reconciliationStatus

Objeto:

- `required`

`required` e booleano derivado do estado canonico financeiro/academico.

## 7. Campos proibidos

OperationalOrderView nunca retorna:

- `providerPaymentId`
- `providerCustomerId`
- `walletId`
- `splitSnapshot`
- `recipientShares`
- `platformFeeBps`
- `financialRuleId`
- `idempotencyKey`
- `webhookToken`
- `apiKey`
- payload bruto do Asaas
- resposta bruta de webhook
- secrets
- dados de cartao
- dados bancarios
- CPF completo

A existencia desses campos nas fontes canonicas nao autoriza exposicao
operacional.

## 8. Listagem

`listarPedidosOperacionaisV12`

Payload permitido:

- `limit`
- `cursor`
- `productType`
- `orderStatus`

Regras:

- default `limit = 20`;
- maximo `limit = 25`;
- cursor opaco, versionado e validado no backend;
- ordenacao deterministica;
- sem scan ilimitado;
- nenhum filtro arbitrario;
- nenhum nome de collection vindo do cliente.

A implementacao pode usar estrategia de scan limitado quando um filtro
derivado impedir query direta, mas deve possuir teto explicito e
continuacao deterministica.

## 9. Detalhe

`obterPedidoOperacionalV12`

Payload permitido:

- `orderId`

Regras:

- lookup direto por identificador canonico;
- `orderId` validado no backend;
- retorna somente `OperationalOrderView`;
- `not-found` sanitizado quando o pedido nao existir.

## 10. Reuso do dominio financeiro

O Gate 8.5 deve reutilizar:

- `validateOrder`
- `validateTransaction`
- tipos e statuses de `financial-domain.js`
- regras canonicas de enrollment e exam registration
- logica canonica de reversal/reconciliation quando aplicavel

Pode extrair helpers puros compartilhados quando isso reduzir duplicacao,
desde que:

- nao altere sem necessidade o comportamento dos callables financeiros
  existentes;
- mantenha compatibilidade com Cursos e Exames;
- preserve snapshots financeiros historicos;
- nao amplie permissoes financeiras.

## 11. Service

O read service operacional deve:

- viver no modulo administrativo do Marco 8;
- ser Firestore-read-only;
- carregar somente documentos necessarios;
- validar documentos canonicos antes de montar a view;
- tratar ausencia de dados relacionados de forma deterministica;
- falhar fechado quando houver inconsistencia canonica relevante;
- nao escrever em Firestore;
- nao chamar provider financeiro.

O service nao pode depender de:

- `ASAAS_API_KEY`
- `ASAAS_WEBHOOK_TOKEN`
- Gemini
- provider factory
- adapters HTTP financeiros.

## 12. Runtime

A composicao usa a mesma barreira administrativa do Marco 8:

`adminRuntimeAllowed`

Portanto, os callables deste gate permanecem:

- staging only em Firebase real;
- permitidos em demo/emulator controlado;
- indisponiveis em producao.

Nenhum passo deste documento autoriza deploy em producao.

## 13. Sequencia de implementacao

### 8.5A

Arquitetura e contratos.

### 8.5B

`OperationalOrderView` e helpers de sanitizacao.

### 8.5C

Read service de Pedidos.

### 8.5D

Callables e composicao em `functions/main.js`.

### 8.5E

Integracao e regressao local.

### 8.5F

Staging controlado e smoke funcional.

Depois do 8.5F, o proximo bloco do Marco 8 passa para as superficies do
Console, sem autorizar producao.
