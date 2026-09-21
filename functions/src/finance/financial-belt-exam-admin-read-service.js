'use strict';

const {
  FinancialAdminDomainError,
  assertCanAdministerFinancialRules
} = require('./financial-admin-domain');
const {
  FinancialPurchaseReadDomainError
} = require('./financial-purchase-read-domain');
const {
  FinancialPurchaseReadServiceError,
  requiredIdentifier,
  pageSize,
  selectRelevantReversal,
  sanitizeBuyer
} = require('./financial-purchase-read-service');
const {
  REVERSAL_REQUESTS_COLLECTION,
  reversalRequestId
} = require('./financial-reversal-admin-service');
const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  validateExamRegistration
} = require('../exams/exam-registration-domain');
const {
  buildAdminBeltExamOperationView
} = require('./financial-belt-exam-admin-read-domain');

function sanitizeExamSession(sessionId, input = {}) {
  const targetBelt = String(input.targetBelt || '').trim() || null;

  return {
    sessionId,
    targetBelt,
    scheduledAt: input.scheduledAt ?? null
  };
}

function registrationForAdminOrder(
  registrationEntry,
  orderId,
  { sessionId, userId } = {}
) {
  if (!registrationEntry?.data) return null;

  let registration;
  try {
    registration = validateExamRegistration(registrationEntry.data);
  } catch (error) {
    if (error instanceof ExamRegistrationDomainError) {
      throw new FinancialPurchaseReadServiceError(
        'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
        'Registration canônica inconsistente na visão administrativa.'
      );
    }
    throw error;
  }

  if (
    registration.sessionId !== sessionId ||
    registration.studentId !== userId
  ) {
    throw new FinancialPurchaseReadServiceError(
      'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
      'Registration administrativa não corresponde ao pedido do exame.'
    );
  }

  // Existe apenas uma registration canônica por sessão/aluno.
  // Em uma nova tentativa financeira, ela pode apontar para outro pedido.
  // Nesse caso o pedido histórico não deve herdar o estado da nova tentativa.
  if (
    registration.orderId &&
    registration.orderId !== orderId
  ) {
    return null;
  }

  return registrationEntry.data;
}

