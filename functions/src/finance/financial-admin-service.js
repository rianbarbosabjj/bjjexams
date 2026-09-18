'use strict';

const {
  DEFAULT_PLATFORM_FEE_BPS
} = require('./financial-domain');

const {
  FinancialAdminDomainError,
  assertCanAdministerFinancialRules,
  financialRecipientAccountId,
  productFinancialRuleId,
  buildDefaultRuleMutation,
  buildRecipientAccountMutation,
  buildCourseRuleMutation,
  recipientAccountView,
  financialRuleView,
  recipientReadiness
} = require('./financial-admin-domain');

class FinancialAdminServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialAdminServiceError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function requireIdentifier(value, field) {
  const normalized = text(value, 200);

  if (!normalized || normalized.includes('/')) {
    throw new FinancialAdminServiceError(
      'INVALID_FINANCIAL_ADMIN_ID',
      `${field} inválido.`
    );
  }

  return normalized;
}

function assertAllowedFields(input, allowedFields, operation) {
  const allowed = new Set(allowedFields);
  const forbidden = Object.keys(input || {})
    .filter(key => !allowed.has(key));

  if (forbidden.length) {
    throw new FinancialAdminServiceError(
      'FINANCIAL_ADMIN_FIELDS_NOT_ALLOWED',
      `${operation} contém campos não permitidos: ${forbidden.join(', ')}.`
    );
  }
}

function storedRule(snapshot, expectedId) {
  if (!snapshot?.exists) return null;

  return {
    ...(snapshot.data() || {}),
    id: snapshot.id || expectedId
  };
}

