'use strict';

const {
  enrollmentDocumentId,
  validateEnrollment
} = require('../courses/course-enrollment-domain');
const {
  validateFinancialPair,
  entitlementFromEnrollment
} = require('./financial-purchase-read-domain');
const {
  FinancialPurchaseReadServiceError,
  requiredIdentifier
} = require('./financial-purchase-read-service');

const DEFAULT_STUDENT_HISTORY_LIMIT = 25;
const MAX_STUDENT_HISTORY_LIMIT = 50;

function studentHistoryLimit(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_STUDENT_HISTORY_LIMIT;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_STUDENT_HISTORY_LIMIT) {
    throw new FinancialPurchaseReadServiceError(
      'INVALID_PURCHASE_STUDENT_LIMIT',
      `limit precisa ser inteiro entre 1 e ${MAX_STUDENT_HISTORY_LIMIT}.`
    );
  }
  return parsed;
}

function studentPurchaseState({ orderStatus, enrollment = null } = {}) {
  const entitled = entitlementFromEnrollment(enrollment);

  switch (orderStatus) {
    case 'pending_payment':
      return {
        purchaseState: 'payment_pending',
        entitled: false,
        canOpenCourse: false,
        canResumeCheckout: true,
        canStartCheckout: false,
        requiresOperationalReview: false
      };
    case 'paid':
      return {
        purchaseState: entitled
          ? 'paid_entitled'
          : 'payment_confirmed_access_pending',
        entitled,
        canOpenCourse: entitled,
        canResumeCheckout: false,
        canStartCheckout: false,
        requiresOperationalReview: !entitled
      };
    case 'refunded':
      return {
        purchaseState: 'refunded',
        entitled: false,
        canOpenCourse: false,
        canResumeCheckout: false,
        canStartCheckout: true,
        requiresOperationalReview: false
      };
    case 'chargeback':
      return {
        purchaseState: 'chargeback',
        entitled: false,
        canOpenCourse: false,
        canResumeCheckout: false,
        canStartCheckout: false,
        requiresOperationalReview: false
      };
    case 'cancelled':
    case 'expired':
      return {
        purchaseState: 'cancelled_or_expired',
        entitled: false,
        canOpenCourse: false,
        canResumeCheckout: false,
        canStartCheckout: true,
        requiresOperationalReview: false
      };
    default:
      throw new FinancialPurchaseReadServiceError(
        'PURCHASE_STATE_UNSUPPORTED',
        'Estado financeiro não suportado no histórico do aluno.'
      );
  }
}

function matchingEnrollment(rawEntry, { orderId, courseId, userId } = {}) {
  if (!rawEntry?.data) return null;

  let enrollment;
  try {
    enrollment = validateEnrollment(rawEntry.data);
  } catch (_error) {
    throw new FinancialPurchaseReadServiceError(
      'PURCHASE_ENROLLMENT_INVALID',
      'A matrícula canônica está inconsistente.'
    );
  }

  if (enrollment.courseId !== courseId || enrollment.userId !== userId) {
    throw new FinancialPurchaseReadServiceError(
      'PURCHASE_ENROLLMENT_IDENTITY_MISMATCH',
      'A matrícula não corresponde ao comprador e curso consultados.'
    );
  }

  if (enrollment.source === 'order' && enrollment.orderId !== orderId) {
    return null;
  }

  return enrollment;
}

function sanitizeCourse(courseId, input = {}) {
  return Object.freeze({
    courseId,
    title: input.title || 'Curso'
  });
}

