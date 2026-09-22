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
  orderIdFromPaymentExternalReference,
  normalizeFulfillmentProviderPayment,
  assertProviderPaymentConfirmed
} = require('./financial-webhook-fulfillment');
const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  validateExamRegistration,
  authorizePaidExamRegistration
} = require('../exams/exam-registration-domain');

const PAYMENT_AUTHORIZED_REGISTRATION_STATUSES = Object.freeze([
  'authorized',
  'started',
  'submitted',
  'passed',
  'failed',
  'certified'
]);

class FinancialBeltExamWebhookFulfillmentError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'FinancialBeltExamWebhookFulfillmentError';
    this.code = code;
    this.retryable = retryable === true;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'INVALID_BELT_EXAM_FULFILLMENT_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requireDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'INVALID_BELT_EXAM_FULFILLMENT_TIMESTAMP',
      `${field} inválido.`
    );
  }
  return date;
}

function validateCanonicalBeltExamFinancialState({
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
      throw new FinancialBeltExamWebhookFulfillmentError(
        'INVALID_BELT_EXAM_CANONICAL_FINANCIAL_STATE',
        'Pedido/transação do exame estão inconsistentes.'
      );
    }
    throw error;
  }

  if (order.productType !== 'belt_exam') {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'FULFILLMENT_PRODUCT_NOT_BELT_EXAM',
      'Fulfillment de exame aceita somente pedido belt_exam.'
    );
  }

  if (
    transaction.financialSnapshot?.productType !== 'belt_exam' ||
    transaction.financialSnapshot?.productId !== order.productId
  ) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_TRANSACTION_SNAPSHOT_MISMATCH',
      'Snapshot da transação não corresponde ao exame comprado.'
    );
  }

  if (
    order.currentTransactionId !== transactionId ||
    transaction.orderId !== orderId ||
    order.buyerUserId !== transaction.buyerUserId ||
    order.provider !== 'asaas' ||
    transaction.provider !== 'asaas' ||
    event.provider !== 'asaas'
  ) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_PAYMENT_IDENTITY_MISMATCH',
      'Pedido, transação e evento do exame não correspondem entre si.'
    );
  }

  if (
    transaction.providerPaymentId !== providerPayment.id ||
    event.providerPaymentId !== providerPayment.id
  ) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_PROVIDER_PAYMENT_ID_MISMATCH',
      'Evento/transação não correspondem à cobrança atual do Asaas.'
    );
  }

  const expectedReference = paymentExternalReference(orderId);
  if (
    event.externalReference !== expectedReference ||
    providerPayment.externalReference !== expectedReference
  ) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_PROVIDER_EXTERNAL_REFERENCE_MISMATCH',
      'Referência da cobrança diverge do pedido canônico do exame.'
    );
  }

  if (
    !order.providerCustomerId ||
    event.providerCustomerId !== order.providerCustomerId ||
    providerPayment.customer !== order.providerCustomerId
  ) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_PROVIDER_CUSTOMER_MISMATCH',
      'Customer da cobrança diverge do pedido canônico do exame.'
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
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_PROVIDER_PAYMENT_VALUE_MISMATCH',
      'Valor/moeda da cobrança divergem do estado canônico do exame.'
    );
  }

  if (event.billingType !== 'PIX' || providerPayment.billingType !== 'PIX') {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_PROVIDER_PAYMENT_NOT_PIX',
      'Evento/cobrança do exame não correspondem a PIX.'
    );
  }

  return { order, transaction };
}

function validateStoredBeltExamRegistration(input = {}, expected = {}) {
  let registration;
  try {
    registration = validateExamRegistration(input);
  } catch (error) {
    if (error instanceof ExamRegistrationDomainError) {
      throw new FinancialBeltExamWebhookFulfillmentError(
        'BELT_EXAM_REGISTRATION_INVALID',
        'Registration do exame está inconsistente.'
      );
    }
    throw error;
  }

  if (
    registration.sessionId !== expected.sessionId ||
    registration.studentId !== expected.studentId ||
    registration.orderId !== expected.orderId
  ) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_REGISTRATION_PAYMENT_IDENTITY_MISMATCH',
      'Registration não corresponde ao pedido pago.'
    );
  }

  return registration;
}

