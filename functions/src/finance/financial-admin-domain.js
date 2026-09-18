'use strict';

const crypto = require('crypto');

const {
  DEFAULT_PLATFORM_FEE_BPS,
  FinancialDomainError,
  normalizeFinancialRule,
  validateFinancialRule,
  normalizeRecipientShares
} = (() => {
  const finance = require('./financial-domain');

  // normalizeRecipientShares não é exportado pelo domínio 5.1.
  // O 5.2 usa validateFinancialRule como fonte final de invariantes.
  return {
    ...finance,
    normalizeRecipientShares: value =>
      Array.isArray(value)
        ? value.map(item => ({
            recipientType: String(item?.recipientType || '').trim().toLowerCase() || null,
            recipientId:
              item?.recipientId === undefined || item?.recipientId === null
                ? null
                : String(item.recipientId).trim() || null,
            shareBps: Number(item?.shareBps)
          }))
        : []
  };
})();

const FINANCIAL_RECIPIENT_ACCOUNT_STATUSES =
  Object.freeze(['ready', 'blocked']);
const FINANCIAL_PROVIDER_ENVIRONMENTS =
  Object.freeze(['sandbox', 'production']);
const FINANCIAL_PROVIDERS =
  Object.freeze(['asaas']);

class FinancialAdminDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialAdminDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function token(value, max = 80) {
  const normalized = text(value, max);
  return normalized ? normalized.toLowerCase() : null;
}

function safeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : Number.NaN;
}

