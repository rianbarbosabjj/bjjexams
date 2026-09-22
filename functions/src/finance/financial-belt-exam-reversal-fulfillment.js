'use strict';

const {
  FinancialDomainError,
  validateOrder,
  validateTransaction
} = require('./financial-domain');
const {
  paymentExternalReference
} = require('./asaas-checkout-adapter');
const {
  paymentTransactionId
} = require('./financial-checkout-persistence');
const {
  FinancialReversalDomainError,
  classifyFinancialReversalEvent
} = require('./financial-reversal-domain');
const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  markRegistrationNeedsReconciliation
} = require('../exams/exam-registration-domain');
const {
  FinancialBeltExamReversalStateDomainError,
  buildCanonicalBeltExamReversalState,
  validateCanonicalBeltExamFinancialPair,
  validateCanonicalBeltExamRegistration
} = require('./financial-belt-exam-reversal-state-domain');

class FinancialBeltExamReversalFulfillmentError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'FinancialBeltExamReversalFulfillmentError';
    this.code = code;
    this.retryable = retryable === true;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'INVALID_BELT_EXAM_REVERSAL_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requireDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'INVALID_BELT_EXAM_REVERSAL_TIMESTAMP',
      `${field} inválido.`
    );
  }
  return date;
}

function orderIdFromExternalReference(value) {
  const reference = String(value || '').trim();
  const prefix = 'BJJEX-V12-ORDER-';
  if (!reference.startsWith(prefix)) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'INVALID_BELT_EXAM_REVERSAL_EXTERNAL_REFERENCE',
      'externalReference não pertence ao contrato BJJ Exams v1.2.'
    );
  }
  const orderId = requiredIdentifier(reference.slice(prefix.length), 'orderId');
  if (paymentExternalReference(orderId) !== reference) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'INVALID_BELT_EXAM_REVERSAL_EXTERNAL_REFERENCE',
      'externalReference do exame não é canônica.'
    );
  }
  return orderId;
}

function normalizeFailure(error) {
  if (error instanceof FinancialBeltExamReversalFulfillmentError) return error;
  if (
    error instanceof FinancialBeltExamReversalStateDomainError ||
    error instanceof FinancialDomainError ||
    error instanceof FinancialReversalDomainError ||
    error instanceof ExamRegistrationDomainError
  ) {
    return new FinancialBeltExamReversalFulfillmentError(
      error.code || 'INVALID_BELT_EXAM_REVERSAL_STATE',
      error.message || 'Estado canônico incompatível com a reversão do exame.'
    );
  }
  return error;
}

function eventAlreadyFinal(event = {}, eventId) {
  if (event.status === 'processed') {
    return {
      processed: true,
      idempotent: true,
      eventId,
      orderId: event.orderId || null,
      transactionId: event.transactionId || null,
      registrationId: event.registrationId || null,
      action: event.reversalOutcome || event.reversalAction || null
    };
  }
  if (event.status === 'error') {
    return {
      processed: false,
      error: true,
      eventId,
      errorCode: event.errorCode || null
    };
  }
  if (event.status === 'ignored') {
    return { processed: false, ignored: true, eventId };
  }
  return null;
}

function assertEventMatchesCanonical({
  event,
  orderId,
  transactionId,
  order,
  transaction
}) {
  if (
    event.provider !== 'asaas' ||
    order.provider !== 'asaas' ||
    transaction.provider !== 'asaas'
  ) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'BELT_EXAM_REVERSAL_PROVIDER_MISMATCH',
      'Evento, pedido e transação precisam usar provider asaas.'
    );
  }
  if (
    transaction.orderId !== orderId ||
    order.currentTransactionId !== transactionId ||
    transaction.buyerUserId !== order.buyerUserId
  ) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'BELT_EXAM_REVERSAL_CANONICAL_IDENTITY_MISMATCH',
      'Pedido e transação do exame não correspondem entre si.'
    );
  }
  if (
    !event.providerPaymentId ||
    transaction.providerPaymentId !== event.providerPaymentId
  ) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'BELT_EXAM_REVERSAL_PROVIDER_PAYMENT_MISMATCH',
      'Evento não corresponde ao providerPaymentId do exame.'
    );
  }
  if (event.externalReference !== paymentExternalReference(orderId)) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'BELT_EXAM_REVERSAL_EXTERNAL_REFERENCE_MISMATCH',
      'Evento não corresponde ao externalReference do exame.'
    );
  }
  if (
    !order.providerCustomerId ||
    event.providerCustomerId !== order.providerCustomerId
  ) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'BELT_EXAM_REVERSAL_CUSTOMER_MISMATCH',
      'Evento não corresponde ao customer canônico do exame.'
    );
  }
  if (
    !Number.isSafeInteger(event.valueCents) ||
    event.valueCents !== order.amountCents ||
    transaction.amountCents !== order.amountCents ||
    order.currency !== 'BRL' ||
    transaction.currency !== 'BRL'
  ) {
    throw new FinancialBeltExamReversalFulfillmentError(
      'BELT_EXAM_REVERSAL_VALUE_MISMATCH',
      'Evento possui valor/moeda divergente do exame.'
    );
  }
  if (event.billingType !== 'PIX') {
    throw new FinancialBeltExamReversalFulfillmentError(
      'BELT_EXAM_REVERSAL_BILLING_TYPE_MISMATCH',
      'Reversão automática de exame aceita somente PIX.'
    );
  }
}

