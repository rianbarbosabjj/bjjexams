'use strict';

const {
  REVERSAL_REQUESTS_COLLECTION,
  reversalRequestId
} = require('./financial-reversal-admin-service');

const RECONCILABLE_ADMIN_EVENTS = Object.freeze({
  PAYMENT_DELETED: Object.freeze({
    operation: 'cancel_pending',
    requestStatus: 'completed',
    providerLifecycleStatus: 'cancelled',
    errorCode: null,
    terminal: true
  }),
  PAYMENT_REFUNDED: Object.freeze({
    operation: 'refund_full',
    requestStatus: 'completed',
    providerLifecycleStatus: 'refunded',
    errorCode: null,
    terminal: true
  }),
  PAYMENT_REFUND_IN_PROGRESS: Object.freeze({
    operation: 'refund_full',
    requestStatus: 'awaiting_webhook',
    providerLifecycleStatus: 'in_progress',
    errorCode: null,
    terminal: false
  }),
  PAYMENT_REFUND_DENIED: Object.freeze({
    operation: 'refund_full',
    requestStatus: 'needs_reconciliation',
    providerLifecycleStatus: 'denied',
    errorCode: 'REVERSAL_PROVIDER_REFUND_DENIED',
    terminal: true
  }),
  PAYMENT_PARTIALLY_REFUNDED: Object.freeze({
    operation: 'refund_full',
    requestStatus: 'needs_reconciliation',
    providerLifecycleStatus: 'partial_refund',
    errorCode: 'REVERSAL_PROVIDER_PARTIAL_REFUND',
    terminal: true
  })
});

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requireEventId(value) {
  const id = text(value, 200);
  if (!id || id.includes('/')) {
    throw new TypeError('Admin reversal request reconciler exige eventId válido.');
  }
  return id;
}

function requireDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Admin reversal request reconciler exige clock válido.');
  }
  return date;
}

function ruleForEventType(eventType) {
  return RECONCILABLE_ADMIN_EVENTS[String(eventType || '').trim().toUpperCase()] || null;
}

function identityMatches(request = {}, event = {}, rule = {}) {
  return Boolean(
    request.operation === rule.operation &&
    request.orderId === event.orderId &&
    request.transactionId === event.transactionId &&
    request.provider === 'asaas' &&
    request.providerPaymentId === event.providerPaymentId
  );
}

function auditAction(rule) {
  if (rule.operation === 'cancel_pending' && rule.requestStatus === 'completed') {
    return 'financial.reversal.cancel_completed';
  }
  if (rule.operation === 'refund_full' && rule.requestStatus === 'completed') {
    return 'financial.reversal.refund_completed';
  }
  if (rule.operation === 'refund_full' && rule.providerLifecycleStatus === 'denied') {
    return 'financial.reversal.refund_denied';
  }
  if (rule.operation === 'refund_full' && rule.providerLifecycleStatus === 'partial_refund') {
    return 'financial.reversal.refund_partial_review';
  }
  if (rule.operation === 'refund_full' && rule.providerLifecycleStatus === 'in_progress') {
    return 'financial.reversal.refund_in_progress';
  }
  return 'financial.reversal.request_reconciled';
}

