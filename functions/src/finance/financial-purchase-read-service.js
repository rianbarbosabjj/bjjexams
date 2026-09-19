'use strict';

const {
  FinancialAdminDomainError,
  assertCanAdministerFinancialRules
} = require('./financial-admin-domain');
const {
  REVERSAL_REQUESTS_COLLECTION,
  reversalRequestId
} = require('./financial-reversal-admin-service');
const {
  FinancialPurchaseReadDomainError,
  resolveStudentPurchaseState,
  buildAdminPurchaseView
} = require('./financial-purchase-read-domain');
const {
  enrollmentDocumentId,
  validateEnrollment
} = require('../courses/course-enrollment-domain');

const MAX_STUDENT_ORDER_CANDIDATES = 20;
const DEFAULT_ADMIN_PAGE_SIZE = 25;
const MAX_ADMIN_PAGE_SIZE = 50;

class FinancialPurchaseReadServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialPurchaseReadServiceError';
    this.code = code;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialPurchaseReadServiceError(
      'INVALID_PURCHASE_READ_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function pageSize(value) {
  if (value === undefined || value === null || value === '') {
    return DEFAULT_ADMIN_PAGE_SIZE;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_ADMIN_PAGE_SIZE) {
    throw new FinancialPurchaseReadServiceError(
      'INVALID_PURCHASE_ADMIN_LIMIT',
      `limit precisa ser inteiro entre 1 e ${MAX_ADMIN_PAGE_SIZE}.`
    );
  }
  return parsed;
}

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis();
  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function newestDocument(entries = []) {
  return [...entries].sort((left, right) => {
    const rightTime = toMillis(right.data?.updatedAt || right.data?.createdAt);
    const leftTime = toMillis(left.data?.updatedAt || left.data?.createdAt);
    if (rightTime !== leftTime) return rightTime - leftTime;
    return String(right.id).localeCompare(String(left.id));
  })[0] || null;
}

function reversalPriority(request = {}) {
  const status = String(request.status || '').trim().toLowerCase();
  if (status === 'needs_reconciliation') return 5;
  if (status === 'executing' || status === 'awaiting_webhook') return 4;
  if (status === 'completed') return 3;
  if (status === 'provider_rejected') return 2;
  return 0;
}

function selectRelevantReversal(entries = []) {
  return [...entries]
    .filter(entry => entry && entry.data)
    .sort((left, right) => {
      const priorityDiff = reversalPriority(right.data) - reversalPriority(left.data);
      if (priorityDiff !== 0) return priorityDiff;
      const timeDiff =
        toMillis(right.data.updatedAt || right.data.createdAt) -
        toMillis(left.data.updatedAt || left.data.createdAt);
      if (timeDiff !== 0) return timeDiff;
      return String(right.id).localeCompare(String(left.id));
    })[0] || null;
}

function sanitizeBuyer(userId, input = {}) {
  return {
    userId,
    name: input.nome || input.name || null,
    email: input.email || null
  };
}

function sanitizeCourse(courseId, input = {}) {
  return {
    courseId,
    title: input.title || null
  };
}

function enrollmentForAdminOrder(enrollmentEntry, orderId) {
  if (!enrollmentEntry?.data) return null;

  let enrollment;
  try {
    enrollment = validateEnrollment(enrollmentEntry.data);
  } catch (_error) {
    throw new FinancialPurchaseReadServiceError(
      'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
      'Enrollment canônico inconsistente na visão administrativa.'
    );
  }

  // Existe apenas um enrollment canônico por curso/usuário. Em recompra,
  // esse documento pode continuar apontando para um pedido histórico enquanto
  // um novo pedido pending já existe. A view administrativa de cada pedido
  // só deve anexar enrollment originado daquele próprio pedido; mismatch
  // histórico é ausência de enrollment para a linha, não corrupção do pedido.
  if (enrollment.source === 'order' && enrollment.orderId !== orderId) {
    return null;
  }

  return enrollmentEntry.data;
}

