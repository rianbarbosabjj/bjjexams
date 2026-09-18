'use strict';

const crypto = require('crypto');

const {
  validateOrder,
  validateTransaction,
  buildTransactionFromOrder
} = require('./financial-domain');
const {
  financialRecipientAccountId,
  recipientReadiness
} = require('./financial-admin-domain');
const {
  buildAsaasSplit
} = require('./asaas-checkout-adapter');
const {
  createFinancialOrderService
} = require('./financial-order-service');

const CHECKOUT_PROVIDER = 'asaas';
const CHECKOUT_ENVIRONMENT = 'sandbox';
const DEFAULT_LEASE_DURATION_MS = 45 * 1000;
const CUSTOMER_STATUSES = Object.freeze([
  'idle',
  'provisioning',
  'ready'
]);

class FinancialCheckoutPersistenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialCheckoutPersistenceError';
    this.code = code;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialCheckoutPersistenceError(
      'INVALID_CHECKOUT_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function ensureSandbox(environment) {
  if (String(environment || '').trim().toLowerCase() !== CHECKOUT_ENVIRONMENT) {
    throw new FinancialCheckoutPersistenceError(
      'CHECKOUT_SANDBOX_ONLY',
      'Persistência do checkout 5.3 aceita somente sandbox.'
    );
  }
  return CHECKOUT_ENVIRONMENT;
}

function deterministicId(namespace, parts = []) {
  return crypto
    .createHash('sha256')
    .update([namespace, ...parts.map(part => String(part))].join(':'))
    .digest('hex');
}

function providerCustomerDocumentId({
  provider = CHECKOUT_PROVIDER,
  environment = CHECKOUT_ENVIRONMENT,
  userId
} = {}) {
  const user = requiredIdentifier(userId, 'userId');
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedEnvironment = ensureSandbox(environment);
  if (normalizedProvider !== CHECKOUT_PROVIDER) {
    throw new FinancialCheckoutPersistenceError(
      'CHECKOUT_PROVIDER_UNSUPPORTED',
      'Marco 5.3 aceita somente provider asaas.'
    );
  }
  return deterministicId(
    'financial-provider-customer-v1',
    [normalizedProvider, normalizedEnvironment, user]
  );
}

function providerCustomerExternalReference({
  provider = CHECKOUT_PROVIDER,
  environment = CHECKOUT_ENVIRONMENT,
  userId
} = {}) {
  const user = requiredIdentifier(userId, 'userId');
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  const normalizedEnvironment = ensureSandbox(environment);
  const hash = deterministicId(
    'financial-provider-customer-ref-v1',
    [normalizedProvider, normalizedEnvironment, user]
  ).slice(0, 32);
  return `BJJEX-V12-CUSTOMER-${hash}`;
}

function paymentTransactionId({
  provider = CHECKOUT_PROVIDER,
  orderId
} = {}) {
  const order = requiredIdentifier(orderId, 'orderId');
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (normalizedProvider !== CHECKOUT_PROVIDER) {
    throw new FinancialCheckoutPersistenceError(
      'CHECKOUT_PROVIDER_UNSUPPORTED',
      'Marco 5.3 aceita somente provider asaas.'
    );
  }
  return deterministicId(
    'payment-transaction-v1',
    [normalizedProvider, order]
  );
}

function toMillis(value) {
  if (!value) return Number.NaN;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const date = value instanceof Date ? value : new Date(value);
  return date.getTime();
}

