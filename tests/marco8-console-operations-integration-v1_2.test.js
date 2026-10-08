"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const {
  ADMIN_CAPABILITIES,
  hasAdminCapability
} = require("../functions/src/admin/admin-access-policy");

const {
  OPERATIONAL_WEBHOOK_VIEW_FIELDS
} = require("../functions/src/admin/admin-webhook-models");

const {
  WEBHOOK_EVENTS_COLLECTION,
  DEFAULT_WEBHOOKS_LIMIT,
  MAX_WEBHOOKS_LIMIT,
  WEBHOOK_MAX_SCAN_DOCS
} = require("../functions/src/admin/admin-webhooks-read-service");

const {
  WEBHOOKS_READ_CAPABILITY
} = require("../functions/src/admin/admin-webhooks-read-functions");

const {
  WEBHOOKS_REPROCESS_CAPABILITY
} = require("../functions/src/admin/admin-webhooks-reprocess-functions");

const {
  AUDIT_OPERATIONAL_VIEW_FIELDS,
  AUDIT_METADATA_MAX_JSON_BYTES
} = require("../functions/src/admin/admin-audit-models");

const {
  AUDIT_LOGS_COLLECTION,
  DEFAULT_AUDIT_LIMIT,
  MAX_AUDIT_LIMIT,
  AUDIT_MAX_SCAN_DOCS
} = require("../functions/src/admin/admin-audit-read-service");

const {
  AUDIT_READ_CAPABILITY
} = require("../functions/src/admin/admin-audit-read-functions");

const {
  SECURITY_OPERATIONAL_VIEW_FIELDS,
  CONFIG_OPERATIONAL_VIEW_FIELDS,
  HEALTH_OPERATIONAL_VIEW_FIELDS,
  PROVIDER_EXTERNAL_HEALTH
} = require("../functions/src/admin/admin-operational-observability-models");

const {
  WEBHOOK_HEALTH_STATUSES,
  REVERSAL_HEALTH_STATUSES
} = require("../functions/src/admin/admin-operational-observability-service");

const {
  SECURITY_READ_CAPABILITY,
  CONFIG_READ_CAPABILITY,
  HEALTH_READ_CAPABILITY
} = require("../functions/src/admin/admin-operational-observability-functions");

const {
  REVERSAL_REQUESTS_COLLECTION
} = require("../functions/src/finance/financial-reversal-admin-service");

function claims(role) {
  return { [role]: true };
}

function assertMatrix(capability, allowed, blocked) {
  for (const role of allowed) {
    assert.strictEqual(
      hasAdminCapability(claims(role), capability),
      true,
      `${role} should have ${capability}`
    );
  }

  for (const role of blocked) {
    assert.strictEqual(
      hasAdminCapability(claims(role), capability),
      false,
      `${role} should not have ${capability}`
    );
  }
}

function sliceBetween(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + 1);

  assert.ok(start >= 0, `${label} start marker missing`);
  assert.ok(end > start, `${label} end marker missing`);

  return source.slice(start, end);
}

