'use strict';

const {
  FinancialDomainError,
  validateOrder,
  validateTransaction,
  assertOrderStatusTransition,
  assertTransactionStatusTransition
} = require('./financial-domain');
const {
  paymentExternalReference
} = require('./asaas-checkout-adapter');
const {
  paymentTransactionId
} = require('./financial-checkout-persistence');
const {
  normalizeProviderPayment
} = require('./financial-checkout-provider-state');
const {
  CourseEnrollmentDomainError,
  enrollmentDocumentId,
  validateEnrollment
} = require('../courses/course-enrollment-domain');

const CONFIRMED_PROVIDER_STATUSES = Object.freeze([
  'CONFIRMED',
  'RECEIVED'
]);

class FinancialWebhookFulfillmentError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'FinancialWebhookFulfillmentError';
    this.code = code;
    this.retryable = retryable === true;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialWebhookFulfillmentError(
      'INVALID_FULFILLMENT_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requireDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new FinancialWebhookFulfillmentError(
      'INVALID_FULFILLMENT_TIMESTAMP',
      `${field} inválido.`
    );
  }
  return date;
}

function orderIdFromPaymentExternalReference(value) {
  const reference = String(value || '').trim();
  const prefix = 'BJJEX-V12-ORDER-';
  if (!reference.startsWith(prefix)) {
    throw new FinancialWebhookFulfillmentError(
      'INVALID_PAYMENT_EXTERNAL_REFERENCE',
      'externalReference da cobrança não pertence ao contrato BJJ Exams v1.2.'
    );
  }
  const orderId = reference.slice(prefix.length);
  requiredIdentifier(orderId, 'orderId');
  if (paymentExternalReference(orderId) !== reference) {
    throw new FinancialWebhookFulfillmentError(
      'INVALID_PAYMENT_EXTERNAL_REFERENCE',
      'externalReference da cobrança não é canônica.'
    );
  }
  return orderId;
}

function normalizeFulfillmentProviderPayment(input = {}) {
  let base;
  try {
    base = normalizeProviderPayment(input);
  } catch (error) {
    throw new FinancialWebhookFulfillmentError(
      'INVALID_PROVIDER_PAYMENT',
      'Cobrança atual do Asaas possui formato incompatível.'
    );
  }

  const billingType = String(input.billingType || '').trim().toUpperCase();
  if (!billingType) {
    throw new FinancialWebhookFulfillmentError(
      'PROVIDER_BILLING_TYPE_REQUIRED',
      'Cobrança atual do Asaas não informou billingType.'
    );
  }

  return {
    ...base,
    billingType
  };
}

function assertProviderPaymentConfirmed(payment = {}) {
  if (!CONFIRMED_PROVIDER_STATUSES.includes(payment.status)) {
    throw new FinancialWebhookFulfillmentError(
      'PROVIDER_PAYMENT_NOT_CONFIRMED',
      'Cobrança ainda não está CONFIRMED/RECEIVED no Asaas.',
      { retryable: true }
    );
  }
  if (payment.billingType !== 'PIX') {
    throw new FinancialWebhookFulfillmentError(
      'PROVIDER_PAYMENT_NOT_PIX',
      'Marco 5.4 course-first aceita somente cobrança PIX.'
    );
  }
  return true;
}

function buildOrderEnrollment({
  courseId,
  userId,
  orderId,
  createdAt
} = {}) {
  try {
    return validateEnrollment({
      courseId,
      userId,
      source: 'order',
      orderId,
      status: 'active',
      progressPercent: 0,
      startedAt: createdAt,
      completedAt: null,
      createdAt,
      updatedAt: createdAt
    });
  } catch (error) {
    if (error instanceof CourseEnrollmentDomainError) {
      throw new FinancialWebhookFulfillmentError(
        'INVALID_ORDER_ENROLLMENT',
        'Não foi possível construir a matrícula canônica do pedido.'
      );
    }
    throw error;
  }
}

function validateStoredEnrollment(input = {}, expected = {}) {
  let enrollment;
  try {
    enrollment = validateEnrollment(input);
  } catch (error) {
    throw new FinancialWebhookFulfillmentError(
      'EXISTING_ENROLLMENT_INVALID',
      'Matrícula existente está inconsistente.'
    );
  }

  if (
    enrollment.courseId !== expected.courseId ||
    enrollment.userId !== expected.userId ||
    enrollment.source !== 'order' ||
    enrollment.orderId !== expected.orderId ||
    !['active', 'completed'].includes(enrollment.status)
  ) {
    throw new FinancialWebhookFulfillmentError(
      'EXISTING_ENROLLMENT_CONFLICT',
      'Matrícula existente conflita com o fulfillment financeiro.'
    );
  }

  return enrollment;
}

