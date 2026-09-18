'use strict';

const assert = require('node:assert/strict');

const {
  DEFAULT_PLATFORM_FEE_BPS
} = require('../src/finance/financial-domain');

const {
  FinancialAdminDomainError,
  canAdministerFinancialRules,
  financialAdminRole,
  assertCanAdministerFinancialRules,
  financialRecipientAccountId,
  productFinancialRuleId,
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
} = require('../src/finance/financial-admin-domain');

let passed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    throw error;
  }
}

const now1 = '2026-09-17T22:00:00.000Z';
const now2 = '2026-09-17T22:05:00.000Z';

function account(overrides = {}) {
  return {
    recipientType: 'user',
    recipientId: 'user-1',
    provider: 'asaas',
    environment: 'sandbox',
    walletId: 'wallet-sandbox-1234',
    status: 'ready',
    version: 1,
    createdBy: 'admin-1',
    updatedBy: 'admin-1',
    createdAt: now1,
    updatedAt: now1,
    ...overrides
  };
}

function course(overrides = {}) {
  return {
    status: 'published',
    isPaid: true,
    priceCents: 10000,
    ownerType: 'user',
    ownerId: 'owner-1',
    ...overrides
  };
}

function defaultRule(overrides = {}) {
  return {
    id: 'platform-default',
    name: 'Regra padrão da plataforma',
    status: 'active',
    scope: 'platform_default',
    productType: null,
    productId: null,
    platformFeeBps: 1000,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 1,
    createdBy: 'admin-1',
    updatedBy: 'admin-1',
    createdAt: now1,
    updatedAt: now1,
    ...overrides
  };
}

test('super_admin administra financeiro', () => {
  assert.equal(
    canAdministerFinancialRules({ super_admin: true }),
    true
  );
  assert.equal(
    financialAdminRole({ super_admin: true }),
    'super_admin'
  );
});

test('platform_admin administra financeiro', () => {
  assert.equal(
    canAdministerFinancialRules({ platform_admin: true }),
    true
  );
});

test('finance_admin isolado ainda nao administra financeiro', () => {
  assert.equal(
    canAdministerFinancialRules({ finance_admin: true }),
    false
  );

  assert.throws(
    () => assertCanAdministerFinancialRules({
      finance_admin: true
    }),
    error =>
      error instanceof FinancialAdminDomainError &&
      error.code === 'FINANCIAL_ADMIN_PERMISSION_REQUIRED'
  );
});

test('content_admin e usuario comum nao administram financeiro', () => {
  assert.equal(
    canAdministerFinancialRules({ content_admin: true }),
    false
  );
  assert.equal(
    canAdministerFinancialRules({}),
    false
  );
});

test('ids de conta e regra sao deterministas e environment scoped', () => {
  const sandbox = financialRecipientAccountId({
    environment: 'sandbox',
    recipientType: 'user',
    recipientId: 'user-1'
  });

  const sandboxAgain = financialRecipientAccountId({
    environment: 'sandbox',
    recipientType: 'user',
    recipientId: 'user-1'
  });

  const production = financialRecipientAccountId({
    environment: 'production',
    recipientType: 'user',
    recipientId: 'user-1'
  });

  assert.equal(sandbox, sandboxAgain);
  assert.notEqual(sandbox, production);

  assert.equal(
    productFinancialRuleId({
      productType: 'course',
      productId: 'course-1'
    }),
    productFinancialRuleId({
      productType: 'course',
      productId: 'course-1'
    })
  );
});

test('conta ready exige wallet', () => {
  assert.throws(
    () => validateRecipientAccount(
      account({ walletId: null })
    ),
    error =>
      error instanceof FinancialAdminDomainError &&
      error.code === 'RECIPIENT_WALLET_REQUIRED'
  );
});

test('platform esta ready sem conta de recebedor', () => {
  assert.deepEqual(
    recipientReadiness({
      recipientType: 'platform',
      environment: 'sandbox'
    }),
    {
      ready: true,
      reason: 'PLATFORM_PRIMARY_ACCOUNT'
    }
  );
});

test('conta blocked nao satisfaz readiness', () => {
  assert.deepEqual(
    recipientReadiness({
      recipientType: 'user',
      recipientId: 'user-1',
      environment: 'sandbox',
      account: account({ status: 'blocked' })
    }),
    {
      ready: false,
      reason: 'RECIPIENT_ACCOUNT_BLOCKED'
    }
  );
});

test('conta de outro ambiente nao satisfaz readiness', () => {
  assert.deepEqual(
    recipientReadiness({
      recipientType: 'user',
      recipientId: 'user-1',
      environment: 'production',
      account: account()
    }),
    {
      ready: false,
      reason: 'RECIPIENT_ACCOUNT_ENVIRONMENT_MISMATCH'
    }
  );
});

