'use strict';

const {
  onCall,
  HttpsError
} = require(
  'firebase-functions/v2/https'
);

const {
  ExamCertificateServiceError,
  createExamCertificateService
} = require(
  './exam-certificate-service'
);

function requireAuth(
  request
) {
  const uid =
    request.auth?.uid;

  if (!uid) {
    throw new HttpsError(
      'unauthenticated',
      'Faça login para emitir seu certificado.'
    );
  }

  return uid;
}

function assertOnlyFields(
  data,
  allowedFields,
  operation
) {
  const input =
    data &&
    typeof data === 'object' &&
    !Array.isArray(data)
      ? data
      : {};

  const allowed =
    new Set(
      allowedFields
    );

  const extra =
    Object.keys(input)
      .filter(
        field =>
          !allowed.has(field)
      );

  if (extra.length) {
    throw new HttpsError(
      'invalid-argument',
      `${operation} contém campos não permitidos.`,
      {
        forbiddenFields:
          extra
      }
    );
  }

  return input;
}

function parseIdentifier(
  value,
  label
) {
  const id =
    String(
      value || ''
    ).trim();

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

function parseIssueInput(
  request
) {
  const actorId =
    requireAuth(
      request
    );

  const data =
    assertOnlyFields(
      request.data,
      [
        'registrationId'
      ],
      'Emissão do certificado oficial'
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

function parsePublicVerificationInput(
  request
) {
  const data =
    assertOnlyFields(
      request.data,
      [
        'certificateId'
      ],
      'Validação pública do certificado'
    );

  return {
    certificateId:
      parseIdentifier(
        data.certificateId,
        'certificateId'
      )
  };
}
function mapExamCertificateError(
  error
) {
  if (
    error instanceof
      HttpsError
  ) {
    throw error;
  }

  if (
    !(
      error instanceof
        ExamCertificateServiceError
    )
  ) {
    throw new HttpsError(
      'unavailable',
      'Não foi possível emitir o certificado agora.'
    );
  }

  const code =
    String(
      error.code ||
      'EXAM_CERTIFICATE_FAILED'
    );

  const invalidArgument =
    new Set([
      'INVALID_EXAM_CERTIFICATE_SERVICE_IDENTIFIER'
    ]);

  const permissionDenied =
    new Set([
      'EXAM_CERTIFICATE_STUDENT_MISMATCH'
    ]);

  const notFound =
    new Set([
      'EXAM_CERTIFICATE_REGISTRATION_NOT_FOUND',
      'EXAM_CERTIFICATE_RESULT_NOT_FOUND',
      'EXAM_CERTIFICATE_ATTEMPT_NOT_FOUND',
      'EXAM_CERTIFICATE_SESSION_NOT_FOUND',
      'EXAM_CERTIFICATE_TEMPLATE_NOT_FOUND',
      'EXAM_CERTIFICATE_TEMPLATE_VERSION_NOT_FOUND',
      'EXAM_CERTIFICATE_STUDENT_PROFILE_NOT_FOUND',
      'EXAM_CERTIFICATE_INSTRUCTOR_PROFILE_NOT_FOUND',
      'EXAM_CERTIFICATE_ORGANIZATION_NOT_FOUND',
      'EXAM_CERTIFICATE_NOT_FOUND'
    ]);

  let httpsCode =
    'failed-precondition';

  if (
    invalidArgument.has(code)
  ) {
    httpsCode =
      'invalid-argument';
  } else if (
    permissionDenied.has(code)
  ) {
    httpsCode =
      'permission-denied';
  } else if (
    notFound.has(code)
  ) {
    httpsCode =
      'not-found';
  }

  throw new HttpsError(
    httpsCode,
    error.message,
    {
      domainCode:
        code
    }
  );
}

function createExamCertificateFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db
  } = dependencies;

  if (
    !REGION ||
    !db
  ) {
    throw new Error(
      'Exam certificate functions: infraestrutura obrigatória ausente.'
    );
  }

  const service =
    createExamCertificateService({
      db
    });

  const emitirMeuCertificadoExameV12 =
    onCall(
      {
        region:
          REGION
      },
      async request => {
        const input =
          parseIssueInput(
            request
          );

        try {
          const result =
            await service.issueCertificate(
              input
            );

          return {
            ok:
              true,
            created:
              result.created,
            certificate:
              result.certificate
          };
        } catch (error) {
          mapExamCertificateError(
            error
          );
        }
      }
    );

  const validarCertificadoExamePublicoV12 =
    onCall(
      {
        region:
          REGION
      },
      async request => {
        const input =
          parsePublicVerificationInput(
            request
          );

        try {
          const certificate =
            await service.verifyPublicCertificate(
              input
            );

          return {
            ok:
              true,
            certificate
          };
        } catch (error) {
          mapExamCertificateError(
            error
          );
        }
      }
    );
  return Object.freeze({
    emitirMeuCertificadoExameV12,
    validarCertificadoExamePublicoV12
  });
}

module.exports = {
  requireAuth,
  assertOnlyFields,
  parseIdentifier,
  parseIssueInput,
  parsePublicVerificationInput,
  mapExamCertificateError,
  createExamCertificateFunctions
};