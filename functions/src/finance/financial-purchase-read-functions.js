'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const {
  FinancialPurchaseReadDomainError
} = require('./financial-purchase-read-domain');
const {
  FinancialPurchaseReadServiceError,
  createFinancialPurchaseReadService
} = require('./financial-purchase-read-service');
const {
  createFinancialStudentPurchaseHistoryService
} = require('./financial-student-purchase-history-service');

function assertOnlyFields(data, allowed) {
  const forbidden = Object.keys(data || {}).filter(key => !allowed.includes(key));
  if (forbidden.length) {
    throw new HttpsError(
      'invalid-argument',
      'Payload contém campos não permitidos.',
      { forbiddenFields: forbidden }
    );
  }
}

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Faça login para consultar informações financeiras.'
    );
  }
  return uid;
}

function mapReadError(error) {
  if (error instanceof HttpsError) throw error;

  const known =
    error instanceof FinancialPurchaseReadDomainError ||
    error instanceof FinancialPurchaseReadServiceError;

  if (!known) {
    throw new HttpsError(
      'unavailable',
      'Não foi possível consultar o estado da compra agora.'
    );
  }

  const code = error.code || 'PURCHASE_READ_ERROR';

  if (code === 'PURCHASE_COURSE_NOT_FOUND') {
    throw new HttpsError('not-found', error.message, { domainCode: code });
  }

  if (code === 'FINANCIAL_ADMIN_PERMISSION_REQUIRED') {
    throw new HttpsError('permission-denied', error.message, { domainCode: code });
  }

  const invalidArgument = new Set([
    'INVALID_PURCHASE_READ_IDENTIFIER',
    'INVALID_PURCHASE_READ_ID',
    'INVALID_PURCHASE_ADMIN_LIMIT',
    'INVALID_PURCHASE_STUDENT_LIMIT'
  ]);
  if (invalidArgument.has(code)) {
    throw new HttpsError('invalid-argument', error.message, { domainCode: code });
  }

  const failedPrecondition = new Set([
    'PURCHASE_COURSE_NOT_AVAILABLE',
    'PURCHASE_COURSE_NOT_PAID',
    'PURCHASE_COURSE_PRICE_INVALID',
    'PURCHASE_ENROLLMENT_INVALID',
    'PURCHASE_ORDER_REQUIRED_FOR_ENTITLEMENT',
    'PURCHASE_ORDER_REQUIRED_FOR_PAID_ENROLLMENT',
    'PURCHASE_ORDER_INVALID',
    'PURCHASE_ORDER_IDENTITY_MISMATCH',
    'PURCHASE_TRANSACTION_REQUIRED',
    'PURCHASE_TRANSACTION_INVALID',
    'PURCHASE_TRANSACTION_IDENTITY_MISMATCH',
    'PURCHASE_FINANCIAL_STATE_MISMATCH',
    'PURCHASE_ENROLLMENT_IDENTITY_MISMATCH',
    'PURCHASE_ENROLLMENT_ORDER_MISMATCH',
    'PURCHASE_STATE_UNSUPPORTED',
    'PURCHASE_ADMIN_CANONICAL_STATE_INVALID',
    'PURCHASE_STUDENT_HISTORY_CANONICAL_STATE_INVALID'
  ]);
  if (failedPrecondition.has(code)) {
    throw new HttpsError(
      'failed-precondition',
      error.message,
      { domainCode: code }
    );
  }

  throw new HttpsError(
    'unavailable',
    'Não foi possível consultar o estado da compra agora.',
    { domainCode: code }
  );
}

function createFinancialPurchaseReadFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;
  if (!REGION || !db) {
    throw new Error('Purchase read functions: infraestrutura obrigatória ausente.');
  }

  const service = createFinancialPurchaseReadService({ db });
  const studentHistoryService = createFinancialStudentPurchaseHistoryService({ db });

  const obterStatusCompraCursoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      const data = request.data || {};
      assertOnlyFields(data, ['courseId']);

      try {
        const purchase = await service.getStudentCoursePurchase({
          userId: uid,
          courseId: data.courseId
        });
        return { ok: true, purchase };
      } catch (error) {
        mapReadError(error);
      }
    }
  );

  const listarComprasCursosAlunoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      const data = request.data || {};
      assertOnlyFields(data, ['limit']);

      try {
        const result = await studentHistoryService.listStudentCoursePurchases({
          userId: uid,
          limit: data.limit
        });
        return { ok: true, ...result };
      } catch (error) {
        mapReadError(error);
      }
    }
  );

  const listarOperacoesFinanceirasCursosV12 = onCall(
    { region: REGION },
    async request => {
      requireAuth(request);
      const data = request.data || {};
      assertOnlyFields(data, ['limit']);

      try {
        const result = await service.listAdminCoursePurchases({
          claims: request.auth?.token || {},
          limit: data.limit
        });
        return { ok: true, ...result };
      } catch (error) {
        mapReadError(error);
      }
    }
  );

  return {
    obterStatusCompraCursoV12,
    listarComprasCursosAlunoV12,
    listarOperacoesFinanceirasCursosV12
  };
}

module.exports = {
  assertOnlyFields,
  mapReadError,
  createFinancialPurchaseReadFunctions
};