async function resolveBeltExamOrderFromEvent({ db, event } = {}) {
  if (!db || typeof db.doc !== 'function') {
    throw new TypeError('Roteamento de reversão belt_exam exige Firestore válido.');
  }
  if (!event || event.status !== 'received' || !event.externalReference) {
    return null;
  }
  let orderId;
  try {
    orderId = orderIdFromExternalReference(event.externalReference);
  } catch (_error) {
    return null;
  }
  const snap = await db.doc(`orders/${orderId}`).get();
  if (!snap.exists) return null;
  let order;
  try {
    order = validateOrder(snap.data() || {});
  } catch (_error) {
    return null;
  }
  return order.productType === 'belt_exam'
    ? { orderId, order }
    : null;
}

async function isBeltExamFinancialEvent(input = {}) {
  return Boolean(await resolveBeltExamOrderFromEvent(input));
}

function audit(tx, db, {
  action,
  entityType,
  entityId,
  before,
  after,
  eventId,
  now
}) {
  tx.create(db.collection('audit_logs').doc(), {
    actorId: 'system:asaas-webhook',
    actorRole: 'system',
    action,
    entityType,
    entityId,
    before,
    after,
    source: 'webhook',
    requestId: eventId,
    createdAt: now
  });
}

function createFinancialBeltExamReversalFulfillment(dependencies = {}) {
  const {
    db,
    clock = () => new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Belt exam reversal fulfillment exige Firestore válido.');
  }

  async function markPermanentError(eventId, error) {
    if (
      !(error instanceof FinancialBeltExamReversalFulfillmentError) ||
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
      throw new FinancialBeltExamReversalFulfillmentError(
        'BELT_EXAM_REVERSAL_WEBHOOK_EVENT_NOT_FOUND',
        'Evento financeiro do exame não encontrado.'
      );
    }

    const firstEvent = firstSnap.data() || {};
    const final = eventAlreadyFinal(firstEvent, canonicalEventId);
    if (final) return final;
    if (
      firstEvent.status !== 'received' ||
      !['reconcile_reversal', 'confirm_payment'].includes(firstEvent.processingAction)
    ) {
      throw new FinancialBeltExamReversalFulfillmentError(
        'BELT_EXAM_REVERSAL_WEBHOOK_EVENT_NOT_PROCESSABLE',
        'Evento financeiro do exame não está pronto para reversão.'
      );
    }

    let orderId;
    let transactionId;
    try {
      orderId = orderIdFromExternalReference(firstEvent.externalReference);
      transactionId = paymentTransactionId({ provider: 'asaas', orderId });
    } catch (error) {
      const normalized = normalizeFailure(error);
      await markPermanentError(canonicalEventId, normalized);
      throw normalized;
    }

    const orderRef = db.doc(`orders/${orderId}`);
    const transactionRef = db.doc(`payment_transactions/${transactionId}`);
    const now = requireDate(clock(), 'clock');

    try {
      return await db.runTransaction(async tx => {
        const [eventSnap, orderSnap, transactionSnap] = await Promise.all([
          tx.get(eventRef),
          tx.get(orderRef),
          tx.get(transactionRef)
        ]);

        if (!eventSnap.exists || !orderSnap.exists || !transactionSnap.exists) {
          throw new FinancialBeltExamReversalFulfillmentError(
            'BELT_EXAM_REVERSAL_CANONICAL_STATE_NOT_FOUND',
            'Evento, pedido ou transação do exame não foram encontrados.'
          );
        }

        const event = eventSnap.data() || {};
        const alreadyFinal = eventAlreadyFinal(event, canonicalEventId);
        if (alreadyFinal) return alreadyFinal;
        if (event.status !== 'received') {
          throw new FinancialBeltExamReversalFulfillmentError(
            'BELT_EXAM_REVERSAL_WEBHOOK_EVENT_STATE_CHANGED',
            'Estado do evento mudou durante a reversão do exame.'
          );
        }

        let canonical;
        try {
          canonical = validateCanonicalBeltExamFinancialPair({
            orderId,
            order: orderSnap.data() || {},
            transactionId,
            transaction: transactionSnap.data() || {}
          });
        } catch (error) {
          throw normalizeFailure(error);
        }

        assertEventMatchesCanonical({
          event,
          orderId,
          transactionId,
          order: canonical.order,
          transaction: canonical.transaction
        });

        const classification = classifyFinancialReversalEvent(event.eventType);

        if (
          classification.action === 'positive_payment' &&
          !['chargeback', 'refunded'].includes(canonical.order.status)
        ) {
          return {
            processed: false,
            delegatedToConfirmation: true,
            eventId: canonicalEventId,
            orderId,
            transactionId
          };
        }

        const registrationId = examRegistrationDocumentId({
          sessionId: canonical.order.productId,
          studentId: canonical.order.buyerUserId
        });
        const registrationRef = db.doc(`exam_registrations/${registrationId}`);
        const registrationSnap = await tx.get(registrationRef);
        if (!registrationSnap.exists) {
          throw new FinancialBeltExamReversalFulfillmentError(
            'BELT_EXAM_REVERSAL_REGISTRATION_REQUIRED',
            'Reversão do exame exige registration canônica.'
          );
        }

        let registration;
        try {
          registration = validateCanonicalBeltExamRegistration({
            orderId,
            order: canonical.order,
            registration: registrationSnap.data() || {}
          });
        } catch (error) {
          throw normalizeFailure(error);
        }

        if (classification.action === 'positive_payment') {
          const needsReview = canonical.order.status === 'chargeback';
          let nextRegistration = registration;
          let registrationMutationRequired = false;
          if (needsReview && registration.status !== 'needs_reconciliation') {
            nextRegistration = markRegistrationNeedsReconciliation(registration, {
              orderId,
              updatedAt: now
            });
            registrationMutationRequired = true;
            tx.set(registrationRef, nextRegistration);
          }

          tx.update(eventRef, {
            status: 'processed',
            orderId,
            transactionId,
            registrationId,
            processedAt: now,
            errorCode: null,
            reversalAction: 'positive_payment',
            reversalOutcome: canonical.order.status === 'refunded'
              ? 'refund_final_precedence'
              : 'chargeback_positive_requires_review',
            reviewRequired: needsReview
          });

          if (registrationMutationRequired) {
            audit(tx, db, {
              action: 'exam.registration.reconciliation_required',
              entityType: 'exam_registration',
              entityId: registrationId,
              before: { status: registration.status },
              after: { status: nextRegistration.status },
              eventId: canonicalEventId,
              now
            });
          }

          return {
            processed: true,
            idempotent: true,
            eventId: canonicalEventId,
            orderId,
            transactionId,
            registrationId,
            action: 'positive_payment',
            reviewRequired: needsReview
          };
        }

        let state;
        try {
          state = buildCanonicalBeltExamReversalState({
            orderId,
            order: canonical.order,
            transactionId,
            transaction: canonical.transaction,
            registration,
            eventType: event.eventType,
            now
          });
        } catch (error) {
          throw normalizeFailure(error);
        }

        let nextTransaction = state.transaction;
        if (state.financialMutationRequired && event.providerPaymentStatus) {
          nextTransaction = validateTransaction({
            ...state.transaction,
            providerStatus: event.providerPaymentStatus
          });
        }

        if (state.financialMutationRequired) {
          tx.set(orderRef, state.order);
          tx.set(transactionRef, nextTransaction);
          audit(tx, db, {
            action: 'financial.reversal.applied',
            entityType: 'payment_transaction',
            entityId: transactionId,
            before: {
              orderStatus: canonical.order.status,
              transactionStatus: canonical.transaction.status
            },
            after: {
              orderStatus: state.order.status,
              transactionStatus: nextTransaction.status,
              action: state.transition.action
            },
            eventId: canonicalEventId,
            now
          });
        }

        if (state.registrationMutationRequired) {
          tx.set(registrationRef, state.registration);
          audit(tx, db, {
            action: state.registration.status === 'needs_reconciliation'
              ? 'exam.registration.reconciliation_required'
              : 'exam.registration.financial_reversal_applied',
            entityType: 'exam_registration',
            entityId: registrationId,
            before: { status: registration.status, orderId: registration.orderId },
            after: {
              status: state.registration.status,
              orderId: state.registration.orderId
            },
            eventId: canonicalEventId,
            now
          });
        }

        const reviewRequired = Boolean(
          state.reviewRequired ||
          state.classification.requiresReview ||
          state.registration.status === 'needs_reconciliation'
        );
        tx.update(eventRef, {
          status: 'processed',
          orderId,
          transactionId,
          registrationId,
          processedAt: now,
          errorCode: null,
          reversalAction: state.transition.action,
          reversalOutcome: state.transition.reason || state.transition.action,
          reviewRequired
        });

        return {
          processed: true,
          idempotent: state.mutationRequired !== true,
          eventId: canonicalEventId,
          orderId,
          transactionId,
          registrationId,
          action: state.transition.action,
          reviewRequired,
          delegatedToConfirmation: false
        };
      });
    } catch (error) {
      const normalized = normalizeFailure(error);
      if (normalized instanceof FinancialBeltExamReversalFulfillmentError) {
        await markPermanentError(canonicalEventId, normalized);
      }
      throw normalized;
    }
  }

  return {
    processWebhookEvent,
    markPermanentError
  };
}

module.exports = {
  FinancialBeltExamReversalFulfillmentError,
  orderIdFromExternalReference,
  assertEventMatchesCanonical,
  resolveBeltExamOrderFromEvent,
  isBeltExamFinancialEvent,
  createFinancialBeltExamReversalFulfillment
};
