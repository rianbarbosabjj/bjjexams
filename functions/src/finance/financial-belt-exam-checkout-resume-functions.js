'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const {
  assertOnlyFields,
  mapBeltExamCheckoutError
} = require('./financial-belt-exam-checkout-functions');
const {
  createFinancialBeltExamCheckoutResumeService
} = require('./financial-belt-exam-checkout-resume-service');

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Faça login para retomar o pagamento do exame.');
  }
  return uid;
}

function createFinancialBeltExamCheckoutResumeFunctions(dependencies = {}) {
  const {
    REGION,
    db,
    environment,
    providerFactory,
    secrets = [],
    clock = () => new Date()
  } = dependencies;

  if (!REGION || !db || typeof providerFactory !== 'function') {
    throw new Error('Belt exam checkout resume functions: infraestrutura obrigatória ausente.');
  }

  const retomarCheckoutExameFaixaV12 = onCall(
    {
      region: REGION,
      secrets
    },
    async request => {
      const uid = requireAuth(request);
      const data = request.data || {};
      assertOnlyFields(data, ['sessionId']);

      if (String(environment || '').trim().toLowerCase() !== 'sandbox') {
        throw new HttpsError(
          'failed-precondition',
          'Retomada de checkout de exame está disponível apenas em sandbox neste marco.'
        );
      }

      try {
        const provider = providerFactory();
        const service = createFinancialBeltExamCheckoutResumeService({
          db,
          provider,
          environment,
          clock
        });
        const result = await service.resumeBeltExamCheckout({
          buyerUserId: uid,
          sessionId: data.sessionId
        });

        return {
          ok: true,
          orderId: result.orderId,
          transactionId: result.transactionId,
          status: result.status,
          processing: result.processing,
          pix: result.pix
        };
      } catch (error) {
        mapBeltExamCheckoutError(error);
      }
    }
  );

  return Object.freeze({
    retomarCheckoutExameFaixaV12
  });
}

module.exports = {
  requireAuth,
  createFinancialBeltExamCheckoutResumeFunctions
};
