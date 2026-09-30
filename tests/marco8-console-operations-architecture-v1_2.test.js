"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

const architecturePath = path.join(
  root,
  "docs",
  "architecture",
  "MARCO_8_CONSOLE_OPERATIONS.md"
);

const architecture = fs.readFileSync(
  architecturePath,
  "utf8"
);

const accessPolicy = require(
  path.join(
    root,
    "functions",
    "src",
    "admin",
    "admin-access-policy.js"
  )
);

const webhookPersistenceSource = fs.readFileSync(
  path.join(
    root,
    "functions",
    "src",
    "finance",
    "financial-webhook-persistence.js"
  ),
  "utf8"
);

const webhookFulfillmentSource = fs.readFileSync(
  path.join(
    root,
    "functions",
    "src",
    "finance",
    "financial-webhook-fulfillment.js"
  ),
  "utf8"
);

const lifecycleServiceSource = fs.readFileSync(
  path.join(
    root,
    "functions",
    "src",
    "admin",
    "admin-lifecycle-service.js"
  ),
  "utf8"
);

const courseWorkflowSource = fs.readFileSync(
  path.join(
    root,
    "functions",
    "src",
    "admin",
    "admin-course-workflow-service.js"
  ),
  "utf8"
);

const questionWriteSource = fs.readFileSync(
  path.join(
    root,
    "functions",
    "src",
    "admin",
    "admin-question-write-service.js"
  ),
  "utf8"
);

const financialAdminSource = fs.readFileSync(
  path.join(
    root,
    "functions",
    "src",
    "finance",
    "financial-admin-service.js"
  ),
  "utf8"
);

const firestoreRules = fs.readFileSync(
  path.join(
    root,
    "firestore.rules"
  ),
  "utf8"
);

function contains(
  source,
  value,
  label = value
) {
  assert.ok(
    source.includes(value),
    `${label}: missing ${value}`
  );
}

function excludes(
  source,
  value,
  label = value
) {
  assert.equal(
    source.includes(value),
    false,
    `${label}: forbidden ${value}`
  );
}

function exactRoleAccess(
  capability,
  expectedRoles
) {
  const roles = [
    "super_admin",
    "platform_admin",
    "finance_admin",
    "content_admin",
    "support_admin"
  ];

  const actual = roles.filter(
    role =>
      accessPolicy.hasAdminCapability(
        {
          [role]: true
        },
        capability
      )
  );

  assert.deepEqual(
    actual,
    expectedRoles,
    `${capability} role mapping`
  );
}

assert.equal(
  fs.existsSync(architecturePath),
  true,
  "8.6A architecture document must exist"
);

contains(
  architecture,
  "# Marco 8.6A — Console operacional",
  "architecture title"
);

contains(
  webhookPersistenceSource,
  "payment_webhook_events/",
  "canonical webhook persistence"
);

contains(
  webhookFulfillmentSource,
  "payment_webhook_events/",
  "canonical webhook fulfillment"
);

for (
  const source
  of [
    webhookFulfillmentSource,
    lifecycleServiceSource,
    courseWorkflowSource,
    questionWriteSource,
    financialAdminSource
  ]
) {
  contains(
    source,
    "audit_logs",
    "canonical audit collection reuse"
  );
}

contains(
  architecture,
  "`payment_webhook_events`",
  "webhook canonical source"
);

contains(
  architecture,
  "`audit_logs`",
  "audit canonical source"
);

for (
  const forbidden
  of [
    "admin_webhook_events",
    "webhook_events_v2",
    "operational_webhooks",
    "admin_audit_events",
    "audit_logs_v2",
    "operational_audit_logs"
  ]
) {
  excludes(
    architecture,
    `criar \`${forbidden}\``,
    `parallel collection ${forbidden}`
  );
}

const requiredCapabilities = [
  "console.webhooks.read",
  "console.webhooks.reprocess",
  "console.audit.read",
  "console.security.read",
  "console.config.read",
  "console.config.manage",
  "console.health.read"
];

for (
  const capability
  of requiredCapabilities
) {
  assert.ok(
    accessPolicy.ADMIN_CAPABILITIES.includes(
      capability
    ),
    `missing capability ${capability}`
  );

  contains(
    architecture,
    `\`${capability}\``,
    `architecture capability ${capability}`
  );
}

exactRoleAccess(
  "console.webhooks.read",
  [
    "super_admin",
    "platform_admin",
    "finance_admin"
  ]
);

exactRoleAccess(
  "console.webhooks.reprocess",
  [
    "super_admin",
    "finance_admin"
  ]
);

exactRoleAccess(
  "console.audit.read",
  [
    "super_admin",
    "platform_admin",
    "finance_admin",
    "support_admin"
  ]
);

exactRoleAccess(
  "console.security.read",
  [
    "super_admin",
    "platform_admin",
    "support_admin"
  ]
);

exactRoleAccess(
  "console.config.read",
  [
    "super_admin",
    "platform_admin"
  ]
);

exactRoleAccess(
  "console.health.read",
  [
    "super_admin",
    "platform_admin",
    "finance_admin",
    "support_admin"
  ]
);

assert.equal(
  accessPolicy.hasAdminCapability(
    {
      organization_owner: true,
      organization_admin: true
    },
    "console.audit.read"
  ),
  false,
  "organization roles cannot escalate global console access"
);

const webhookViewFields = [
  "eventId",
  "provider",
  "providerEventRef",
  "eventType",
  "status",
  "relatedOrderId",
  "deliveryCount",
  "processing",
  "timestamps"
];

for (
  const field
  of webhookViewFields
) {
  contains(
    architecture,
    `\`${field}\``,
    `WebhookOperationalView field ${field}`
  );
}

