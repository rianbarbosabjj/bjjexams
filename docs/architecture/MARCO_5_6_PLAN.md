# Marco 5.6 — UI de compra e operação financeira v1.2

## Objetivo

Transformar os domínios financeiros já validados nos Marcos 5.1–5.5 em uma experiência segura e observável para compra de cursos pagos e operação administrativa, mantendo o backend canônico como fonte de verdade.

O Marco 5.6 permanece **course-first**, **staging-first** e **sem produção**.

## Estado de partida

Na `develop-v1.2` atual:

- `catalogo.html` já diferencia curso pago e gratuito e exibe preço;
- `cursos.html` ainda direciona o usuário apenas para login e ainda contém texto de “matrículas em implantação”;
- `js/course-student-api-v1_2.js` cobre matrícula gratuita, entitlement, consumo e progresso, mas não expõe checkout nem estado financeiro;
- `iniciarCheckoutCursoV12` já cria checkout PIX em Sandbox e devolve `orderId`, `transactionId`, `status`, `paymentId` e `pix`;
- webhook + worker confirmam pagamento e concedem enrollment somente após confirmação server-side;
- `cancelarCobrancaPendenteV12` e `solicitarEstornoIntegralV12` já existem para perfis administrativos autorizados;
- `financial_reversal_requests` já representa `awaiting_webhook`, `completed`, `provider_rejected` e `needs_reconciliation`;
- refund negado no Asaas Sandbox já foi validado de forma fail-safe: compra e acesso permanecem ativos e a operação vai para reconciliação.

## Princípios

1. O browser nunca lê nem escreve diretamente `orders`, `payment_transactions`, `payment_webhook_events`, `financial_reversal_requests` ou coleções de recovery.
2. A UI não considera pagamento concluído apenas porque o checkout foi criado ou porque o usuário exibiu/copou o QR Code.
3. Entitlement pago continua sendo concedido exclusivamente pelo backend após confirmação financeira canônica.
4. Estados exibidos ao usuário são derivados de uma view server-side sanitizada, não do documento financeiro cru.
5. O frontend deve ser idempotente: recarregar página, repetir clique ou retornar do navegador não pode duplicar pedido/cobrança.
6. Identificadores do provedor, secrets, payloads de webhook e detalhes operacionais internos não são expostos ao usuário final.
7. Operações administrativas de cancelamento/refund exigem RBAC server-side; a UI nunca decide autorização.
8. `needs_reconciliation` deve ser visível para operação administrativa e nunca traduzido como “estorno concluído”.
9. Produção permanece proibida neste marco.

## Fluxo do aluno — curso pago

### Antes do checkout

A página do curso autenticado deve consultar um read model server-side e distinguir pelo menos:

```text
available_for_purchase
payment_pending
paid_entitled
refunded
chargeback
cancelled_or_expired
```

Para curso gratuito, o fluxo atual de matrícula gratuita permanece separado.

### Início da compra

Para `available_for_purchase`:

1. usuário confirma a compra;
2. frontend gera/reutiliza uma `idempotencyKey` estável para aquela tentativa;
3. chama `iniciarCheckoutCursoV12`;
4. backend valida curso, comprador, regra financeira, recebedores e ambiente;
5. UI recebe somente o necessário para pagamento PIX;
6. a compra entra em `payment_pending`.

### Tela PIX

A interface deve suportar:

- QR Code PIX renderizado a partir do payload retornado pelo backend/provedor;
- código copia-e-cola;
- valor e curso;
- indicação explícita de “aguardando confirmação do pagamento”;
- botão de copiar;
- possibilidade de retomar a compra após reload;
- timeout visual sem alterar estado financeiro canônico.

A UI não deve mostrar `providerPaymentId` nem snapshots financeiros internos.

### Confirmação

A tela consulta periodicamente uma callable/read model própria. Quando o backend reportar entitlement ativo/completo, a UI muda para “Pagamento confirmado” e libera entrada no curso.

Nenhum polling do browser consulta o Asaas diretamente.

## Read model do aluno

Criar uma callable dedicada, por exemplo `obterStatusCompraCursoV12`, que recebe apenas `courseId` e retorna resposta sanitizada semelhante a:

```json
{
  "courseId": "...",
  "purchaseState": "payment_pending",
  "orderStatus": "pending_payment",
  "entitled": false,
  "canStartCheckout": false,
  "canOpenCourse": false,
  "payment": {
    "method": "PIX",
    "expiresAt": "...",
    "pixCopyPaste": "...",
    "pixQrCode": "..."
  }
}
```