function createFinancialBeltExamAdminReadService(dependencies = {}) {
  const { db } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.getAll !== 'function'
  ) {
    throw new TypeError(
      'Belt exam admin read service exige Firestore válido.'
    );
  }

  async function listAdminBeltExamPurchases(input = {}) {
    let role;
    try {
      role = assertCanAdministerFinancialRules(input.claims || {});
    } catch (error) {
      if (error instanceof FinancialAdminDomainError) {
        throw new FinancialPurchaseReadServiceError(
          error.code,
          error.message
        );
      }
      throw error;
    }

    const limit = pageSize(input.limit);

    const orderSnap = await db
      .collection('orders')
      .where('productType', '==', 'belt_exam')
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    if (orderSnap.empty) {
      return Object.freeze({
        role,
        limit,
        items: Object.freeze([])
      });
    }

    const orders = orderSnap.docs.map(doc => ({
      id: doc.id,
      data: doc.data() || {}
    }));

    const refsByPath = new Map();

    function addRef(ref) {
      if (!refsByPath.has(ref.path)) {
        refsByPath.set(ref.path, ref);
      }
    }

    for (const entry of orders) {
      const rawOrder = entry.data;

      const sessionId = requiredIdentifier(
        rawOrder.productId,
        'order.productId'
      );
      const userId = requiredIdentifier(
        rawOrder.buyerUserId,
        'order.buyerUserId'
      );

      addRef(db.doc(`exam_sessions/${sessionId}`));
      addRef(db.doc(`usuarios/${userId}`));

      const registrationId = examRegistrationDocumentId({
        sessionId,
        studentId: userId
      });

      addRef(db.doc(`exam_registrations/${registrationId}`));

      if (rawOrder.currentTransactionId) {
        const transactionId = requiredIdentifier(
          rawOrder.currentTransactionId,
          'currentTransactionId'
        );

        addRef(db.doc(`payment_transactions/${transactionId}`));

        for (const operation of ['cancel_pending', 'refund_full']) {
          const requestId = reversalRequestId({
            operation,
            transactionId
          });

          addRef(
            db.doc(
              `${REVERSAL_REQUESTS_COLLECTION}/${requestId}`
            )
          );
        }
      }
    }

    const refs = [...refsByPath.values()];
    const snapshots = refs.length
      ? await db.getAll(...refs)
      : [];

    const byPath = new Map(
      snapshots.map(snap => [
        snap.ref.path,
        snap.exists
          ? { id: snap.id, data: snap.data() || {} }
          : null
      ])
    );

    const items = [];

    for (const entry of orders) {
      const rawOrder = entry.data;

      const sessionId = requiredIdentifier(
        rawOrder.productId,
        'order.productId'
      );
      const userId = requiredIdentifier(
        rawOrder.buyerUserId,
        'order.buyerUserId'
      );
      const transactionId = rawOrder.currentTransactionId
        ? requiredIdentifier(
            rawOrder.currentTransactionId,
            'currentTransactionId'
          )
        : null;

      const sessionEntry =
        byPath.get(`exam_sessions/${sessionId}`) || null;

      const buyerEntry =
        byPath.get(`usuarios/${userId}`) || null;

      const registrationId = examRegistrationDocumentId({
        sessionId,
        studentId: userId
      });

      const registrationEntry =
        byPath.get(`exam_registrations/${registrationId}`) || null;

      const registration = registrationForAdminOrder(
        registrationEntry,
        entry.id,
        { sessionId, userId }
      );

      const transactionEntry = transactionId
        ? byPath.get(
            `payment_transactions/${transactionId}`
          ) || null
        : null;

      const reversalEntries = [];

      if (transactionId) {
        for (const operation of ['cancel_pending', 'refund_full']) {
          const requestId = reversalRequestId({
            operation,
            transactionId
          });

          const reversalEntry = byPath.get(
            `${REVERSAL_REQUESTS_COLLECTION}/${requestId}`
          );

          if (reversalEntry) {
            reversalEntries.push(reversalEntry);
          }
        }
      }

      const reversalEntry =
        selectRelevantReversal(reversalEntries);

      let baseView;

      try {
        baseView = buildAdminBeltExamOperationView({
          orderId: entry.id,
          order: rawOrder,
          transactionId,
          transaction: transactionEntry?.data || null,
          registration,
          reversalRequestId: reversalEntry?.id || null,
          reversalRequest: reversalEntry?.data || null
        });
      } catch (error) {
        if (error instanceof FinancialPurchaseReadDomainError) {
          throw new FinancialPurchaseReadServiceError(
            'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
            `Pedido ${entry.id} possui estado canônico de exame inconsistente.`
          );
        }
        throw error;
      }

      const exam = Object.freeze(
        sanitizeExamSession(
          sessionId,
          sessionEntry?.data || {}
        )
      );

      const buyer = Object.freeze(
        sanitizeBuyer(
          userId,
          buyerEntry?.data || {}
        )
      );

      const label = exam.targetBelt
        ? `Exame oficial - Faixa ${exam.targetBelt}`
        : 'Exame oficial de faixa';

      items.push(
        Object.freeze({
          ...baseView,
          product: Object.freeze({
            productType: 'belt_exam',
            productId: sessionId,
            label
          }),
          exam,
          course: null,
          buyer,
          lifecycleKind: 'exam_registration',
          lifecycleStatus: baseView.registrationStatus
        })
      );
    }

    return Object.freeze({
      role,
      limit,
      items: Object.freeze(items)
    });
  }

  return Object.freeze({
    listAdminBeltExamPurchases
  });
}

module.exports = {
  sanitizeExamSession,
  registrationForAdminOrder,
  createFinancialBeltExamAdminReadService
};