const forbiddenWebhookOutput = [
  "providerPaymentId",
  "providerCustomerId",
  "externalReference",
  "billingType",
  "valueCents",
  "authToken"
];

for (
  const field
  of forbiddenWebhookOutput
) {
  contains(
    architecture,
    `\`${field}\``,
    `forbidden webhook output ${field}`
  );
}

for (
  const callable
  of [
    "listarWebhooksOperacionaisV12",
    "obterWebhookOperacionalV12",
    "reprocessarWebhookOperacionalV12",
    "listarAuditoriaOperacionalV12",
    "obterSegurancaOperacionalV12",
    "obterConfiguracaoOperacionalV12",
    "obterSaudeOperacionalV12"
  ]
) {
  contains(
    architecture,
    `\`${callable}\``,
    `8.6 callable ${callable}`
  );
}

contains(
  architecture,
  "status=error",
  "reprocess eligibility"
);

for (
  const status
  of [
    "`processed`",
    "`ignored`",
    "evento `received`"
  ]
) {
  contains(
    architecture,
    status,
    "reprocess blocked state"
  );
}

for (
  const field
  of [
    "`reprocessCount`",
    "`lastReprocessRequestId`",
    "`lastReprocessRequestedBy`",
    "`lastReprocessRequestedAt`"
  ]
) {
  contains(
    architecture,
    field,
    "reprocess idempotency metadata"
  );
}

contains(
  architecture,
  "`admin.webhook.reprocess.requested`",
  "reprocess audit event"
);

for (
  const mapping
  of [
    "`action` -> `eventType`",
    "`actorId` -> `actorUid`",
    "`entityType` -> `targetType`",
    "`entityId` -> `targetId`"
  ]
) {
  contains(
    architecture,
    mapping,
    "legacy audit adapter mapping"
  );
}

for (
  const field
  of [
    "`auditId`",
    "`eventType`",
    "`actor`",
    "`target`",
    "`organizationId`",
    "`source`",
    "`requestId`",
    "`createdAt`",
    "`metadata`"
  ]
) {
  contains(
    architecture,
    field,
    `AuditOperationalView field ${field}`
  );
}

contains(
  architecture,
  "`before` e `after` históricos nunca são devolvidos crus",
  "audit sanitization"
);

contains(
  architecture,
  "A primeira versão é read-only.",
  "config initial read-only"
);

contains(
  architecture,
  "não realiza ping autenticado ao Asaas",
  "health provider boundary"
);

contains(
  architecture,
  "retornar `null` ou `unsupported`",
  "security no fabricated counters"
);

contains(
  firestoreRules,
  "match /payment_webhook_events/{eventId}",
  "webhook Firestore boundary"
);

contains(
  firestoreRules,
  "allow read, write: if false;",
  "server-side Firestore boundary"
);

for (
  const stage
  of [
    "### 8.6A",
    "### 8.6B",
    "### 8.6C",
    "### 8.6D",
    "### 8.6E",
    "### 8.6F",
    "### 8.7 — Frontend integrado",
    "### 8.8 — Homologação geral em staging",
    "### 8.9 — Release candidate"
  ]
) {
  contains(
    architecture,
    stage,
    `implementation sequence ${stage}`
  );
}

contains(
  architecture,
  "Nenhum passo deste documento autoriza deploy em produção.",
  "production boundary"
);

console.log(
  "MARCO8_6A_CANONICAL_WEBHOOK_SOURCE=payment_webhook_events"
);

console.log(
  "MARCO8_6A_CANONICAL_AUDIT_SOURCE=audit_logs"
);

console.log(
  "MARCO8_6A_PARALLEL_WEBHOOK_LEDGER=False"
);

console.log(
  "MARCO8_6A_PARALLEL_AUDIT_LEDGER=False"
);

console.log(
  "MARCO8_6A_CONSOLE_CAPABILITIES=7/7"
);

console.log(
  "MARCO8_6A_WEBHOOK_READ_ROLES=3/3"
);

console.log(
  "MARCO8_6A_WEBHOOK_REPROCESS_ROLES=2/2"
);

console.log(
  "MARCO8_6A_AUDIT_READ_ROLES=4/4"
);

console.log(
  "MARCO8_6A_SECURITY_READ_ROLES=3/3"
);

console.log(
  "MARCO8_6A_CONFIG_READ_ROLES=2/2"
);

console.log(
  "MARCO8_6A_HEALTH_READ_ROLES=4/4"
);

console.log(
  "MARCO8_6A_ORG_ROLE_ESCALATION=BLOCKED"
);

console.log(
  "MARCO8_6A_WEBHOOK_VIEW_FIELDS=9/9"
);

console.log(
  "MARCO8_6A_WEBHOOK_REPROCESS=ERROR_ONLY"
);

console.log(
  "MARCO8_6A_REPROCESS_IDEMPOTENCY=CANONICAL_EVENT_METADATA"
);

console.log(
  "MARCO8_6A_AUDIT_ADAPTER=LEGACY_COMPATIBLE"
);

console.log(
  "MARCO8_6A_AUDIT_RAW_BEFORE_AFTER_EXPOSURE=False"
);

console.log(
  "MARCO8_6A_CONFIG_MUTATION=DEFERRED_EXPLICIT_SCHEMA"
);

console.log(
  "MARCO8_6A_PROVIDER_HEALTH_PING=False"
);

console.log(
  "MARCO8_6A_RUNTIME_GATE=STAGING_DEMO_ONLY"
);

console.log(
  "MARCO8_6A_PRODUCTION=FORBIDDEN"
);

console.log(
  "MARCO8_6A_CONSOLE_OPERATIONS_ARCHITECTURE=PASSED"
);
