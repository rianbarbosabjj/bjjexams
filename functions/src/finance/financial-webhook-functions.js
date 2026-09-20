'use strict';

const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const {
  WEBHOOK_AUTH_HEADER,
  FinancialWebhookDomainError,
  verifyWebhookAuthToken
} = require('./financial-webhook-domain');
const {
  FinancialWebhookPersistenceError,
  createFinancialWebhookPersistence
} = require('./financial-webhook-persistence');
const {
  FinancialWebhookFulfillmentError,
  createFinancialWebhookFulfillment
} = require('./financial-webhook-fulfillment');
const {
  FinancialBeltExamWebhookFulfillmentError,
  isBeltExamPaymentConfirmation,
  createFinancialBeltExamWebhookFulfillment
} = require('./financial-belt-exam-webhook-fulfillment');
const {
  FinancialReversalFulfillmentError,
  createFinancialReversalFulfillment
} = require('./financial-reversal-fulfillment');
const {
  createFinancialReversalAdminRequestReconciler
} = require('./financial-reversal-admin-request-reconciler');

const WEBHOOK_EVENT_DOCUMENT = 'payment_webhook_events/{eventId}';

function normalizeSecretList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function readHeader(req, name) {
  const headers = req?.headers || {};
  const value = headers[String(name || '').toLowerCase()];
  if (Array.isArray(value)) return String(value[0] || '');
  return String(value || '');
}

function sendJson(res, statusCode, body) {
  res.status(statusCode);
  res.set('content-type', 'application/json; charset=utf-8');
  return res.send(JSON.stringify(body));
}

function createWebhookIngressHandler({
  persistence,
  webhookTokenResolver
} = {}) {
  if (!persistence || typeof persistence.registerWebhookEvent !== 'function') {
    throw new TypeError('Webhook ingress exige persistence.registerWebhookEvent().');
  }
  if (typeof webhookTokenResolver !== 'function') {
    throw new TypeError('Webhook ingress exige webhookTokenResolver().');
  }

  return async function webhookIngressHandler(req, res) {
    if (String(req?.method || '').toUpperCase() !== 'POST') {
      res.set('allow', 'POST');
      return sendJson(res, 405, {
        ok: false,
        error: 'METHOD_NOT_ALLOWED'
      });
    }

    let expectedToken;
    try {
      expectedToken = String(webhookTokenResolver() || '');
    } catch (_error) {
      return sendJson(res, 503, {
        ok: false,
        error: 'WEBHOOK_AUTH_UNAVAILABLE'
      });
    }

    const receivedToken = readHeader(req, WEBHOOK_AUTH_HEADER);
    if (!receivedToken) {
      return sendJson(res, 401, {
        ok: false,
        error: 'WEBHOOK_AUTH_REQUIRED'
      });
    }
    if (!verifyWebhookAuthToken(receivedToken, expectedToken)) {
      return sendJson(res, 403, {
        ok: false,
        error: 'WEBHOOK_AUTH_INVALID'
      });
    }

    const payload = req?.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return sendJson(res, 400, {
        ok: false,
        error: 'INVALID_WEBHOOK_BODY'
      });
    }

    try {
      const result = await persistence.registerWebhookEvent({ payload });
      return sendJson(res, 202, {
        ok: true,
        accepted: true,
        duplicate: result.duplicate === true,
        status: result.status
      });
    } catch (error) {
      if (error instanceof FinancialWebhookDomainError) {
        return sendJson(res, 400, {
          ok: false,
          error: error.code
        });
      }
      if (error instanceof FinancialWebhookPersistenceError) {
        const status = error.code === 'WEBHOOK_EVENT_REDELIVERY_MISMATCH'
          ? 409
          : 400;
        return sendJson(res, status, {
          ok: false,
          error: error.code
        });
      }
      console.error('financial-webhook-ingress-error', {
        name: error?.name || 'Error'
      });
      return sendJson(res, 500, {
        ok: false,
        error: 'WEBHOOK_PERSISTENCE_FAILED'
      });
    }
  };
}