function addMillis(value, durationMs) {
  const start = toMillis(value);
  if (!Number.isFinite(start)) {
    throw new FinancialCheckoutPersistenceError(
      'CHECKOUT_TIMESTAMP_REQUIRED',
      'Timestamp do checkout inválido.'
    );
  }
  return new Date(start + durationMs);
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeCustomerBinding(input = {}, expected = {}) {
  const status = String(input.status || '').trim().toLowerCase();
  if (!CUSTOMER_STATUSES.includes(status)) {
    throw new FinancialCheckoutPersistenceError(
      'INVALID_PROVIDER_CUSTOMER_STATUS',
      'Status do vínculo de cliente financeiro inválido.'
    );
  }

  const normalized = {
    provider: String(input.provider || '').trim().toLowerCase(),
    environment: String(input.environment || '').trim().toLowerCase(),
    userId: String(input.userId || '').trim(),
    providerCustomerId: input.providerCustomerId
      ? String(input.providerCustomerId).trim()
      : null,
    externalReference: String(input.externalReference || '').trim(),
    status,
    leaseToken: input.leaseToken ? String(input.leaseToken).trim() : null,
    leaseExpiresAt: input.leaseExpiresAt || null,
    createdAt: input.createdAt || null,
    updatedAt: input.updatedAt || null
  };

  if (
    normalized.provider !== expected.provider ||
    normalized.environment !== expected.environment ||
    normalized.userId !== expected.userId ||
    normalized.externalReference !== expected.externalReference
  ) {
    throw new FinancialCheckoutPersistenceError(
      'PROVIDER_CUSTOMER_BINDING_MISMATCH',
      'Vínculo de cliente financeiro não corresponde à identidade esperada.'
    );
  }

  if (status === 'ready' && !normalized.providerCustomerId) {
    throw new FinancialCheckoutPersistenceError(
      'PROVIDER_CUSTOMER_ID_REQUIRED',
      'Vínculo ready exige providerCustomerId.'
    );
  }

  if (status === 'provisioning' && (!normalized.leaseToken || !normalized.leaseExpiresAt)) {
    throw new FinancialCheckoutPersistenceError(
      'PROVIDER_CUSTOMER_LEASE_REQUIRED',
      'Vínculo em provisioning exige lease ativa.'
    );
  }

  return normalized;
}

function createFinancialCheckoutPersistence(dependencies = {}) {
  const {
    db,
    environment = CHECKOUT_ENVIRONMENT,
    provider = CHECKOUT_PROVIDER,
    clock = () => new Date(),
    leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
    tokenFactory = () => crypto.randomUUID()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Checkout persistence exige Firestore válido.');
  }

  const canonicalEnvironment = ensureSandbox(environment);
  const canonicalProvider = String(provider || '').trim().toLowerCase();
  if (canonicalProvider !== CHECKOUT_PROVIDER) {
    throw new FinancialCheckoutPersistenceError(
      'CHECKOUT_PROVIDER_UNSUPPORTED',
      'Marco 5.3 aceita somente provider asaas.'
    );
  }
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1000) {
    throw new TypeError('leaseDurationMs precisa ser inteiro >= 1000.');
  }

  const orderService = createFinancialOrderService({ db, clock });

  function customerIdentity(userId) {
    const user = requiredIdentifier(userId, 'userId');
    return {
      provider: canonicalProvider,
      environment: canonicalEnvironment,
      userId: user,
      externalReference: providerCustomerExternalReference({
        provider: canonicalProvider,
        environment: canonicalEnvironment,
        userId: user
      })
    };
  }

  async function acquireProviderCustomerLease({ userId } = {}) {
    const identity = customerIdentity(userId);
    const customerId = providerCustomerDocumentId(identity);
    const customerRef = db.doc(`financial_provider_customers/${customerId}`);
    const userRef = db.doc(`usuarios/${identity.userId}`);
    const now = clock();
    const leaseToken = String(tokenFactory() || '').trim();
    if (!leaseToken) {
      throw new FinancialCheckoutPersistenceError(
        'CHECKOUT_LEASE_TOKEN_REQUIRED',
        'tokenFactory não retornou lease token.'
      );
    }

    return db.runTransaction(async tx => {
      const [userSnap, customerSnap] = await Promise.all([
        tx.get(userRef),
        tx.get(customerRef)
      ]);

      if (!userSnap.exists) {
        throw new FinancialCheckoutPersistenceError(
          'BUYER_PROFILE_REQUIRED',
          'Perfil canônico do comprador não encontrado.'
        );
      }

      if (customerSnap.exists) {
        const existing = normalizeCustomerBinding(
          customerSnap.data() || {},
          identity
        );

        if (existing.status === 'ready') {
          return {
            customerId,
            acquired: false,
            ready: true,
            providerCustomerId: existing.providerCustomerId,
            externalReference: identity.externalReference,
            leaseToken: null
          };
        }

        if (
          existing.status === 'provisioning' &&
          toMillis(existing.leaseExpiresAt) > toMillis(now)
        ) {
          return {
            customerId,
            acquired: false,
            ready: false,
            processing: true,
            providerCustomerId: null,
            externalReference: identity.externalReference,
            leaseToken: null
          };
        }
      }

      const existingData = customerSnap.exists
        ? normalizeCustomerBinding(customerSnap.data() || {}, identity)
        : null;

      const next = {
        provider: canonicalProvider,
        environment: canonicalEnvironment,
        userId: identity.userId,
        providerCustomerId: null,
        externalReference: identity.externalReference,
        status: 'provisioning',
        leaseToken,
        leaseExpiresAt: addMillis(now, leaseDurationMs),
        createdAt: existingData?.createdAt || now,
        updatedAt: now
      };

      tx.set(customerRef, next);

      return {
        customerId,
        acquired: true,
        ready: false,
        processing: false,
        providerCustomerId: null,
        externalReference: identity.externalReference,
        leaseToken
      };
    });
  }

  async function completeProviderCustomerBinding({
    userId,
    leaseToken,
    providerCustomerId
  } = {}) {
    const identity = customerIdentity(userId);
    const customerId = providerCustomerDocumentId(identity);
    const customerRef = db.doc(`financial_provider_customers/${customerId}`);
    const canonicalLeaseToken = requiredIdentifier(leaseToken, 'leaseToken');
    const canonicalProviderCustomerId = requiredIdentifier(
      providerCustomerId,
      'providerCustomerId'
    );
    const now = clock();

    return db.runTransaction(async tx => {
      const customerSnap = await tx.get(customerRef);
      if (!customerSnap.exists) {
        throw new FinancialCheckoutPersistenceError(
          'PROVIDER_CUSTOMER_LEASE_NOT_FOUND',
          'Lease de cliente financeiro não encontrada.'
        );
      }

      const existing = normalizeCustomerBinding(
        customerSnap.data() || {},
        identity
      );

      if (existing.status === 'ready') {
        if (existing.providerCustomerId !== canonicalProviderCustomerId) {
          throw new FinancialCheckoutPersistenceError(
            'PROVIDER_CUSTOMER_ID_MISMATCH',
            'Vínculo ready aponta para outro providerCustomerId.'
          );
        }
        return {
          customerId,
          completed: false,
          providerCustomerId: existing.providerCustomerId,
          externalReference: identity.externalReference
        };
      }

      if (
        existing.status !== 'provisioning' ||
        existing.leaseToken !== canonicalLeaseToken
      ) {
        throw new FinancialCheckoutPersistenceError(
          'PROVIDER_CUSTOMER_LEASE_MISMATCH',
          'Lease de cliente financeiro não corresponde ao executor atual.'
        );
      }

      const next = {
        ...existing,
        providerCustomerId: canonicalProviderCustomerId,
        status: 'ready',
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now
      };

      tx.set(customerRef, next);
      tx.create(db.collection('audit_logs').doc(), {
        actorId: identity.userId,
        actorRole: 'student',
        action: 'financial.provider_customer.bound',
        entityType: 'financial_provider_customer',
        entityId: customerId,
        before: null,
        after: {
          provider: canonicalProvider,
          environment: canonicalEnvironment,
          userId: identity.userId,
          externalReference: identity.externalReference,
          providerCustomerConfigured: true
        },
        source: 'service',
        requestId: null,
        createdAt: now
      });

      return {
        customerId,
        completed: true,
        providerCustomerId: canonicalProviderCustomerId,
        externalReference: identity.externalReference
      };
    });
  }

  async function releaseProviderCustomerLease({ userId, leaseToken } = {}) {
    const identity = customerIdentity(userId);
    const customerId = providerCustomerDocumentId(identity);
    const customerRef = db.doc(`financial_provider_customers/${customerId}`);
    const canonicalLeaseToken = requiredIdentifier(leaseToken, 'leaseToken');
    const now = clock();

    return db.runTransaction(async tx => {
      const snap = await tx.get(customerRef);
      if (!snap.exists) return false;
      const existing = normalizeCustomerBinding(snap.data() || {}, identity);
      if (existing.status === 'ready') return false;
      if (
        existing.status !== 'provisioning' ||
        existing.leaseToken !== canonicalLeaseToken
      ) {
        return false;
      }
      tx.set(customerRef, {
        ...existing,
        status: 'idle',
        leaseToken: null,
        leaseExpiresAt: null,
        updatedAt: now
      });
      return true;
    });
  }

  async function prepareCourseCheckout({
    buyerUserId,
    courseId,
    idempotencyKey
  } = {}) {
    const buyer = requiredIdentifier(buyerUserId, 'buyerUserId');
    const course = requiredIdentifier(courseId, 'courseId');
    const orderResult = await orderService.createPendingCourseOrder({
      buyerUserId: buyer,
      courseId: course,
      idempotencyKey
    });
    const orderId = orderResult.orderId;
    const transactionId = paymentTransactionId({
      provider: canonicalProvider,
      orderId
    });
    const leaseToken = String(tokenFactory() || '').trim();
    if (!leaseToken) {
      throw new FinancialCheckoutPersistenceError(
        'CHECKOUT_LEASE_TOKEN_REQUIRED',
        'tokenFactory não retornou lease token.'
      );
    }

    const orderRef = db.doc(`orders/${orderId}`);
    const transactionRef = db.doc(`payment_transactions/${transactionId}`);
    const leaseRef = db.doc(`financial_checkout_leases/${transactionId}`);
    const buyerRef = db.doc(`usuarios/${buyer}`);
    const customerIdentityValue = customerIdentity(buyer);
    const customerId = providerCustomerDocumentId(customerIdentityValue);
    const customerRef = db.doc(`financial_provider_customers/${customerId}`);
    const now = clock();

    return db.runTransaction(async tx => {
      const [orderSnap, buyerSnap, transactionSnap, leaseSnap, customerSnap] =
        await Promise.all([
          tx.get(orderRef),
          tx.get(buyerRef),
          tx.get(transactionRef),
          tx.get(leaseRef),
          tx.get(customerRef)
        ]);

      if (!orderSnap.exists) {
        throw new FinancialCheckoutPersistenceError(
          'ORDER_NOT_FOUND_AFTER_CREATE',
          'Pedido canônico não encontrado após preparação.'
        );
      }
      if (!buyerSnap.exists) {
        throw new FinancialCheckoutPersistenceError(
          'BUYER_PROFILE_REQUIRED',
          'Perfil canônico do comprador não encontrado.'
        );
      }

      const order = validateOrder(orderSnap.data() || {});
      if (
        order.buyerUserId !== buyer ||
        order.productType !== 'course' ||
        order.productId !== course ||
        order.status !== 'pending_payment'
      ) {
        throw new FinancialCheckoutPersistenceError(
          'ORDER_NOT_CHECKOUT_READY',
          'Pedido não está consistente para checkout.'
        );
      }

      const externalAllocations = order.financialSnapshot.recipientAllocations
        .filter(item => item.recipientType !== 'platform');

      const recipientEntries = [];
      for (const allocation of externalAllocations) {
        const type = allocation.recipientType;
        const recipientId = requiredIdentifier(
          allocation.recipientId,
          'recipientId'
        );
        if (!['user', 'organization'].includes(type)) {
          throw new FinancialCheckoutPersistenceError(
            'INVALID_CHECKOUT_RECIPIENT',
            'Snapshot possui recebedor externo inválido.'
          );
        }
        const identityRef = type === 'user'
          ? db.doc(`usuarios/${recipientId}`)
          : db.doc(`organizacoes/${recipientId}`);
        const accountId = financialRecipientAccountId({
          provider: canonicalProvider,
          environment: canonicalEnvironment,
          recipientType: type,
          recipientId
        });
        const accountRef = db.doc(`financial_recipient_accounts/${accountId}`);
        recipientEntries.push({
          allocation,
          type,
          recipientId,
          identityRef,
          accountRef
        });
      }

      for (const entry of recipientEntries) {
        entry.identitySnap = await tx.get(entry.identityRef);
        entry.accountSnap = await tx.get(entry.accountRef);
      }

      const recipientWallets = {};
      for (const entry of recipientEntries) {
        if (!entry.identitySnap.exists) {
          throw new FinancialCheckoutPersistenceError(
            'RECIPIENT_IDENTITY_REQUIRED',
            `Identidade canônica do recebedor ${entry.type}:${entry.recipientId} não existe.`
          );
        }
        const account = entry.accountSnap.exists
          ? entry.accountSnap.data() || {}
          : null;
        const readiness = recipientReadiness({
          recipientType: entry.type,
          recipientId: entry.recipientId,
          account,
          provider: canonicalProvider,
          environment: canonicalEnvironment
        });
        if (!readiness.ready) {
          throw new FinancialCheckoutPersistenceError(
            'RECIPIENT_NOT_READY_FOR_CHECKOUT',
            `Recebedor ${entry.type}:${entry.recipientId} não está pronto: ${readiness.reason}.`
          );
        }
        recipientWallets[`${entry.type}:${entry.recipientId}`] =
          String(account.walletId || '').trim();
      }

      const expectedSplit = buildAsaasSplit({
        transactionId,
        financialSnapshot: order.financialSnapshot,
        recipientWallets
      });

      let transaction;
      let transactionCreated = false;
      if (transactionSnap.exists) {
        transaction = validateTransaction(transactionSnap.data() || {});
        if (
          transaction.orderId !== orderId ||
          transaction.buyerUserId !== buyer ||
          transaction.provider !== canonicalProvider ||
          transaction.amountCents !== order.amountCents ||
          transaction.currency !== order.currency ||
          !sameSnapshot(transaction.financialSnapshot, order.financialSnapshot) ||
          !sameSnapshot(
            transaction.providerSplitSnapshot || [],
            expectedSplit.providerSplitSnapshot
          )
        ) {
          throw new FinancialCheckoutPersistenceError(
            'TRANSACTION_IDEMPOTENCY_MISMATCH',
            'Transação canônica existente diverge do pedido/snapshot.'
          );
        }
      } else {
        const baseTransaction = buildTransactionFromOrder({
          orderId,
          order,
          provider: canonicalProvider,
          createdAt: now
        });
        transaction = validateTransaction({
          ...baseTransaction,
          providerSplitSnapshot: expectedSplit.providerSplitSnapshot
        });
        tx.create(transactionRef, transaction);
        tx.create(db.collection('audit_logs').doc(), {
          actorId: buyer,
          actorRole: 'student',
          action: 'financial.transaction.created',
          entityType: 'payment_transaction',
          entityId: transactionId,
          before: null,
          after: {
            orderId,
            provider: canonicalProvider,
            amountCents: transaction.amountCents,
            currency: transaction.currency,
            status: transaction.status,
            ruleId: transaction.financialSnapshot.ruleId,
            ruleVersion: transaction.financialSnapshot.ruleVersion
          },
          source: 'service',
          requestId: null,
          createdAt: now
        });
        transactionCreated = true;
      }

      let customerBinding = null;
      if (customerSnap.exists) {
        customerBinding = normalizeCustomerBinding(
          customerSnap.data() || {},
          customerIdentityValue
        );
      }

      const updatedOrder = validateOrder({
        ...order,
        provider: canonicalProvider,
        providerCustomerId:
          customerBinding?.status === 'ready'
            ? customerBinding.providerCustomerId
            : order.providerCustomerId,
        currentTransactionId: transactionId,
        updatedAt: now
      });

      tx.set(orderRef, updatedOrder);

      let leaseAcquired = false;
      let processing = false;
      if (leaseSnap.exists) {
        const lease = leaseSnap.data() || {};
        const active =
          lease.status === 'active' &&
          lease.provider === canonicalProvider &&
          lease.environment === canonicalEnvironment &&
          lease.orderId === orderId &&
          lease.transactionId === transactionId &&
          toMillis(lease.expiresAt) > toMillis(now);
        if (active) {
          processing = true;
        } else {
          leaseAcquired = true;
        }
      } else {
        leaseAcquired = true;
      }

      if (leaseAcquired) {
        tx.set(leaseRef, {
          orderId,
          transactionId,
          provider: canonicalProvider,
          environment: canonicalEnvironment,
          status: 'active',
          leaseToken,
          acquiredAt: now,
          expiresAt: addMillis(now, leaseDurationMs),
          updatedAt: now
        });
      }

      return {
        orderId,
        order: updatedOrder,
        transactionId,
        transaction,
        transactionCreated,
        recipientWallets,
        providerSplitSnapshot: expectedSplit.providerSplitSnapshot,
        customer: customerBinding
          ? {
              status: customerBinding.status,
              providerCustomerId:
                customerBinding.status === 'ready'
                  ? customerBinding.providerCustomerId
                  : null,
              externalReference: customerBinding.externalReference
            }
          : {
              status: 'missing',
              providerCustomerId: null,
              externalReference: customerIdentityValue.externalReference
            },
        lease: {
          acquired: leaseAcquired,
          processing,
          leaseToken: leaseAcquired ? leaseToken : null
        }
      };
    });
  }

  async function releaseCheckoutLease({ transactionId, leaseToken } = {}) {
    const canonicalTransactionId = requiredIdentifier(
      transactionId,
      'transactionId'
    );
    const canonicalLeaseToken = requiredIdentifier(leaseToken, 'leaseToken');
    const leaseRef = db.doc(`financial_checkout_leases/${canonicalTransactionId}`);
    const now = clock();

    return db.runTransaction(async tx => {
      const snap = await tx.get(leaseRef);
      if (!snap.exists) return false;
      const lease = snap.data() || {};
      if (
        lease.transactionId !== canonicalTransactionId ||
        lease.leaseToken !== canonicalLeaseToken ||
        lease.status !== 'active'
      ) {
        return false;
      }
      tx.set(leaseRef, {
        ...lease,
        status: 'released',
        leaseToken: null,
        expiresAt: now,
        updatedAt: now
      });
      return true;
    });
  }

  return {
    acquireProviderCustomerLease,
    completeProviderCustomerBinding,
    releaseProviderCustomerLease,
    prepareCourseCheckout,
    releaseCheckoutLease
  };
}

module.exports = {
  CHECKOUT_PROVIDER,
  CHECKOUT_ENVIRONMENT,
  DEFAULT_LEASE_DURATION_MS,
  CUSTOMER_STATUSES,
  FinancialCheckoutPersistenceError,
  providerCustomerDocumentId,
  providerCustomerExternalReference,
  paymentTransactionId,
  createFinancialCheckoutPersistence
};