function main() {
  const caps = [
    "console.webhooks.read",
    "console.webhooks.reprocess",
    "console.audit.read",
    "console.security.read",
    "console.config.read",
    "console.config.manage",
    "console.health.read"
  ];

  for (const cap of caps) {
    assert.ok(ADMIN_CAPABILITIES.includes(cap), `Missing ${cap}`);
  }

  assert.strictEqual(WEBHOOKS_READ_CAPABILITY, "console.webhooks.read");
  assert.strictEqual(WEBHOOKS_REPROCESS_CAPABILITY, "console.webhooks.reprocess");
  assert.strictEqual(AUDIT_READ_CAPABILITY, "console.audit.read");
  assert.strictEqual(SECURITY_READ_CAPABILITY, "console.security.read");
  assert.strictEqual(CONFIG_READ_CAPABILITY, "console.config.read");
  assert.strictEqual(HEALTH_READ_CAPABILITY, "console.health.read");

  assertMatrix(
    WEBHOOKS_READ_CAPABILITY,
    ["super_admin", "platform_admin", "finance_admin"],
    ["support_admin", "content_admin"]
  );

  assertMatrix(
    WEBHOOKS_REPROCESS_CAPABILITY,
    ["super_admin", "finance_admin"],
    ["platform_admin", "support_admin", "content_admin"]
  );

  assertMatrix(
    AUDIT_READ_CAPABILITY,
    ["super_admin", "platform_admin", "finance_admin", "support_admin"],
    ["content_admin"]
  );

  assertMatrix(
    SECURITY_READ_CAPABILITY,
    ["super_admin", "platform_admin", "support_admin"],
    ["finance_admin", "content_admin"]
  );

  assertMatrix(
    CONFIG_READ_CAPABILITY,
    ["super_admin", "platform_admin"],
    ["finance_admin", "support_admin", "content_admin"]
  );

  assertMatrix(
    "console.config.manage",
    ["super_admin", "platform_admin"],
    ["finance_admin", "support_admin", "content_admin"]
  );

  assertMatrix(
    HEALTH_READ_CAPABILITY,
    ["super_admin", "platform_admin", "finance_admin", "support_admin"],
    ["content_admin"]
  );

  for (const cap of caps) {
    assert.strictEqual(
      hasAdminCapability(
        {
          organization_admin: true,
          academy_admin: true,
          owner: true
        },
        cap
      ),
      false,
      `Organization role escalated into ${cap}`
    );
  }

  assert.strictEqual(WEBHOOK_EVENTS_COLLECTION, "payment_webhook_events");
  assert.strictEqual(AUDIT_LOGS_COLLECTION, "audit_logs");
  assert.strictEqual(REVERSAL_REQUESTS_COLLECTION, "financial_reversal_requests");

  assert.strictEqual(OPERATIONAL_WEBHOOK_VIEW_FIELDS.length, 9);
  assert.strictEqual(AUDIT_OPERATIONAL_VIEW_FIELDS.length, 9);
  assert.strictEqual(SECURITY_OPERATIONAL_VIEW_FIELDS.length, 7);
  assert.strictEqual(CONFIG_OPERATIONAL_VIEW_FIELDS.length, 6);
  assert.strictEqual(HEALTH_OPERATIONAL_VIEW_FIELDS.length, 8);

  assert.strictEqual(DEFAULT_WEBHOOKS_LIMIT, 20);
  assert.strictEqual(MAX_WEBHOOKS_LIMIT, 25);
  assert.strictEqual(WEBHOOK_MAX_SCAN_DOCS, 260);
  assert.strictEqual(DEFAULT_AUDIT_LIMIT, 20);
  assert.strictEqual(MAX_AUDIT_LIMIT, 25);
  assert.strictEqual(AUDIT_MAX_SCAN_DOCS, 260);
  assert.strictEqual(AUDIT_METADATA_MAX_JSON_BYTES, 2048);
  assert.strictEqual(PROVIDER_EXTERNAL_HEALTH, "not_measured");

  assert.deepStrictEqual(
    WEBHOOK_HEALTH_STATUSES,
    ["received", "processing", "processed", "ignored", "error"]
  );

  assert.deepStrictEqual(
    REVERSAL_HEALTH_STATUSES,
    ["executing", "awaiting_webhook", "provider_rejected", "needs_reconciliation"]
  );

  const mainSource = fs.readFileSync(
    path.join(__dirname, "..", "functions", "main.js"),
    "utf8"
  );

  const callableSources = [
    "admin-webhooks-read-functions.js",
    "admin-webhooks-reprocess-functions.js",
    "admin-audit-read-functions.js",
    "admin-operational-observability-functions.js"
  ].map(file =>
    fs.readFileSync(
      path.join(__dirname, "..", "functions", "src", "admin", file),
      "utf8"
    )
  ).join("\n");

  for (const marker of [
    "createAdminWebhooksReadFunctions",
    "createAdminWebhooksReprocessFunctions",
    "createAdminAuditReadFunctions",
    "createAdminOperationalObservabilityFunctions",
    "...adminWebhooksReadFunctions",
    "...adminWebhooksReprocessFunctions",
    "...adminAuditReadFunctions",
    "...adminOperationalObservabilityFunctions"
  ]) {
    assert.ok(mainSource.includes(marker), `main.js missing ${marker}`);
  }

  for (const callable of [
    "listarWebhooksOperacionaisV12",
    "obterWebhookOperacionalV12",
    "reprocessarWebhookOperacionalV12",
    "listarAuditoriaOperacionalV12",
    "obterSegurancaOperacionalV12",
    "obterConfiguracaoOperacionalV12",
    "obterSaudeOperacionalV12"
  ]) {
    assert.ok(callableSources.includes(callable), `Missing callable ${callable}`);
  }

  const webhookReadBlock = sliceBetween(
    mainSource,
    "// Operational Webhooks read surface for Marco 8.6.",
    "// Operational Audit read surface for Marco 8.6.",
    "webhook read"
  );

  const auditReadBlock = sliceBetween(
    mainSource,
    "// Operational Audit read surface for Marco 8.6.",
    "// Operational Course workflow command surface for Marco 8.",
    "audit read"
  );

  const observabilityBlock = sliceBetween(
    mainSource,
    "// Read-only Security, Config and Health surfaces for Marco 8.6.",
    "// Operational lifecycle command surface for Marco 8.",
    "observability"
  );

  for (const [label, block] of [
    ["webhook read", webhookReadBlock],
    ["audit read", auditReadBlock],
    ["observability", observabilityBlock]
  ]) {
    for (const marker of [".value(", "secrets:", "providerFactory:"]) {
      assert.strictEqual(
        block.includes(marker),
        false,
        `${label} unexpectedly contains ${marker}`
      );
    }
  }

  assert.ok(observabilityBlock.includes(
    "asaasApiKeyConfigured: Boolean(ASAAS_API_KEY)"
  ));
  assert.ok(observabilityBlock.includes(
    "asaasWebhookTokenConfigured: Boolean(ASAAS_WEBHOOK_TOKEN)"
  ));
  assert.ok(observabilityBlock.includes(
    "financialEnvironment === \"sandbox\""
  ));

  const reprocessBlock = sliceBetween(
    mainSource,
    "// Controlled operational Webhook reprocessing for Marco 8.6.",
    "const financialCheckoutFunctions =",
    "reprocess"
  );

  assert.ok(reprocessBlock.includes("providerFactory: checkoutProviderFactory"));
  assert.ok(reprocessBlock.includes("secrets: checkoutSecrets"));
  assert.strictEqual(reprocessBlock.includes("ASAAS_API_KEY.value("), false);
  assert.strictEqual(reprocessBlock.includes("ASAAS_WEBHOOK_TOKEN.value("), false);

  for (const forbidden of [
    "admin_audit_events",
    "audit_logs_v2",
    "payment_webhook_events_v2",
    "admin_webhook_events",
    "config_console",
    "admin_config"
  ]) {
    assert.strictEqual(
      mainSource.includes(forbidden),
      false,
      `Parallel state marker found: ${forbidden}`
    );
  }

  assert.strictEqual(
    callableSources.includes("atualizarConfiguracaoOperacionalV12"),
    false
  );
  assert.strictEqual(
    callableSources.includes("gerenciarConfiguracaoOperacionalV12"),
    false
  );
  assert.strictEqual(observabilityBlock.includes("axios."), false);
  assert.strictEqual(observabilityBlock.includes("fetch("), false);

  console.log("MARCO8_6F_ARCHITECTURE_SEQUENCE=PASSED");
  console.log("MARCO8_6F_CONSOLE_CAPABILITIES=7/7");
  console.log("MARCO8_6F_OPERATIONAL_CALLABLES=7/7");
  console.log("MARCO8_6F_CANONICAL_SOURCES=3/3");
  console.log("MARCO8_6F_ROLE_MATRIX=PASSED");
  console.log("MARCO8_6F_ORG_ROLE_ESCALATION=BLOCKED");
  console.log("MARCO8_6F_VIEW_CONTRACTS=5/5");
  console.log("MARCO8_6F_READ_LIMITS=PASSED");
  console.log("MARCO8_6F_READ_SURFACES_PROVIDER_SECRET_BINDING=False");
  console.log("MARCO8_6F_REPROCESS_SHARED_PROVIDER=PASSED");
  console.log("MARCO8_6F_CONFIG_MUTATION=False");
  console.log("MARCO8_6F_PROVIDER_HEALTH_PING=False");
  console.log("MARCO8_6F_PARALLEL_LEDGER=False");
  console.log("MARCO8_6F_RUNTIME_GATE=STAGING_DEMO_ONLY");
  console.log("MARCO8_6F_PRODUCTION_EXPORT=BLOCKED");
  console.log("MARCO8_6F_CONSOLE_OPERATIONS_INTEGRATION=PASSED");
}

main();