test('explicit exige todos os recebedores externos ready', () => {
  const shares = [
    {
      recipientType: 'platform',
      recipientId: null,
      shareBps: 2000
    },
    {
      recipientType: 'user',
      recipientId: 'user-1',
      shareBps: 8000
    }
  ];

  assert.equal(
    assertExplicitRecipientsReady({
      recipientShares: shares,
      accountsByRecipientKey: {
        'user:user-1': account()
      },
      environment: 'sandbox'
    }),
    true
  );

  assert.throws(
    () => assertExplicitRecipientsReady({
      recipientShares: shares,
      accountsByRecipientKey: {},
      environment: 'sandbox'
    }),
    error =>
      error instanceof FinancialAdminDomainError &&
      error.code === 'FINANCIAL_RECIPIENT_NOT_READY'
  );
});

test('default nasce com 10 por cento quando inicializado sem bps', () => {
  const result = buildDefaultRuleMutation({
    actorId: 'admin-1',
    timestamp: now1
  });

  assert.equal(result.created, true);
  assert.equal(result.changed, true);
  assert.equal(
    result.rule.platformFeeBps,
    DEFAULT_PLATFORM_FEE_BPS
  );
  assert.equal(result.rule.version, 1);
});

test('default identico e idempotente', () => {
  const result = buildDefaultRuleMutation({
    existingRule: defaultRule(),
    platformFeeBps: 1000,
    actorId: 'admin-2',
    timestamp: now2
  });

  assert.equal(result.changed, false);
  assert.equal(result.rule.version, 1);
  assert.equal(result.rule.updatedBy, 'admin-1');
});

test('default alterado incrementa version', () => {
  const result = buildDefaultRuleMutation({
    existingRule: defaultRule(),
    platformFeeBps: 1250,
    actorId: 'admin-2',
    timestamp: now2
  });

  assert.equal(result.changed, true);
  assert.equal(result.rule.version, 2);
  assert.equal(result.rule.platformFeeBps, 1250);
  assert.equal(result.rule.updatedBy, 'admin-2');
  assert.equal(result.rule.createdBy, 'admin-1');
});

test('nova conta de recebedor inicia em version 1', () => {
  const result = buildRecipientAccountMutation({
    input: {
      recipientType: 'user',
      recipientId: 'user-1',
      walletId: 'wallet-xyz-9999',
      status: 'ready'
    },
    actorId: 'admin-1',
    timestamp: now1,
    environment: 'sandbox'
  });

  assert.equal(result.created, true);
  assert.equal(result.account.version, 1);
  assert.equal(result.account.provider, 'asaas');
  assert.equal(result.account.environment, 'sandbox');
});

test('conta identica nao incrementa version', () => {
  const result = buildRecipientAccountMutation({
    existingAccount: account(),
    input: {
      recipientType: 'user',
      recipientId: 'user-1',
      walletId: 'wallet-sandbox-1234',
      status: 'ready'
    },
    actorId: 'admin-2',
    timestamp: now2,
    environment: 'sandbox'
  });

  assert.equal(result.changed, false);
  assert.equal(result.account.version, 1);
});

test('mudanca de wallet incrementa version', () => {
  const result = buildRecipientAccountMutation({
    existingAccount: account(),
    input: {
      recipientType: 'user',
      recipientId: 'user-1',
      walletId: 'wallet-new-8888',
      status: 'ready'
    },
    actorId: 'admin-2',
    timestamp: now2,
    environment: 'sandbox'
  });

  assert.equal(result.changed, true);
  assert.equal(result.account.version, 2);
  assert.equal(result.account.updatedBy, 'admin-2');
});

test('identidade da conta e imutavel', () => {
  assert.throws(
    () => buildRecipientAccountMutation({
      existingAccount: account(),
      input: {
        recipientType: 'user',
        recipientId: 'user-2',
        walletId: 'wallet-new-8888',
        status: 'ready'
      },
      actorId: 'admin-2',
      timestamp: now2,
      environment: 'sandbox'
    }),
    error =>
      error instanceof FinancialAdminDomainError &&
      error.code === 'RECIPIENT_ACCOUNT_IDENTITY_IMMUTABLE'
  );
});

test('override exige curso pago e rejeita arquivado', () => {
  assert.throws(
    () => assertPaidConfigurableCourse(
      course({ isPaid: false, priceCents: 0 })
    ),
    error =>
      error instanceof FinancialAdminDomainError &&
      error.code === 'PAID_COURSE_REQUIRED'
  );

  assert.throws(
    () => assertPaidConfigurableCourse(
      course({ status: 'archived' })
    ),
    error =>
      error instanceof FinancialAdminDomainError &&
      error.code === 'ARCHIVED_COURSE_FINANCE_LOCKED'
  );
});

