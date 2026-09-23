'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const {
  buildExamSession
} = require('../src/exams/exam-session-domain');
const {
  buildSelectedExamRegistration,
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');
const {
  financialRecipientAccountId
} = require('../src/finance/financial-admin-domain');
const {
  createFinancialBeltExamOrderService,
  beltExamFinancialOrderDocumentId,
  FinancialBeltExamOrderServiceError
} = require('../src/finance/financial-belt-exam-order-service');
const {
  createFinancialBeltExamCheckoutPersistence,
  FinancialBeltExamCheckoutPersistenceError
} = require('../src/finance/financial-belt-exam-checkout-persistence');
const {
  paymentTransactionId
} = require('../src/finance/financial-checkout-persistence');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-belt-exam-checkout';
const app = initializeApp(
  { projectId },
  `belt-exam-checkout-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;

function id(label) {
  return `belt_exam_${label}_${runId}`;
}

function now(minutes = 0) {
  return new Date(Date.parse('2026-09-20T02:00:00.000Z') + minutes * 60000);
}

async function seedDefaultRule() {
  await db.doc('financial_rules/platform-default').set({
    name: 'Regra padrao',
    status: 'active',
    scope: 'platform_default',
    productType: null,
    productId: null,
    platformFeeBps: 1000,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 1,
    createdBy: 'system',
    updatedBy: 'system',
    createdAt: now(),
    updatedAt: now()
  });
}

async function seedCandidate({
  label,
  membershipStatus = 'ativo',
  withRecipientAccount = true,
  withTemplateBinding = true
}) {
  const organizationId = id(`org_${label}`);
  const studentId = id(`student_${label}`);
  const instructorId = id(`instructor_${label}`);
  const sessionId = id(`session_${label}`);
  const membershipId = id(`membership_${label}`);
  const registrationId = examRegistrationDocumentId({ sessionId, studentId });

  await db.doc(`organizacoes/${organizationId}`).set({
    nome: `Academia ${label}`,
    status: 'active'
  });
  await db.doc(`usuarios/${studentId}`).set({
    nome: `Aluno ${label}`,
    email: `${studentId}@example.test`,
    cpf: '12345678909',
    status_conta: 'ativo'
  });
  await db.doc(`vinculos_organizacao/${membershipId}`).set({
    usuario_id: studentId,
    organizacao_id: organizationId,
    papel: 'aluno',
    status: membershipStatus
  });

  const session = buildExamSession({
    organizationId,
    responsibleInstructorId: instructorId,
    targetBelt: 'Azul',
    templateId: withTemplateBinding
      ? id(`template_${label}`)
      : null,
    templateVersionId: withTemplateBinding
      ? 'v0000001'
      : null,
    priceCents: 10000,
    currency: 'BRL',
    financialRuleId: null,
    createdBy: instructorId,
    timestamp: now()
  });
  await db.doc(`exam_sessions/${sessionId}`).set({
    ...session,
    status: 'candidates_selected'
  });

  const registration = buildSelectedExamRegistration({
    sessionId,
    organizationId,
    studentId,
    instructorId,
    currentBelt: 'Branca',
    targetBelt: 'Azul',
    membershipId,
    timestamp: now()
  });
  await db.doc(`exam_registrations/${registrationId}`).set(registration);

  if (withRecipientAccount) {
    const accountId = financialRecipientAccountId({
      provider: 'asaas',
      environment: 'sandbox',
      recipientType: 'organization',
      recipientId: organizationId
    });
    await db.doc(`financial_recipient_accounts/${accountId}`).set({
      recipientType: 'organization',
      recipientId: organizationId,
      provider: 'asaas',
      environment: 'sandbox',
      walletId: `wallet_${label}_${runId}`,
      status: 'ready',
      version: 1,
      createdBy: 'system',
      updatedBy: 'system',
      createdAt: now(),
      updatedAt: now()
    });
  }

  return {
    organizationId,
    studentId,
    instructorId,
    sessionId,
    membershipId,
    registrationId
  };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(offset, offset + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function cleanup() {
  for (const name of [
    'audit_logs',
    'financial_checkout_leases',
    'payment_transactions',
    'orders',
    'financial_recipient_accounts',
    'financial_rules',
    'exam_registrations',
    'exam_sessions',
    'vinculos_organizacao',
    'usuarios',
    'organizacoes'
  ]) {
    await deleteCollection(name);
  }
  await deleteApp(app);
}

async function main() {
  try {
    await seedDefaultRule();

    await test('aluno nao selecionado nao cria pedido belt_exam', async () => {
      const service = createFinancialBeltExamOrderService({ db, clock: () => now() });
      let error = null;
      try {
        await service.createPendingBeltExamOrder({
          buyerUserId: id('missing_student'),
          sessionId: id('missing_session'),
          idempotencyKey: 'intent-1'
        });
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof FinancialBeltExamOrderServiceError);
      assert.equal(error.code, 'BELT_EXAM_SESSION_NOT_FOUND');
    });

    const unbound = await seedCandidate({
      label: 'unbound',
      withTemplateBinding: false
    });

    await test(
      'sessao sem template oficial falha antes de criar order ou transaction',
      async () => {
        const service =
          createFinancialBeltExamOrderService({
            db,
            clock: () => now(1)
          });

        const idempotencyKey =
          'unbound-template-intent';

        let error = null;

        try {
          await service.createPendingBeltExamOrder({
            buyerUserId:
              unbound.studentId,
            sessionId:
              unbound.sessionId,
            idempotencyKey
          });
        } catch (caught) {
          error = caught;
        }

        assert.ok(
          error instanceof
            FinancialBeltExamOrderServiceError
        );

        assert.equal(
          error.code,
          'BELT_EXAM_TEMPLATE_REQUIRED'
        );

        const orderId =
          beltExamFinancialOrderDocumentId({
            buyerUserId:
              unbound.studentId,
            sessionId:
              unbound.sessionId,
            idempotencyKey
          });

        const transactionId =
          paymentTransactionId({
            provider: 'asaas',
            orderId
          });

        assert.equal(
          (
            await db.doc(
              `orders/${orderId}`
            ).get()
          ).exists,
          false
        );

        assert.equal(
          (
            await db.doc(
              `payment_transactions/${transactionId}`
            ).get()
          ).exists,
          false
        );

        const registration =
          (
            await db.doc(
              `exam_registrations/${unbound.registrationId}`
            ).get()
          ).data();

        assert.equal(
          registration.status,
          'selected'
        );

        assert.equal(
          registration.orderId,
          null
        );

        const session =
          (
            await db.doc(
              `exam_sessions/${unbound.sessionId}`
            ).get()
          ).data();

        assert.equal(
          session.status,
          'candidates_selected'
        );
      }
    );

    const candidate = await seedCandidate({ label: 'primary' });
    const orderService = createFinancialBeltExamOrderService({ db, clock: () => now(1) });
    const intent = 'checkout-intent-primary';

    let firstOrder;
    await test('selected cria order belt_exam e vincula registration atomicamente', async () => {
      firstOrder = await orderService.createPendingBeltExamOrder({
        buyerUserId: candidate.studentId,
        sessionId: candidate.sessionId,
        idempotencyKey: intent
      });
      assert.equal(firstOrder.created, true);
      assert.equal(firstOrder.order.productType, 'belt_exam');
      assert.equal(firstOrder.order.productId, candidate.sessionId);
      assert.equal(firstOrder.order.amountCents, 10000);
      assert.equal(firstOrder.order.financialSnapshot.platformFeeBps, 1000);
      assert.equal(firstOrder.order.financialSnapshot.platformFeeCents, 1000);
      assert.equal(firstOrder.registration.status, 'awaiting_payment');
      assert.equal(firstOrder.registration.orderId, firstOrder.orderId);
      const session = (await db.doc(`exam_sessions/${candidate.sessionId}`).get()).data();
      assert.equal(session.status, 'awaiting_payment');
    });

    await test('mesma idempotency key reutiliza um unico order', async () => {
      const again = await orderService.createPendingBeltExamOrder({
        buyerUserId: candidate.studentId,
        sessionId: candidate.sessionId,
        idempotencyKey: intent
      });
      assert.equal(again.created, false);
      assert.equal(again.orderId, firstOrder.orderId);
      const orders = await db.collection('orders')
        .where('buyerUserId', '==', candidate.studentId)
        .get();
      assert.equal(orders.size, 1);
    });

    await test('nova idempotency key nao cria cobranca concorrente', async () => {
      let error = null;
      try {
        await orderService.createPendingBeltExamOrder({
          buyerUserId: candidate.studentId,
          sessionId: candidate.sessionId,
          idempotencyKey: 'checkout-intent-conflict'
        });
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof FinancialBeltExamOrderServiceError);
      assert.equal(error.code, 'BELT_EXAM_ACTIVE_ORDER_CONFLICT');
    });

    await test('membership inativo bloqueia compra antes de criar order', async () => {
      const blocked = await seedCandidate({ label: 'blocked', membershipStatus: 'ended' });
      const service = createFinancialBeltExamOrderService({ db, clock: () => now(2) });
      let error = null;
      try {
        await service.createPendingBeltExamOrder({
          buyerUserId: blocked.studentId,
          sessionId: blocked.sessionId,
          idempotencyKey: 'blocked-intent'
        });
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof FinancialBeltExamOrderServiceError);
      assert.equal(error.code, 'BELT_EXAM_STUDENT_MEMBERSHIP_REQUIRED');
      const orderId = beltExamFinancialOrderDocumentId({
        buyerUserId: blocked.studentId,
        sessionId: blocked.sessionId,
        idempotencyKey: 'blocked-intent'
      });
      assert.equal((await db.doc(`orders/${orderId}`).get()).exists, false);
    });

    const preparedCandidate = await seedCandidate({ label: 'prepared' });
    const persistence = createFinancialBeltExamCheckoutPersistence({
      db,
      clock: () => now(3),
      tokenFactory: () => 'lease-token-fixed'
    });

    let prepared;
    await test('prepare checkout cria transaction e split para wallet da organizacao', async () => {
      prepared = await persistence.prepareBeltExamCheckout({
        buyerUserId: preparedCandidate.studentId,
        sessionId: preparedCandidate.sessionId,
        idempotencyKey: 'prepared-intent'
      });
      assert.equal(prepared.order.productType, 'belt_exam');
      assert.equal(prepared.transaction.orderId, prepared.orderId);
      assert.equal(prepared.transaction.status, 'created');
      assert.equal(prepared.transactionCreated, true);
      assert.equal(prepared.providerSplitSnapshot.length, 1);
      assert.equal(prepared.providerSplitSnapshot[0].recipientType, 'organization');
      assert.equal(prepared.providerSplitSnapshot[0].recipientId, preparedCandidate.organizationId);
      assert.equal(prepared.lease.acquired, true);
      assert.equal(prepared.lease.processing, false);
      assert.equal(
        prepared.transactionId,
        paymentTransactionId({ provider: 'asaas', orderId: prepared.orderId })
      );
    });

    await test('retry com lease ativa nao duplica transaction', async () => {
      const second = await persistence.prepareBeltExamCheckout({
        buyerUserId: preparedCandidate.studentId,
        sessionId: preparedCandidate.sessionId,
        idempotencyKey: 'prepared-intent'
      });
      assert.equal(second.orderId, prepared.orderId);
      assert.equal(second.transactionId, prepared.transactionId);
      assert.equal(second.transactionCreated, false);
      assert.equal(second.lease.acquired, false);
      assert.equal(second.lease.processing, true);
      const txs = await db.collection('payment_transactions')
        .where('orderId', '==', prepared.orderId)
        .get();
      assert.equal(txs.size, 1);
    });

    await test('wallet ausente falha seguro sem criar transaction', async () => {
      const noWallet = await seedCandidate({ label: 'no_wallet', withRecipientAccount: false });
      const isolated = createFinancialBeltExamCheckoutPersistence({
        db,
        clock: () => now(4),
        tokenFactory: () => 'lease-token-no-wallet'
      });
      let error = null;
      try {
        await isolated.prepareBeltExamCheckout({
          buyerUserId: noWallet.studentId,
          sessionId: noWallet.sessionId,
          idempotencyKey: 'no-wallet-intent'
        });
      } catch (caught) {
        error = caught;
      }
      assert.ok(error instanceof FinancialBeltExamCheckoutPersistenceError);
      assert.equal(error.code, 'BELT_EXAM_RECIPIENT_NOT_READY');
      const orderId = beltExamFinancialOrderDocumentId({
        buyerUserId: noWallet.studentId,
        sessionId: noWallet.sessionId,
        idempotencyKey: 'no-wallet-intent'
      });
      const txId = paymentTransactionId({ provider: 'asaas', orderId });
      assert.equal((await db.doc(`payment_transactions/${txId}`).get()).exists, false);
    });

    console.log(`BELT_EXAM_CHECKOUT_PERSISTENCE_EMULATOR_V1_2=${passed}/9`);
    if (passed !== 9) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