function createFinancialStudentPurchaseHistoryService(dependencies = {}) {
  const { db } = dependencies;

  if (
    !db ||
    typeof db.collection !== 'function' ||
    typeof db.doc !== 'function' ||
    typeof db.getAll !== 'function'
  ) {
    throw new TypeError('Student purchase history exige Firestore válido.');
  }

  async function listStudentCoursePurchases(input = {}) {
    const userId = requiredIdentifier(input.userId, 'userId');
    const limit = studentHistoryLimit(input.limit);

    const orderSnap = await db
      .collection('orders')
      .where('buyerUserId', '==', userId)
      .where('productType', '==', 'course')
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    if (orderSnap.empty) {
      return Object.freeze({ limit, items: Object.freeze([]) });
    }

    const orders = orderSnap.docs.map(doc => ({
      id: doc.id,
      data: doc.data() || {}
    }));

    const refs = [];
    for (const entry of orders) {
      const order = entry.data;
      const courseId = requiredIdentifier(order.productId, 'order.productId');
      refs.push(db.doc(`courses/${courseId}`));
      refs.push(db.doc(`enrollments/${enrollmentDocumentId(courseId, userId)}`));
      if (order.currentTransactionId) {
        refs.push(
          db.doc(
            `payment_transactions/${requiredIdentifier(
              order.currentTransactionId,
              'currentTransactionId'
            )}`
          )
        );
      }
    }

    const uniqueRefs = [...new Map(refs.map(ref => [ref.path, ref])).values()];
    const snapshots = uniqueRefs.length ? await db.getAll(...uniqueRefs) : [];
    const byPath = new Map(
      snapshots.map(snap => [
        snap.ref.path,
        snap.exists ? { id: snap.id, data: snap.data() || {} } : null
      ])
    );

    const items = [];
    for (const entry of orders) {
      const rawOrder = entry.data;
      const courseId = requiredIdentifier(rawOrder.productId, 'order.productId');
      const transactionId = rawOrder.currentTransactionId
        ? requiredIdentifier(rawOrder.currentTransactionId, 'currentTransactionId')
        : null;
      const transactionEntry = transactionId
        ? byPath.get(`payment_transactions/${transactionId}`) || null
        : null;

      let canonical;
      try {
        canonical = validateFinancialPair({
          orderId: entry.id,
          order: rawOrder,
          transactionId,
          transaction: transactionEntry?.data || null,
          userId,
          courseId
        });
      } catch (error) {
        throw new FinancialPurchaseReadServiceError(
          error.code || 'PURCHASE_STUDENT_HISTORY_CANONICAL_STATE_INVALID',
          'Uma compra do aluno possui estado canônico inconsistente.'
        );
      }

      const enrollmentPath = `enrollments/${enrollmentDocumentId(courseId, userId)}`;
      const enrollmentEntry = byPath.get(enrollmentPath) || null;
      const enrollment = matchingEnrollment(enrollmentEntry, {
        orderId: entry.id,
        courseId,
        userId
      });
      const state = studentPurchaseState({
        orderStatus: canonical.order.status,
        enrollment
      });
      const courseEntry = byPath.get(`courses/${courseId}`) || null;

      items.push(Object.freeze({
        course: sanitizeCourse(courseId, courseEntry?.data || {}),
        purchaseState: state.purchaseState,
        orderStatus: canonical.order.status,
        transactionStatus: canonical.transaction?.status || null,
        enrollmentStatus: enrollment?.status || null,
        entitled: state.entitled,
        canOpenCourse: state.canOpenCourse,
        canResumeCheckout: state.canResumeCheckout,
        canStartCheckout: state.canStartCheckout,
        requiresOperationalReview: state.requiresOperationalReview,
        amountCents: canonical.order.amountCents,
        currency: canonical.order.currency,
        createdAt: canonical.order.createdAt,
        updatedAt: canonical.order.updatedAt,
        paidAt: canonical.order.paidAt,
        refundedAt: canonical.order.refundedAt,
        chargebackAt: canonical.order.chargebackAt
      }));
    }

    return Object.freeze({
      limit,
      items: Object.freeze(items)
    });
  }

  return Object.freeze({ listStudentCoursePurchases });
}

module.exports = {
  DEFAULT_STUDENT_HISTORY_LIMIT,
  MAX_STUDENT_HISTORY_LIMIT,
  studentHistoryLimit,
  studentPurchaseState,
  matchingEnrollment,
  sanitizeCourse,
  createFinancialStudentPurchaseHistoryService
};
