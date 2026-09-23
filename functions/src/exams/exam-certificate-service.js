'use strict';

const {
  ExamCertificateDomainError,
  examCertificateDocumentId,
  buildExamCertificate,
  assertExamCertificateDocumentIdentity,
  publicExamCertificate
} = require(
  './exam-certificate-domain'
);

const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  validateExamRegistration,
  markRegistrationCertified
} = require(
  './exam-registration-domain'
);

const {
  ExamResultDomainError,
  assertExamResultDocumentIdentity
} = require(
  './exam-result-domain'
);

const {
  ExamAttemptDomainError,
  assertExamAttemptDocumentIdentity
} = require(
  './exam-attempt-domain'
);

const {
  ExamSessionDomainError,
  validateExamSession
} = require(
  './exam-session-domain'
);

const {
  ExamTemplateDomainError,
  validateExamTemplate,
  validateExamTemplateVersion,
  examTemplateVersionDocumentId
} = require(
  './exam-template-domain'
);

class ExamCertificateServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name =
      'ExamCertificateServiceError';
    this.code = code;
  }
}

function text(
  value,
  max = 200
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value).trim();

  return normalized
    ? normalized.slice(0, max)
    : null;
}

function requiredIdentifier(
  value,
  field
) {
  const id =
    text(value, 200);

  if (
    !id ||
    id.includes('/')
  ) {
    throw new ExamCertificateServiceError(
      'INVALID_EXAM_CERTIFICATE_SERVICE_IDENTIFIER',
      `${field} inválido.`
    );
  }

  return id;
}

function timestampMillis(
  value
) {
  if (value instanceof Date) {
    return value.getTime();
  }

  if (
    value &&
    typeof value.toMillis ===
      'function'
  ) {
    return Number(
      value.toMillis()
    );
  }

  if (
    value &&
    typeof value.toDate ===
      'function'
  ) {
    const date =
      value.toDate();

    if (date instanceof Date) {
      return date.getTime();
    }
  }

  return Number.NaN;
}

function sameTimestamp(
  left,
  right
) {
  const a =
    timestampMillis(left);

  const b =
    timestampMillis(right);

  return (
    Number.isFinite(a) &&
    Number.isFinite(b) &&
    a === b
  );
}

function throwDomainAsService(
  error
) {
  if (
    error instanceof
      ExamCertificateDomainError ||
    error instanceof
      ExamRegistrationDomainError ||
    error instanceof
      ExamResultDomainError ||
    error instanceof
      ExamAttemptDomainError ||
    error instanceof
      ExamSessionDomainError ||
    error instanceof
      ExamTemplateDomainError
  ) {
    throw new ExamCertificateServiceError(
      error.code,
      error.message
    );
  }

  throw error;
}

function documentName(
  snapshot,
  notFoundCode,
  nameRequiredCode,
  label
) {
  if (!snapshot?.exists) {
    throw new ExamCertificateServiceError(
      notFoundCode,
      `${label} não encontrado.`
    );
  }

  const name =
    text(
      snapshot.data()?.nome,
      200
    );

  if (!name) {
    throw new ExamCertificateServiceError(
      nameRequiredCode,
      `${label} não possui nome válido.`
    );
  }

  return name;
}

