# Marco 5.7 — Venda individual de exame oficial de faixa v1.2

## Objetivo

Concluir o último incremento financeiro do Marco 5 com suporte canônico a venda individual de exame oficial de faixa (`belt_exam`), reutilizando a infraestrutura financeira homologada para cursos sem duplicar cobrança, sem consumir créditos do professor no novo fluxo e sem antecipar a modernização completa da execução de provas prevista para o Marco 6.

O Marco 5.7 permanece **staging-first**, **Asaas Sandbox only** e **sem produção**.

## Relação com o roadmap

O plano macro da v1.2 reserva o Marco 6 para o domínio completo de exames oficiais: templates, sessões por academia, seleção de alunos, inscrição individual, cobrança individual, prova server-side, resultado e certificado.

O Marco 5.7 implementa apenas a ponte financeira e de autorização necessária para esse domínio futuro:

- sessão canônica mínima de exame;
- seleção/registro canônico do aluno;
- cobrança PIX individual;
- confirmação financeira -> autorização do registro;
- estados sanitizados para aluno/instrutor/admin;
- cancelamento/refund/chargeback fail-safe antes do início da prova.

Templates, execução de prova, correção, resultado e certificado continuam pertencendo ao Marco 6, salvo adaptações mínimas de compatibilidade estritamente necessárias para impedir dupla cobrança ou acesso indevido.

## Estado de partida

### Financeiro v1.2 já disponível

O domínio financeiro já reconhece:

```text
course
belt_exam
```

A taxa administrativa padrão permanece em 1000 bps (10%), com snapshot da regra efetivamente aplicada em cada pedido.

Já existem e foram homologados em staging:

- `orders`;
- `payment_transactions`;
- `financial_rules`;
- `financial_recipient_accounts`;
- customer binding Asaas;
- checkout PIX idempotente;
- webhook idempotente;
- confirmação financeira;
- cancelamento/refund/chargeback;
- console operacional sanitizado;
- `needs_reconciliation` fail-safe.

Entretanto, a orquestração atual é deliberadamente `course-first`:

- `financial-order-service.js` cria apenas pedido de curso;
- `financial-checkout-persistence.js` prepara apenas checkout de curso;
- `financial-course-checkout-service.js` inicia apenas checkout de curso;
- `financial-webhook-fulfillment.js` exige `productType=course` e cria `enrollment`;
- reversal fulfillment/admin valida estado de `enrollment` de curso;
- read models/UI do Marco 5.6 são orientados a curso.

### Exames existentes

O legado/transição atual já possui:

- `configurarAutorizacaoExame`;
- `obterPreviaExame`;
- `iniciarExameSeguro`;
- `finalizarExameSeguro`;
- `autorizacoes_exame/{alunoId}`;
- `tentativas_exame` server-only;
- `resultados` server-write only;
- `certificados` server-write only;
- configuração de exame por faixa em `config_exames`;
- permissão organizacional `canApplyOfficialExam`.

O fluxo legado de exame oficial consome **um crédito pré-pago do professor** quando a prova é iniciada. Esse mecanismo não pode coexistir com cobrança individual do aluno para o mesmo registro, sob risco de dupla monetização.

### Frontend legado de prova

Há UI histórica que ainda tenta:

- ler `config_exames` e `questoes` diretamente;
- acessar `resposta_correta` no browser;
- corrigir prova no cliente;
- escrever resultado/certificado diretamente.

As Rules atuais já bloqueiam esse padrão para aluno. O Marco 5.7 **não deve reabrir Rules** para acomodá-lo. A modernização do consumo da prova continuará server-side no Marco 6.

## Decisões de arquitetura

### 1. Identidade do produto financeiro

Para venda individual de exame:

```text
productType = belt_exam
productId   = examSessionId
```

A sessão representa o produto comercial comum daquela aplicação de exame. O registro do aluno é derivado deterministicamente de:

```text
examSessionId + studentId
```

Razões:

- preço e regra financeira pertencem à sessão, não ao aluno;
- uma única regra de split pode atender todos os candidatos da sessão;
- evita criar override financeiro por aluno;
- permite múltiplos alunos comprarem o mesmo produto com pedidos próprios;
- simplifica reconciliação por `order.buyerUserId + order.productId`;
- prepara o modelo definitivo do Marco 6 sem migração estrutural posterior.