Os campos exatos serão definidos por contrato e testes. Dados financeiros internos, allocations, recebedores e IDs do provedor ficam fora da resposta pública.

## Minhas compras / meus cursos

A área autenticada do aluno deve passar a distinguir:

- curso gratuito;
- curso pago aguardando pagamento;
- curso pago confirmado;
- curso com acesso revogado por refund;
- curso com acesso revogado por chargeback;
- compra cancelada/expirada.

A experiência deve evitar que um curso pago pendente pareça uma matrícula ativa.

## Operação administrativa

Criar view operacional server-side sanitizada para perfis `super_admin` e `platform_admin` com, no mínimo:

- pedido;
- curso;
- comprador sanitizado;
- valor;
- estado canônico do pedido/transação;
- estado do enrollment;
- tipo/status da solicitação de reversão;
- flags operacionais como `canCancel`, `canRefund`, `needsReconciliation`;
- timestamps relevantes.

A UI administrativa poderá acionar as callables já existentes:

- `cancelarCobrancaPendenteV12`;
- `solicitarEstornoIntegralV12`.

Ela deve representar explicitamente:

```text
awaiting_webhook      -> operação solicitada, aguardando confirmação
completed             -> reversão confirmada
provider_rejected     -> provedor rejeitou a solicitação imediatamente
needs_reconciliation  -> ação manual/operacional necessária
```

Nenhum desses estados deve ser inferido apenas por mensagem HTTP do frontend.

## Observabilidade

O Marco 5.6 deve manter/expandir:

- `audit_logs` para ações administrativas;
- correlação por `orderId`/`transactionId`/`reversalRequestId` apenas no backend/admin sanitizado;
- mensagens de erro estáveis para UX;
- logs sem secrets, CPF completo, payload bruto de webhook ou chaves PIX sensíveis além do estritamente necessário ao comprador autenticado;
- marcador explícito de ambiente de testes em staging.

## Gates

### Gate 1 — contratos e read models

- domínio puro dos estados de UI de compra;
- callable sanitizada de status da compra do aluno;
- callable/listagem administrativa sanitizada;
- testes unitários e Firestore Emulator;
- sem alteração visual ainda.

### Gate 2 — API frontend financeira

- criar módulo `js/course-purchase-api-v1_2.js`;
- allowlist explícita de callables;
- autenticação obrigatória;
- ambiente seguro igual aos demais módulos v1.2;
- idempotency key controlada pelo cliente sem reutilização entre produtos/usuários;
- testes JS.

### Gate 3 — experiência de compra no curso

- substituir o estado “matrículas em implantação”;
- CTA contextual para gratuito/pago/pending/entitled;
- checkout PIX;
- copiar código PIX;
- QR Code;
- polling sanitizado;
- recuperação de sessão após reload;
- responsividade e estados de erro.

### Gate 4 — área do aluno

- exibir compras pendentes separadas de cursos liberados;
- abrir curso apenas quando entitlement estiver ativo/completo;
- representar refund/chargeback sem apagar histórico acadêmico.

### Gate 5 — console operacional financeiro

- listagem server-side sanitizada;
- cancelamento de cobrança pendente;
- solicitação de refund integral;
- acompanhamento de `awaiting_webhook`;
- destaque de `needs_reconciliation`;
- confirmação destrutiva e prevenção de duplo clique;
- RBAC validado no backend.

### Gate 6 — staging

- deploy somente em `bjj-exams-staging`;
- smoke navegador/API de checkout PIX;
- reload/retomada de pending checkout;
- confirmação Sandbox -> enrollment;
- cancelamento pendente pela UI administrativa;
- refund Sandbox com aceitação tanto de `completed/refunded` quanto do comportamento real `needs_reconciliation/denied`;
- sem produção.

## Fora do Marco 5.6

- produção;
- venda de exame oficial de faixa (Marco 5.7);
- refund parcial automatizado;
- chargeback manual pelo usuário;
- alteração histórica de snapshot financeiro;
- migração do legado financeiro;
- payout/saque para recebedores;
- hardening final de produção e SLOs (Marco 5.8).

## Critério de conclusão

O Marco 5.6 estará concluído quando um usuário autenticado conseguir, em staging, comprar um curso pago por PIX, acompanhar o estado sem acesso direto ao Firestore financeiro, receber entitlement apenas após confirmação server-side e retomar a experiência após reload; e quando um administrador autorizado conseguir operar cancelamento/refund e visualizar reconciliações pendentes por uma view sanitizada, com todos os fluxos críticos cobertos por Emulator + smoke de staging.
