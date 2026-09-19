# Marco 5.5 — Cancelamento, refund e chargeback financeiro v1.2

## Objetivo

Estender o financeiro canônico da v1.2 para tratar reversões após o checkout e o fulfillment do Marco 5.4, mantendo o domínio como fonte de verdade e o Asaas apenas como provedor.

O Marco 5.5 permanece **course-first** e **staging/sandbox-first**. Produção continua fora do escopo.

## Princípios

1. Cancelamento pré-pagamento, refund e chargeback são operações distintas.
2. Nenhuma reversão financeira é inferida apenas de uma ação de UI; o estado final depende de confirmação server-side do provedor e/ou webhook reconciliado.
3. `order`, `payment_transaction`, `enrollment` e `payment_webhook_event` precisam convergir de forma idempotente e auditável.
4. Refund e chargeback revogam entitlement pago, mas **não apagam histórico de progresso ou conclusão**.
5. Reentregas do mesmo evento não podem duplicar reversões nem auditorias de negócio.
6. Eventos fora de ordem não podem reativar acesso indevidamente.
7. Refund parcial não será aplicado automaticamente ao entitlement no primeiro incremento; exige reconciliação operacional explícita.
8. Produção permanece proibida até gate específico posterior.

## Contrato Asaas considerado

Documentação oficial consultada em setembro de 2026:

- `DELETE /v3/payments/{id}` remove uma cobrança ainda não paga e não representa refund;
- `POST /v3/payments/{id}/refund` solicita refund de cobrança paga; Pix aceita refund integral e múltiplos refunds parciais;
- `PAYMENT_DELETED` comunica remoção da cobrança;
- `PAYMENT_REFUNDED` comunica refund concluído;
- `PAYMENT_PARTIALLY_REFUNDED` comunica refund parcial;
- `PAYMENT_REFUND_IN_PROGRESS` comunica refund ainda em processamento;
- `PAYMENT_CHARGEBACK_REQUESTED` comunica abertura de chargeback;
- `PAYMENT_CHARGEBACK_DISPUTE` comunica disputa em andamento;
- `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` indica disputa vencida pelo cliente Asaas aguardando reversão do chargeback;
- após `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`, o Asaas pode voltar a emitir `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED` quando a cobrança for restaurada;
- quando o portador vence o chargeback, o fluxo pode terminar em `PAYMENT_REFUNDED`.

Referências:

- `https://docs.asaas.com/reference/delete-payment`
- `https://docs.asaas.com/reference/refund-payment`
- `https://docs.asaas.com/docs/webhook-para-cobrancas`

## Estados financeiros

O domínio já possui:

```text
order:
pending_payment | paid | cancelled | expired | refunded | chargeback

transaction:
created | pending | paid | failed | cancelled | expired | refunded | chargeback
```

O 5.5 deverá suportar, com validação contextual:

```text
pending_payment/pending -> cancelled/cancelled
paid/paid -> refunded/refunded
paid/paid -> chargeback/chargeback
chargeback/chargeback -> refunded/refunded
chargeback/chargeback -> paid/paid   # somente recuperação de disputa comprovada
```

`refunded` permanece estado final para o refund integral.

## Política de cancelamento

Cancelamento se aplica somente antes da confirmação do pagamento.

Fluxo esperado:

1. reler estado canônico;
2. consultar a cobrança Asaas;
3. confirmar que ainda não está paga;
4. solicitar `DELETE /payments/{id}`;
5. validar resposta do provedor;
6. convergir pedido/transação para `cancelled`;
7. aceitar `PAYMENT_DELETED` como confirmação/reconciliação idempotente;
8. não criar nem manter enrollment pago para pedido cancelado antes do pagamento.

`PAYMENT_DELETED` recebido para pedido já `paid`, `refunded` ou `chargeback` deve falhar fechado e não ser interpretado como refund.

## Política de refund

No primeiro incremento, a automação canônica trata **refund integral**.

`PAYMENT_REFUNDED`:

- `paid/paid -> refunded/refunded`;
- `chargeback/chargeback -> refunded/refunded` quando o chargeback termina em perda para o recebedor;
- `refunded/refunded` é idempotente;
- enrollment `source=order` passa para `refunded`;
- progresso e `completedAt` são preservados;
- entitlement deixa de ser concedido.

### Refund parcial

`PAYMENT_PARTIALLY_REFUNDED` não muda automaticamente pedido para `refunded` e não revoga integralmente o acesso.

Motivo: o modelo canônico atual não possui `partially_refunded` nem valor acumulado de refund. O evento deve ser persistido, reconciliado e sinalizado para tratamento operacional até um contrato específico de refund parcial ser introduzido.

`PAYMENT_REFUND_IN_PROGRESS` também não finaliza a reversão. O sistema aguarda evento final/reconciliação do provedor.

## Política de chargeback