function assertCoreChain(
  input
) {
  const {
    registrationId,
    registration,
    resultId,
    result,
    attemptId,
    attempt,
    sessionId,
    session,
    templateId,
    template,
    templateVersionId,
    templateVersion,
    templateVersionDocumentId
  } = input;

  const expectedRegistrationId =
    examRegistrationDocumentId({
      sessionId:
        registration.sessionId,
      studentId:
        registration.studentId
    });

  if (
    expectedRegistrationId !==
      registrationId
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_REGISTRATION_ID_MISMATCH',
      'registrationId não corresponde à sessão e ao aluno.'
    );
  }

  if (
    registration.resultId !==
      resultId ||
    registration.attemptId !==
      attemptId ||
    registration.sessionId !==
      sessionId
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_CHAIN_MISMATCH',
      'Registration diverge da cadeia acadêmica.'
    );
  }

  if (
    result.registrationId !==
      registrationId ||
    result.attemptId !==
      attemptId ||
    result.sessionId !==
      sessionId ||
    result.organizationId !==
      registration.organizationId ||
    result.studentId !==
      registration.studentId ||
    result.targetBelt !==
      registration.targetBelt
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_CHAIN_MISMATCH',
      'Resultado diverge da registration.'
    );
  }

  if (
    attempt.registrationId !==
      registrationId ||
    attempt.sessionId !==
      sessionId ||
    attempt.organizationId !==
      registration.organizationId ||
    attempt.studentId !==
      registration.studentId ||
    attempt.resultId !==
      resultId ||
    attempt.status !==
      'submitted'
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_CHAIN_MISMATCH',
      'Tentativa diverge da cadeia acadêmica.'
    );
  }

  if (
    session.organizationId !==
      registration.organizationId ||
    session.responsibleInstructorId !==
      registration.instructorId ||
    session.targetBelt !==
      registration.targetBelt
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_CHAIN_MISMATCH',
      'Sessão diverge da registration.'
    );
  }

  if (
    !session.templateId ||
    !session.templateVersionId ||
    session.templateId !==
      templateId ||
    session.templateVersionId !==
      templateVersionId ||
    attempt.templateId !==
      templateId ||
    attempt.templateVersionId !==
      templateVersionId ||
    result.templateId !==
      templateId ||
    result.templateVersionId !==
      templateVersionId
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_CHAIN_MISMATCH',
      'Template congelado diverge da cadeia acadêmica.'
    );
  }

  if (
    template.targetBelt !==
      registration.targetBelt ||
    templateVersion.templateId !==
      templateId
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_CHAIN_MISMATCH',
      'Template oficial diverge da cadeia acadêmica.'
    );
  }

  const expectedVersionDocumentId =
    examTemplateVersionDocumentId(
      templateVersion.version
    );

  if (
    expectedVersionDocumentId !==
      templateVersionDocumentId ||
    expectedVersionDocumentId !==
      templateVersionId
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_CHAIN_MISMATCH',
      'Versão documental do template diverge da sessão.'
    );
  }

  if (
    result.outcome !==
      'passed' ||
    result.certificateEligible !==
      true
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_RESULT_NOT_ELIGIBLE',
      'Resultado não está elegível para certificado.'
    );
  }
}

function assertExistingCertificateMatches(
  certificate,
  expected
) {
  const fields = [
    'registrationId',
    'resultId',
    'attemptId',
    'sessionId',
    'organizationId',
    'studentId',
    'instructorId',
    'templateId',
    'templateVersionId',
    'targetBelt',
    'scoreBps',
    'correctCount',
    'totalQuestions'
  ];

  for (const field of fields) {
    if (
      certificate[field] !==
        expected[field]
    ) {
      throw new ExamCertificateServiceError(
        'EXAM_CERTIFICATE_EXISTING_CONFLICT',
        `Certificado existente diverge em ${field}.`
      );
    }
  }

  if (
    !sameTimestamp(
      certificate.resultFinalizedAt,
      expected.resultFinalizedAt
    )
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_EXISTING_CONFLICT',
      'Certificado existente diverge no timestamp do resultado.'
    );
  }

  if (
    certificate.issuedBy !==
      expected.studentId
  ) {
    throw new ExamCertificateServiceError(
      'EXAM_CERTIFICATE_EXISTING_CONFLICT',
      'Certificado existente possui emissor incompatível.'
    );
  }
}