function assertAlreadyAuthorizedRegistration(registration) {
  if (!PAYMENT_AUTHORIZED_REGISTRATION_STATUSES.includes(registration.status)) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_REGISTRATION_NOT_AUTHORIZED',
      'Pedido já pago exige registration autorizada pelo mesmo orderId.'
    );
  }
  if (!registration.paidAt || !registration.authorizedAt) {
    throw new FinancialBeltExamWebhookFulfillmentError(
      'BELT_EXAM_REGISTRATION_AUTHORIZATION_TIMESTAMPS_REQUIRED',
      'Registration autorizada precisa preservar timestamps financeiros.'
    );
  }
  return registration;
}

async function isBeltExamPaymentConfirmation({ db, event } = {}) {
  if (!db || typeof db.doc !== 'function') {
    throw new TypeError('Roteamento de webhook belt_exam exige Firestore válido.');
  }
  if (
    !event ||
    event.status !== 'received' ||
    event.processingAction !== 'confirm_payment' ||
    !event.externalReference
  ) {
    return false;
  }

  let orderId;
  try {
    orderId = orderIdFromPaymentExternalReference(event.externalReference);
  } catch (_error) {
    return false;
  }

  const snap = await db.doc(`orders/${orderId}`).get();
  if (!snap.exists) return false;

  try {
    return validateOrder(snap.data() || {}).productType === 'belt_exam';
  } catch (_error) {
    return false;
  }
}

function assertProvider(provider) {
  if (!provider || typeof provider.getPaymentById !== 'function') {
    throw new TypeError(
      'Belt exam webhook fulfillment exige provider.getPaymentById().'
    );
  }
}