function validateCanonicalFinancialState({
  orderId,
  transactionId,
  orderInput,
  transactionInput,
  event,
  providerPayment
} = {}) {
  let order;
  let transaction;
  try {
    order = validateOrder(orderInput || {});
    transaction = validateTransaction(transactionInput || {});
  } catch (error) {
    if (error instanceof FinancialDomainError) {
      throw new FinancialWebhookFulfillmentError(
        'INVALID_CANONICAL_FINANCIAL_STATE',
        'Pedido/transação persistidos estão inconsistentes.'
      );
    }
    throw error;
  }

  if (order.productType !== 'course') {
    throw new FinancialWebhookFulfillmentError(
      'FULFILLMENT_PRODUCT_NOT_COURSE',
      'Marco 5.4 atual processa somente pedidos de curso.'
    );
  }

  if (
    order.currentTransactionId !== transactionId ||
    transaction.orderId !== orderId ||
    order.buyerUserId !== transaction.buyerUserId ||
    order.provider !== 'asaas' ||
    transaction.provider !== 'asaas'
  ) {
    throw new FinancialWebhookFulfillmentError(
      'CANONICAL_PAYMENT_IDENTITY_MISMATCH',
      'Pedido e transação não correspondem entre si.'
    );
  }

  if (
    transaction.providerPaymentId !== providerPayment.id ||
    event.providerPaymentId !== providerPayment.id
  ) {
    throw new FinancialWebhookFulfillmentError(
      'PROVIDER_PAYMENT_ID_MISMATCH',
      'Evento/transação não correspondem à cobrança atual do Asaas.'
    );
  }

  const expectedReference = paymentExternalReference(orderId);
  if (
    event.externalReference !== expectedReference ||
    providerPayment.externalReference !== expectedReference
  ) {
    throw new FinancialWebhookFulfillmentError(
      'PROVIDER_EXTERNAL_REFERENCE_MISMATCH',
      'Referência da cobrança diverge do pedido canônico.'
    );
  }

  if (
    !order.providerCustomerId ||
    event.providerCustomerId !== order.providerCustomerId ||
    providerPayment.customer !== order.providerCustomerId
  ) {
    throw new FinancialWebhookFulfillmentError(
      'PROVIDER_CUSTOMER_MISMATCH',
      'Customer da cobrança diverge do pedido canônico.'
    );
  }

  if (
    !Number.isSafeInteger(event.valueCents) ||
    event.valueCents <= 0 ||
    event.valueCents !== order.amountCents ||
    providerPayment.valueCents !== order.amountCents ||
    transaction.amountCents !== order.amountCents ||
    transaction.currency !== order.currency ||
    order.currency !== 'BRL'
  ) {
    throw new FinancialWebhookFulfillmentError(
      'PROVIDER_PAYMENT_VALUE_MISMATCH',
      'Valor/moeda da cobrança divergem do estado canônico.'
    );
  }

  if (event.billingType !== 'PIX' || providerPayment.billingType !== 'PIX') {
    throw new FinancialWebhookFulfillmentError(
      'PROVIDER_PAYMENT_NOT_PIX',
      'Evento/cobrança não correspondem a PIX.'
    );
  }

  return { order, transaction };
}

function assertProvider(provider) {
  if (!provider || typeof provider.getPaymentById !== 'function') {
    throw new TypeError('Webhook fulfillment exige provider.getPaymentById().');
  }
}