`PAYMENT_CHARGEBACK_REQUESTED`:

- `paid/paid -> chargeback/chargeback`;
- revoga imediatamente o entitlement pago;
- enrollment `source=order` passa para `chargeback`;
- progresso e conclusão histórica são preservados.

`PAYMENT_CHARGEBACK_DISPUTE` e `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` mantêm o acesso revogado enquanto a disputa não estiver efetivamente revertida.

### Recuperação de chargeback

Um novo `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` **não pode**, sozinho, restaurar acesso de um pedido em `chargeback`, pois pode ser uma entrega atrasada de evento antigo.

A recuperação só pode ocorrer quando houver evidência canônica anterior de `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` referente à mesma cobrança. Somente então:

```text
chargeback/chargeback -> paid/paid
```

O enrollment é restaurado para:

- `completed` quando houver `completedAt` histórico ou progresso de 100%;
- `active` nos demais casos.

## Política para curso já concluído

Refund ou chargeback **revogam o entitlement**, inclusive se o curso já estava concluído, mas o sistema não apaga:

- `progressPercent`;
- `completedAt`;
- timestamps históricos anteriores;
- auditorias.

Assim, o estado de acesso muda, mas o histórico acadêmico/técnico permanece rastreável.

## Enrollment

O 5.5 introduzirá `chargeback` como estado não concedente de entitlement.

Estados esperados:

```text
active | completed | cancelled | refunded | chargeback
```

Somente `active` e `completed` concedem entitlement.

Reversão financeira nunca altera enrollment `source=free` ou `source=admin_grant`.

## Idempotência e ordem de eventos

Regras mínimas:

- reentrega de `PAYMENT_REFUNDED` em pedido já `refunded` é sucesso idempotente;
- reentrega de `PAYMENT_CHARGEBACK_REQUESTED` em pedido já `chargeback` é sucesso idempotente;
- `PAYMENT_CHARGEBACK_REQUESTED` entregue depois de `PAYMENT_REFUNDED` não pode retirar o estado final `refunded`;
- evento positivo entregue após refund não pode restaurar acesso;
- recuperação de chargeback exige evidência contextual explícita da reversão da disputa;
- divergência entre estado do pedido e transação falha fechado.

## Auditoria

Cada mutação financeira deverá gerar `audit_logs` com, no mínimo:

- ator (`system:asaas-webhook` ou admin autorizado);
- ação;
- pedido/transação;
- estado anterior e posterior;
- evento/providerPaymentId correlatos;
- timestamp;
- motivo/origem (`webhook`, `admin`, `reconciliation`).

Ações previstas:

```text
financial.payment.cancelled
financial.payment.refunded
financial.payment.chargeback_started
financial.payment.chargeback_recovered
course.enrollment.revoked_refund
course.enrollment.revoked_chargeback
course.enrollment.restored_chargeback
```

## Gates de implementação

### Gate 1 — domínio puro

- classificação dos eventos de reversão;
- máquina contextual de cancel/refund/chargeback;
- precedência de refund final;
- proteção contra evento positivo fora de ordem;
- política de entitlement e curso concluído;
- testes unitários sem Firestore e sem Asaas.

### Gate 2 — integração dos estados canônicos

- permitir `chargeback -> refunded` e recuperação autorizada `chargeback -> paid` no domínio financeiro;
- adicionar `chargeback` ao enrollment sem torná-lo concedente de acesso;
- adaptar validações/timestamps;
- regressão dos domínios existentes.

### Gate 3 — persistência e worker no Firestore Emulator

- processar `PAYMENT_DELETED`, `PAYMENT_REFUNDED` e `PAYMENT_CHARGEBACK_REQUESTED`;
- registrar eventos intermediários sem mutação final indevida;
- transação atômica order + transaction + enrollment + event + audit;
- recuperação segura de chargeback;
- idempotência, concorrência e eventos fora de ordem.

### Gate 4 — operações administrativas/provider no Emulator

- cancelamento pré-pagamento server-side;
- refund integral server-side;
- adapter Asaas encapsulado;
- permissões administrativas coerentes com a governança existente;
- fake provider isolado nos emuladores.

### Gate 5 — staging / Asaas Sandbox

Somente depois dos gates locais verdes:

- atualizar eventos do Webhook Sandbox necessários ao 5.5;
- testar cancelamento de cobrança pendente;
- testar refund integral de cobrança Sandbox elegível;
- validar convergência canônica e revogação do entitlement;
- chargeback real em staging somente se o Sandbox oferecer fluxo reproduzível e seguro; caso contrário, permanece coberto por Emulator + reconciliação documentada.

Produção continua fora do escopo.

## Fora do Marco 5.5

- refund parcial automatizado;
- alteração de regra financeira histórica;
- produção;
- UI final de compra/operação (Marco 5.6);
- exames oficiais (Marco 5.7);
- migração do legado `pedidos`/`matriculas`.