function createFinancialAdminService(dependencies = {}) {
  const {
    db,
    environment,
    provider = 'asaas',
    clock = () => new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError(
      'Financial admin service exige Firestore válido.'
    );
  }

  const canonicalEnvironment =
    String(environment || '').trim().toLowerCase();

  if (!['sandbox', 'production'].includes(canonicalEnvironment)) {
    throw new TypeError(
      'Financial admin service exige environment sandbox ou production.'
    );
  }

  const canonicalProvider =
    String(provider || '').trim().toLowerCase();

  if (canonicalProvider !== 'asaas') {
    throw new TypeError(
      'Financial admin service suporta somente provider asaas no contrato atual.'
    );
  }

  function actorContext({ actorId, claims = {} } = {}) {
    const uid = requireIdentifier(actorId, 'actorId');

    let role;
    try {
      role = assertCanAdministerFinancialRules(claims);
    } catch (error) {
      if (error instanceof FinancialAdminDomainError) {
        throw new FinancialAdminServiceError(
          error.code,
          error.message
        );
      }
      throw error;
    }

    return { uid, role };
  }

  function timestamp() {
    const value = clock();

    if (!value) {
      throw new FinancialAdminServiceError(
        'FINANCIAL_ADMIN_TIMESTAMP_REQUIRED',
        'Relógio server-side não retornou timestamp válido.'
      );
    }

    return value;
  }

  function auditPayload({
    actor,
    action,
    entityType,
    entityId,
    before = null,
    after = null,
    createdAt
  }) {
    return {
      actorId: actor.uid,
      actorRole: actor.role,
      action,
      entityType,
      entityId,
      before,
      after,
      source: 'service',
      requestId: null,
      createdAt
    };
  }

  function recipientIdentityRef(recipientType, recipientId) {
    if (recipientType === 'user') {
      return db.doc(`usuarios/${recipientId}`);
    }

    if (recipientType === 'organization') {
      return db.doc(`organizacoes/${recipientId}`);
    }

    throw new FinancialAdminServiceError(
      'INVALID_RECIPIENT_TYPE',
      'Conta financeira somente pode pertencer a user ou organization.'
    );
  }

  function recipientAccountAuditView(account) {
    if (!account) return null;
    return recipientAccountView(account);
  }

  function courseRuleAuditView(rule, courseFinancialRuleId) {
    if (!rule) return null;

    return {
      ...financialRuleView(rule),
      courseFinancialRuleId:
        courseFinancialRuleId || null
    };
  }

  async function getDefaultConfiguration(input = {}) {
    const actor = actorContext(input);
    void actor;

    const ref = db.doc('financial_rules/platform-default');
    const snap = await ref.get();

    if (!snap.exists) {
      return {
        persisted: false,
        active: false,
        defaultPlatformFeeBps:
          DEFAULT_PLATFORM_FEE_BPS,
        rule: null
      };
    }

    const rule = financialRuleView(
      storedRule(snap, 'platform-default')
    );

    return {
      persisted: true,
      active: rule.status === 'active',
      defaultPlatformFeeBps:
        DEFAULT_PLATFORM_FEE_BPS,
      rule
    };
  }

  async function updateDefaultRule(input = {}) {
    assertAllowedFields(
      input.data || {},
      ['platformFeeBps'],
      'Atualização da taxa padrão'
    );

    const actor = actorContext(input);
    const now = timestamp();
    const ref = db.doc('financial_rules/platform-default');
    const auditRef = db.collection('audit_logs').doc();

    let result = null;

    await db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const existing = storedRule(
        snap,
        'platform-default'
      );

      const mutation = buildDefaultRuleMutation({
        existingRule: existing,
        platformFeeBps:
          input.data?.platformFeeBps,
        actorId: actor.uid,
        timestamp: now
      });

      if (!mutation.changed) {
        result = {
          changed: false,
          created: false,
          rule: financialRuleView(mutation.rule)
        };
        return;
      }

      if (snap.exists) {
        tx.set(ref, mutation.rule);
      } else {
        tx.create(ref, mutation.rule);
      }

      tx.create(
        auditRef,
        auditPayload({
          actor,
          action: 'financial.default_rule.updated',
          entityType: 'financial_rule',
          entityId: 'platform-default',
          before: existing
            ? financialRuleView(existing)
            : null,
          after: financialRuleView(mutation.rule),
          createdAt: now
        })
      );

      result = {
        changed: true,
        created: mutation.created,
        rule: financialRuleView(mutation.rule)
      };
    });

    return result;
  }

  async function configureRecipientAccount(input = {}) {
    assertAllowedFields(
      input.data || {},
      [
        'recipientType',
        'recipientId',
        'walletId',
        'status'
      ],
      'Configuração de conta de recebedor'
    );

    const actor = actorContext(input);
    const now = timestamp();

    const recipientType =
      String(input.data?.recipientType || '')
        .trim()
        .toLowerCase();

    const recipientId = requireIdentifier(
      input.data?.recipientId,
      'recipientId'
    );

    const accountId = financialRecipientAccountId({
      provider: canonicalProvider,
      environment: canonicalEnvironment,
      recipientType,
      recipientId
    });

    const identityRef = recipientIdentityRef(
      recipientType,
      recipientId
    );

    const accountRef = db.doc(
      `financial_recipient_accounts/${accountId}`
    );

    const auditRef = db.collection('audit_logs').doc();

    let result = null;

    await db.runTransaction(async tx => {
      const [identitySnap, accountSnap] =
        await Promise.all([
          tx.get(identityRef),
          tx.get(accountRef)
        ]);

      if (!identitySnap.exists) {
        throw new FinancialAdminServiceError(
          'RECIPIENT_IDENTITY_NOT_FOUND',
          'Recebedor canônico não encontrado.'
        );
      }

      const existing = accountSnap.exists
        ? accountSnap.data()
        : null;

      const mutation = buildRecipientAccountMutation({
        existingAccount: existing,
        input: {
          recipientType,
          recipientId,
          walletId: input.data?.walletId,
          status: input.data?.status
        },
        actorId: actor.uid,
        timestamp: now,
        provider: canonicalProvider,
        environment: canonicalEnvironment
      });

      if (!mutation.changed) {
        result = {
          changed: false,
          created: false,
          accountId,
          account:
            recipientAccountView(mutation.account)
        };
        return;
      }

      if (accountSnap.exists) {
        tx.set(accountRef, mutation.account);
      } else {
        tx.create(accountRef, mutation.account);
      }

      tx.create(
        auditRef,
        auditPayload({
          actor,
          action: mutation.created
            ? 'financial.recipient_account.created'
            : 'financial.recipient_account.updated',
          entityType: 'financial_recipient_account',
          entityId: accountId,
          before:
            recipientAccountAuditView(existing),
          after:
            recipientAccountView(mutation.account),
          createdAt: now
        })
      );

      result = {
        changed: true,
        created: mutation.created,
        accountId,
        account:
          recipientAccountView(mutation.account)
      };
    });

    return result;
  }

  async function getRecipientAccount(input = {}) {
    actorContext(input);

    const recipientType =
      String(input.recipientType || '')
        .trim()
        .toLowerCase();

    const recipientId = requireIdentifier(
      input.recipientId,
      'recipientId'
    );

    const accountId = financialRecipientAccountId({
      provider: canonicalProvider,
      environment: canonicalEnvironment,
      recipientType,
      recipientId
    });

    const snap = await db.doc(
      `financial_recipient_accounts/${accountId}`
    ).get();

    return {
      accountId,
      account: snap.exists
        ? recipientAccountView(snap.data())
        : null,
      readiness: recipientReadiness({
        recipientType,
        recipientId,
        account: snap.exists ? snap.data() : null,
        provider: canonicalProvider,
        environment: canonicalEnvironment
      })
    };
  }

  function explicitRecipientDescriptors(data = {}) {
    const mode =
      String(data.recipientMode || '')
        .trim()
        .toLowerCase();

    const status =
      String(data.status || '')
        .trim()
        .toLowerCase();

    if (
      mode !== 'explicit' ||
      status !== 'active'
    ) {
      return [];
    }

    if (!Array.isArray(data.recipientShares)) {
      return [];
    }

    const unique = new Map();

    for (const raw of data.recipientShares) {
      const recipientType =
        String(raw?.recipientType || '')
          .trim()
          .toLowerCase();

      if (recipientType === 'platform') {
        continue;
      }

      const recipientId = requireIdentifier(
        raw?.recipientId,
        'recipientId'
      );

      const accountId = financialRecipientAccountId({
        provider: canonicalProvider,
        environment: canonicalEnvironment,
        recipientType,
        recipientId
      });

      unique.set(
        `${recipientType}:${recipientId}`,
        {
          recipientType,
          recipientId,
          accountId,
          identityRef: recipientIdentityRef(
            recipientType,
            recipientId
          ),
          accountRef: db.doc(
            `financial_recipient_accounts/${accountId}`
          )
        }
      );
    }

    return [...unique.values()];
  }

  async function saveCourseRule(input = {}) {
    assertAllowedFields(
      input.data || {},
      [
        'courseId',
        'platformFeeBps',
        'recipientMode',
        'recipientShares',
        'status'
      ],
      'Configuração financeira de curso'
    );

    const actor = actorContext(input);
    const now = timestamp();

    const courseId = requireIdentifier(
      input.data?.courseId,
      'courseId'
    );

    const ruleId = productFinancialRuleId({
      productType: 'course',
      productId: courseId
    });

    const courseRef = db.doc(
      `courses/${courseId}`
    );
    const ruleRef = db.doc(
      `financial_rules/${ruleId}`
    );
    const auditRef = db.collection('audit_logs').doc();

    const descriptors =
      explicitRecipientDescriptors(input.data);

    let result = null;

    await db.runTransaction(async tx => {
      const baseReads = await Promise.all([
        tx.get(courseRef),
        tx.get(ruleRef),
        ...descriptors.map(item =>
          tx.get(item.identityRef)
        ),
        ...descriptors.map(item =>
          tx.get(item.accountRef)
        )
      ]);

      const courseSnap = baseReads[0];
      const ruleSnap = baseReads[1];

      if (!courseSnap.exists) {
        throw new FinancialAdminServiceError(
          'COURSE_NOT_FOUND',
          'Curso não encontrado.'
        );
      }

      const identityOffset = 2;
      const accountOffset =
        identityOffset + descriptors.length;

      for (
        let index = 0;
        index < descriptors.length;
        index += 1
      ) {
        if (!baseReads[identityOffset + index].exists) {
          throw new FinancialAdminServiceError(
            'RECIPIENT_IDENTITY_NOT_FOUND',
            `Recebedor ${descriptors[index].recipientType}:${descriptors[index].recipientId} não encontrado.`
          );
        }
      }

      const accountsByRecipientKey = {};

      for (
        let index = 0;
        index < descriptors.length;
        index += 1
      ) {
        const snap =
          baseReads[accountOffset + index];

        if (snap.exists) {
          const descriptor = descriptors[index];
          accountsByRecipientKey[
            `${descriptor.recipientType}:${descriptor.recipientId}`
          ] = snap.data();
        }
      }

      const course = courseSnap.data() || {};
      const existingRule = storedRule(
        ruleSnap,
        ruleId
      );

      const mutation = buildCourseRuleMutation({
        courseId,
        course,
        existingRule,
        input: {
          status: input.data?.status,
          platformFeeBps:
            input.data?.platformFeeBps,
          recipientMode:
            input.data?.recipientMode,
          recipientShares:
            input.data?.recipientShares
        },
        actorId: actor.uid,
        timestamp: now,
        accountsByRecipientKey,
        provider: canonicalProvider,
        environment: canonicalEnvironment
      });

      const previousLink =
        course.financialRuleId || null;
      const desiredLink =
        mutation.courseFinancialRuleId || null;
      const linkChanged =
        previousLink !== desiredLink;

      if (!mutation.changed && !linkChanged) {
        result = {
          changed: false,
          created: false,
          linkRepaired: false,
          rule:
            financialRuleView(mutation.rule),
          courseFinancialRuleId:
            desiredLink
        };
        return;
      }

      if (mutation.changed) {
        if (ruleSnap.exists) {
          tx.set(ruleRef, mutation.rule);
        } else {
          tx.create(ruleRef, mutation.rule);
        }
      }

      if (linkChanged) {
        tx.update(courseRef, {
          financialRuleId: desiredLink,
          updatedAt: now
        });
      }

      let action =
        mutation.created
          ? 'financial.course_rule.created'
          : 'financial.course_rule.updated';

      if (
        existingRule &&
        existingRule.status !== 'active' &&
        mutation.rule.status === 'active'
      ) {
        action = 'financial.course_rule.activated';
      }

      if (
        existingRule &&
        existingRule.status === 'active' &&
        mutation.rule.status === 'inactive'
      ) {
        action = 'financial.course_rule.deactivated';
      }

      if (!mutation.changed && linkChanged) {
        action = 'financial.course_rule.link_repaired';
      }

      tx.create(
        auditRef,
        auditPayload({
          actor,
          action,
          entityType: 'financial_rule',
          entityId: ruleId,
          before:
            courseRuleAuditView(
              existingRule,
              previousLink
            ),
          after:
            courseRuleAuditView(
              mutation.rule,
              desiredLink
            ),
          createdAt: now
        })
      );

      result = {
        changed: true,
        created: mutation.created,
        linkRepaired:
          !mutation.changed && linkChanged,
        rule:
          financialRuleView(mutation.rule),
        courseFinancialRuleId:
          desiredLink
      };
    });

    return result;
  }

  async function getCourseRule(input = {}) {
    actorContext(input);

    const courseId = requireIdentifier(
      input.courseId,
      'courseId'
    );

    const courseRef = db.doc(
      `courses/${courseId}`
    );
    const ruleId = productFinancialRuleId({
      productType: 'course',
      productId: courseId
    });
    const ruleRef = db.doc(
      `financial_rules/${ruleId}`
    );

    const [courseSnap, ruleSnap] =
      await Promise.all([
        courseRef.get(),
        ruleRef.get()
      ]);

    if (!courseSnap.exists) {
      throw new FinancialAdminServiceError(
        'COURSE_NOT_FOUND',
        'Curso não encontrado.'
      );
    }

    if (!ruleSnap.exists) {
      return {
        courseId,
        courseFinancialRuleId:
          courseSnap.data()?.financialRuleId || null,
        rule: null,
        recipientReadiness: []
      };
    }

    const rule = storedRule(ruleSnap, ruleId);
    const view = financialRuleView(rule);
    const readiness = [];

    if (view.recipientMode === 'explicit') {
      for (const share of view.recipientShares) {
        if (share.recipientType === 'platform') {
          readiness.push({
            recipientType: 'platform',
            recipientId: null,
            ready: true,
            reason: 'PLATFORM_PRIMARY_ACCOUNT'
          });
          continue;
        }

        const accountId =
          financialRecipientAccountId({
            provider: canonicalProvider,
            environment: canonicalEnvironment,
            recipientType: share.recipientType,
            recipientId: share.recipientId
          });

        const accountSnap = await db.doc(
          `financial_recipient_accounts/${accountId}`
        ).get();

        const state = recipientReadiness({
          recipientType: share.recipientType,
          recipientId: share.recipientId,
          account:
            accountSnap.exists
              ? accountSnap.data()
              : null,
          provider: canonicalProvider,
          environment: canonicalEnvironment
        });

        readiness.push({
          recipientType: share.recipientType,
          recipientId: share.recipientId,
          ...state
        });
      }
    }

    return {
      courseId,
      courseFinancialRuleId:
        courseSnap.data()?.financialRuleId || null,
      rule: view,
      recipientReadiness: readiness
    };
  }

  return {
    getDefaultConfiguration,
    updateDefaultRule,
    configureRecipientAccount,
    getRecipientAccount,
    saveCourseRule,
    getCourseRule
  };
}

module.exports = {
  FinancialAdminServiceError,
  createFinancialAdminService
};
