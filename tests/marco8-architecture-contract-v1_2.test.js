"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function read(p) {
  return fs.readFileSync(
    path.join(ROOT, p),
    "utf8"
  );
}

function has(text, value, label) {
  assert.ok(
    text.includes(value),
    `${label}: missing ${value}`
  );
}

const spec = read(
  "docs/architecture/MARCO_8_RBAC_CONTRACTS.md"
);

const inventory = read(
  "docs/architecture/MARCO_8_LEGACY_ADMIN_INVENTORY.md"
);

const claims = read(
  "functions/src/auth/global-claims.js"
);

const membership = read(
  "functions/src/auth/organization-membership.js"
);

const globalRoles = [
  "super_admin",
  "platform_admin",
  "finance_admin",
  "content_admin",
  "support_admin"
];

const orgRoles = [
  "owner",
  "manager",
  "instructor",
  "student"
];

const capabilities = [
  "ops.read",
  "ops.people.read",
  "ops.people.manage",
  "ops.organizations.read",
  "ops.organizations.manage",
  "ops.courses.read",
  "ops.courses.manage",
  "ops.exams.read",
  "ops.exams.manage",
  "ops.questions.read",
  "ops.questions.manage",
  "ops.certificates.read",
  "ops.certificates.manage",
  "ops.orders.read",
  "console.read",
  "console.finance.read",
  "console.finance.manage",
  "console.splits.read",
  "console.splits.manage",
  "console.webhooks.read",
  "console.webhooks.reprocess",
  "console.audit.read",
  "console.security.read",
  "console.config.read",
  "console.config.manage",
  "console.health.read"
];

const p0 = [
  "login.html",
  "painel_admin.html",
  "painel_superadmin.html"
];

for (const role of globalRoles) {
  has(claims, `'${role}'`, "canonical global role");
  has(spec, `\`${role}\``, "spec global role");
}

for (const role of orgRoles) {
  has(membership, `"${role}"`, "canonical org role");
  has(spec, `\`${role}\``, "spec org role");
}

for (const capability of capabilities) {
  has(
    spec,
    `\`${capability}\``,
    "capability"
  );
}

for (const file of p0) {
  has(
    inventory,
    `\`${file}\``,
    "inventory P0"
  );

  has(
    spec,
    `\`${file}\``,
    "spec P0"
  );
}

has(
  inventory,
  "mutation direta: **3**",
  "inventory baseline"
);

has(
  claims,
  "if (claims.super_admin === true)",
  "super admin hierarchy"
);

has(
  membership,
  'return role === "owner" || role === "manager";',
  "organization management boundary"
);

has(
  spec,
  "`obterContextoAdministrativoV12`",
  "admin bootstrap contract"
);

has(
  spec,
  "O Console nao cria ledger paralelo.",
  "financial boundary"
);

has(
  spec,
  "O Marco 7 continua autoritativo para `exam_certificates`.",
  "certificate boundary"
);

has(
  spec,
  "producao permanece bloqueada",
  "production boundary"
);

const forbidden = [
  "adminUpdateDocument",
  "adminDeleteDocument",
  "adminWriteFirestore",
  "writeAnyDocument",
  "updateAnything",
  "deleteAnything"
];

for (const command of forbidden) {
  has(
    spec,
    `\`${command}\``,
    "forbidden generic command"
  );
}

console.log("MARCO8_GLOBAL_ROLES=5/5");
console.log("MARCO8_ORG_ROLES=4/4");
console.log(
  `MARCO8_CAPABILITIES=${capabilities.length}/${capabilities.length}`
);
console.log("MARCO8_P0_BOUNDARIES=3/3");
console.log("MARCO8_ADMIN_BOOTSTRAP=DEFINED");
console.log("MARCO8_FINANCIAL_BOUNDARY=OK");
console.log("MARCO8_CERTIFICATE_BOUNDARY=OK");
console.log("MARCO8_PRODUCTION_BOUNDARY=OK");
console.log("MARCO8_ARCHITECTURE_CONTRACT=PASSED");