### 2. `exam_sessions` mínimo neste marco

Criar `exam_sessions/{sessionId}` somente com os campos necessários a seleção e venda:

```js
{
  organizationId,
  responsibleInstructorId,
  targetBelt,
  status: 'draft' | 'candidates_selected' | 'awaiting_payment' | 'ready' | 'cancelled' | 'archived',
  priceCents,
  currency: 'BRL',
  financialRuleId: null,
  scheduledAt: null,
  createdBy,
  createdAt,
  updatedAt
}
```

Campos de template, execução e resultado serão adicionados/ativados no Marco 6.

### 3. `exam_registrations` canônico

Criar `exam_registrations/{registrationId}` com identidade determinística por sessão + aluno:

```js
{
  sessionId,
  organizationId,
  studentId,
  instructorId,
  currentBelt,
  targetBelt,
  membershipId,
  status: 'selected' | 'awaiting_payment' | 'authorized' | 'started' | 'submitted' | 'passed' | 'failed' | 'certified' | 'cancelled' | 'needs_reconciliation',
  orderId: null,
  attemptId: null,
  resultId: null,
  certificateId: null,
  selectedAt,
  paidAt: null,
  authorizedAt: null,
  cancelledAt: null,
  updatedAt
}
```

O Marco 5.7 usa somente os estados até `authorized`, `cancelled` e `needs_reconciliation`. Os demais ficam reservados ao Marco 6.

### 4. Seleção server-side

A criação de sessão e a seleção de candidato devem ocorrer somente por callable/service.

Requisitos obrigatórios:

- ator autenticado;
- membership ativo do ator na organização;
- `canApplyOfficialExam(actorMembership) === true`;
- aluno com membership ativo `student` na mesma organização;
- sessão ativa e pertencente à mesma organização;
- faixa alvo válida e snapshot da faixa atual;
- uma registration canônica por `sessionId + studentId`;
- nenhuma seleção baseada apenas em `equipe_id` legado no browser.

Compatibilidade de leitura com `vinculos_organizacao` pode permanecer enquanto a migração de identidade não for encerrada, sempre encapsulada no backend.

### 5. Preço e split

- `priceCents` é definido server-side na sessão e precisa ser inteiro positivo;
- moeda `BRL`;
- taxa padrão da plataforma: 10% (1000 bps), salvo override configurado;
- `financialRuleId` opcional na sessão;
- `ownerType` financeiro padrão recomendado: `organization`;
- `ownerId = organizationId` por padrão;
- split explícito pode distribuir o seller pool entre organização/instrutor quando configurado por papel financeiro privilegiado;
- wallet readiness precisa ser validada antes do checkout;
- toda venda grava snapshot imutável da regra aplicada.

Nenhum wallet ID ou provider ID pode ser exposto ao aluno.

### 6. Compatibilidade de idempotência

Os IDs de pedido de curso existentes **não podem mudar**.

Adicionar identidade específica para exame, por exemplo:

```text
financial-belt-exam-order-v1:{buyerUserId}:{examSessionId}:{idempotencyKey}
```

A implementação pode extrair um helper genérico internamente, mas wrappers/IDs de curso existentes devem permanecer byte-for-byte compatíveis.

### 7. Checkout

Adicionar callable autenticada dedicada, por exemplo:

```text
iniciarCheckoutExameFaixaV12
```

Payload público mínimo:

```json
{
  "sessionId": "...",
  "idempotencyKey": "..."
}
```

O backend resolve a registration pelo usuário autenticado. O cliente nunca informa:

- studentId;
- organizationId;
- instructorId;
- priceCents;
- targetBelt;
- split;
- wallet;
- providerPaymentId.

Pré-condições:

- registration existe e pertence ao comprador;
- registration está `selected` ou em retomada `awaiting_payment`;
- sessão aceita pagamento;
- aluno continua membro ativo da organização;
- nenhuma tentativa oficial já foi iniciada;
- nenhum pedido pago/autorizado concorrente existe.

### 8. Reutilização do checkout Asaas

A infraestrutura de customer binding, transaction ID, externalReference, lease e provider adapter deve ser reutilizada.

