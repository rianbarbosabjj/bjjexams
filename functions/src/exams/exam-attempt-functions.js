'use strict';

const {
  onCall,
  HttpsError
} = require('firebase-functions/v2/https');

const {
  ExamAttemptServiceError,
  createExamAttemptService
} = require('./exam-attempt-service');

function createExamAttemptFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db
  } = dependencies;

  if (!REGION || !db) {
    throw new Error(
      'Exam attempt functions: infraestrutura obrigatória ausente.'
    );
  }

  const service =
    createExamAttemptService({
      db
    });

  function requireAuth(request) {
    const uid =
      request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        'unauthenticated',
        'Faça login para continuar.'
      );
    }

    return uid;
  }

  function assertAllowedFields(
    data,
    allowedFields,
    operation
  ) {
    const allowed =
      new Set(allowedFields);

    const extra =
      Object.keys(data || {})
        .filter(
          field =>
            !allowed.has(field)
        );

    if (extra.length) {
      throw new HttpsError(
        'invalid-argument',
        `${operation} contém campos não permitidos: ${extra.join(', ')}.`
      );
    }
  }

  function parseIdentifier(
    value,
    label
  ) {
    const id =
      String(value || '').trim();

    if (
      !id ||
      id.length > 200 ||
      id.includes('/')
    ) {
      throw new HttpsError(
        'invalid-argument',
        `${label} inválido.`
      );
    }

    return id;
  }

  function throwMapped(error) {
    if (
      !(
        error instanceof
          ExamAttemptServiceError
      )
    ) {
      throw error;
    }

    const code =
      error.code ||
      'EXAM_ATTEMPT_FAILED';

    const permissionDenied =
      new Set([
        'EXAM_ATTEMPT_STUDENT_MISMATCH',
        'EXAM_ATTEMPT_ACTIVE_STUDENT_MEMBERSHIP_REQUIRED'
      ]);

    const notFound =
      new Set([
        'EXAM_ATTEMPT_REGISTRATION_NOT_FOUND',
        'EXAM_ATTEMPT_SESSION_NOT_FOUND',
        'EXAM_ATTEMPT_ORGANIZATION_NOT_FOUND',
        'EXAM_ATTEMPT_MEMBERSHIP_NOT_FOUND',
        'EXAM_ATTEMPT_ORDER_NOT_FOUND',
        'EXAM_ATTEMPT_TRANSACTION_NOT_FOUND',
        'EXAM_ATTEMPT_TEMPLATE_NOT_FOUND',
        'EXAM_ATTEMPT_TEMPLATE_VERSION_NOT_FOUND',
        'EXAM_ATTEMPT_QUESTION_NOT_FOUND',
        'EXAM_ATTEMPT_NOT_FOUND'
      ]);

    const failedPrecondition =
      new Set([
        'EXAM_ATTEMPT_REGISTRATION_INVALID',
        'EXAM_ATTEMPT_SESSION_INVALID',
        'EXAM_ATTEMPT_TEMPLATE_INVALID',
        'EXAM_ATTEMPT_TEMPLATE_VERSION_INVALID',
        'EXAM_ATTEMPT_TEMPLATE_VERSION_ID_MISMATCH',
        'EXAM_ATTEMPT_ORDER_INVALID',
        'EXAM_ATTEMPT_TRANSACTION_INVALID',
        'EXAM_ATTEMPT_ORGANIZATION_NOT_ACTIVE',
        'EXAM_ATTEMPT_SESSION_REGISTRATION_MISMATCH',
        'EXAM_ATTEMPT_SESSION_NOT_EXECUTABLE',
        'EXAM_ATTEMPT_TEMPLATE_REQUIRED',
        'EXAM_ATTEMPT_ORDER_MISMATCH',
        'EXAM_ATTEMPT_PAYMENT_NOT_CONFIRMED',
        'EXAM_ATTEMPT_ORDER_IDENTITY_MISMATCH',
        'EXAM_ATTEMPT_TRANSACTION_IDENTITY_MISMATCH',
        'EXAM_ATTEMPT_FINANCIAL_AMOUNT_MISMATCH',
        'EXAM_ATTEMPT_FINANCIAL_SNAPSHOT_MISMATCH',
        'EXAM_ATTEMPT_TEMPLATE_BELT_MISMATCH',
        'EXAM_ATTEMPT_TEMPLATE_VERSION_MISMATCH',
        'EXAM_ATTEMPT_TEMPLATE_VERSION_NOT_EXECUTABLE',
        'EXAM_ATTEMPT_TEMPLATE_BINDING_MISMATCH',
        'EXAM_ATTEMPT_EXISTING_IDENTITY_MISMATCH',
        'EXAM_ATTEMPT_EXISTING_QUESTION_ORDER_MISMATCH',
        'EXAM_ATTEMPT_REGISTRATION_NOT_STARTABLE',
        'EXAM_ATTEMPT_STATE_INCONSISTENT',
        'EXAM_ATTEMPT_NOT_AVAILABLE',
        'EXAM_ATTEMPT_NOT_RESUMABLE',
        'EXAM_ATTEMPT_EXPIRED'
      ]);

    let httpsCode =
      'invalid-argument';

    if (
      permissionDenied.has(code)
    ) {
      httpsCode =
        'permission-denied';
    } else if (
      notFound.has(code)
    ) {
      httpsCode =
        'not-found';
    } else if (
      failedPrecondition.has(code)
    ) {
      httpsCode =
        'failed-precondition';
    }

    throw new HttpsError(
      httpsCode,
      error.message,
      {
        domainCode: code
      }
    );
  }

  function parseRegistrationInput(
    request,
    operation
  ) {
    const actorId =
      requireAuth(request);

    const data =
      request.data || {};

    assertAllowedFields(
      data,
      ['registrationId'],
      operation
    );

    return {
      actorId,
      registrationId:
        parseIdentifier(
          data.registrationId,
          'registrationId'
        )
    };
  }

  const iniciarExameOficialV12 =
    onCall(
      {
        region: REGION
      },
      async request => {
        const input =
          parseRegistrationInput(
            request,
            'Início da prova oficial'
          );

        try {
          const result =
            await service.startAttempt(
              input
            );

          return {
            ok: true,
            created:
              result.created,
            resumed:
              result.resumed,
            attempt:
              result.attempt,
            questions:
              result.questions
          };
        } catch (error) {
          throwMapped(error);
        }
      }
    );

  const obterTentativaExameOficialV12 =
    onCall(
      {
        region: REGION
      },
      async request => {
        const input =
          parseRegistrationInput(
            request,
            'Retomada da prova oficial'
          );

        try {
          const result =
            await service.getAttempt(
              input
            );

          return {
            ok: true,
            resumed:
              result.resumed,
            attempt:
              result.attempt,
            questions:
              result.questions
          };
        } catch (error) {
          throwMapped(error);
        }
      }
    );

  return {
    iniciarExameOficialV12,
    obterTentativaExameOficialV12
  };
}

module.exports = {
  createExamAttemptFunctions
};