'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const {
  ExamUiSupportServiceError,
  createExamUiSupportService
} = require('./exam-ui-support-service');

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Faça login para consultar alunos elegíveis.');
  }
  return uid;
}

function assertOnlyFields(data, allowedFields) {
  const input = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : {};
  const allowed = new Set(allowedFields);
  const extra = Object.keys(input).filter(field => !allowed.has(field));
  if (extra.length) {
    throw new HttpsError(
      'invalid-argument',
      'Payload contém campos não permitidos.',
      { forbiddenFields: extra }
    );
  }
  return input;
}

function mapExamUiSupportError(error) {
  if (error instanceof HttpsError) throw error;
  if (!(error instanceof ExamUiSupportServiceError)) {
    throw new HttpsError(
      'unavailable',
      'Não foi possível consultar os alunos elegíveis agora.'
    );
  }

  const code = String(error.code || 'EXAM_UI_SUPPORT_FAILED');
  const permissionDenied = new Set([
    'EXAM_UI_SUPPORT_PERMISSION_REQUIRED'
  ]);
  const notFound = new Set([
    'EXAM_UI_SUPPORT_ORGANIZATION_NOT_FOUND'
  ]);
  const invalidArgument = new Set([
    'INVALID_EXAM_UI_SUPPORT_IDENTIFIER',
    'INVALID_EXAM_UI_SUPPORT_LIMIT'
  ]);
  const failedPrecondition = new Set([
    'EXAM_UI_SUPPORT_ORGANIZATION_NOT_ACTIVE'
  ]);

  let httpsCode = 'unavailable';
  if (permissionDenied.has(code)) httpsCode = 'permission-denied';
  else if (notFound.has(code)) httpsCode = 'not-found';
  else if (invalidArgument.has(code)) httpsCode = 'invalid-argument';
  else if (failedPrecondition.has(code)) httpsCode = 'failed-precondition';

  throw new HttpsError(
    httpsCode,
    error.message,
    { domainCode: code }
  );
}

function createExamUiSupportFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;
  if (!REGION || !db) {
    throw new Error('Exam UI support functions: infraestrutura obrigatória ausente.');
  }

  const service = createExamUiSupportService({ db });

  const listarAlunosElegiveisExameFaixaV12 = onCall(
    { region: REGION },
    async request => {
      const actorId = requireAuth(request);
      const data = assertOnlyFields(
        request.data,
        ['organizationId', 'limit']
      );

      try {
        const result = await service.listEligibleStudents({
          actorId,
          organizationId: data.organizationId,
          limit: data.limit
        });
        return {
          ok: true,
          ...result
        };
      } catch (error) {
        mapExamUiSupportError(error);
      }
    }
  );

  return Object.freeze({
    listarAlunosElegiveisExameFaixaV12
  });
}

module.exports = {
  requireAuth,
  assertOnlyFields,
  mapExamUiSupportError,
  createExamUiSupportFunctions
};