Refatorar internamente o mínimo necessário para suportar `course` e `belt_exam`, preservando:

- APIs atuais de curso;
- IDs determinísticos atuais de curso;
- testes dos Marcos 5.3–5.6;
- semântica de retry/reload;
- Sandbox-only.

Evitar copiar integralmente a orquestração de checkout para um segundo stack independente.

### 9. Fulfillment por tipo de produto

O webhook deve passar a despachar fulfillment pelo `order.productType`:

#### `course`

Comportamento atual inalterado:

```text
paid -> enrollment active
```

#### `belt_exam`

Localizar registration canônica por:

```text
sessionId = order.productId
studentId = order.buyerUserId
```

Validar identidade completa e, na mesma transação canônica:

```text
order pending_payment -> paid
transaction pending -> paid
registration awaiting_payment -> authorized
registration.orderId = orderId
registration.paidAt = now
registration.authorizedAt = now
```

Idempotência de webhook deve preservar um único pedido, uma única transação e uma única registration autorizada.

### 10. Não consumir crédito do professor

Uma registration `belt_exam` paga/autorizada pelo financeiro v1.2 **não pode consumir `creditos_professor`**.

O fluxo legado de créditos permanece apenas para autorizações legadas já existentes enquanto durar a transição.

No futuro ponto de integração com `iniciarExameSeguro`, a função deve distinguir explicitamente:

```text
canonical paid registration -> sem débito de crédito
legacy authorization        -> comportamento legado temporário
```

Nenhum fallback silencioso pode cobrar ambos.

### 11. Read models sanitizados

Criar views server-side específicas.

#### Aluno

Exemplo de estados:

```text
not_selected
selected
payment_pending
authorized
cancelled
needs_reconciliation
started_or_later
```

Pode retornar:

- sessionId;
- targetBelt;
- organizationName sanitizado;
- price/currency;
- estado da compra;
- PIX somente para o comprador autenticado quando pendente;
- `canStartCheckout`;
- `canResumePayment`;
- `canStartExam` (false neste marco até integração segura do Marco 6, salvo decisão explícita posterior).

Nunca retornar IDs do provedor, regra/split cru ou dados de outro aluno.

#### Instrutor

Listagem por sessão com:

- aluno sanitizado;
- faixa atual/alvo;
- status da registration;
- status financeiro derivado;
- flags como `selected`, `awaitingPayment`, `authorized`, `needsReconciliation`.

Não expor provider IDs.

#### Admin financeiro

O console financeiro deve reconhecer `belt_exam` e exibir rótulo de produto/sessão sem depender de curso.

### 12. Cancelamento, refund e chargeback

As reversões atuais são `course-first` e precisam de estratégia por produto.

#### Cobrança pendente

Cancelamento administrativo aceito quando:

- order `pending_payment`;
- transaction `pending`;
- registration ainda não iniciou prova.

Após confirmação do provedor:

```text
order -> cancelled
transaction -> cancelled
registration -> selected ou cancelled conforme política definida no domínio
```

Preferência para o Marco 5.7: retornar a registration a `selected`, permitindo nova tentativa de compra sem nova seleção do professor, preservando histórico via order anterior.

#### Refund integral antes de iniciar a prova

Se registration está `authorized` e sem `attemptId`/início:

```text
order -> refunded
transaction -> refunded
registration -> cancelled
```

Aluno perde autorização para iniciar.

#### Refund/chargeback após início

Se existir `attemptId`, resultado ou certificado, não alterar automaticamente o histórico acadêmico.

Marcar:

```text
registration -> needs_reconciliation
```

com alerta/auditoria operacional. Decisão sobre resultado/certificado pertence ao Marco 6/8.

#### Refund negado/parcial

Manter compra/autorização coerentes com o estado financeiro real e exibir `needs_reconciliation`; nunca reportar sucesso falso.

### 13. Firestore Rules

Novas coleções canônicas:

```text
exam_sessions
exam_registrations
```

Devem iniciar com:

```text
allow read, write: if false
```

Toda leitura/mutação ocorre via backend/read model sanitizado.

Não ampliar acesso do aluno a:

- `questoes`;
- `config_exames`;
- gabaritos;
- `orders`;
- `payment_transactions`;
- `payment_webhook_events`;
- `financial_reversal_requests`.

