"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ui = require("../js/financial-ops-ui-v1_2.js");
const source = fs.readFileSync(
  path.join(__dirname, "..", "js", "financial-ops-ui-v1_2.js"),
  "utf8"
);

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

test("valor financeiro usa centavos e moeda sanitizada", () => {
  assert.ok(ui.formatCurrency(5000, "BRL").includes("50"));
  assert.equal(ui.formatCurrency(-1, "BRL"), "Valor indisponível");
});

test("pedido pending cancelável oferece somente cancelamento", () => {
  const view = ui.operationView({
    orderId: "order-1",
    course: { title: "Curso" },
    buyer: { name: "Aluno", email: "a@example.test" },
    amountCents: 5000,
    currency: "BRL",
    orderStatus: "pending_payment",
    transactionStatus: "pending",
    canCancel: true,
    canRefund: false,
    needsReconciliation: false,
    reversalInProgress: false
  });
  assert.equal(view.action, ui.ACTIONS.CANCEL);
  assert.equal(view.canCancel, true);
  assert.equal(view.canRefund, false);
});

test("curso usa contrato product-aware preservando compatibilidade", () => {
  const view = ui.operationView({
    orderId: "order-course",
    productType: "course",
    product: {
      productType: "course",
      productId: "course-1",
      label: "Curso Product Aware"
    },
    course: {
      courseId: "course-1",
      title: "Curso Product Aware"
    },
    lifecycleKind: "enrollment",
    lifecycleStatus: "active",
    buyer: {
      name: "Aluno"
    },
    amountCents: 5000,
    currency: "BRL",
    orderStatus: "paid",
    transactionStatus: "paid",
    canCancel: false,
    canRefund: true
  });

  assert.equal(view.productType, "course");
  assert.equal(view.productLabel, "Curso Product Aware");
  assert.equal(view.lifecycleLabel, "Acesso");
  assert.equal(view.lifecycleStatusLabel, "Ativo");
  assert.equal(view.courseTitle, "Curso Product Aware");
  assert.equal(view.enrollmentStatus, "Ativo");
});

test("belt_exam usa produto e lifecycle da registration", () => {
  const view = ui.operationView({
    orderId: "order-exam",
    productType: "belt_exam",
    product: {
      productType: "belt_exam",
      productId: "session-1",
      label: "Exame oficial - Faixa Azul"
    },
    exam: {
      sessionId: "session-1",
      targetBelt: "Azul"
    },
    lifecycleKind: "exam_registration",
    lifecycleStatus: "authorized",
    registrationStatus: "authorized",
    buyer: {
      name: "Aluno"
    },
    amountCents: 10000,
    currency: "BRL",
    orderStatus: "paid",
    transactionStatus: "paid",
    canCancel: false,
    canRefund: true
  });

  assert.equal(view.productType, "belt_exam");
  assert.equal(view.productLabel, "Exame oficial - Faixa Azul");
  assert.equal(view.lifecycleKind, "exam_registration");
  assert.equal(view.lifecycleLabel, "Exame");
  assert.equal(view.lifecycleStatus, "authorized");
  assert.equal(view.lifecycleStatusLabel, "Autorizado");
  assert.equal(view.action, ui.ACTIONS.REFUND);
});

test("pedido pago elegível oferece somente refund integral", () => {
  const view = ui.operationView({
    orderId: "order-2",
    course: { title: "Curso" },
    buyer: { name: "Aluno" },
    amountCents: 5000,
    currency: "BRL",
    orderStatus: "paid",
    transactionStatus: "paid",
    enrollmentStatus: "active",
    canCancel: false,
    canRefund: true,
    needsReconciliation: false,
    reversalInProgress: false
  });
  assert.equal(view.action, ui.ACTIONS.REFUND);
  assert.equal(view.canRefund, true);
});

test("awaiting_webhook bloqueia nova ação destrutiva", () => {
  const view = ui.operationView({
    orderId: "order-3",
    orderStatus: "paid",
    transactionStatus: "paid",
    canRefund: true,
    reversalInProgress: true,
    reversal: { status: "awaiting_webhook" }
  });
  assert.equal(view.action, null);
  assert.equal(view.reversalInProgress, true);
  assert.equal(view.reversal.label, "Aguardando confirmação do provedor");
});

