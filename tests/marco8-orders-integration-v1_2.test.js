"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  hasAdminCapability
} = require(
  "../functions/src/admin/admin-access-policy"
);

const {
  OPERATIONAL_ORDER_VIEW_FIELDS,
  OPERATIONAL_PRODUCT_SUMMARY_FIELDS,
  OPERATIONAL_BUYER_SUMMARY_FIELDS,
  OPERATIONAL_PAYMENT_STATUS_FIELDS,
  OPERATIONAL_FULFILLMENT_STATUS_FIELDS,
  OPERATIONAL_REVERSAL_STATUS_FIELDS,
  OPERATIONAL_RECONCILIATION_STATUS_FIELDS
} = require(
  "../functions/src/admin/admin-order-models"
);

const {
  ORDERS_READ_CAPABILITY
} = require(
  "../functions/src/admin/admin-orders-read-functions"
);

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

function read(
  relativePath
) {
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

function contains(
  text,
  value,
  label
) {
  assert.ok(
    text.includes(
      value
    ),
    `${label}: missing ${value}`
  );
}

function excludes(
  text,
  value,
  label
) {
  assert.strictEqual(
    text.includes(
      value
    ),
    false,
    `${label}: forbidden ${value}`
  );
}

const architecture =
  read(
    "docs/architecture/MARCO_8_ORDERS.md"
  );

const main =
  read(
    "functions/main.js"
  );

const functionsSource =
  read(
    "functions/src/admin/admin-orders-read-functions.js"
  );

const serviceSource =
  read(
    "functions/src/admin/admin-orders-read-service.js"
  );

const modelSource =
  read(
    "functions/src/admin/admin-order-models.js"
  );

/*
 * 1. Architecture sequence remains 8.5E local integration/regression
 *    followed by 8.5F controlled staging. Production stays blocked.
 */
contains(
  architecture,
  "### 8.5E",
  "8.5E architecture"
);

contains(
  architecture,
  "Integracao e regressao local.",
  "8.5E architecture"
);

contains(
  architecture,
  "### 8.5F",
  "8.5F architecture"
);

contains(
  architecture,
  "Staging controlado e smoke funcional.",
  "8.5F architecture"
);

contains(
  architecture,
  "Nenhum passo deste documento autoriza deploy em producao.",
  "production boundary"
);

/*
 * 2. Operational view contract remains exact and sanitized.
 */
assert.deepStrictEqual(
  OPERATIONAL_ORDER_VIEW_FIELDS,
  [
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
);

assert.deepStrictEqual(
  OPERATIONAL_PRODUCT_SUMMARY_FIELDS,
  [
    "productType",
    "productId",
    "label"
  ]
);

assert.deepStrictEqual(
  OPERATIONAL_BUYER_SUMMARY_FIELDS,
  [
    "userId",
    "displayName",
    "email"
  ]
);

assert.deepStrictEqual(
  OPERATIONAL_PAYMENT_STATUS_FIELDS,
  [
    "orderStatus",
    "transactionStatus"
  ]
);

assert.deepStrictEqual(
  OPERATIONAL_FULFILLMENT_STATUS_FIELDS,
  [
    "kind",
    "status"
  ]
);

assert.deepStrictEqual(
  OPERATIONAL_REVERSAL_STATUS_FIELDS,
  [
    "status",
    "operation"
  ]
);

assert.deepStrictEqual(
  OPERATIONAL_RECONCILIATION_STATUS_FIELDS,
  [
    "required"
  ]
);

const exposedFields =
  new Set([
    ...OPERATIONAL_ORDER_VIEW_FIELDS,
    ...OPERATIONAL_PRODUCT_SUMMARY_FIELDS,
    ...OPERATIONAL_BUYER_SUMMARY_FIELDS,
    ...OPERATIONAL_PAYMENT_STATUS_FIELDS,
    ...OPERATIONAL_FULFILLMENT_STATUS_FIELDS,
    ...OPERATIONAL_REVERSAL_STATUS_FIELDS,
    ...OPERATIONAL_RECONCILIATION_STATUS_FIELDS
  ]);

for (
  const forbidden
  of [
    "providerPaymentId",
    "providerCustomerId",
    "walletId",
    "splitSnapshot",
    "recipientShares",
    "platformFeeBps",
    "financialRuleId",
    "idempotencyKey",
    "webhookToken",
    "apiKey",
    "cpf"
  ]
) {
  assert.strictEqual(
    exposedFields.has(
      forbidden
    ),
    false,
    `Operational order view must not expose ${forbidden}`
  );
}

/*
 * 3. Global RBAC: four intended global roles receive orders read;
 *    content and organizational roles do not.
 */
assert.strictEqual(
  ORDERS_READ_CAPABILITY,
  "ops.orders.read"
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
  assert.strictEqual(
    hasAdminCapability(
      {
        [role]:
          true
      },
      ORDERS_READ_CAPABILITY
    ),
    true,
    `${role} must receive ${ORDERS_READ_CAPABILITY}`
  );
}

assert.strictEqual(
  hasAdminCapability(
    {
      content_admin:
        true
    },
    ORDERS_READ_CAPABILITY
  ),
  false,
  "content_admin must not receive ops.orders.read"
);

assert.strictEqual(
  hasAdminCapability(
    {
      organization_role:
        "owner"
    },
    ORDERS_READ_CAPABILITY
  ),
  false,
  "organization role must not escalate to global orders"
);

/*
 * 4. Callable contract and client-input boundary.
 */
for (
  const callable
  of [
    "listarPedidosOperacionaisV12",
    "obterPedidoOperacionalV12"
  ]
) {
  contains(
    functionsSource,
    callable,
    "orders callable"
  );
}

contains(
  functionsSource,
  '"ops.orders.read"',
  "orders capability"
);

for (
  const field
  of [
    '"limit"',
    '"cursor"',
    '"productType"',
    '"orderStatus"',
    '"orderId"'
  ]
) {
  contains(
    functionsSource,
    field,
    "orders payload allowlist"
  );
}

for (
  const forbidden
  of [
    "request.data.role",
    "request.data.actorRole",
    "request.data.capability",
    "request.data.collection",
    "request.data.fields",
    '"console.finance.read"',
    "ASAAS_API_KEY",
    "ASAAS_WEBHOOK_TOKEN",
    "defineSecret",
    "providerFactory"
  ]
) {
  excludes(
    functionsSource,
    forbidden,
    "orders callable boundary"
  );
}

/*
 * 5. Layering remains functions -> read service -> operational model ->
 *    canonical financial/course/exam domains.
 */
contains(
  functionsSource,
  'require("./admin-orders-read-service")',
  "functions to service binding"
);

contains(
  serviceSource,
  'require(\n  "./admin-order-models"\n)',
  "service to model binding"
);

contains(
  modelSource,
  'require(\n  "../finance/financial-domain"\n)',
  "model financial canonical binding"
);

contains(
  modelSource,
  'require(\n  "../courses/course-enrollment-domain"\n)',
  "model course canonical binding"
);

contains(
  modelSource,
  'require(\n  "../exams/exam-registration-domain"\n)',
  "model exam canonical binding"
);

contains(
  modelSource,
  'require(\n  "../finance/financial-purchase-read-domain"\n)',
  "model reversal canonical binding"
);

/*
 * 6. Read service uses only the eight canonical sources documented by 8.5A.
 */
for (
  const collection
  of [
    '"orders"',
    '"payment_transactions"',
    '"courses"',
    '"exam_sessions"',
    '"enrollments"',
    '"exam_registrations"',
    '"usuarios"',
    '"financial_reversal_requests"'
  ]
) {
  contains(
    serviceSource,
    collection,
    "orders canonical source"
  );
}

for (
  const forbiddenCollection
  of [
    '"admin_orders"',
    '"operational_orders"',
    '"orders_v2"'
  ]
) {
  excludes(
    serviceSource,
    forbiddenCollection,
    "parallel ledger boundary"
  );
}

/*
 * 7. Operational service remains Firestore read-only and provider-free.
 */
for (
  const forbiddenPattern
  of [
    /\bdb\s*\.\s*runTransaction\s*\(/,
    /\bdb\s*\.\s*batch\s*\(/,
    /\b(?:transaction|batch)\s*\.\s*(?:create|set|update|delete)\s*\(/,
    /\bawait\s+[\w$.]+\s*\.\s*(?:create|set|update|delete)\s*\(/,
    /\bFieldValue\b/,
    /\bserverTimestamp\s*\(/
  ]
) {
  assert.strictEqual(
    forbiddenPattern.test(
      serviceSource
    ),
    false,
    "orders read service must not perform Firestore writes"
  );
}

for (
  const forbidden
  of [
    "ASAAS_API_KEY",
    "ASAAS_WEBHOOK_TOKEN",
    "GEMINI_COURSE_MODERATION_API_KEY",
    "defineSecret",
    "providerFactory",
    "axios",
    "console.finance.read"
  ]
) {
  excludes(
    serviceSource,
    forbidden,
    "orders read service dependency boundary"
  );
}

/*
 * 8. Main composition is guarded by the shared administrative runtime gate.
 */
contains(
  main,
  'require("./src/admin/admin-orders-read-functions")',
  "orders main import"
);

contains(
  main,
  "createAdminOrdersReadFunctions",
  "orders main factory"
);

contains(
  main,
  "const adminOrdersReadFunctions =",
  "orders guarded composition"
);

contains(
  main,
  "...adminOrdersReadFunctions,",
  "orders main export"
);

const ordersBlockStart =
  main.indexOf(
    "const adminOrdersReadFunctions ="
  );

const workflowBlockStart =
  main.indexOf(
    "const adminCourseWorkflowFunctions ="
  );

assert.ok(
  ordersBlockStart >= 0 &&
  workflowBlockStart >
    ordersBlockStart,
  "orders composition block must precede course workflow block"
);

const ordersBlock =
  main.slice(
    ordersBlockStart,
    workflowBlockStart
  );

contains(
  ordersBlock,
  "adminRuntimeAllowed",
  "orders runtime gate"
);

contains(
  ordersBlock,
  "createAdminOrdersReadFunctions",
  "orders factory binding"
);

contains(
  ordersBlock,
  "REGION",
  "orders REGION binding"
);

contains(
  ordersBlock,
  "db",
  "orders Firestore binding"
);

for (
  const forbidden
  of [
    "webhookRuntimeAllowed",
    "ASAAS_API_KEY",
    "ASAAS_WEBHOOK_TOKEN",
    "financialEnvironment",
    "providerFactory",
    "defineSecret"
  ]
) {
  excludes(
    ordersBlock,
    forbidden,
    "orders main composition boundary"
  );
}

const adminGateStart =
  main.indexOf(
    "const adminRuntimeAllowed ="
  );

const adminGateEnd =
  main.indexOf(
    "const adminRuntimeEnvironment =",
    adminGateStart
  );

assert.ok(
  adminGateStart >= 0 &&
  adminGateEnd >
    adminGateStart,
  "administrative runtime gate block missing"
);

const adminGate =
  main.slice(
    adminGateStart,
    adminGateEnd
  );

contains(
  adminGate,
  "firebaseProjectId === STAGING_PROJECT_ID",
  "staging administrative runtime"
);

contains(
  adminGate,
  "webhookDemoEmulatorAllowed",
  "demo emulator administrative runtime"
);

excludes(
  adminGate,
  'firebaseProjectId === "bjj-exams"',
  "production administrative runtime"
);

/*
 * 9. Orders surface remains separate from Finance Console authority.
 */
contains(
  architecture,
  "`ops.orders.read` e `console.finance.read` sao capacidades diferentes.",
  "financial console separation"
);

excludes(
  functionsSource,
  "createFinancialAdminFunctions",
  "orders callable financial admin isolation"
);

excludes(
  serviceSource,
  "financial-admin-functions",
  "orders service financial console isolation"
);

/*
 * 10. No mutation callable may leak into the operational order surface.
 */
for (
  const forbidden
  of [
    "solicitar",
    "estornar",
    "cancelarPagamento",
    "reprocessarWebhook",
    "alterarSplit",
    "atualizarPedido"
  ]
) {
  excludes(
    functionsSource,
    forbidden,
    "orders mutation callable boundary"
  );
}

console.log(
  "MARCO8_5E_ARCHITECTURE_SEQUENCE=PASSED"
);

console.log(
  "MARCO8_5E_OPERATIONAL_VIEW_FIELDS=9/9"
);

console.log(
  "MARCO8_5E_NESTED_VIEW_CONTRACTS=6/6"
);

console.log(
  "MARCO8_5E_SENSITIVE_FIELD_EXPOSURE=False"
);

console.log(
  "MARCO8_5E_ORDERS_CAPABILITY=ops.orders.read"
);

console.log(
  "MARCO8_5E_GLOBAL_ROLE_ACCESS=4/4"
);

console.log(
  "MARCO8_5E_CONTENT_ACCESS=BLOCKED"
);

console.log(
  "MARCO8_5E_ORG_ROLE_ESCALATION=BLOCKED"
);

console.log(
  "MARCO8_5E_CALLABLES=2/2"
);

console.log(
  "MARCO8_5E_PAYLOAD_ALLOWLIST=5/5"
);

console.log(
  "MARCO8_5E_CLIENT_AUTHORIZATION_ESCALATION=BLOCKED"
);

console.log(
  "MARCO8_5E_LAYERING=FUNCTIONS_SERVICE_MODEL_CANONICAL_DOMAINS"
);

console.log(
  "MARCO8_5E_CANONICAL_SOURCES=8/8"
);

console.log(
  "MARCO8_5E_PARALLEL_LEDGER=False"
);

console.log(
  "MARCO8_5E_FIRESTORE_READ_ONLY=True"
);

console.log(
  "MARCO8_5E_PROVIDER_DEPENDENCY=False"
);

console.log(
  "MARCO8_5E_FINANCIAL_CONSOLE_DEPENDENCY=False"
);

console.log(
  "MARCO8_5E_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_5E_PRODUCTION_EXPORT=BLOCKED"
);

console.log(
  "MARCO8_5E_MUTATION_CALLABLES=False"
);

console.log(
  "MARCO8_5E_ORDERS_INTEGRATION=PASSED"
);
