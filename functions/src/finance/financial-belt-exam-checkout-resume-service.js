'use strict';

const {
  validateOrder
} = require('./financial-domain');
const {
  FinancialBeltExamOrderServiceError
} = require('./financial-belt-exam-order-service');
const {
  createFinancialBeltExamCheckoutService
} = require('./financial-belt-exam-checkout-service');
const {
  examRegistrationDocumentId,
  validateExamRegistration
} = require('../exams/exam-registration-domain');

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);
  if (!id || id.includes('/')) {
    throw new FinancialBeltExamOrderServiceError(
      'INVALID_BELT_EXAM_ORDER_IDENTITY',
      `${field} inválido.`
    );
  }
  return id;
}

function createFinancialBeltExamCheckoutResumeService(dependencies = {}) {
  const {
    db,
    provider,
    environment = 'sandbox',
    clock = () => new Date()
  } = dependencies;

  if (!db || typeof db.doc !== 'function') {
    throw new TypeError('Resume checkout de exame exige Firestore válido.');
  }

  const checkout = createFinancialBeltExamCheckoutService({
    db,
    provider,
    environment,
    clock
  });

  async function resumeBeltExamCheckout(input = {}) {
    const buyerUserId = requiredIdentifier(input.buyerUserId, 'buyerUserId');
    const sessionId = requiredIdentifier(input.sessionId, 'sessionId');
    const registrationId = examRegistrationDocumentId({
      sessionId,
      studentId: buyerUserId
    });

    const registrationSnap = await db.doc(`exam_registrations/${registrationId}`).get();
    if (!registrationSnap.exists) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_REGISTRATION_NOT_FOUND',
        'O aluno não possui registration canônica para esta sessão.'
      );
    }

    let registration;
    try {
      registration = validateExamRegistration(registrationSnap.data() || {});
    } catch (_error) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_REGISTRATION_INVALID',
        'Registration de exame persistida está inconsistente.'
      );
    }

    if (
      registration.studentId !== buyerUserId ||
      registration.sessionId !== sessionId ||
      registration.status !== 'awaiting_payment' ||
      !registration.orderId
    ) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_ORDER_NOT_RESUMABLE',
        'Não existe cobrança pendente retomável para esta registration.'
      );
    }

    const orderSnap = await db.doc(`orders/${registration.orderId}`).get();
    if (!orderSnap.exists) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_ORDER_NOT_RESUMABLE',
        'Pedido pendente vinculado à registration não foi encontrado.'
      );
    }

    let order;
    try {
      order = validateOrder(orderSnap.data() || {});
    } catch (_error) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_ORDER_NOT_RESUMABLE',
        'Pedido pendente vinculado à registration está inconsistente.'
      );
    }

    const idempotencyKey = text(order.idempotencyKey, 200);
    if (
      order.buyerUserId !== buyerUserId ||
      order.productType !== 'belt_exam' ||
      order.productId !== sessionId ||
      order.status !== 'pending_payment' ||
      !idempotencyKey
    ) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_ORDER_NOT_RESUMABLE',
        'Pedido pendente não corresponde ao exame autenticado.'
      );
    }

    return checkout.startBeltExamCheckout({
      buyerUserId,
      sessionId,
      idempotencyKey
    });
  }

  return Object.freeze({
    resumeBeltExamCheckout
  });
}

module.exports = {
  createFinancialBeltExamCheckoutResumeService
};
