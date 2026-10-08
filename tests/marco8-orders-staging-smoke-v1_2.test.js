"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");

const runSource = fs.readFileSync(
  path.join(root, "functions", "scripts", "run-admin-orders-staging-smoke.js"),
  "utf8"
);

const cleanupSource = fs.readFileSync(
  path.join(root, "functions", "scripts", "cleanup-admin-orders-staging-smoke.js"),
  "utf8"
);

const gitignore = fs.readFileSync(
  path.join(root, ".gitignore"),
  "utf8"
);

const cases = [];

function test(name, fn) {
  cases.push({ name, fn });
}

function contains(source, value) {
  assert.ok(
    source.includes(value),
    `Esperado encontrar: ${value}`
  );
}

function excludes(source, value) {
  assert.strictEqual(
    source.includes(value),
    false,
    `Não deveria encontrar: ${value}`
  );
}

test("smoke e cleanup sao fixados em staging e bloqueiam producao", () => {
  contains(runSource, "const TARGET_PROJECT = 'bjj-exams-staging';");
  contains(runSource, "const PRODUCTION_PROJECT = 'bjj-exams';");
  contains(runSource, "fail('Projeto de produção detectado. Execução bloqueada.')");
  contains(cleanupSource, "fail('Projeto de produção detectado. Cleanup bloqueado.')");
});

test("harness exige confirmacao explicita e branch do Marco 8", () => {
  contains(runSource, "const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';");
  contains(runSource, "const ALLOWED_BRANCH = 'feature/marco8-ops-console';");
  contains(runSource, "currentBranch() !== ALLOWED_BRANCH");
  contains(cleanupSource, "currentBranch() !== ALLOWED_BRANCH");
});

test("smoke usa autenticacao real e callables implantadas", () => {
  contains(runSource, "accounts:signInWithPassword");
  contains(runSource, "'listarPedidosOperacionaisV12'");
  contains(runSource, "'obterPedidoOperacionalV12'");
  contains(runSource, "headers.Authorization = `Bearer ${idToken}`");
});

test("fixture usa claims globais controladas", () => {
  contains(runSource, "support_admin: true");
  contains(runSource, "content_admin: true");
  excludes(runSource, "finance_admin: true");
  excludes(runSource, "super_admin: true");
});

test("fixture financeira e construida pelo dominio canonico", () => {
  contains(runSource, "buildFinancialSnapshot");
  contains(runSource, "validateOrder");
  contains(runSource, "status: 'pending_payment'");
  contains(runSource, "currentTransactionId: null");
  contains(runSource, "TEMP_TRANSACTIONS_CREATED=0");
});

test("fixture cria dois pedidos lexicograficamente iniciais", () => {
  contains(runSource, "`00000000-marco85f-${runId}-a`");
  contains(runSource, "`00000000-marco85f-${runId}-b`");
  contains(runSource, "TEMP_ORDERS_CREATED=2");
});

test("smoke valida autenticacao autorizacao e payload allowlist", () => {
  contains(runSource, "UNAUTHENTICATED_ACCESS=BLOCKED");
  contains(runSource, "CONTENT_ADMIN_ACCESS=BLOCKED");
  contains(runSource, "CLIENT_ROLE_INPUT=BLOCKED");
  contains(runSource, "'PERMISSION_DENIED'");
  contains(runSource, "'INVALID_ARGUMENT'");
});

test("smoke valida listagem cursor e detalhe em staging real", () => {
  contains(runSource, "SUPPORT_LIST_PAGE_1=OK");
  contains(runSource, "SUPPORT_LIST_CURSOR_PAGE_2=OK");
  contains(runSource, "SUPPORT_DETAIL=OK");
  contains(runSource, "cursor: firstPage.nextCursor");
});

test("smoke valida contrato sanitizado exato", () => {
  contains(runSource, "assertSanitizedOperationalView");
  contains(runSource, "LIST_VIEW_SANITIZED=OK");
  contains(runSource, "DETAIL_VIEW_SANITIZED=OK");
  contains(runSource, "'financialSnapshot'");
  contains(runSource, "'providerPaymentId'");
  contains(runSource, "'platformFeeBps'");
});

test("smoke confirma comportamento read-only", () => {
  contains(runSource, "CANONICAL_ORDERS_UNCHANGED=OK");
  contains(runSource, "READ_CALLABLE_WRITES=False");
  contains(runSource, "payment_transactions");
  contains(runSource, "txSnap.empty");
});

test("cleanup so remove documentos com ownership marker", () => {
  contains(cleanupSource, "data.smokeRunId !== runId");
  contains(cleanupSource, "data.productId !== state.courseId");
  contains(cleanupSource, "data.buyerUserId !== state.supportUserId");
  contains(cleanupSource, "REMOTE_RESIDUES=0");
});

test("cleanup remove auth perfis curso pedidos e state local", () => {
  contains(cleanupSource, "auth.deleteUser(uid)");
  contains(cleanupSource, "db.doc(`usuarios/${uid}`)");
  contains(cleanupSource, "db.doc(`courses/${state.courseId}`)");
  contains(cleanupSource, "db.doc(`orders/${orderId}`)");
  contains(cleanupSource, "fs.unlinkSync(STATE_FILE)");
});

test("harness nao chama provider nem Asaas", () => {
  for (const source of [runSource, cleanupSource]) {
    excludes(source, "ASAAS_API_KEY");
    excludes(source, "ASAAS_WEBHOOK_TOKEN");
    excludes(source, "api.asaas.com");
    excludes(source, "api-sandbox.asaas.com");
    excludes(source, "providerFactory");
  }
  contains(runSource, "PROVIDER_CALLS=False");
});

test("diagnosticos nao imprimem senhas ou tokens", () => {
  contains(runSource, "sanitizeDiagnosticText");
  contains(runSource, "PASSWORDS_PRINTED=False");
  excludes(runSource, "console.log(supportPassword");
  excludes(runSource, "console.log(contentPassword");
  excludes(runSource, "console.log(supportToken");
  excludes(runSource, "console.log(contentToken");
});

test("state file esta ignorado pelo Git", () => {
  contains(gitignore, "functions/.admin-orders-staging-smoke.local.json");
});

test("harness declara explicitamente que producao nao foi acessada", () => {
  contains(runSource, "PRODUCTION_ACCESS=NOT_RUN");
  contains(cleanupSource, "PRODUCTION_ACCESS=NOT_RUN");
});

let passed = 0;

for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(
  `MARCO8_5F_ORDERS_STAGING_SMOKE_CONTRACT=${passed}/${cases.length}`
);
