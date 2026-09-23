'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const {
  ExamReadServiceError,
  createExamReadService
} = require('./exam-read-service');

function requireAuth(request) {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Faça login para consultar exames.');
  }
  return uid;
}

function assertOnlyFields(data, allowedFields, operation) {
  const input = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : {};
  const allowed = new Set(allowedFields);
  const extra = Object.keys(input).filter(field => !allowed.has(field));
  if (extra.length) {
    throw new HttpsError(
      'invalid-argument',
      `${operation} contém campos não permitidos.`,
      { forbiddenFields: extra }
    );
  }
  return input;
}

function mapExamReadError(error) {
  if (error instanceof HttpsError) throw error;
  if (!(error instanceof ExamReadServiceError)) {
    throw new HttpsError(
      'unavailable',
      'Não foi possível consultar os exames agora.'
    );
  }

  const code = String(error.code || 'EXAM_READ_FAILED');
  const permissionDenied = new Set([
    'EXAM_READ_PERMISSION_REQUIRED'
  ]);
  const notFound = new Set([
    'EXAM_READ_SESSION_NOT_FOUND',
    'EXAM_READ_ORGANIZATION_NOT_FOUND',
    'EXAM_READ_RESULT_NOT_FOUND',
    'EXAM_READ_CERTIFICATE_NOT_FOUND'
  ]);
  const invalidArgument = new Set([
    'INVALID_EXAM_READ_IDENTIFIER',
    'INVALID_EXAM_READ_LIMIT'
  ]);
  const failedPrecondition = new Set([
    'EXAM_READ_CANONICAL_STATE_INVALID'
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

function createExamReadFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;
  if (!REGION || !db) {
    throw new Error('Exam read functions: infraestrutura obrigatória ausente.');
  }

  const service = createExamReadService({ db });

  async function invoke(request, operation) {
    const actorId = requireAuth(request);
    try {
      return await operation(actorId);
    } catch (error) {
      mapExamReadError(error);
    }
  }

  const listarSessoesExameFaixaV12 = onCall(
    { region: REGION },
    async request => {
      const data = assertOnlyFields(
        request.data,
        ['organizationId', 'limit'],
        'Listagem de sessões de exame'
      );
      return invoke(request, async actorId => ({
        ok: true,
        ...await service.listInstructorSessions({
          actorId,
          organizationId: data.organizationId,
          limit: data.limit
        })
      }));
    }
  );

  const obterSessaoExameFaixaV12 = onCall(
    { region: REGION },
    async request => {
      const data = assertOnlyFields(
        request.data,
        ['sessionId'],
        'Consulta de sessão de exame'
      );
      return invoke(request, async actorId => ({
        ok: true,
        ...await service.getInstructorSession({
          actorId,
          sessionId: data.sessionId
        })
      }));
    }
  );

  const listarMeusExamesFaixaV12 = onCall(
    { region: REGION },
    async request => {
      const data = assertOnlyFields(
        request.data,
        ['limit'],
        'Listagem de exames do aluno'
      );
      return invoke(request, async actorId => ({
        ok: true,
        ...await service.listStudentExams({
          actorId,
          limit: data.limit
        })
      }));
    }
  );

  return Object.freeze({
    listarSessoesExameFaixaV12,
    obterSessaoExameFaixaV12,
    listarMeusExamesFaixaV12
  });
}

module.exports = {
  requireAuth,
  assertOnlyFields,
  mapExamReadError,
  createExamReadFunctions
};
