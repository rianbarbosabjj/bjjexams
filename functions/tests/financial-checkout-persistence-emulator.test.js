'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const {
  financialRecipientAccountId
} = require('../src/finance/financial-admin-domain');
const {
  financialOrderDocumentId
} = require('../src/finance/financial-order-service');
const {
  FinancialCheckoutPersistenceError,
  providerCustomerDocumentId,
  paymentTransactionId,
  createFinancialCheckoutPersistence
} = require('../src/finance/financial-checkout-persistence');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-finance-checkout-persistence';
const app = initializeApp({ projectId }, `checkout-persistence-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let now = new Date('2026-09-18T14:00:00.000Z');
let tokenCounter = 0;
let passed = 0;

function id(label) {
  return `${label}_${runId}`;
}

function service() {
  return createFinancialCheckoutPersistence({
    db,
    environment: 'sandbox',
    provider: 'asaas',
    clock: () => new Date(now.getTime()),
    leaseDurationMs: 45000,
    tokenFactory: () => `lease-${++tokenCounter}-${runId}`
  });
}

function defaultRule() {
  return {
    name: 'Regra padrao da plataforma',
    status: 'active',
    scope: 'platform_default',
    productType: null,
    productId: null,
    platformFeeBps: 1000,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 1,
    createdBy: id('admin'),
    updatedBy: id('admin'),
    createdAt: new Date('2026-09-18T10:00:00.000Z'),
    updatedAt: new Date('2026-09-18T10:00:00.000Z')
  };
}

function paidCourse(ownerId) {
  return {
    title: 'Curso checkout persistence',
    status: 'published',
    visibility: 'platform',
    isPaid: true,
    priceCents: 10000,
    currency: 'BRL',
    ownerType: 'user',
    ownerId,
    instructorIds: [ownerId],
    financialRuleId: null
  };
}

function recipientAccount(recipientId, walletId, overrides = {}) {
  return {
    recipientType: 'user',
    recipientId,
    provider: 'asaas',
    environment: 'sandbox',
    walletId,
    status: 'ready',
    version: 1,
    createdBy: id('admin'),
    updatedBy: id('admin'),
    createdAt: new Date('2026-09-18T10:00:00.000Z'),
    updatedAt: new Date('2026-09-18T10:00:00.000Z'),
    ...overrides
  };
}

async function seedCheckout({ buyer, owner, courseId, walletId = id('wallet') }) {
  await Promise.all([
    db.doc(`usuarios/${buyer}`).set({ nome: 'BUYER' }),
    db.doc(`usuarios/${owner}`).set({ nome: 'OWNER' }),
    db.doc(`courses/${courseId}`).set(paidCourse(owner)),
    db.doc('financial_rules/platform-default').set(defaultRule())
  ]);

  const accountId = financialRecipientAccountId({
    provider: 'asaas',
    environment: 'sandbox',
    recipientType: 'user',
    recipientId: owner
  });

  await db.doc(`financial_recipient_accounts/${accountId}`).set(
    recipientAccount(owner, walletId)
  );

  return { accountId, walletId };
}

async function auditsFor(actorId, action) {
  const snap = await db.collection('audit_logs')
    .where('actorId', '==', actorId)
    .get();
  return snap.docs.filter(doc => doc.data().action === action);
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function main() {
  try {
    await test('customer lease converge e binding ready fica idempotente', async () => {
      const buyer = id('buyer_customer');
      await db.doc(`usuarios/${buyer}`).set({ nome: 'BUYER CUSTOMER' });
      const api = service();

      const first = await api.acquireProviderCustomerLease({ userId: buyer });
      const second = await api.acquireProviderCustomerLease({ userId: buyer });

      assert.equal(first.acquired, true);
      assert.equal(second.processing, true);
      assert.equal(first.externalReference.includes(buyer), false);

      const customerProviderId = id('cus');
      const completed = await api.completeProviderCustomerBinding({
        userId: buyer,
        leaseToken: first.leaseToken,
        providerCustomerId: customerProviderId
      });
      const retry = await api.acquireProviderCustomerLease({ userId: buyer });

      assert.equal(completed.completed, true);
      assert.equal(retry.ready, true);
      assert.equal(retry.providerCustomerId, customerProviderId);
      assert.equal((await auditsFor(buyer, 'financial.provider_customer.bound')).length, 1);
    });

    await test('customer lease expirada pode ser retomada no mesmo documento', async () => {
      const buyer = id('buyer_expired');
      await db.doc(`usuarios/${buyer}`).set({ nome: 'BUYER EXPIRED' });
      const api = service();
      const first = await api.acquireProviderCustomerLease({ userId: buyer });
      now = new Date(now.getTime() + 60000);
      const second = await api.acquireProviderCustomerLease({ userId: buyer });

      assert.equal(first.acquired, true);
      assert.equal(second.acquired, true);
      assert.notEqual(first.leaseToken, second.leaseToken);

      const customerId = providerCustomerDocumentId({
        provider: 'asaas', environment: 'sandbox', userId: buyer
      });
      const snap = await db.doc(`financial_provider_customers/${customerId}`).get();
      assert.equal(snap.data().leaseToken, second.leaseToken);
    });

    await test('prepare cria transacao split snapshot e lease antes do provider', async () => {
      const buyer = id('buyer_prepare');
      const owner = id('owner_prepare');
      const courseId = id('course_prepare');
      const seeded = await seedCheckout({ buyer, owner, courseId });
      const result = await service().prepareCourseCheckout({
        buyerUserId: buyer,
        courseId,
        idempotencyKey: id('intent_prepare')
      });

      assert.equal(result.transactionCreated, true);
      assert.equal(result.transaction.status, 'created');
      assert.equal(result.providerSplitSnapshot.length, 1);
      assert.equal(result.providerSplitSnapshot[0].walletId, seeded.walletId);
      assert.equal(result.providerSplitSnapshot[0].fixedValueCents, 9000);
      assert.equal(result.lease.acquired, true);
      assert.equal(result.customer.status, 'missing');

      const order = (await db.doc(`orders/${result.orderId}`).get()).data();
      assert.equal(order.provider, 'asaas');
      assert.equal(order.currentTransactionId, result.transactionId);
      assert.equal((await db.collection('enrollments').where('userId', '==', buyer).get()).empty, true);
    });

    await test('duas preparacoes convergem para uma transacao e uma lease ativa', async () => {
      const buyer = id('buyer_concurrent');
      const owner = id('owner_concurrent');
      const courseId = id('course_concurrent');
      await seedCheckout({ buyer, owner, courseId });
      const input = {
        buyerUserId: buyer,
        courseId,
        idempotencyKey: id('intent_concurrent')
      };

      const [left, right] = await Promise.all([
        service().prepareCourseCheckout(input),
        service().prepareCourseCheckout(input)
      ]);

      assert.equal(left.orderId, right.orderId);
      assert.equal(left.transactionId, right.transactionId);
      assert.equal([left.transactionCreated, right.transactionCreated].filter(Boolean).length, 1);
      assert.equal([left.lease.acquired, right.lease.acquired].filter(Boolean).length, 1);
      assert.equal([left.lease.processing, right.lease.processing].filter(Boolean).length, 1);
      assert.equal((await auditsFor(buyer, 'financial.transaction.created')).length, 1);
    });

    await test('checkout revalida existencia atual da identidade do recebedor', async () => {
      const buyer = id('buyer_deleted_owner');
      const owner = id('owner_deleted');
      const courseId = id('course_deleted_owner');
      const intent = id('intent_deleted_owner');
      await seedCheckout({ buyer, owner, courseId });
      await db.doc(`usuarios/${owner}`).delete();

      await assert.rejects(
        service().prepareCourseCheckout({ buyerUserId: buyer, courseId, idempotencyKey: intent }),
        error => error instanceof FinancialCheckoutPersistenceError &&
          error.code === 'RECIPIENT_IDENTITY_REQUIRED'
      );

      const orderId = financialOrderDocumentId({
        buyerUserId: buyer,
        courseId,
        idempotencyKey: intent
      });
      const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
      assert.equal((await db.doc(`payment_transactions/${transactionId}`).get()).exists, false);
    });

    await test('checkout bloqueia conta de recebedor que deixou de estar ready', async () => {
      const buyer = id('buyer_blocked');
      const owner = id('owner_blocked');
      const courseId = id('course_blocked');
      const { accountId } = await seedCheckout({ buyer, owner, courseId });
      await db.doc(`financial_recipient_accounts/${accountId}`).update({ status: 'blocked' });

      await assert.rejects(
        service().prepareCourseCheckout({
          buyerUserId: buyer,
          courseId,
          idempotencyKey: id('intent_blocked')
        }),
        error => error instanceof FinancialCheckoutPersistenceError &&
          error.code === 'RECIPIENT_NOT_READY_FOR_CHECKOUT'
      );
    });

    await test('release da checkout lease permite retomada da mesma transacao', async () => {
      const buyer = id('buyer_release');
      const owner = id('owner_release');
      const courseId = id('course_release');
      await seedCheckout({ buyer, owner, courseId });
      const input = {
        buyerUserId: buyer,
        courseId,
        idempotencyKey: id('intent_release')
      };

      const first = await service().prepareCourseCheckout(input);
      const released = await service().releaseCheckoutLease({
        transactionId: first.transactionId,
        leaseToken: first.lease.leaseToken
      });
      const second = await service().prepareCourseCheckout(input);

      assert.equal(released, true);
      assert.equal(second.transactionId, first.transactionId);
      assert.equal(second.transactionCreated, false);
      assert.equal(second.lease.acquired, true);
    });

    await test('binding customer divergente falha fechado', async () => {
      const buyer = id('buyer_binding_mismatch');
      await db.doc(`usuarios/${buyer}`).set({ nome: 'BUYER BINDING' });
      const api = service();
      const lease = await api.acquireProviderCustomerLease({ userId: buyer });
      const originalId = id('cus_original');
      await api.completeProviderCustomerBinding({
        userId: buyer,
        leaseToken: lease.leaseToken,
        providerCustomerId: originalId
      });

      await assert.rejects(
        api.completeProviderCustomerBinding({
          userId: buyer,
          leaseToken: id('other_lease'),
          providerCustomerId: id('cus_other')
        }),
        error => error instanceof FinancialCheckoutPersistenceError &&
          error.code === 'PROVIDER_CUSTOMER_ID_MISMATCH'
      );
    });

    console.log(`FINANCIAL_CHECKOUT_PERSISTENCE_EMULATOR_V1_2=${passed}/8`);
    if (passed !== 8) process.exitCode = 1;
  } finally {
    await deleteApp(app);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
