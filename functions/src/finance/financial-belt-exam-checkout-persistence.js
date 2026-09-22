'use strict';

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
  CHECKOUT_PROVIDER,
  CHECKOUT_ENVIRONMENT,
  DEFAULT_LEASE_DURATION_MS,
  FinancialCheckoutPersistenceError,
  providerCustomerExternalReference,
  paymentTransactionId,
  createFinancialCheckoutPersistence
} = require('./financial-checkout-persistence');
const {
  createFinancialBeltExamOrderService
} = require('./financial-belt-exam-order-service');

class FinancialBeltExamCheckoutPersistenceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialBeltExamCheckoutPersistenceError';
    this.code = code;
  }
}

function requiredIdentifier(value, field) {
  const id = String(value || '').trim();
  if (!id || id.length > 200 || id.includes('/')) {
    throw new FinancialBeltExamCheckoutPersistenceError(
      'INVALID_BELT_EXAM_CHECKOUT_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return id;
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
    throw new FinancialBeltExamCheckoutPersistenceError(
      'BELT_EXAM_CHECKOUT_TIMESTAMP_REQUIRED',
      'Timestamp do checkout inválido.'
    );
  }
  return new Date(start + durationMs);
}

function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function createFinancialBeltExamCheckoutPersistence(dependencies = {}) {
  const {
    db,
    environment = CHECKOUT_ENVIRONMENT,
    provider = CHECKOUT_PROVIDER,
    clock = () => new Date(),
    leaseDurationMs = DEFAULT_LEASE_DURATION_MS,
    tokenFactory = () => require('crypto').randomUUID()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Belt exam checkout persistence exige Firestore válido.');
  }

  const canonicalEnvironment = String(environment || '').trim().toLowerCase();
  const canonicalProvider = String(provider || '').trim().toLowerCase();
  if (canonicalEnvironment !== CHECKOUT_ENVIRONMENT || canonicalProvider !== CHECKOUT_PROVIDER) {
    throw new FinancialBeltExamCheckoutPersistenceError(
      'BELT_EXAM_CHECKOUT_SANDBOX_ONLY',
      'Checkout de exame aceita somente Asaas sandbox neste marco.'
    );
  }
  if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1000) {
    throw new TypeError('leaseDurationMs precisa ser inteiro >= 1000.');
  }

  const sharedPersistence = createFinancialCheckoutPersistence({
    db,
    environment: canonicalEnvironment,
    provider: canonicalProvider,
    clock,
    leaseDurationMs,
    tokenFactory
  });
  const orderService = createFinancialBeltExamOrderService({ db, clock });

  async function prepareBeltExamCheckout({
    buyerUserId,
    sessionId,
    idempotencyKey
  } = {}) {
    const buyer = requiredIdentifier(buyerUserId, 'buyerUserId');
    const session = requiredIdentifier(sessionId, 'sessionId');
    const orderResult = await orderService.createPendingBeltExamOrder({
      buyerUserId: buyer,
      sessionId: session,
      idempotencyKey
    });
    const orderId = orderResult.orderId;
    const transactionId = paymentTransactionId({
      provider: canonicalProvider,
      orderId
    });
    const leaseToken = String(tokenFactory() || '').trim();
    if (!leaseToken) {
      throw new FinancialBeltExamCheckoutPersistenceError(
        'BELT_EXAM_CHECKOUT_LEASE_TOKEN_REQUIRED',
        'tokenFactory não retornou lease token.'
      );
    }

    const orderRef = db.doc(`orders/${orderId}`);
    const transactionRef = db.doc(`payment_transactions/${transactionId}`);
    const leaseRef = db.doc(`financial_checkout_leases/${transactionId}`);
    const now = clock();

    return db.runTransaction(async tx => {
      const [orderSnap, transactionSnap, leaseSnap] = await Promise.all([
        tx.get(orderRef),
        tx.get(transactionRef),
        tx.get(leaseRef)
      ]);

      if (!orderSnap.exists) {
        throw new FinancialBeltExamCheckoutPersistenceError(
          'BELT_EXAM_ORDER_NOT_FOUND_AFTER_CREATE',
          'Pedido canônico não encontrado após preparação.'
        );
      }

      const order = validateOrder(orderSnap.data() || {});
      if (
        order.buyerUserId !== buyer ||
        order.productType !== 'belt_exam' ||
        order.productId !== session ||
        order.status !== 'pending_payment'
      ) {
        throw new FinancialBeltExamCheckoutPersistenceError(
          'BELT_EXAM_ORDER_NOT_CHECKOUT_READY',
          'Pedido de exame não está consistente para checkout.'
        );
      }

      const externalAllocations = order.financialSnapshot.recipientAllocations
        .filter(item => item.recipientType !== 'platform');
      const recipientEntries = [];

      for (const allocation of externalAllocations) {
        const type = allocation.recipientType;
        const recipientId = requiredIdentifier(allocation.recipientId, 'recipientId');
        if (!['user', 'organization'].includes(type)) {
          throw new FinancialBeltExamCheckoutPersistenceError(
            'INVALID_BELT_EXAM_CHECKOUT_RECIPIENT',
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
        recipientEntries.push({ allocation, type, recipientId, identityRef, accountRef });
      }

      for (const entry of recipientEntries) {
        entry.identitySnap = await tx.get(entry.identityRef);
        entry.accountSnap = await tx.get(entry.accountRef);
      }

      const recipientWallets = {};
      for (const entry of recipientEntries) {
        if (!entry.identitySnap.exists) {
          throw new FinancialBeltExamCheckoutPersistenceError(
            'BELT_EXAM_RECIPIENT_IDENTITY_REQUIRED',
            `Identidade canônica do recebedor ${entry.type}:${entry.recipientId} não existe.`
          );
        }
        const account = entry.accountSnap.exists ? entry.accountSnap.data() || {} : null;
        const readiness = recipientReadiness({
          recipientType: entry.type,
          recipientId: entry.recipientId,
          account,
          provider: canonicalProvider,
          environment: canonicalEnvironment
        });
        if (!readiness.ready) {
          throw new FinancialBeltExamCheckoutPersistenceError(
            'BELT_EXAM_RECIPIENT_NOT_READY',
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
          throw new FinancialBeltExamCheckoutPersistenceError(
            'BELT_EXAM_TRANSACTION_IDEMPOTENCY_MISMATCH',
            'Transação existente diverge do pedido/snapshot do exame.'
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
            productType: 'belt_exam',
            productId: session,
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

      const updatedOrder = validateOrder({
        ...order,
        provider: canonicalProvider,
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
        if (active) processing = true;
        else leaseAcquired = true;
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
        customer: {
          status: 'missing',
          providerCustomerId: null,
          externalReference: providerCustomerExternalReference({
            provider: canonicalProvider,
            environment: canonicalEnvironment,
            userId: buyer
          })
        },
        lease: {
          acquired: leaseAcquired,
          processing,
          leaseToken: leaseAcquired ? leaseToken : null
        }
      };
    });
  }

  return {
    acquireProviderCustomerLease: sharedPersistence.acquireProviderCustomerLease,
    completeProviderCustomerBinding: sharedPersistence.completeProviderCustomerBinding,
    releaseProviderCustomerLease: sharedPersistence.releaseProviderCustomerLease,
    prepareBeltExamCheckout,
    releaseCheckoutLease: sharedPersistence.releaseCheckoutLease
  };
}

module.exports = {
  FinancialBeltExamCheckoutPersistenceError,
  createFinancialBeltExamCheckoutPersistence,
  FinancialCheckoutPersistenceError
};