function requireIdentifier(value, field) {
  const normalized = text(value, 200);
  if (!normalized || normalized.includes('/')) {
    throw new FinancialAdminDomainError(
      'INVALID_FINANCIAL_ADMIN_ID',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new FinancialAdminDomainError(
      'INVALID_FINANCIAL_ADMIN_ENUM',
      `${field} inválido.`
    );
  }
  return value;
}

function canAdministerFinancialRules(claims = {}) {
  return (
    claims.super_admin === true ||
    claims.platform_admin === true
  );
}

function financialAdminRole(claims = {}) {
  if (claims.super_admin === true) return 'super_admin';
  if (claims.platform_admin === true) return 'platform_admin';
  return null;
}

function assertCanAdministerFinancialRules(claims = {}) {
  const role = financialAdminRole(claims);
  if (!role) {
    throw new FinancialAdminDomainError(
      'FINANCIAL_ADMIN_PERMISSION_REQUIRED',
      'Administração financeira exige super_admin ou platform_admin.'
    );
  }
  return role;
}

function deterministicId(namespace, parts = []) {
  return crypto
    .createHash('sha256')
    .update(
      [namespace, ...parts.map(part => String(part))]
        .join(':')
    )
    .digest('hex');
}

function financialRecipientAccountId({
  provider = 'asaas',
  environment,
  recipientType,
  recipientId
} = {}) {
  const canonicalProvider = token(provider, 40);
  const canonicalEnvironment = token(environment, 40);
  const canonicalType = token(recipientType, 40);
  const canonicalId = requireIdentifier(recipientId, 'recipientId');

  requireEnum(canonicalProvider, FINANCIAL_PROVIDERS, 'provider');
  requireEnum(
    canonicalEnvironment,
    FINANCIAL_PROVIDER_ENVIRONMENTS,
    'environment'
  );
  requireEnum(canonicalType, ['user', 'organization'], 'recipientType');

  return deterministicId(
    'financial-recipient-account-v1',
    [
      canonicalProvider,
      canonicalEnvironment,
      canonicalType,
      canonicalId
    ]
  );
}

function productFinancialRuleId({
  productType,
  productId
} = {}) {
  const canonicalType = token(productType, 40);
  const canonicalId = requireIdentifier(productId, 'productId');

  requireEnum(
    canonicalType,
    ['course', 'belt_exam'],
    'productType'
  );

  return deterministicId(
    'financial-product-rule-v1',
    [canonicalType, canonicalId]
  );
}

function normalizeRecipientAccount(input = {}) {
  return {
    recipientType: token(input.recipientType, 40),
    recipientId: text(input.recipientId, 200),
    provider: token(input.provider, 40),
    environment: token(input.environment, 40),
    walletId: text(input.walletId, 180),
    status: token(input.status, 40),
    version: safeInteger(input.version),
    createdBy: text(input.createdBy, 200),
    updatedBy: text(input.updatedBy, 200),
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null
  };
}

function validateRecipientAccount(input = {}) {
  const account = normalizeRecipientAccount(input);

  requireEnum(
    account.recipientType,
    ['user', 'organization'],
    'recipientType'
  );
  requireIdentifier(account.recipientId, 'recipientId');
  requireEnum(account.provider, FINANCIAL_PROVIDERS, 'provider');
  requireEnum(
    account.environment,
    FINANCIAL_PROVIDER_ENVIRONMENTS,
    'environment'
  );
  requireEnum(
    account.status,
    FINANCIAL_RECIPIENT_ACCOUNT_STATUSES,
    'status'
  );

  if (!Number.isSafeInteger(account.version) || account.version < 1) {
    throw new FinancialAdminDomainError(
      'INVALID_RECIPIENT_ACCOUNT_VERSION',
      'Conta de recebedor exige version inteira positiva.'
    );
  }

  if (account.status === 'ready' && !account.walletId) {
    throw new FinancialAdminDomainError(
      'RECIPIENT_WALLET_REQUIRED',
      'Conta ready exige walletId.'
    );
  }

  if (
    !account.createdBy ||
    !account.updatedBy ||
    !account.createdAt ||
    !account.updatedAt
  ) {
    throw new FinancialAdminDomainError(
      'RECIPIENT_ACCOUNT_AUDIT_REQUIRED',
      'Conta de recebedor exige metadados de auditoria.'
    );
  }

  return account;
}

function recipientKey(recipientType, recipientId) {
  return `${recipientType}:${recipientId || ''}`;
}

function recipientReadiness({
  recipientType,
  recipientId = null,
  account = null,
  provider = 'asaas',
  environment
} = {}) {
  const type = token(recipientType, 40);

  if (type === 'platform') {
    return {
      ready: true,
      reason: 'PLATFORM_PRIMARY_ACCOUNT'
    };
  }

  if (!['user', 'organization'].includes(type)) {
    return {
      ready: false,
      reason: 'INVALID_RECIPIENT_TYPE'
    };
  }

  if (!account) {
    return {
      ready: false,
      reason: 'RECIPIENT_ACCOUNT_REQUIRED'
    };
  }

  let normalized;
  try {
    normalized = validateRecipientAccount(account);
  } catch (_error) {
    return {
      ready: false,
      reason: 'INVALID_RECIPIENT_ACCOUNT'
    };
  }

  const expectedProvider = token(provider, 40);
  const expectedEnvironment = token(environment, 40);
  const expectedId = text(recipientId, 200);

  if (
    normalized.recipientType !== type ||
    normalized.recipientId !== expectedId
  ) {
    return {
      ready: false,
      reason: 'RECIPIENT_ACCOUNT_IDENTITY_MISMATCH'
    };
  }

  if (
    normalized.provider !== expectedProvider ||
    normalized.environment !== expectedEnvironment
  ) {
    return {
      ready: false,
      reason: 'RECIPIENT_ACCOUNT_ENVIRONMENT_MISMATCH'
    };
  }

  if (normalized.status !== 'ready') {
    return {
      ready: false,
      reason: 'RECIPIENT_ACCOUNT_BLOCKED'
    };
  }

  if (!normalized.walletId) {
    return {
      ready: false,
      reason: 'RECIPIENT_WALLET_REQUIRED'
    };
  }

  return {
    ready: true,
    reason: 'READY'
  };
}

function assertExplicitRecipientsReady({
  recipientShares = [],
  accountsByRecipientKey = {},
  provider = 'asaas',
  environment
} = {}) {
  for (const share of normalizeRecipientShares(recipientShares)) {
    if (share.recipientType === 'platform') continue;

    const key = recipientKey(
      share.recipientType,
      share.recipientId
    );

    const readiness = recipientReadiness({
      recipientType: share.recipientType,
      recipientId: share.recipientId,
      account: accountsByRecipientKey[key] || null,
      provider,
      environment
    });

    if (!readiness.ready) {
      throw new FinancialAdminDomainError(
        'FINANCIAL_RECIPIENT_NOT_READY',
        `Recebedor ${key} não está pronto: ${readiness.reason}.`
      );
    }
  }

  return true;
}

function buildDefaultRuleMutation({
  existingRule = null,
  platformFeeBps = DEFAULT_PLATFORM_FEE_BPS,
  actorId,
  timestamp
} = {}) {
  const actor = requireIdentifier(actorId, 'actorId');

  if (!timestamp) {
    throw new FinancialAdminDomainError(
      'FINANCIAL_ADMIN_TIMESTAMP_REQUIRED',
      'Mutação financeira exige timestamp.'
    );
  }

  const bps = safeInteger(platformFeeBps);
  if (!Number.isSafeInteger(bps)) {
    throw new FinancialAdminDomainError(
      'INVALID_PLATFORM_FEE_BPS',
      'platformFeeBps precisa ser inteiro.'
    );
  }

  if (!existingRule) {
    const created = validateFinancialRule({
      id: 'platform-default',
      name: 'Regra padrão da plataforma',
      status: 'active',
      scope: 'platform_default',
      productType: null,
      productId: null,
      platformFeeBps: bps,
      recipientMode: 'product_owner',
      recipientShares: [],
      version: 1,
      createdBy: actor,
      updatedBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return {
      changed: true,
      created: true,
      rule: created
    };
  }

  const existing = validateFinancialRule({
    ...existingRule,
    id: 'platform-default'
  });

  if (
    existing.scope !== 'platform_default' ||
    existing.recipientMode !== 'product_owner'
  ) {
    throw new FinancialAdminDomainError(
      'INVALID_DEFAULT_RULE_SHAPE',
      'Regra padrão persistida possui formato incompatível.'
    );
  }

  if (
    existing.platformFeeBps === bps &&
    existing.status === 'active'
  ) {
    return {
      changed: false,
      created: false,
      rule: existing
    };
  }

  const updated = validateFinancialRule({
    ...existing,
    id: 'platform-default',
    status: 'active',
    platformFeeBps: bps,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: existing.version + 1,
    createdBy: existing.createdBy,
    createdAt: existing.createdAt,
    updatedBy: actor,
    updatedAt: timestamp
  });

  return {
    changed: true,
    created: false,
    rule: updated
  };
}

function buildRecipientAccountMutation({
  existingAccount = null,
  input = {},
  actorId,
  timestamp,
  provider = 'asaas',
  environment
} = {}) {
  const actor = requireIdentifier(actorId, 'actorId');

  if (!timestamp) {
    throw new FinancialAdminDomainError(
      'FINANCIAL_ADMIN_TIMESTAMP_REQUIRED',
      'Mutação financeira exige timestamp.'
    );
  }

  const recipientType = token(input.recipientType, 40);
  const recipientId = requireIdentifier(
    input.recipientId,
    'recipientId'
  );
  const status = token(input.status, 40);
  const walletId = text(input.walletId, 180);
  const canonicalProvider = token(provider, 40);
  const canonicalEnvironment = token(environment, 40);

  requireEnum(
    recipientType,
    ['user', 'organization'],
    'recipientType'
  );
  requireEnum(status, FINANCIAL_RECIPIENT_ACCOUNT_STATUSES, 'status');
  requireEnum(canonicalProvider, FINANCIAL_PROVIDERS, 'provider');
  requireEnum(
    canonicalEnvironment,
    FINANCIAL_PROVIDER_ENVIRONMENTS,
    'environment'
  );

  if (status === 'ready' && !walletId) {
    throw new FinancialAdminDomainError(
      'RECIPIENT_WALLET_REQUIRED',
      'Conta ready exige walletId.'
    );
  }

  if (!existingAccount) {
    const created = validateRecipientAccount({
      recipientType,
      recipientId,
      provider: canonicalProvider,
      environment: canonicalEnvironment,
      walletId,
      status,
      version: 1,
      createdBy: actor,
      updatedBy: actor,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return {
      changed: true,
      created: true,
      account: created
    };
  }

  const existing = validateRecipientAccount(existingAccount);

  if (
    existing.recipientType !== recipientType ||
    existing.recipientId !== recipientId ||
    existing.provider !== canonicalProvider ||
    existing.environment !== canonicalEnvironment
  ) {
    throw new FinancialAdminDomainError(
      'RECIPIENT_ACCOUNT_IDENTITY_IMMUTABLE',
      'Identidade da conta de recebedor é imutável.'
    );
  }

  if (
    existing.walletId === walletId &&
    existing.status === status
  ) {
    return {
      changed: false,
      created: false,
      account: existing
    };
  }

  const updated = validateRecipientAccount({
    ...existing,
    walletId,
    status,
    version: existing.version + 1,
    createdBy: existing.createdBy,
    createdAt: existing.createdAt,
    updatedBy: actor,
    updatedAt: timestamp
  });

  return {
    changed: true,
    created: false,
    account: updated
  };
}

function assertPaidConfigurableCourse(course = {}) {
  if (!course || typeof course !== 'object') {
    throw new FinancialAdminDomainError(
      'COURSE_REQUIRED',
      'Curso é obrigatório.'
    );
  }

  if (course.status === 'archived') {
    throw new FinancialAdminDomainError(
      'ARCHIVED_COURSE_FINANCE_LOCKED',
      'Curso arquivado não aceita nova configuração financeira.'
    );
  }

  if (
    course.isPaid !== true ||
    !Number.isSafeInteger(Number(course.priceCents)) ||
    Number(course.priceCents) <= 0
  ) {
    throw new FinancialAdminDomainError(
      'PAID_COURSE_REQUIRED',
      'Override financeiro exige curso pago com preço válido.'
    );
  }

  return true;
}

function ruleComparable(rule) {
  const normalized = normalizeFinancialRule(rule);

  return JSON.stringify({
    status: normalized.status,
    scope: normalized.scope,
    productType: normalized.productType,
    productId: normalized.productId,
    platformFeeBps: normalized.platformFeeBps,
    recipientMode: normalized.recipientMode,
    recipientShares: normalizeRecipientShares(
      normalized.recipientShares
    )
      .slice()
      .sort((a, b) =>
        recipientKey(a.recipientType, a.recipientId)
          .localeCompare(
            recipientKey(b.recipientType, b.recipientId)
          )
      )
  });
}

function buildCourseRuleMutation({
  courseId,
  course = {},
  existingRule = null,
  input = {},
  actorId,
  timestamp,
  accountsByRecipientKey = {},
  provider = 'asaas',
  environment
} = {}) {
  const canonicalCourseId = requireIdentifier(
    courseId,
    'courseId'
  );
  const actor = requireIdentifier(actorId, 'actorId');

  if (!timestamp) {
    throw new FinancialAdminDomainError(
      'FINANCIAL_ADMIN_TIMESTAMP_REQUIRED',
      'Mutação financeira exige timestamp.'
    );
  }

  assertPaidConfigurableCourse(course);

  const ruleId = productFinancialRuleId({
    productType: 'course',
    productId: canonicalCourseId
  });

  const status = token(input.status, 40);
  requireEnum(status, ['active', 'inactive'], 'status');

  const platformFeeBps = safeInteger(input.platformFeeBps);
  if (!Number.isSafeInteger(platformFeeBps)) {
    throw new FinancialAdminDomainError(
      'INVALID_PLATFORM_FEE_BPS',
      'platformFeeBps precisa ser inteiro.'
    );
  }

  const recipientMode = token(input.recipientMode, 40);
  const recipientShares =
    recipientMode === 'explicit'
      ? normalizeRecipientShares(input.recipientShares)
      : [];

  const candidateBase = {
    id: ruleId,
    name: `Override financeiro do curso ${canonicalCourseId}`,
    status,
    scope: 'product_override',
    productType: 'course',
    productId: canonicalCourseId,
    platformFeeBps,
    recipientMode,
    recipientShares
  };

  // validateFinancialRule fecha bps, recipient mode, soma e duplicidade.
  validateFinancialRule({
    ...candidateBase,
    version: existingRule ? existingRule.version : 1,
    createdBy: actor,
    updatedBy: actor,
    createdAt: timestamp,
    updatedAt: timestamp
  });

  if (
    status === 'active' &&
    recipientMode === 'explicit'
  ) {
    assertExplicitRecipientsReady({
      recipientShares,
      accountsByRecipientKey,
      provider,
      environment
    });
  }

  let version = 1;
  let createdBy = actor;
  let createdAt = timestamp;
  let changed = true;
  let created = true;

  if (existingRule) {
    const existing = validateFinancialRule({
      ...existingRule,
      id: ruleId
    });

    if (
      existing.scope !== 'product_override' ||
      existing.productType !== 'course' ||
      existing.productId !== canonicalCourseId
    ) {
      throw new FinancialAdminDomainError(
        'INVALID_EXISTING_PRODUCT_RULE',
        'Regra persistida não corresponde ao curso.'
      );
    }

    created = false;
    createdBy = existing.createdBy;
    createdAt = existing.createdAt;
    changed =
      ruleComparable(existing) !==
      ruleComparable({
        ...candidateBase,
        version: existing.version
      });

    if (!changed) {
      return {
        changed: false,
        created: false,
        rule: existing,
        courseFinancialRuleId:
          existing.status === 'active'
            ? ruleId
            : null
      };
    }

    version = existing.version + 1;
  }

  const rule = validateFinancialRule({
    ...candidateBase,
    version,
    createdBy,
    updatedBy: actor,
    createdAt,
    updatedAt: timestamp
  });

  return {
    changed: true,
    created,
    rule,
    courseFinancialRuleId:
      rule.status === 'active'
        ? ruleId
        : null
  };
}

function maskWalletId(value) {
  const wallet = text(value, 180);
  if (!wallet) return null;
  const suffix = wallet.slice(-4);
  return `••••${suffix}`;
}

function recipientAccountView(input = {}) {
  const account = validateRecipientAccount(input);
  return {
    recipientType: account.recipientType,
    recipientId: account.recipientId,
    provider: account.provider,
    environment: account.environment,
    status: account.status,
    version: account.version,
    walletConfigured: Boolean(account.walletId),
    walletMasked: maskWalletId(account.walletId),
    updatedAt: account.updatedAt
  };
}

function financialRuleView(input = {}) {
  const rule = validateFinancialRule(input);
  return {
    id: rule.id,
    status: rule.status,
    scope: rule.scope,
    productType: rule.productType,
    productId: rule.productId,
    platformFeeBps: rule.platformFeeBps,
    recipientMode: rule.recipientMode,
    recipientShares: rule.recipientShares.map(item => ({
      ...item
    })),
    version: rule.version,
    updatedAt: rule.updatedAt
  };
}

module.exports = {
  FINANCIAL_RECIPIENT_ACCOUNT_STATUSES,
  FINANCIAL_PROVIDER_ENVIRONMENTS,
  FINANCIAL_PROVIDERS,
  FinancialAdminDomainError,
  canAdministerFinancialRules,
  financialAdminRole,
  assertCanAdministerFinancialRules,
  financialRecipientAccountId,
  productFinancialRuleId,
  normalizeRecipientAccount,
  validateRecipientAccount,
  recipientReadiness,
  assertExplicitRecipientsReady,
  buildDefaultRuleMutation,
  buildRecipientAccountMutation,
  assertPaidConfigurableCourse,
  buildCourseRuleMutation,
  maskWalletId,
  recipientAccountView,
  financialRuleView
};