function createFinancialReversalAdminRequestReconciler({
  db,
  clock = () => new Date()
} = {}) {
  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Admin reversal request reconciler exige Firestore válido.');
  }

  async function reconcileProcessedEvent({ eventId } = {}) {
    const canonicalEventId = requireEventId(eventId);
    const eventRef = db.doc(`payment_webhook_events/${canonicalEventId}`);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return {
        reconciled: false,
        skipped: true,
        reason: 'EVENT_NOT_FOUND',
        eventId: canonicalEventId
      };
    }

    const initialEvent = eventSnap.data() || {};
    const rule = ruleForEventType(initialEvent.eventType);
    if (!rule) {
      return {
        reconciled: false,
        skipped: true,
        reason: 'EVENT_NOT_ADMIN_REVERSAL',
        eventId: canonicalEventId
      };
    }
    if (initialEvent.status !== 'processed') {
      return {
        reconciled: false,
        skipped: true,
        reason: 'EVENT_NOT_PROCESSED',
        eventId: canonicalEventId
      };
    }

    const transactionId = text(initialEvent.transactionId, 200);
    if (!transactionId || transactionId.includes('/')) {
      return {
        reconciled: false,
        skipped: true,
        reviewRequired: true,
        reason: 'EVENT_TRANSACTION_ID_REQUIRED',
        eventId: canonicalEventId
      };
    }

    const requestId = reversalRequestId({
      operation: rule.operation,
      transactionId
    });
    const requestRef = db.doc(`${REVERSAL_REQUESTS_COLLECTION}/${requestId}`);
    const now = requireDate(clock());

    return db.runTransaction(async tx => {
      const [freshEventSnap, requestSnap] = await Promise.all([
        tx.get(eventRef),
        tx.get(requestRef)
      ]);

      if (!freshEventSnap.exists) {
        return {
          reconciled: false,
          skipped: true,
          reason: 'EVENT_NOT_FOUND',
          eventId: canonicalEventId
        };
      }

      const event = freshEventSnap.data() || {};
      const freshRule = ruleForEventType(event.eventType);
      if (
        event.status !== 'processed' ||
        !freshRule ||
        freshRule.operation !== rule.operation
      ) {
        return {
          reconciled: false,
          skipped: true,
          reason: 'EVENT_STATE_CHANGED',
          eventId: canonicalEventId
        };
      }

      if (!requestSnap.exists) {
        return {
          reconciled: false,
          skipped: true,
          reason: 'ADMIN_REQUEST_NOT_FOUND',
          eventId: canonicalEventId,
          requestId
        };
      }

      const request = requestSnap.data() || {};
      if (!identityMatches(request, event, freshRule)) {
        return {
          reconciled: false,
          skipped: true,
          reviewRequired: true,
          reason: 'ADMIN_REQUEST_IDENTITY_MISMATCH',
          eventId: canonicalEventId,
          requestId
        };
      }

      const sameState = Boolean(
        request.status === freshRule.requestStatus &&
        request.providerLifecycleStatus === freshRule.providerLifecycleStatus &&
        (request.errorCode || null) === freshRule.errorCode &&
        request.lastWebhookEventId === canonicalEventId
      );
      if (sameState) {
        return {
          reconciled: true,
          idempotent: true,
          eventId: canonicalEventId,
          requestId,
          status: request.status,
          providerLifecycleStatus: request.providerLifecycleStatus || null
        };
      }

      const update = {
        status: freshRule.requestStatus,
        providerLifecycleStatus: freshRule.providerLifecycleStatus,
        errorCode: freshRule.errorCode,
        lastWebhookEventId: canonicalEventId,
        updatedAt: now
      };
      if (freshRule.terminal && freshRule.requestStatus === 'completed') {
        update.completedAt = request.completedAt || now;
      }
      if (freshRule.requestStatus === 'needs_reconciliation') {
        update.reconciliationRequiredAt = request.reconciliationRequiredAt || now;
      }

      tx.update(requestRef, update);
      tx.create(db.collection('audit_logs').doc(), {
        actorId: 'system:asaas-webhook',
        actorRole: 'system',
        action: auditAction(freshRule),
        entityType: 'financial_reversal_request',
        entityId: requestId,
        before: {
          status: request.status || null,
          providerLifecycleStatus: request.providerLifecycleStatus || null,
          errorCode: request.errorCode || null
        },
        after: {
          status: update.status,
          providerLifecycleStatus: update.providerLifecycleStatus,
          errorCode: update.errorCode
        },
        source: 'webhook',
        requestId: canonicalEventId,
        createdAt: now
      });

      return {
        reconciled: true,
        idempotent: false,
        eventId: canonicalEventId,
        requestId,
        status: update.status,
        providerLifecycleStatus: update.providerLifecycleStatus,
        reviewRequired: update.status === 'needs_reconciliation'
      };
    });
  }

  return {
    reconcileProcessedEvent
  };
}

module.exports = {
  RECONCILABLE_ADMIN_EVENTS,
  ruleForEventType,
  identityMatches,
  createFinancialReversalAdminRequestReconciler
};
