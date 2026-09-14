'use strict';

const GLOBAL_ROLE_CLAIMS = Object.freeze([
  'super_admin',
  'platform_admin',
  'finance_admin',
  'content_admin',
  'support_admin'
]);

// Somente estas claims possuem hoje uma fonte autoritativa
// definida no legado que pode ser sincronizada automaticamente.
const SYNCHRONIZED_GLOBAL_CLAIMS = Object.freeze([
  'super_admin',
  'platform_admin'
]);

function normalizeUserType(value) {
  return String(value || '').trim().toLowerCase();
}

function deriveGlobalClaims({
  hasSuperAdminMarker = false,
  hasAdminMarker = false,
  userType = null
} = {}) {
  if (hasSuperAdminMarker === true) {
    return {
      super_admin: true
    };
  }

  if (
    hasAdminMarker === true ||
    ['admin', 'administrador'].includes(normalizeUserType(userType))
  ) {
    return {
      platform_admin: true
    };
  }

  return {};
}

function mergeSynchronizedGlobalClaims(
  existingClaims = {},
  desiredClaims = {}
) {
  const result = { ...existingClaims };

  // Remove apenas as claims cuja fonte autoritativa
  // este sincronizador realmente conhece.
  for (const key of SYNCHRONIZED_GLOBAL_CLAIMS) {
    delete result[key];
  }

  for (const [key, value] of Object.entries(desiredClaims)) {
    if (!SYNCHRONIZED_GLOBAL_CLAIMS.includes(key)) {
      throw new Error(
        `Unsupported synchronized global claim: ${key}`
      );
    }

    if (value === true) {
      result[key] = true;
    }
  }

  return result;
}

function hasGlobalRole(claims = {}, role) {
  if (!GLOBAL_ROLE_CLAIMS.includes(role)) {
    return false;
  }

  if (claims.super_admin === true) {
    return true;
  }

  return claims[role] === true;
}

module.exports = {
  GLOBAL_ROLE_CLAIMS,
  SYNCHRONIZED_GLOBAL_CLAIMS,
  deriveGlobalClaims,
  mergeSynchronizedGlobalClaims,
  hasGlobalRole
};