function createFinancialBeltExamWebhookFulfillment(dependencies = {}) {
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
    throw new TypeError('Belt exam webhook fulfillment exige Firestore válido.');
  }
  assertProvider(provider);

  async function markPermanentError(eventId, error) {
    if (
      !(error instanceof FinancialBeltExamWebhookFulfillmentError) ||
      error.retryable
    ) {
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
      throw new FinancialBeltExamWebhookFulfillmentError(
        'BELT_EXAM_WEBHOOK_EVENT_NOT_FOUND',
        'Evento financeiro do exame não encontrado.'
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
        registrationId: firstEvent.registrationId || null
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
      const error = new FinancialBeltExamWebhookFulfillmentError(
        'BELT_EXAM_WEBHOOK_EVENT_NOT_PROCESSABLE',
        'Evento financeiro do exame não está pronto para confirmação.'
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
      throw new FinancialBeltExamWebhookFulfillmentError(
        'BELT_EXAM_PROVIDER_PAYMENT_UNAVAILABLE',
        'Cobrança do exame não pôde ser reconciliada no Asaas.',
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
        throw new FinancialBeltExamWebhookFulfillmentError(
          'BELT_EXAM_WEBHOOK_PROVIDER_PROJECTION_MISMATCH',
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
      const normalized = error instanceof FinancialBeltExamWebhookFulfillmentError
        ? error
        : new FinancialBeltExamWebhookFulfillmentError(
            error?.code || 'BELT_EXAM_PROVIDER_CONFIRMATION_INVALID',
            error?.message || 'Confirmação do pagamento do exame é inválida.',
            { retryable: error?.retryable === true }
          );
      await markPermanentError(canonicalEventId, normalized);
      throw normalized;
    }

    const now = requireDate(clock(), 'clock');

    try {
      return await db.runTransaction(async tx => {
        const eventSnap = await tx.get(eventRef);
        if (!eventSnap.exists) {
          throw new FinancialBeltExamWebhookFulfillmentError(
            'BELT_EXAM_WEBHOOK_EVENT_NOT_FOUND',
            'Evento financeiro do exame desapareceu durante processamento.'
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
            registrationId: event.registrationId || null
          };
        }
        if (event.status !== 'received') {
          throw new FinancialBeltExamWebhookFulfillmentError(
            'BELT_EXAM_WEBHOOK_EVENT_STATE_CHANGED',
            'Estado do evento mudou durante o processamento.'
          );
        }

        const orderRef = db.doc(`orders/${orderId}`);
        const transactionRef = db.doc(`payment_transactions/${transactionId}`);
        const [orderSnap, transactionSnap] = await Promise.all([
          tx.get(orderRef),
          tx.get(transactionRef)
        ]);

        if (!orderSnap.exists || !transactionSnap.exists) {
          throw new FinancialBeltExamWebhookFulfillmentError(
            'BELT_EXAM_CANONICAL_FINANCIAL_STATE_NOT_FOUND',
            'Pedido/transação do exame não foram encontrados.'
          );
        }

        const { order, transaction } = validateCanonicalBeltExamFinancialState({
          orderId,
          transactionId,
          orderInput: orderSnap.data(),
          transactionInput: transactionSnap.data(),
          event,
          providerPayment
        });

        const registrationId = examRegistrationDocumentId({
          sessionId: order.productId,
          studentId: order.buyerUserId
        });
        const registrationRef = db.doc(`exam_registrations/${registrationId}`);
        const registrationSnap = await tx.get(registrationRef);
        if (!registrationSnap.exists) {
          throw new FinancialBeltExamWebhookFulfillmentError(
            'BELT_EXAM_REGISTRATION_NOT_FOUND',
            'Registration vinculada ao pedido pago não foi encontrada.'
          );
        }

        const registration = validateStoredBeltExamRegistration(
          registrationSnap.data(),
          {
            sessionId: order.productId,
            studentId: order.buyerUserId,
            orderId
          }
        );

        const alreadyPaid =
          order.status === 'paid' && transaction.status === 'paid';
        let registrationAuthorized = false;

        if (alreadyPaid) {
          assertAlreadyAuthorizedRegistration(registration);
        } else {
          if (
            order.status !== 'pending_payment' ||
            transaction.status !== 'pending'
          ) {
            throw new FinancialBeltExamWebhookFulfillmentError(
              'BELT_EXAM_PAYMENT_STATE_NOT_CONFIRMABLE',
              'Pedido/transação do exame não estão em estado confirmável.'
            );
          }
          if (registration.status !== 'awaiting_payment') {
            throw new FinancialBeltExamWebhookFulfillmentError(
              'BELT_EXAM_REGISTRATION_NOT_AWAITING_PAYMENT',
              'Registration precisa aguardar pagamento antes da autorização.'
            );
          }

          try {
            assertOrderStatusTransition(order.status, 'paid');
            assertTransactionStatusTransition(transaction.status, 'paid');
          } catch (_error) {
            throw new FinancialBeltExamWebhookFulfillmentError(
              'BELT_EXAM_PAYMENT_STATE_TRANSITION_REJECTED',
              'Transição financeira do exame para paid foi rejeitada.'
            );
          }

          let authorizedRegistration;
          try {
            authorizedRegistration = authorizePaidExamRegistration(registration, {
              orderId,
              paidAt: now
            });
          } catch (error) {
            if (error instanceof ExamRegistrationDomainError) {
              throw new FinancialBeltExamWebhookFulfillmentError(
                error.code || 'BELT_EXAM_REGISTRATION_AUTHORIZATION_REJECTED',
                error.message
              );
            }
            throw error;
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
          tx.set(registrationRef, authorizedRegistration);
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
              providerStatus: providerPayment.status,
              productType: 'belt_exam'
            },
            source: 'webhook_worker',
            requestId: canonicalEventId,
            createdAt: now
          });
          tx.create(db.collection('audit_logs').doc(), {
            actorId: 'system:asaas-webhook',
            actorRole: 'system',
            action: 'exam.registration.authorized',
            entityType: 'exam_registration',
            entityId: registrationId,
            before: {
              status: registration.status,
              orderId: registration.orderId
            },
            after: {
              status: authorizedRegistration.status,
              orderId,
              paidAt: authorizedRegistration.paidAt,
              authorizedAt: authorizedRegistration.authorizedAt
            },
            source: 'webhook_worker',
            requestId: canonicalEventId,
            createdAt: now
          });
          registrationAuthorized = true;
        }

        tx.update(eventRef, {
          status: 'processed',
          orderId,
          transactionId,
          registrationId,
          registrationAuthorized,
          providerVerifiedStatus: providerPayment.status,
          processedAt: now,
          errorCode: null
        });

        return {
          processed: true,
          idempotent: alreadyPaid,
          eventId: canonicalEventId,
          orderId,
          transactionId,
          registrationId,
          registrationAuthorized,
          orderAlreadyPaid: alreadyPaid
        };
      });
    } catch (error) {
      if (error instanceof FinancialBeltExamWebhookFulfillmentError) {
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
  PAYMENT_AUTHORIZED_REGISTRATION_STATUSES,
  FinancialBeltExamWebhookFulfillmentError,
  validateCanonicalBeltExamFinancialState,
  validateStoredBeltExamRegistration,
  assertAlreadyAuthorizedRegistration,
  isBeltExamPaymentConfirmation,
  createFinancialBeltExamWebhookFulfillment
};