test("needs_reconciliation bloqueia nova reversão", () => {
  const view = ui.operationView({
    orderId: "order-4",
    orderStatus: "paid",
    transactionStatus: "paid",
    canRefund: true,
    needsReconciliation: true,
    reversal: { status: "needs_reconciliation", providerLifecycleStatus: "denied" }
  });
  assert.equal(view.action, null);
  assert.equal(view.needsReconciliation, true);
  assert.equal(view.reversal.tone, "danger");
});

test("provider_rejected é exibido como falha operacional", () => {
  const view = ui.reversalView({ status: "provider_rejected" });
  assert.equal(view.tone, "danger");
  assert.equal(view.label, "Operação rejeitada pelo provedor");
});

test("reversão completed é explicitamente concluída", () => {
  const view = ui.reversalView({ status: "completed" });
  assert.equal(view.tone, "success");
  assert.equal(view.label, "Reversão concluída");
});

test("status chargeback não inventa ação administrativa", () => {
  const view = ui.operationView({
    orderId: "order-5",
    orderStatus: "chargeback",
    transactionStatus: "chargeback",
    canCancel: false,
    canRefund: false
  });
  assert.equal(view.action, null);
  assert.equal(view.orderStatusLabel, "Chargeback");
});

test("erro de autenticação vira mensagem estável", () => {
  const error = ui.normalizeError({ httpStatus: 401 });
  assert.equal(error.title, "Sessão expirada");
});

test("erro de autorização vira acesso restrito", () => {
  const error = ui.normalizeError({ callableStatus: "PERMISSION_DENIED" });
  assert.equal(error.title, "Acesso restrito");
});

test("controller exige cliente financeiro", () => {
  assert.throws(
    () => ui.createController({ document: { createElement() {} }, getIdToken() {} }),
    /course-purchase-api/
  );
});

test("controller exige token autenticado", () => {
  assert.throws(
    () => ui.createController({
      api: { listAdminOperations() {} },
      document: { createElement() {} }
    }),
    /getIdToken/
  );
});

test("console administrativo deixa de ser rotulado como course-only", () => {
  assert.ok(source.includes('"Operações financeiras"'));
  assert.equal(
    source.includes('"Operações financeiras de cursos"'),
    false
  );
  assert.ok(
    source.includes(
      "`${view.lifecycleLabel}: ${view.lifecycleStatusLabel}`"
    )
  );
});

test("UI usa somente callables financeiras para listar e reverter", () => {
  assert.ok(source.includes("api.listAdminOperations(50, apiOptions())"));
  assert.ok(source.includes("api.requestFullRefund(view.orderId, reason, apiOptions())"));
  assert.ok(source.includes("api.cancelPending(view.orderId, reason, apiOptions())"));
});

test("UI não acessa coleções financeiras diretamente", () => {
  assert.equal(source.includes('collection("orders")'), false);
  assert.equal(source.includes("payment_transactions"), false);
  assert.equal(source.includes("financial_reversal_requests"), false);
  assert.equal(source.includes("providerPaymentId"), false);
  assert.equal(source.includes("financialSnapshot"), false);
});

test("duplo clique é bloqueado por pedido enquanto ação está em voo", () => {
  assert.ok(source.includes("state.pendingOrderIds.has(view.orderId)"));
  assert.ok(source.includes("state.pendingOrderIds.add(view.orderId)"));
  assert.ok(source.includes("state.pendingOrderIds.delete(view.orderId)"));
});

test("operações exigem confirmação e justificativa antes da callable", () => {
  const confirmIndex = source.indexOf("const confirmed = await confirmAction(view)");
  const reasonIndex = source.indexOf("const reason = String(await requestReason");
  const refundIndex = source.indexOf("await api.requestFullRefund");
  assert.ok(confirmIndex >= 0);
  assert.ok(reasonIndex > confirmIndex);
  assert.ok(refundIndex > reasonIndex);
  assert.ok(source.includes("reason.length < 5 || reason.length > 300"));
});

console.log(`FINANCIAL_OPS_UI_V1_2=${passed}/19`);
if (passed !== 19) process.exitCode = 1;