function createWebhookWorkerHandler({
  db,
  providerFactory,
  clock = () => new Date()
} = {}) {
  if (!db || typeof db.doc !== 'function') {
    throw new TypeError('Webhook worker exige Firestore válido.');
  }
  if (typeof providerFactory !== 'function') {
    throw new TypeError('Webhook worker exige providerFactory().');
  }

  return async function webhookWorkerHandler(event) {
    const eventId = String(event?.params?.eventId || '').trim();
    const snapshot = event?.data || null;
    const data = snapshot && typeof snapshot.data === 'function'
      ? snapshot.data()
      : null;

    if (!eventId || !data) {
      return { processed: false, skipped: true, reason: 'EVENT_DATA_REQUIRED' };
    }

    if (data.status === 'ignored') {
      return { processed: false, ignored: true, eventId };
    }

    if (
      data.status !== 'received' ||
      !['confirm_payment', 'reconcile_reversal'].includes(data.processingAction)
    ) {
      return {
        processed: false,
        skipped: true,
        eventId,
        reason: 'EVENT_NOT_PROCESSABLE'
      };
    }

    const reversalFulfillment = createFinancialReversalFulfillment({
      db,
      clock
    });
    const adminRequestReconciler = createFinancialReversalAdminRequestReconciler({
      db,
      clock
    });

    try {
      const reversalResult = await reversalFulfillment.processWebhookEvent({
        eventId
      });

      if (reversalResult?.delegatedToConfirmation !== true) {
        const adminRequestReconciliation =
          await adminRequestReconciler.reconcileProcessedEvent({ eventId });
        return {
          ...reversalResult,
          adminRequestReconciliation
        };
      }

      const provider = providerFactory();
      const beltExam = await isBeltExamPaymentConfirmation({
        db,
        event: data
      });

      if (beltExam) {
        const fulfillment = createFinancialBeltExamWebhookFulfillment({
          db,
          provider,
          clock
        });
        return await fulfillment.processWebhookEvent({ eventId });
      }

      const fulfillment = createFinancialWebhookFulfillment({
        db,
        provider,
        clock
      });
      return await fulfillment.processWebhookEvent({ eventId });
    } catch (error) {
      if (
        error instanceof FinancialReversalFulfillmentError &&
        error.retryable !== true
      ) {
        return {
          processed: false,
          error: true,
          eventId,
          errorCode: error.code
        };
      }
      if (
        error instanceof FinancialBeltExamWebhookFulfillmentError &&
        error.retryable !== true
      ) {
        return {
          processed: false,
          error: true,
          eventId,
          errorCode: error.code
        };
      }
      if (
        error instanceof FinancialWebhookFulfillmentError &&
        error.retryable !== true
      ) {
        return {
          processed: false,
          error: true,
          eventId,
          errorCode: error.code
        };
      }
      throw error;
    }
  };
}

function createFinancialWebhookFunctions(dependencies = {}) {
  const {
    REGION,
    db,
    providerFactory,
    webhookTokenResolver,
    ingressSecrets = [],
    workerSecrets = [],
    clock = () => new Date()
  } = dependencies;

  if (!REGION || !db) {
    throw new Error('Financial webhook: infraestrutura obrigatória ausente.');
  }

  const persistence = createFinancialWebhookPersistence({ db, clock });
  const ingressHandler = createWebhookIngressHandler({
    persistence,
    webhookTokenResolver
  });
  const workerHandler = createWebhookWorkerHandler({
    db,
    providerFactory,
    clock
  });

  const ingressSecretList = normalizeSecretList(ingressSecrets);
  const workerSecretList = normalizeSecretList(workerSecrets);
  const ingressOptions = {
    region: REGION,
    ...(ingressSecretList.length ? { secrets: ingressSecretList } : {})
  };
  const workerOptions = {
    region: REGION,
    document: WEBHOOK_EVENT_DOCUMENT,
    retry: true,
    ...(workerSecretList.length ? { secrets: workerSecretList } : {})
  };

  return {
    webhookAsaasPagamentosV12: onRequest(
      ingressOptions,
      ingressHandler
    ),
    processarWebhookPagamentoV12: onDocumentCreated(
      workerOptions,
      workerHandler
    )
  };
}

module.exports = {
  WEBHOOK_EVENT_DOCUMENT,
  readHeader,
  sendJson,
  createWebhookIngressHandler,
  createWebhookWorkerHandler,
  createFinancialWebhookFunctions
};