function createFinancialWebhookFulfillment(dependencies = {}) {
  const {
    db,
    provider,
    clock = () => new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Webhook fulfillment exige Firestore válido.');
  }
  assertProvider(provider);

  async function markPermanentError(eventId, error) {
    if (!(error instanceof FinancialWebhookFulfillmentError) || error.retryable) {
      return false;
    }

    const eventRef = db.doc(`payment_webhook_events/${eventId}`);
    const now = requireDate(clock(), 'clock');
    return db.runTransaction(async tx => {
      const snap = await tx.get(eventRef);
      if (!snap.exists) return false;
      const event = snap.data() || {};
      if (event.status !== 'received') return false;
      tx.update(eventRef, {
        status: 'error',
        errorCode: error.code,
        processedAt: now
      });
      return true;
    });
  }

  async function processWebhookEvent({ eventId } = {}) {
    const canonicalEventId = requiredIdentifier(eventId, 'eventId');
    const eventRef = db.doc(`payment_webhook_events/${canonicalEventId}`);
    const firstSnap = await eventRef.get();
    if (!firstSnap.exists) {
      throw new FinancialWebhookFulfillmentError(
        'WEBHOOK_EVENT_NOT_FOUND',
        'Evento financeiro não encontrado.'
      );
    }

    const firstEvent = firstSnap.data() || {};
    if (firstEvent.status === 'ignored') {
      return { processed: false, ignored: true, eventId: canonicalEventId };
    }
    if (firstEvent.status === 'processed') {
      return {
        processed: true,
        idempotent: true,
        eventId: canonicalEventId,
        orderId: firstEvent.orderId || null,
        transactionId: firstEvent.transactionId || null,
        enrollmentId: firstEvent.enrollmentId || null
      };
    }
    if (firstEvent.status === 'error') {
      return {
        processed: false,
        error: true,
        eventId: canonicalEventId,
        errorCode: firstEvent.errorCode || null
      };
    }

    if (
      firstEvent.status !== 'received' ||
      firstEvent.processingAction !== 'confirm_payment' ||
      !firstEvent.providerPaymentId
    ) {
      const error = new FinancialWebhookFulfillmentError(
        'WEBHOOK_EVENT_NOT_PROCESSABLE',
        'Evento financeiro não está pronto para confirmação.'
      );
      await markPermanentError(canonicalEventId, error);
      throw error;
    }

    let providerRaw;
    try {
      providerRaw = await provider.getPaymentById(firstEvent.providerPaymentId);
    } catch (error) {
      throw error;
    }

    if (!providerRaw) {
      throw new FinancialWebhookFulfillmentError(
        'PROVIDER_PAYMENT_UNAVAILABLE',
        'Cobrança não pôde ser reconciliada no Asaas.',
        { retryable: true }
      );
    }

    let providerPayment;
    let orderId;
    let transactionId;
    try {
      providerPayment = normalizeFulfillmentProviderPayment(providerRaw);
      assertProviderPaymentConfirmed(providerPayment);

      if (
        firstEvent.providerPaymentId !== providerPayment.id ||
        firstEvent.externalReference !== providerPayment.externalReference ||
        firstEvent.providerCustomerId !== providerPayment.customer ||
        firstEvent.valueCents !== providerPayment.valueCents ||
        firstEvent.billingType !== providerPayment.billingType
      ) {
        throw new FinancialWebhookFulfillmentError(
          'WEBHOOK_PROVIDER_PROJECTION_MISMATCH',
          'Evento recebido diverge da cobrança atual do Asaas.'
        );
      }

      orderId = orderIdFromPaymentExternalReference(
        providerPayment.externalReference
      );
      transactionId = paymentTransactionId({
        provider: 'asaas',
        orderId
      });
    } catch (error) {
      await markPermanentError(canonicalEventId, error);
      throw error;
    }

    const now = requireDate(clock(), 'clock');

    try {
      return await db.runTransaction(async tx => {
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          throw new FinancialWebhookFulfillmentError(
            'WEBHOOK_EVENT_NOT_FOUND',
            'Evento financeiro desapareceu durante processamento.'
          );
        }

        const event = eventSnap.data() || {};
        if (event.status === 'processed') {
          return {
            processed: true,
            idempotent: true,
            eventId: canonicalEventId,
            orderId: event.orderId || orderId,
            transactionId: event.transactionId || transactionId,
            enrollmentId: event.enrollmentId || null
          };
        }
        if (event.status !== 'received') {
          throw new FinancialWebhookFulfillmentError(
            'WEBHOOK_EVENT_STATE_CHANGED',
            'Estado do evento mudou durante o processamento.'
          );
        }

        const orderRef = db.doc(`orders/${orderId}`);
        const transactionRef = db.doc(
          `payment_transactions/${transactionId}`
        );
        const [orderSnap, transactionSnap] = await Promise.all([
          tx.get(orderRef),
          tx.get(transactionRef)
        ]);

        if (!orderSnap.exists || !transactionSnap.exists) {
          throw new FinancialWebhookFulfillmentError(
            'CANONICAL_FINANCIAL_STATE_NOT_FOUND',
            'Pedido/transação da cobrança não foram encontrados.'
          );
        }

        const { order, transaction } = validateCanonicalFinancialState({
          orderId,
          transactionId,
          orderInput: orderSnap.data(),
          transactionInput: transactionSnap.data(),
          event,
          providerPayment
        });

        const enrollmentId = enrollmentDocumentId(
          order.productId,
          order.buyerUserId
        );
        const enrollmentRef = db.doc(`enrollments/${enrollmentId}`);
        const enrollmentSnap = await tx.get(enrollmentRef);
        let enrollmentCreated = false;

        if (enrollmentSnap.exists) {
          validateStoredEnrollment(enrollmentSnap.data(), {
            courseId: order.productId,
            userId: order.buyerUserId,
            orderId
          });
        } else {
          const enrollment = buildOrderEnrollment({
            courseId: order.productId,
            userId: order.buyerUserId,
            orderId,
            createdAt: now
          });
          tx.create(enrollmentRef, enrollment);
          enrollmentCreated = true;
        }

        const alreadyPaid =
          order.status === 'paid' && transaction.status === 'paid';
        if (!alreadyPaid) {
          if (
            order.status !== 'pending_payment' ||
            transaction.status !== 'pending'
          ) {
            throw new FinancialWebhookFulfillmentError(
              'PAYMENT_STATE_NOT_CONFIRMABLE',
              'Pedido/transação não estão em estado confirmável.'
            );
          }

          try {
            assertOrderStatusTransition(order.status, 'paid');
            assertTransactionStatusTransition(transaction.status, 'paid');
          } catch (error) {
            throw new FinancialWebhookFulfillmentError(
              'PAYMENT_STATE_TRANSITION_REJECTED',
              'Transição financeira para paid foi rejeitada.'
            );
          }

          const updatedOrder = validateOrder({
            ...order,
            status: 'paid',
            paidAt: now,
            updatedAt: now
          });
          const updatedTransaction = validateTransaction({
            ...transaction,
            status: 'paid',
            providerStatus: providerPayment.status,
            confirmedAt: transaction.confirmedAt || now,
            updatedAt: now
          });

          tx.set(orderRef, updatedOrder);
          tx.set(transactionRef, updatedTransaction);
          tx.create(db.collection('audit_logs').doc(), {
            actorId: 'system:asaas-webhook',
            actorRole: 'system',
            action: 'financial.payment.confirmed',
            entityType: 'payment_transaction',
            entityId: transactionId,
            before: {
              orderStatus: order.status,
              transactionStatus: transaction.status
            },
            after: {
              orderStatus: 'paid',
              transactionStatus: 'paid',
              providerStatus: providerPayment.status
            },
            source: 'webhook_worker',
            requestId: canonicalEventId,
            createdAt: now
          });
        }

        if (enrollmentCreated) {
          tx.create(db.collection('audit_logs').doc(), {
            actorId: 'system:asaas-webhook',
            actorRole: 'system',
            action: 'course.enrollment.created',
            entityType: 'enrollment',
            entityId: enrollmentId,
            before: null,
            after: {
              courseId: order.productId,
              userId: order.buyerUserId,
              source: 'order',
              orderId,
              status: 'active'
            },
            source: 'webhook_worker',
            requestId: canonicalEventId,
            createdAt: now
          });
        }

        tx.update(eventRef, {
          status: 'processed',
          orderId,
          transactionId,
          enrollmentId,
          enrollmentCreated,
          providerVerifiedStatus: providerPayment.status,
          processedAt: now,
          errorCode: null
        });

        return {
          processed: true,
          idempotent: alreadyPaid && !enrollmentCreated,
          eventId: canonicalEventId,
          orderId,
          transactionId,
          enrollmentId,
          enrollmentCreated,
          orderAlreadyPaid: alreadyPaid
        };
      });
    } catch (error) {
      if (error instanceof FinancialWebhookFulfillmentError) {
        await markPermanentError(canonicalEventId, error);
      }
      throw error;
    }
  }

  return {
    processWebhookEvent,
    markPermanentError
  };
}

module.exports = {
  CONFIRMED_PROVIDER_STATUSES,
  FinancialWebhookFulfillmentError,
  orderIdFromPaymentExternalReference,
  normalizeFulfillmentProviderPayment,
  assertProviderPaymentConfirmed,
  buildOrderEnrollment,
  validateStoredEnrollment,
  validateCanonicalFinancialState,
  createFinancialWebhookFulfillment
};