test('override product_owner ativo liga financialRuleId', () => {
  const result = buildCourseRuleMutation({
    courseId: 'course-1',
    course: course(),
    input: {
      status: 'active',
      platformFeeBps: 1200,
      recipientMode: 'product_owner',
      recipientShares: []
    },
    actorId: 'admin-1',
    timestamp: now1,
    environment: 'sandbox'
  });

  assert.equal(result.created, true);
  assert.equal(result.rule.version, 1);
  assert.equal(result.rule.status, 'active');
  assert.equal(
    result.courseFinancialRuleId,
    result.rule.id
  );
});

test('override explicit ativo exige readiness', () => {
  const input = {
    status: 'active',
    platformFeeBps: 1000,
    recipientMode: 'explicit',
    recipientShares: [
      {
        recipientType: 'user',
        recipientId: 'user-1',
        shareBps: 10000
      }
    ]
  };

  assert.throws(
    () => buildCourseRuleMutation({
      courseId: 'course-1',
      course: course(),
      input,
      actorId: 'admin-1',
      timestamp: now1,
      accountsByRecipientKey: {},
      environment: 'sandbox'
    }),
    error =>
      error instanceof FinancialAdminDomainError &&
      error.code === 'FINANCIAL_RECIPIENT_NOT_READY'
  );

  const result = buildCourseRuleMutation({
    courseId: 'course-1',
    course: course(),
    input,
    actorId: 'admin-1',
    timestamp: now1,
    accountsByRecipientKey: {
      'user:user-1': account()
    },
    environment: 'sandbox'
  });

  assert.equal(result.rule.recipientMode, 'explicit');
});

test('override identico e idempotente', () => {
  const first = buildCourseRuleMutation({
    courseId: 'course-1',
    course: course(),
    input: {
      status: 'active',
      platformFeeBps: 1200,
      recipientMode: 'product_owner',
      recipientShares: []
    },
    actorId: 'admin-1',
    timestamp: now1,
    environment: 'sandbox'
  });

  const second = buildCourseRuleMutation({
    courseId: 'course-1',
    course: course(),
    existingRule: first.rule,
    input: {
      status: 'active',
      platformFeeBps: 1200,
      recipientMode: 'product_owner',
      recipientShares: []
    },
    actorId: 'admin-2',
    timestamp: now2,
    environment: 'sandbox'
  });

  assert.equal(second.changed, false);
  assert.equal(second.rule.version, 1);
});

test('mudanca de override incrementa version', () => {
  const first = buildCourseRuleMutation({
    courseId: 'course-1',
    course: course(),
    input: {
      status: 'active',
      platformFeeBps: 1200,
      recipientMode: 'product_owner',
      recipientShares: []
    },
    actorId: 'admin-1',
    timestamp: now1,
    environment: 'sandbox'
  });

  const second = buildCourseRuleMutation({
    courseId: 'course-1',
    course: course(),
    existingRule: first.rule,
    input: {
      status: 'active',
      platformFeeBps: 1300,
      recipientMode: 'product_owner',
      recipientShares: []
    },
    actorId: 'admin-2',
    timestamp: now2,
    environment: 'sandbox'
  });

  assert.equal(second.changed, true);
  assert.equal(second.rule.version, 2);
});

test('inativacao limpa financialRuleId futuro', () => {
  const first = buildCourseRuleMutation({
    courseId: 'course-1',
    course: course(),
    input: {
      status: 'active',
      platformFeeBps: 1200,
      recipientMode: 'product_owner',
      recipientShares: []
    },
    actorId: 'admin-1',
    timestamp: now1,
    environment: 'sandbox'
  });

  const inactive = buildCourseRuleMutation({
    courseId: 'course-1',
    course: course(),
    existingRule: first.rule,
    input: {
      status: 'inactive',
      platformFeeBps: 1200,
      recipientMode: 'product_owner',
      recipientShares: []
    },
    actorId: 'admin-2',
    timestamp: now2,
    environment: 'sandbox'
  });

  assert.equal(inactive.rule.status, 'inactive');
  assert.equal(inactive.courseFinancialRuleId, null);
  assert.equal(inactive.rule.version, 2);
});

test('views sanitizadas mascaram wallet e preservam regra util', () => {
  const accountView = recipientAccountView(account());

  assert.equal(accountView.walletConfigured, true);
  assert.equal(accountView.walletMasked, '••••1234');
  assert.equal(accountView.walletId, undefined);

  const ruleView = financialRuleView(defaultRule());
  assert.equal(ruleView.platformFeeBps, 1000);
  assert.equal(ruleView.createdBy, undefined);
});

test('mask nao expoe wallet completa', () => {
  assert.equal(
    maskWalletId('abc123456'),
    '••••3456'
  );
});

console.log(
  `FINANCIAL_ADMIN_DOMAIN_V1_2=${passed}/25`
);

if (passed !== 25) {
  process.exit(1);
}
