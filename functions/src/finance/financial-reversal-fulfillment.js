'use strict';

const {
  FinancialDomainError,
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
  FinancialReversalStateDomainError,
  buildCanonicalFinancialReversalState
} = require('./financial-reversal-state-domain');
const {
  CourseEnrollmentDomainError,
  enrollmentDocumentId
} = require('../courses/course-enrollment-domain');

const RECOVERY_COLLECTION = 'financial_chargeback_recovery';

class FinancialReversalFulfillmentError extends Error {
  constructor(code, message, { retryable = false } = {}) {
    super(message);
    this.name = 'FinancialReversalFulfillmentError';
    this.code = code;
    this.retryable = retryable === true;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialReversalFulfillmentError(
      'INVALID_REVERSAL_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requireDate(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new FinancialReversalFulfillmentError(
      'INVALID_REVERSAL_TIMESTAMP',
      `${field} inválido.`
    );
  }
  return date;
}

function timestampToDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const candidates = [
    raw,
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
      ? `${raw.replace(' ', 'T')}Z`
      : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    const date = new Date(candidate);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

function orderIdFromExternalReference(value) {
  const reference = String(value || '').trim();
  const prefix = 'BJJEX-V12-ORDER-';
  if (!reference.startsWith(prefix)) {
    throw new FinancialReversalFulfillmentError(
      'INVALID_REVERSAL_EXTERNAL_REFERENCE',
      'externalReference não pertence ao contrato BJJ Exams v1.2.'
    );
  }
  const orderId = requiredIdentifier(reference.slice(prefix.length), 'orderId');
  if (paymentExternalReference(orderId) !== reference) {
    throw new FinancialReversalFulfillmentError(
      'INVALID_REVERSAL_EXTERNAL_REFERENCE',
      'externalReference não é canônica.'
    );
  }
  return orderId;
}

function recoveryEvidenceDocumentId(transactionId) {
  return requiredIdentifier(transactionId, 'transactionId');
}

function eventAlreadyFinal(event = {}, eventId) {
  if (event.status === 'processed') {
    return {
      processed: true,
      idempotent: true,
      eventId,
      orderId: event.orderId || null,
      transactionId: event.transactionId || null,
      enrollmentId: event.enrollmentId || null,
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
    return {
      processed: false,
      ignored: true,
      eventId
    };
  }
  return null;
}

function normalizeDomainFailure(error) {
  if (error instanceof FinancialReversalFulfillmentError) return error;
  if (
    error instanceof FinancialReversalDomainError ||
    error instanceof FinancialReversalStateDomainError ||
    error instanceof FinancialDomainError ||
    error instanceof CourseEnrollmentDomainError
  ) {
    return new FinancialReversalFulfillmentError(
      error.code || 'INVALID_REVERSAL_STATE',
      'Estado canônico incompatível com a reversão financeira.'
    );
  }
  return error;
}

function assertEventMatchesCanonical({ event, orderId, transactionId, order, transaction }) {
  if (event.provider !== 'asaas' || transaction.provider !== 'asaas') {
    throw new FinancialReversalFulfillmentError(
      'REVERSAL_PROVIDER_MISMATCH',
      'Evento e transação precisam usar provider asaas.'
    );
  }
  if (
    transaction.orderId !== orderId ||
    order.currentTransactionId !== transactionId ||
    transaction.buyerUserId !== order.buyerUserId
  ) {
    throw new FinancialReversalFulfillmentError(
      'REVERSAL_CANONICAL_IDENTITY_MISMATCH',
      'Pedido e transação não correspondem entre si.'
    );
  }
  if (
    !event.providerPaymentId ||
    transaction.providerPaymentId !== event.providerPaymentId
  ) {
    throw new FinancialReversalFulfillmentError(
      'REVERSAL_PROVIDER_PAYMENT_MISMATCH',
      'Evento não corresponde ao providerPaymentId canônico.'
    );
  }

  const expectedReference = paymentExternalReference(orderId);
  if (event.externalReference !== expectedReference) {
    throw new FinancialReversalFulfillmentError(
      'REVERSAL_EXTERNAL_REFERENCE_MISMATCH',
      'Evento não corresponde ao externalReference canônico.'
    );
  }
  if (
    !order.providerCustomerId ||
    event.providerCustomerId !== order.providerCustomerId
  ) {
    throw new FinancialReversalFulfillmentError(
      'REVERSAL_CUSTOMER_MISMATCH',
      'Evento não corresponde ao customer canônico.'
    );
  }
  if (
    !Number.isSafeInteger(event.valueCents) ||
    event.valueCents !== order.amountCents ||
    transaction.amountCents !== order.amountCents ||
    order.currency !== 'BRL' ||
    transaction.currency !== 'BRL'
  ) {
    throw new FinancialReversalFulfillmentError(
      'REVERSAL_VALUE_MISMATCH',
      'Evento possui valor/moeda divergente do estado canônico.'
    );
  }
  if (event.billingType !== 'PIX') {
    throw new FinancialReversalFulfillmentError(
      'REVERSAL_BILLING_TYPE_MISMATCH',
      'Marco 5.5 course-first aceita reversão automática apenas para PIX.'
    );
  }
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

function recoveryOrderingBoundary(evidence, order) {
  const awaitingAt = timestampToDate(
    evidence?.awaitingReversalProviderEventCreatedAt
  );
  if (awaitingAt) return awaitingAt;

  const chargebackEventAt = timestampToDate(
    evidence?.chargebackProviderEventCreatedAt
  );
  if (chargebackEventAt) return chargebackEventAt;

  return timestampToDate(order?.chargebackAt);
}

function isStalePositiveEvent(event, order, evidence = null) {
  const eventAt = timestampToDate(event.providerEventCreatedAt);
  const boundaryAt = recoveryOrderingBoundary(evidence, order);
  return Boolean(
    eventAt &&
    boundaryAt &&
    eventAt.getTime() <= boundaryAt.getTime()
  );
}

function createFinancialReversalFulfillment(dependencies = {}) {
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
    throw new TypeError('Reversal fulfillment exige Firestore válido.');
  }

  async function markPermanentError(eventId, error) {
    if (!(error instanceof FinancialReversalFulfillmentError) || error.retryable) {
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
      throw new FinancialReversalFulfillmentError(
        'REVERSAL_WEBHOOK_EVENT_NOT_FOUND',
        'Evento financeiro não encontrado.'
      );
    }

    const firstEvent = firstSnap.data() || {};
    const final = eventAlreadyFinal(firstEvent, canonicalEventId);
    if (final) return final;
    if (firstEvent.status !== 'received') {
      throw new FinancialReversalFulfillmentError(
        'REVERSAL_WEBHOOK_EVENT_NOT_RECEIVED',
        'Evento financeiro não está em estado received.'
      );
    }
    if (!['reconcile_reversal', 'confirm_payment'].includes(firstEvent.processingAction)) {
      return {
        processed: false,
        delegatedToConfirmation: false,
        skipped: true,
        eventId: canonicalEventId,
        reason: 'REVERSAL_ACTION_NOT_APPLICABLE'
      };
    }

    let orderId;
    let transactionId;
    try {
      orderId = orderIdFromExternalReference(firstEvent.externalReference);
      transactionId = paymentTransactionId({ provider: 'asaas', orderId });
    } catch (error) {
      const normalized = normalizeDomainFailure(error);
      await markPermanentError(canonicalEventId, normalized);
      throw normalized;
    }

    const orderRef = db.doc(`orders/${orderId}`);
    const transactionRef = db.doc(`payment_transactions/${transactionId}`);
    const evidenceRef = db.doc(
      `${RECOVERY_COLLECTION}/${recoveryEvidenceDocumentId(transactionId)}`
    );
    const now = requireDate(clock(), 'clock');

    try {
      return await db.runTransaction(async tx => {
        const [eventSnap, orderSnap, transactionSnap, evidenceSnap] = await Promise.all([
          tx.get(eventRef),
          tx.get(orderRef),
          tx.get(transactionRef),
          tx.get(evidenceRef)
        ]);

        if (!eventSnap.exists || !orderSnap.exists || !transactionSnap.exists) {
          throw new FinancialReversalFulfillmentError(
            'REVERSAL_CANONICAL_STATE_NOT_FOUND',
            'Evento, pedido ou transação não foram encontrados.'
          );
        }

        const event = eventSnap.data() || {};
        const alreadyFinal = eventAlreadyFinal(event, canonicalEventId);
        if (alreadyFinal) return alreadyFinal;
        if (event.status !== 'received') {
          throw new FinancialReversalFulfillmentError(
            'REVERSAL_WEBHOOK_EVENT_STATE_CHANGED',
            'Estado do evento mudou durante o processamento.'
          );
        }

        const order = orderSnap.data() || {};
        const transaction = transactionSnap.data() || {};
        assertEventMatchesCanonical({
          event,
          orderId,
          transactionId,
          order,
          transaction
        });

        const classification = classifyFinancialReversalEvent(event.eventType);

        if (
          classification.action === 'positive_payment' &&
          !['chargeback', 'refunded'].includes(String(order.status || '').toLowerCase())
        ) {
          return {
            processed: false,
            delegatedToConfirmation: true,
            eventId: canonicalEventId,
            orderId,
            transactionId
          };
        }

        const enrollmentId = enrollmentDocumentId(order.productId, order.buyerUserId);
        const enrollmentRef = db.doc(`enrollments/${enrollmentId}`);
        const enrollmentSnap = await tx.get(enrollmentRef);
        const enrollment = enrollmentSnap.exists ? enrollmentSnap.data() : null;
        const evidence = evidenceSnap.exists ? evidenceSnap.data() : null;

        if (
          classification.action === 'positive_payment' &&
          String(order.status || '').toLowerCase() === 'chargeback' &&
          isStalePositiveEvent(event, order, evidence)
        ) {
          tx.update(eventRef, {
            status: 'processed',
            orderId,
            transactionId,
            enrollmentId: enrollmentSnap.exists ? enrollmentId : null,
            processedAt: now,
            errorCode: null,
            reversalAction: 'positive_payment',
            reversalOutcome: 'stale_positive_ignored',
            reviewRequired: false
          });
          return {
            processed: true,
            idempotent: true,
            stale: true,
            eventId: canonicalEventId,
            orderId,
            transactionId,
            enrollmentId: enrollmentSnap.exists ? enrollmentId : null,
            action: 'stale_positive_ignored'
          };
        }

        let chargebackRecoveryAuthorized = false;
        if (
          classification.action === 'positive_payment' &&
          String(order.status || '').toLowerCase() === 'chargeback'
        ) {
          if (
            !evidence ||
            evidence.status !== 'awaiting_reversal' ||
            evidence.provider !== 'asaas' ||
            evidence.providerPaymentId !== event.providerPaymentId ||
            evidence.orderId !== orderId ||
            evidence.transactionId !== transactionId
          ) {
            throw new FinancialReversalFulfillmentError(
              'CHARGEBACK_RECOVERY_EVIDENCE_PENDING',
              'Recuperação de chargeback aguarda evidência canônica de reversão vencida.',
              { retryable: true }
            );
          }
          if (!timestampToDate(evidence.awaitingReversalProviderEventCreatedAt)) {
            throw new FinancialReversalFulfillmentError(
              'CHARGEBACK_RECOVERY_EVIDENCE_TIME_REQUIRED',
              'Evidência de recuperação precisa preservar o timestamp do evento do provedor.',
              { retryable: true }
            );
          }
          chargebackRecoveryAuthorized = true;
        }

        if (classification.action === 'chargeback_reversal_pending') {
          const status = String(order.status || '').toLowerCase();
          if (status === 'paid' && evidence?.status !== 'consumed') {
            throw new FinancialReversalFulfillmentError(
              'CHARGEBACK_STATE_PENDING',
              'Evidência de recuperação chegou antes do estado chargeback.',
              { retryable: true }
            );
          }
          if (!['chargeback', 'paid', 'refunded'].includes(status)) {
            throw new FinancialReversalFulfillmentError(
              'CHARGEBACK_RECOVERY_STATE_INVALID',
              `Estado ${status || '<vazio>'} não aceita evidência de recuperação.`
            );
          }
        }

        let state;
        try {
          state = buildCanonicalFinancialReversalState({
            orderId,
            order,
            transactionId,
            transaction,
            enrollment,
            eventType: event.eventType,
            chargebackRecoveryAuthorized,
            now
          });
        } catch (error) {
          throw normalizeDomainFailure(error);
        }

        const transition = state.transition;
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
        }
        if (state.enrollmentMutationRequired) {
          tx.set(enrollmentRef, state.enrollment);
        }

        let evidenceChanged = false;

        if (
          transition.action === 'chargeback' &&
          state.financialMutationRequired
        ) {
          tx.set(evidenceRef, {
            provider: 'asaas',
            providerPaymentId: event.providerPaymentId,
            orderId,
            transactionId,
            chargebackEventId: canonicalEventId,
            chargebackProviderEventCreatedAt: event.providerEventCreatedAt || null,
            evidenceEventId: null,
            awaitingReversalProviderEventCreatedAt: null,
            status: 'chargeback_started',
            createdAt: evidence?.createdAt || now,
            updatedAt: now,
            consumedAt: null,
            recoveredEventId: null
          });
          evidenceChanged = true;
        }

        if (
          classification.action === 'chargeback_reversal_pending' &&
          String(order.status || '').toLowerCase() === 'chargeback'
        ) {
          const sameEvidence = Boolean(
            evidence &&
            evidence.status === 'awaiting_reversal' &&
            evidence.providerPaymentId === event.providerPaymentId &&
            evidence.orderId === orderId &&
            evidence.transactionId === transactionId &&
            evidence.evidenceEventId === canonicalEventId &&
            evidence.awaitingReversalProviderEventCreatedAt === event.providerEventCreatedAt
          );
          if (!sameEvidence) {
            tx.set(evidenceRef, {
              provider: 'asaas',
              providerPaymentId: event.providerPaymentId,
              orderId,
              transactionId,
              chargebackEventId: evidence?.chargebackEventId || null,
              chargebackProviderEventCreatedAt:
                evidence?.chargebackProviderEventCreatedAt || null,
              evidenceEventId: canonicalEventId,
              awaitingReversalProviderEventCreatedAt:
                event.providerEventCreatedAt || null,
              status: 'awaiting_reversal',
              createdAt: evidence?.createdAt || now,
              updatedAt: now,
              consumedAt: null,
              recoveredEventId: null
            });
            evidenceChanged = true;
          }
        }

        if (transition.action === 'chargeback_recovered') {
          tx.set(evidenceRef, {
            ...evidence,
            status: 'consumed',
            updatedAt: now,
            consumedAt: now,
            recoveredEventId: canonicalEventId
          });
          evidenceChanged = true;
        }

        const eventEnrollmentId = enrollmentSnap.exists || state.enrollment
          ? enrollmentId
          : null;
        tx.update(eventRef, {
          status: 'processed',
          orderId,
          transactionId,
          enrollmentId: eventEnrollmentId,
          processedAt: now,
          errorCode: null,
          reversalAction: classification.action,
          reversalOutcome: transition.action,
          reversalReason: transition.reason || null,
          reviewRequired: classification.requiresReview === true
        });

        if (state.financialMutationRequired) {
          const actionMap = {
            cancel: 'financial.payment.cancelled',
            refund: 'financial.payment.refunded',
            chargeback: 'financial.payment.chargeback_started',
            chargeback_recovered: 'financial.payment.chargeback_recovered'
          };
          const action = actionMap[transition.action];
          if (action) {
            audit(tx, db, {
              action,
              entityType: 'payment_transaction',
              entityId: transactionId,
              before: {
                orderStatus: transition.fromOrderStatus,
                transactionStatus: transition.fromTransactionStatus
              },
              after: {
                orderStatus: state.order.status,
                transactionStatus: nextTransaction.status
              },
              eventId: canonicalEventId,
              now
            });
          }
        }

        if (state.enrollmentMutationRequired) {
          const actionMap = {
            refund: 'course.enrollment.revoked_refund',
            chargeback: 'course.enrollment.revoked_chargeback',
            chargeback_recovered: 'course.enrollment.restored_chargeback'
          };
          const action = actionMap[transition.action];
          if (action) {
            audit(tx, db, {
              action,
              entityType: 'enrollment',
              entityId: enrollmentId,
              before: { status: state.enrollmentPolicy?.currentStatus || null },
              after: { status: state.enrollment?.status || null },
              eventId: canonicalEventId,
              now
            });
          }
        }

        if (evidenceChanged && classification.action === 'chargeback_reversal_pending') {
          audit(tx, db, {
            action: 'financial.payment.chargeback_recovery_evidence',
            entityType: 'payment_transaction',
            entityId: transactionId,
            before: { evidenceStatus: evidence?.status || null },
            after: { evidenceStatus: 'awaiting_reversal' },
            eventId: canonicalEventId,
            now
          });
        }

        if (
          classification.action === 'partial_refund_review' &&
          transition.noop === true
        ) {
          audit(tx, db, {
            action: 'financial.payment.partial_refund_review',
            entityType: 'payment_transaction',
            entityId: transactionId,
            before: { status: transaction.status },
            after: { status: transaction.status },
            eventId: canonicalEventId,
            now
          });
        }

        return {
          processed: true,
          idempotent: transition.idempotent === true && !state.mutationRequired,
          delegatedToConfirmation: false,
          eventId: canonicalEventId,
          orderId,
          transactionId,
          enrollmentId: eventEnrollmentId,
          action: transition.action,
          financialMutationRequired: state.financialMutationRequired,
          enrollmentMutationRequired: state.enrollmentMutationRequired,
          evidenceChanged,
          reviewRequired: classification.requiresReview === true
        };
      });
    } catch (error) {
      const normalized = normalizeDomainFailure(error);
      await markPermanentError(canonicalEventId, normalized);
      throw normalized;
    }
  }

  return {
    processWebhookEvent
  };
}

module.exports = {
  RECOVERY_COLLECTION,
  FinancialReversalFulfillmentError,
  timestampToDate,
  orderIdFromExternalReference,
  recoveryEvidenceDocumentId,
  recoveryOrderingBoundary,
  isStalePositiveEvent,
  assertEventMatchesCanonical,
  createFinancialReversalFulfillment
};
