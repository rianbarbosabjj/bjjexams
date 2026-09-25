"use strict";

const {
  GLOBAL_ROLE_CLAIMS
} = require("../auth/global-claims");

const ADMIN_CAPABILITIES = Object.freeze([
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
]);

const ROLE_CAPABILITIES = Object.freeze({
  super_admin: ADMIN_CAPABILITIES,

  platform_admin: Object.freeze([
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
    "console.splits.read",
    "console.webhooks.read",
    "console.audit.read",
    "console.security.read",
    "console.config.read",
    "console.config.manage",
    "console.health.read"
  ]),

  finance_admin: Object.freeze([
    "ops.read",
    "ops.orders.read",
    "console.read",
    "console.finance.read",
    "console.finance.manage",
    "console.splits.read",
    "console.splits.manage",
    "console.webhooks.read",
    "console.webhooks.reprocess",
    "console.audit.read",
    "console.health.read"
  ]),

  content_admin: Object.freeze([
    "ops.read",
    "ops.courses.read",
    "ops.courses.manage",
    "ops.exams.read",
    "ops.exams.manage",
    "ops.questions.read",
    "ops.questions.manage",
    "ops.certificates.read"
  ]),

  support_admin: Object.freeze([
    "ops.read",
    "ops.people.read",
    "ops.organizations.read",
    "ops.courses.read",
    "ops.exams.read",
    "ops.questions.read",
    "ops.certificates.read",
    "ops.orders.read",
    "console.audit.read",
    "console.security.read",
    "console.health.read"
  ])
});

class AdminAccessPolicyError extends Error {
  constructor(code, message) {
    super(message);

    this.name = "AdminAccessPolicyError";
    this.code = code;
  }
}

function resolveExplicitGlobalRoles(claims = {}) {
  if (
    !claims ||
    typeof claims !== "object" ||
    Array.isArray(claims)
  ) {
    return [];
  }

  return GLOBAL_ROLE_CLAIMS
    .filter(role => claims[role] === true);
}

function resolveAdminCapabilities(claims = {}) {
  const roles =
    resolveExplicitGlobalRoles(claims);

  if (roles.includes("super_admin")) {
    return [...ADMIN_CAPABILITIES];
  }

  const capabilitySet =
    new Set();

  for (const role of roles) {
    const roleCapabilities =
      ROLE_CAPABILITIES[role] || [];

    for (const capability of roleCapabilities) {
      capabilitySet.add(capability);
    }
  }

  return ADMIN_CAPABILITIES
    .filter(capability =>
      capabilitySet.has(capability)
    );
}

function resolveAdministrativeAccess(claims = {}) {
  const globalRoles =
    resolveExplicitGlobalRoles(claims);

  const capabilities =
    resolveAdminCapabilities(claims);

  if (
    globalRoles.length === 0 ||
    capabilities.length === 0
  ) {
    throw new AdminAccessPolicyError(
      "ADMIN_ROLE_REQUIRED",
      "Global administrative role required."
    );
  }

  return {
    globalRoles,
    capabilities,
    surfaceAccess: {
      operations:
        capabilities.includes("ops.read"),

      console:
        capabilities.includes("console.read")
    }
  };
}

function hasAdminCapability(
  claims = {},
  capability
) {
  if (
    !ADMIN_CAPABILITIES.includes(capability)
  ) {
    return false;
  }

  return resolveAdminCapabilities(claims)
    .includes(capability);
}

function requireAdminCapability(
  claims = {},
  capability
) {
  if (
    !ADMIN_CAPABILITIES.includes(capability)
  ) {
    throw new AdminAccessPolicyError(
      "UNKNOWN_ADMIN_CAPABILITY",
      "Unknown administrative capability."
    );
  }

  if (
    !hasAdminCapability(
      claims,
      capability
    )
  ) {
    throw new AdminAccessPolicyError(
      "ADMIN_CAPABILITY_REQUIRED",
      "Required administrative capability is missing."
    );
  }

  return true;
}

module.exports = {
  ADMIN_CAPABILITIES,
  ROLE_CAPABILITIES,
  AdminAccessPolicyError,
  resolveExplicitGlobalRoles,
  resolveAdminCapabilities,
  resolveAdministrativeAccess,
  hasAdminCapability,
  requireAdminCapability
};