function createFinancialPurchaseReadService(dependencies = {}) {
  const { db } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.getAll !== 'function'
  ) {
    throw new TypeError('Purchase read service exige Firestore válido.');
  }

  async function loadEnrollment(courseId, userId) {
    const enrollmentId = enrollmentDocumentId(courseId, userId);
    const snap = await db.doc(`enrollments/${enrollmentId}`).get();
    return snap.exists
      ? { id: snap.id, data: snap.data() || {} }
      : null;
  }

  async function latestOrderForCourse(userId, courseId) {
    const snap = await db
      .collection('orders')
      .where('buyerUserId', '==', userId)
      .where('productType', '==', 'course')
      .where('productId', '==', courseId)
      .orderBy('createdAt', 'desc')
      .limit(MAX_STUDENT_ORDER_CANDIDATES)
      .get();

    if (snap.empty) return null;
    return newestDocument(
      snap.docs.map(doc => ({ id: doc.id, data: doc.data() || {} }))
    );
  }

  async function orderForStudentPurchase({ userId, courseId, enrollmentEntry }) {
    if (enrollmentEntry) {
      let enrollment;
      try {
        enrollment = validateEnrollment(enrollmentEntry.data || {});
      } catch (_error) {
        throw new FinancialPurchaseReadServiceError(
          'PURCHASE_ENROLLMENT_INVALID',
          'A matrícula canônica está inconsistente.'
        );
      }

      if (
        ['active', 'completed'].includes(enrollment.status) &&
        enrollment.source !== 'order'
      ) {
        return { orderEntry: null, enrollment: enrollmentEntry.data };
      }

      if (
        ['active', 'completed'].includes(enrollment.status) &&
        enrollment.source === 'order'
      ) {
        const orderId = requiredIdentifier(enrollment.orderId, 'enrollment.orderId');
        const orderSnap = await db.doc(`orders/${orderId}`).get();
        if (!orderSnap.exists) {
          throw new FinancialPurchaseReadServiceError(
            'PURCHASE_ORDER_REQUIRED_FOR_ENTITLEMENT',
            'Matrícula paga ativa aponta para pedido inexistente.'
          );
        }
        return {
          orderEntry: { id: orderSnap.id, data: orderSnap.data() || {} },
          enrollment: enrollmentEntry.data
        };
      }
    }

    const latest = await latestOrderForCourse(userId, courseId);
    if (!latest) {
      return {
        orderEntry: null,
        enrollment: enrollmentEntry?.data || null
      };
    }

    let enrollmentForOrder = enrollmentEntry?.data || null;
    if (enrollmentForOrder) {
      let normalized;
      try {
        normalized = validateEnrollment(enrollmentForOrder);
      } catch (_error) {
        throw new FinancialPurchaseReadServiceError(
          'PURCHASE_ENROLLMENT_INVALID',
          'A matrícula canônica está inconsistente.'
        );
      }
      if (
        normalized.source === 'order' &&
        normalized.orderId !== latest.id &&
        !['active', 'completed'].includes(normalized.status)
      ) {
        enrollmentForOrder = null;
      }
    }

    return { orderEntry: latest, enrollment: enrollmentForOrder };
  }

  async function getStudentCoursePurchase(input = {}) {
    const userId = requiredIdentifier(input.userId, 'userId');
    const courseId = requiredIdentifier(input.courseId, 'courseId');

    const [courseSnap, enrollmentEntry] = await Promise.all([
      db.doc(`courses/${courseId}`).get(),
      loadEnrollment(courseId, userId)
    ]);

    if (!courseSnap.exists) {
      throw new FinancialPurchaseReadServiceError(
        'PURCHASE_COURSE_NOT_FOUND',
        'Curso não encontrado.'
      );
    }

    const course = courseSnap.data() || {};
    const selected = await orderForStudentPurchase({
      userId,
      courseId,
      enrollmentEntry
    });

    let transactionEntry = null;
    if (selected.orderEntry?.data?.currentTransactionId) {
      const transactionId = requiredIdentifier(
        selected.orderEntry.data.currentTransactionId,
        'currentTransactionId'
      );
      const transactionSnap = await db
        .doc(`payment_transactions/${transactionId}`)
        .get();
      transactionEntry = transactionSnap.exists
        ? { id: transactionSnap.id, data: transactionSnap.data() || {} }
        : { id: transactionId, data: null };
    }

    let view;
    try {
      view = resolveStudentPurchaseState({
        courseId,
        userId,
        course,
        orderId: selected.orderEntry?.id || null,
        order: selected.orderEntry?.data || null,
        transactionId: transactionEntry?.id || null,
        transaction: transactionEntry?.data || null,
        enrollment: selected.enrollment || null
      });
    } catch (error) {
      if (error instanceof FinancialPurchaseReadDomainError) {
        throw new FinancialPurchaseReadServiceError(error.code, error.message);
      }
      throw error;
    }

    const transaction = transactionEntry?.data || null;
    const paymentPending = view.purchaseState === 'payment_pending';

    return Object.freeze({
      ...view,
      course: Object.freeze({
        courseId,
        title: course.title || null
      }),
      payment: paymentPending
        ? Object.freeze({
            method: 'PIX',
            ready: Boolean(transaction?.providerPaymentId)
          })
        : null,
      canResumeCheckout: paymentPending
    });
  }

  async function listAdminCoursePurchases(input = {}) {
    let role;
    try {
      role = assertCanAdministerFinancialRules(input.claims || {});
    } catch (error) {
      if (error instanceof FinancialAdminDomainError) {
        throw new FinancialPurchaseReadServiceError(error.code, error.message);
      }
      throw error;
    }

    const limit = pageSize(input.limit);
    const orderSnap = await db
      .collection('orders')
      .where('productType', '==', 'course')
      .orderBy('updatedAt', 'desc')
      .limit(limit)
      .get();

    if (orderSnap.empty) {
      return Object.freeze({ role, limit, items: Object.freeze([]) });
    }

    const orders = orderSnap.docs.map(doc => ({
      id: doc.id,
      data: doc.data() || {}
    }));

    const refs = [];
    for (const entry of orders) {
      const order = entry.data;
      refs.push(db.doc(`courses/${requiredIdentifier(order.productId, 'order.productId')}`));
      refs.push(db.doc(`usuarios/${requiredIdentifier(order.buyerUserId, 'order.buyerUserId')}`));
      refs.push(db.doc(`enrollments/${enrollmentDocumentId(order.productId, order.buyerUserId)}`));
      if (order.currentTransactionId) {
        const txId = requiredIdentifier(order.currentTransactionId, 'currentTransactionId');
        refs.push(db.doc(`payment_transactions/${txId}`));
        for (const operation of ['cancel_pending', 'refund_full']) {
          const requestId = reversalRequestId({ operation, transactionId: txId });
          refs.push(db.doc(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`));
        }
      }
    }

    const snapshots = refs.length ? await db.getAll(...refs) : [];
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
      const userId = requiredIdentifier(rawOrder.buyerUserId, 'order.buyerUserId');
      const transactionId = rawOrder.currentTransactionId
        ? requiredIdentifier(rawOrder.currentTransactionId, 'currentTransactionId')
        : null;

      const courseEntry = byPath.get(`courses/${courseId}`) || null;
      const buyerEntry = byPath.get(`usuarios/${userId}`) || null;
      const enrollmentId = enrollmentDocumentId(courseId, userId);
      const rawEnrollmentEntry = byPath.get(`enrollments/${enrollmentId}`) || null;
      const enrollment = enrollmentForAdminOrder(rawEnrollmentEntry, entry.id);
      const transactionEntry = transactionId
        ? byPath.get(`payment_transactions/${transactionId}`) || null
        : null;

      const reversalEntries = [];
      if (transactionId) {
        for (const operation of ['cancel_pending', 'refund_full']) {
          const requestId = reversalRequestId({ operation, transactionId });
          const reversalEntry = byPath.get(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`);
          if (reversalEntry) reversalEntries.push(reversalEntry);
        }
      }
      const reversalEntry = selectRelevantReversal(reversalEntries);

      let baseView;
      try {
        baseView = buildAdminPurchaseView({
          orderId: entry.id,
          order: rawOrder,
          transactionId,
          transaction: transactionEntry?.data || null,
          enrollment,
          reversalRequestId: reversalEntry?.id || null,
          reversalRequest: reversalEntry?.data || null
        });
      } catch (error) {
        if (error instanceof FinancialPurchaseReadDomainError) {
          throw new FinancialPurchaseReadServiceError(
            'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
            `Pedido ${entry.id} possui estado canônico inconsistente.`
          );
        }
        throw error;
      }

      items.push(Object.freeze({
        ...baseView,
        course: Object.freeze(sanitizeCourse(courseId, courseEntry?.data || {})),
        buyer: Object.freeze(sanitizeBuyer(userId, buyerEntry?.data || {}))
      }));
    }

    return Object.freeze({
      role,
      limit,
      items: Object.freeze(items)
    });
  }

  return Object.freeze({
    getStudentCoursePurchase,
    listAdminCoursePurchases
  });
}

module.exports = {
  MAX_STUDENT_ORDER_CANDIDATES,
  DEFAULT_ADMIN_PAGE_SIZE,
  MAX_ADMIN_PAGE_SIZE,
  FinancialPurchaseReadServiceError,
  requiredIdentifier,
  pageSize,
  newestDocument,
  selectRelevantReversal,
  sanitizeBuyer,
  sanitizeCourse,
  enrollmentForAdminOrder,
  createFinancialPurchaseReadService
};