### 14. Auditoria

Registrar ao menos:

- criação/alteração de sessão;
- seleção/revogação de candidato;
- criação de pedido `belt_exam`;
- pagamento confirmado;
- registration autorizada;
- cancelamento/refund/chargeback;
- entrada em `needs_reconciliation`.

Logs não podem conter secrets, PIX bruto desnecessário, CPF completo ou provider payload cru.

## Gates

### Gate 0 — inventário e contrato

- mapear legado de autorização/créditos/prova;
- documentar incompatibilidades com Rules atuais;
- congelar invariantes de `belt_exam`;
- documentar compatibilidade com Marco 6;
- nenhum deploy.

### Gate 1 — domínio canônico de sessão/registration

- `exam-session-domain.js`;
- `exam-registration-domain.js`;
- IDs determinísticos;
- máquina de estados;
- validação de preço/faixas/identidade;
- testes unitários;
- Rules deny-all para novas coleções.

### Gate 2 — seleção server-side

- services/callables para criar sessão mínima e selecionar candidato;
- RBAC organizacional server-side;
- membership ativo na mesma organização;
- listagem sanitizada do instrutor;
- testes Emulator de isolamento entre academias.

### Gate 3 — pedido e checkout `belt_exam`

- estender order service sem alterar IDs/contratos de curso;
- preparar checkout por exam session;
- callable `iniciarCheckoutExameFaixaV12`;
- customer/payment/lease Asaas reutilizados;
- idempotência/reload;
- testes de regressão completos do checkout de curso.

### Gate 4 — confirmação financeira e autorização

- dispatch de webhook por `productType`;
- curso mantém enrollment atual;
- `belt_exam` autoriza registration após confirmação;
- nenhuma baixa em `creditos_professor`;
- webhook duplicado não duplica efeitos;
- testes Emulator.

### Gate 5 — reversões e reconciliação

- cancelamento pending consciente de registration;
- refund antes do início revoga autorização;
- chargeback/refund após início -> reconciliação manual;
- refund negado/parcial sem falso sucesso;
- console admin reconhece produto exame;
- regressão integral de reversões de curso.

### Gate 6 — frontend/read models

- API frontend dedicada ao exame;
- área do aluno: seleção, preço, PIX, pending, autorizado;
- área do instrutor: candidatos e estados de pagamento;
- sem acesso direto às coleções canônicas;
- produção bloqueada;
- testes JS/DOM.

### Gate 7 — staging

Somente `bjj-exams-staging`:

- criar sessão Sandbox;
- selecionar aluno ativo da mesma academia;
- provar bloqueio de aluno não selecionado;
- gerar PIX individual;
- reload sem duplicar order/transaction;
- confirmar Sandbox -> registration `authorized`;
- provar `creditos_professor` inalterado;
- cancelar cobrança pending e permitir nova tentativa;
- refund/denied/reconciliation conforme resposta real do Sandbox;
- garantir curso pago continua sem regressão;
- nenhuma ação em produção.

## Critério de conclusão

O Marco 5.7 estará concluído quando, em staging:

1. instrutor autorizado selecionar um aluno ativo de sua organização para uma sessão canônica de exame;
2. aluno não selecionado não conseguir comprar;
3. aluno selecionado iniciar/reutilizar checkout PIX individual idempotente;
4. pagamento confirmado server-side autorizar exatamente uma registration;
5. o fluxo não consumir crédito do professor;
6. cancelamento/refund/chargeback respeitarem o estado da registration e falharem de forma segura;
7. navegador nunca acessar diretamente estado financeiro, gabaritos ou coleções canônicas de sessão/registration;
8. todos os testes de curso dos Marcos 5.3–5.6 continuarem verdes;
9. produção permanecer intocada.

## Fora do Marco 5.7

- deploy em produção;
- migração completa de `config_exames` para `exam_templates`;
- substituição completa da UI de prova;
- entrega de questões/gabarito no novo frontend;
- correção/resultado/certificado canônico do novo modelo;
- proctoring/anti-cheat definitivo;
- política final para certificado após chargeback tardio;
- go-live de exames oficiais.

Esses itens pertencem ao Marco 6 e aos hardenings posteriores.