function createExamCertificateService(
  dependencies = {}
) {
  const {
    db,
    clock = () =>
      new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !==
      'function' ||
    typeof db.collection !==
      'function' ||
    typeof db.runTransaction !==
      'function'
  ) {
    throw new TypeError(
      'Exam certificate service exige Firestore válido.'
    );
  }

  function timestamp() {
    const value =
      clock();

    const date =
      value instanceof Date
        ? new Date(
            value.getTime()
          )
        : new Date(value);

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      throw new ExamCertificateServiceError(
        'INVALID_EXAM_CERTIFICATE_CLOCK',
        'Relógio do serviço retornou timestamp inválido.'
      );
    }

    return date;
  }

  async function issueCertificate(
    input = {}
  ) {
    const actorId =
      requiredIdentifier(
        input.actorId,
        'actorId'
      );

    const registrationId =
      requiredIdentifier(
        input.registrationId,
        'registrationId'
      );

    const registrationRef =
      db.doc(
        `exam_registrations/${registrationId}`
      );

    const auditRef =
      db.collection(
        'audit_logs'
      ).doc();

    const now =
      timestamp();

    let response =
      null;

    await db.runTransaction(
      async tx => {
        const registrationSnap =
          await tx.get(
            registrationRef
          );

        if (
          !registrationSnap.exists
        ) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_REGISTRATION_NOT_FOUND',
            'Registration de exame não encontrada.'
          );
        }

        let registration;

        try {
          registration =
            validateExamRegistration(
              registrationSnap.data() ||
                {}
            );
        } catch (error) {
          throwDomainAsService(error);
        }

        if (
          registration.studentId !==
            actorId
        ) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_STUDENT_MISMATCH',
            'Somente o aluno proprietário pode emitir este certificado.'
          );
        }

        if (
          ![
            'passed',
            'certified'
          ].includes(
            registration.status
          )
        ) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_REGISTRATION_STATE_REQUIRED',
            'Emissão exige registration passed.'
          );
        }

        const resultId =
          requiredIdentifier(
            registration.resultId,
            'resultId'
          );

        const attemptId =
          requiredIdentifier(
            registration.attemptId,
            'attemptId'
          );

        const sessionId =
          requiredIdentifier(
            registration.sessionId,
            'sessionId'
          );

        const templateId =
          null;

        const certificateId =
          examCertificateDocumentId(
            resultId
          );

        const resultRef =
          db.doc(
            `exam_results/${resultId}`
          );

        const attemptRef =
          db.doc(
            `exam_attempts/${attemptId}`
          );

        const sessionRef =
          db.doc(
            `exam_sessions/${sessionId}`
          );

        const certificateRef =
          db.doc(
            `exam_certificates/${certificateId}`
          );

        const [
          resultSnap,
          attemptSnap,
          sessionSnap,
          certificateSnap
        ] =
          await Promise.all([
            tx.get(resultRef),
            tx.get(attemptRef),
            tx.get(sessionRef),
            tx.get(certificateRef)
          ]);

        if (!resultSnap.exists) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_RESULT_NOT_FOUND',
            'Resultado acadêmico não encontrado.'
          );
        }

        if (!attemptSnap.exists) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_ATTEMPT_NOT_FOUND',
            'Tentativa acadêmica não encontrada.'
          );
        }

        if (!sessionSnap.exists) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_SESSION_NOT_FOUND',
            'Sessão de exame não encontrada.'
          );
        }

        let result;
        let attempt;
        let session;

        try {
          result =
            assertExamResultDocumentIdentity(
              resultId,
              resultSnap.data() ||
                {}
            );

          attempt =
            assertExamAttemptDocumentIdentity(
              attemptId,
              attemptSnap.data() ||
                {}
            );

          session =
            validateExamSession(
              sessionSnap.data() ||
                {}
            );
        } catch (error) {
          throwDomainAsService(error);
        }

        const resolvedTemplateId =
          requiredIdentifier(
            result.templateId,
            'templateId'
          );

        const templateVersionId =
          requiredIdentifier(
            result.templateVersionId,
            'templateVersionId'
          );

        const templateRef =
          db.doc(
            `exam_templates/${resolvedTemplateId}`
          );

        const templateVersionRef =
          db.doc(
            `exam_templates/${resolvedTemplateId}` +
            `/versions/${templateVersionId}`
          );

        const [
          templateSnap,
          templateVersionSnap
        ] =
          await Promise.all([
            tx.get(templateRef),
            tx.get(templateVersionRef)
          ]);

        if (!templateSnap.exists) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_TEMPLATE_NOT_FOUND',
            'Template oficial não encontrado.'
          );
        }

        if (
          !templateVersionSnap.exists
        ) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_TEMPLATE_VERSION_NOT_FOUND',
            'Versão congelada do template não encontrada.'
          );
        }

        let template;
        let templateVersion;

        try {
          template =
            validateExamTemplate(
              templateSnap.data() ||
                {}
            );

          templateVersion =
            validateExamTemplateVersion(
              templateVersionSnap.data() ||
                {}
            );
        } catch (error) {
          throwDomainAsService(error);
        }

        assertCoreChain({
          registrationId,
          registration,
          resultId,
          result,
          attemptId,
          attempt,
          sessionId,
          session,
          templateId:
            resolvedTemplateId,
          template,
          templateVersionId,
          templateVersion,
          templateVersionDocumentId:
            templateVersionSnap.id
        });

        const expectedCertificate = {
          registrationId,
          resultId,
          attemptId,
          sessionId,
          organizationId:
            registration.organizationId,
          studentId:
            registration.studentId,
          instructorId:
            registration.instructorId,
          templateId:
            resolvedTemplateId,
          templateVersionId,
          targetBelt:
            registration.targetBelt,
          scoreBps:
            result.scoreBps,
          correctCount:
            result.correctCount,
          totalQuestions:
            result.totalQuestions,
          resultFinalizedAt:
            result.finalizedAt
        };

        if (
          certificateSnap.exists
        ) {
          let existingCertificate;

          try {
            existingCertificate =
              assertExamCertificateDocumentIdentity(
                certificateId,
                certificateSnap.data() ||
                  {}
              );
          } catch (error) {
            throwDomainAsService(error);
          }

          if (
            registration.status !==
              'certified' ||
            registration.certificateId !==
              certificateId
          ) {
            throw new ExamCertificateServiceError(
              'EXAM_CERTIFICATE_STATE_INCONSISTENT',
              'Certificado existe sem registration certified correspondente.'
            );
          }

          assertExistingCertificateMatches(
            existingCertificate,
            expectedCertificate
          );

          response = {
            created: false,
            certificate:
              publicExamCertificate(
                certificateId,
                existingCertificate
              )
          };

          return;
        }

        if (
          registration.status ===
            'certified'
        ) {
          throw new ExamCertificateServiceError(
            'EXAM_CERTIFICATE_STATE_INCONSISTENT',
            'Registration certified não possui certificado canônico.'
          );
        }

        const studentRef =
          db.doc(
            `usuarios/${registration.studentId}`
          );

        const instructorRef =
          db.doc(
            `usuarios/${registration.instructorId}`
          );

        const organizationRef =
          db.doc(
            `organizacoes/${registration.organizationId}`
          );

        const [
          studentSnap,
          instructorSnap,
          organizationSnap
        ] =
          await Promise.all([
            tx.get(studentRef),
            tx.get(instructorRef),
            tx.get(organizationRef)
          ]);

        const studentName =
          documentName(
            studentSnap,
            'EXAM_CERTIFICATE_STUDENT_PROFILE_NOT_FOUND',
            'EXAM_CERTIFICATE_STUDENT_NAME_REQUIRED',
            'Perfil do aluno'
          );

        const instructorName =
          documentName(
            instructorSnap,
            'EXAM_CERTIFICATE_INSTRUCTOR_PROFILE_NOT_FOUND',
            'EXAM_CERTIFICATE_INSTRUCTOR_NAME_REQUIRED',
            'Perfil do instrutor'
          );

        const organizationName =
          documentName(
            organizationSnap,
            'EXAM_CERTIFICATE_ORGANIZATION_NOT_FOUND',
            'EXAM_CERTIFICATE_ORGANIZATION_NAME_REQUIRED',
            'Organização'
          );

        let certificate;
        let certifiedRegistration;

        try {
          certificate =
            buildExamCertificate({
              ...expectedCertificate,
              studentName,
              organizationName,
              instructorName,
              issuedAt:
                now,
              issuedBy:
                actorId
            });

          certifiedRegistration =
            markRegistrationCertified(
              registration,
              {
                certificateId,
                certifiedAt:
                  now
              }
            );
        } catch (error) {
          throwDomainAsService(error);
        }

        tx.create(
          certificateRef,
          certificate
        );

        tx.update(
          registrationRef,
          {
            status:
              certifiedRegistration.status,
            certificateId:
              certifiedRegistration.certificateId,
            updatedAt:
              certifiedRegistration.updatedAt
          }
        );

        tx.create(
          auditRef,
          {
            actorId,
            actorRole:
              'student',
            action:
              'exam.certificate.issued',
            entityType:
              'exam_certificate',
            entityId:
              certificateId,
            before:
              null,
            after: {
              registrationId,
              resultId,
              certificateId,
              status:
                certificate.status
            },
            source:
              'service',
            requestId:
              null,
            createdAt:
              now
          }
        );

        response = {
          created: true,
          certificate:
            publicExamCertificate(
              certificateId,
              certificate
            )
        };
      }
    );

    return response;
  }
  async function verifyPublicCertificate(
    input = {}
  ) {
    const certificateId =
      requiredIdentifier(
        input.certificateId,
        'certificateId'
      );

    const certificateSnap =
      await db.doc(
        `exam_certificates/${certificateId}`
      ).get();

    if (!certificateSnap.exists) {
      throw new ExamCertificateServiceError(
        'EXAM_CERTIFICATE_NOT_FOUND',
        'Certificado não encontrado.'
      );
    }

    try {
      const certificate =
        assertExamCertificateDocumentIdentity(
          certificateId,
          certificateSnap.data() ||
            {}
        );

      return publicExamCertificate(
        certificateId,
        certificate
      );
    } catch (error) {
      throwDomainAsService(
        error
      );
    }
  }
  return {
    issueCertificate,
    verifyPublicCertificate
  };
}

module.exports = {
  ExamCertificateServiceError,
  createExamCertificateService
};