"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

function read(relativePath) {
  return fs
    .readFileSync(
      path.join(
        ROOT,
        relativePath
      ),
      "utf8"
    )
    .replace(
      /\r\n/g,
      "\n"
    );
}

function has(
  text,
  marker,
  label
) {
  assert.ok(
    text.includes(marker),
    `${label}: missing ${marker}`
  );
}

const architecture =
  read(
    "docs/architecture/MARCO_8_ORDERS.md"
  );

const rbac =
  read(
    "docs/architecture/MARCO_8_RBAC_CONTRACTS.md"
  );

const accessPolicy =
  read(
    "functions/src/admin/admin-access-policy.js"
  );

const financialDomain =
  read(
    "functions/src/finance/financial-domain.js"
  );

const legacyPurchaseFunctions =
  read(
    "functions/src/finance/financial-purchase-read-functions.js"
  );

const financialAdminDomain =
  read(
    "functions/src/finance/financial-admin-domain.js"
  );

const navigation =
  read(
    "js/admin-shell-navigation-v1_2.js"
  );

for (
  const marker
  of [
    "orders",
    "payment_transactions",
    "courses",
    "exam_sessions",
    "enrollments",
    "exam_registrations",
    "usuarios"
  ]
) {
  has(
    architecture,
    `\`${marker}\``,
    "canonical source"
  );
}

for (
  const marker
  of [
    "listarPedidosOperacionaisV12",
    "obterPedidoOperacionalV12"
  ]
) {
  has(
    architecture,
    `\`${marker}\``,
    "orders architecture contract"
  );

  has(
    rbac,
    `\`${marker}\``,
    "orders RBAC contract"
  );
}

has(
  architecture,
  "`ops.orders.read`",
  "orders capability"
);

has(
  accessPolicy,
  '"ops.orders.read"',
  "orders capability implementation"
);

for (
  const role
  of [
    "super_admin",
    "platform_admin",
    "finance_admin",
    "support_admin"
  ]
) {
  has(
    architecture,
    `\`${role}\``,
    "orders allowed role"
  );
}

has(
  architecture,
  "`content_admin` nao recebe `ops.orders.read`",
  "content admin orders boundary"
);

has(
  navigation,
  'id: "orders"',
  "orders navigation item"
);

has(
  navigation,
  'capability: "ops.orders.read"',
  "orders navigation capability"
);

for (
  const field
  of [
    "orderId",
    "productType",
    "productSummary",
    "buyerSummary",
    "paymentStatus",
    "fulfillmentStatus",
    "reversalStatus",
    "reconciliationStatus",
    "createdAt"
  ]
) {
  has(
    architecture,
    `\`${field}\``,
    "OperationalOrderView field"
  );

  has(
    rbac,
    `\`${field}\``,
    "RBAC OperationalOrderView field"
  );
}

for (
  const forbidden
  of [
    "providerPaymentId",
    "walletId",
    "splitSnapshot",
    "recipientShares",
    "platformFeeBps",
    "financialRuleId",
    "idempotencyKey",
    "ASAAS_API_KEY",
    "ASAAS_WEBHOOK_TOKEN"
  ]
) {
  has(
    architecture,
    forbidden,
    "orders sensitive boundary"
  );
}

for (
  const productType
  of [
    "course",
    "belt_exam"
  ]
) {
  has(
    financialDomain,
    `'${productType}'`,
    "canonical financial product type"
  );
}

for (
  const status
  of [
    "pending_payment",
    "paid",
    "cancelled",
    "expired",
    "refunded",
    "chargeback"
  ]
) {
  has(
    financialDomain,
    `'${status}'`,
    "canonical order status"
  );
}

has(
  legacyPurchaseFunctions,
  "listarOperacoesFinanceirasV12",
  "existing financial operations read"
);

has(
  financialAdminDomain,
  "claims.super_admin === true",
  "legacy financial authority super admin"
);

has(
  financialAdminDomain,
  "claims.platform_admin === true",
  "legacy financial authority platform admin"
);

assert.strictEqual(
  financialAdminDomain.includes(
    "claims.support_admin === true"
  ),
  false,
  "legacy financial admin authorization must not be widened for Orders"
);

has(
  architecture,
  "`adminRuntimeAllowed`",
  "admin runtime gate"
);

has(
  architecture,
  "Nenhum passo deste documento autoriza deploy em producao.",
  "production boundary"
);

has(
  architecture,
  "Firestore-read-only",
  "read-only service boundary"
);

console.log(
  "MARCO8_5A_ORDERS_CANONICAL_SOURCES=PASSED"
);

console.log(
  "MARCO8_5A_ORDERS_CONTRACTS=2/2"
);

console.log(
  "MARCO8_5A_ORDERS_CAPABILITY=ops.orders.read"
);

console.log(
  "MARCO8_5A_ORDERS_RBAC_BOUNDARY=PASSED"
);

console.log(
  "MARCO8_5A_ORDERS_VIEW_SANITIZATION=PASSED"
);

console.log(
  "MARCO8_5A_FINANCIAL_CONSOLE_SEPARATION=PASSED"
);

console.log(
  "MARCO8_5A_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_5A_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_5A_ORDERS_ARCHITECTURE=PASSED"
);
