'use strict';

const {
  isActiveMembership,
  membershipRole
} = require('../auth/organization-membership');

const {
  ExamSessionDomainError,
  validateExamSession,
  requireBoundExamTemplate
} = require('./exam-session-domain');

const {
  ExamRegistrationDomainError,
  validateExamRegistration,
  markRegistrationStarted
} = require('./exam-registration-domain');

const {
  ExamAttemptDomainError,
  examAttemptDocumentId,
  validateExamAttempt,
  assertExamAttemptDocumentIdentity,
  buildInProgressExamAttempt,
  assertExamAttemptResumeEligible,
  publicExamAttempt
} = require('./exam-attempt-domain');

const {
  ExamTemplateDomainError,
  validateExamTemplate,
  validateExamTemplateVersion,
  examTemplateVersionDocumentId
} = require('./exam-template-domain');

const {
  ExamQuestionDomainError,
  validateExamQuestionSnapshot,
  publicExamQuestion
} = require('./exam-question-domain');

const {
  FinancialDomainError,
  validateOrder,
  validateTransaction
} = require('../finance/financial-domain');

class ExamAttemptServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExamAttemptServiceError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) {
    return null;
  }

  const normalized = String(value).trim();

  return normalized
    ? normalized.slice(0, max)
    : null;
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);

  if (!id || id.includes('/')) {
    throw new ExamAttemptServiceError(
      'INVALID_EXAM_ATTEMPT_SERVICE_IDENTIFIER',
      `${field} inválido.`
    );
  }

  return id;
}

function membershipOrganizationId(membership = {}) {
  return text(
    membership.organizationId ||
      membership.organizacao_id,
    200
  );
}

function membershipUserId(membership = {}) {
  return text(
    membership.userId ||
      membership.usuario_id,
    200
  );
}

function organizationIsUsable(organization = {}) {
  const status =
    String(organization.status || '')
      .trim()
      .toLowerCase();

  return ![
    'inactive',
    'inativa',
    'suspended',
    'suspensa',
    'archived',
    'arquivada'
  ].includes(status);
}

function validateStoredRegistration(snapshot) {
  try {
    return validateExamRegistration(snapshot || {});
  } catch (error) {
    if (error instanceof ExamRegistrationDomainError) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_REGISTRATION_INVALID',
        'Registration persistida está inconsistente.'
      );
    }

    throw error;
  }
}

function validateStoredSession(snapshot) {
  try {
    return validateExamSession(snapshot || {});
  } catch (error) {
    if (error instanceof ExamSessionDomainError) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_SESSION_INVALID',
        'Sessão persistida está inconsistente.'
      );
    }

    throw error;
  }
}

function validateStoredTemplate(snapshot) {
  try {
    return validateExamTemplate(snapshot || {});
  } catch (error) {
    if (error instanceof ExamTemplateDomainError) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_TEMPLATE_INVALID',
        'Template persistido está inconsistente.'
      );
    }

    throw error;
  }
}

function validateStoredTemplateVersion(snapshot, documentId) {
  try {
    const version =
      validateExamTemplateVersion(snapshot || {});

    const expectedId =
      examTemplateVersionDocumentId(version.version);

    if (expectedId !== documentId) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_TEMPLATE_VERSION_ID_MISMATCH',
        'Documento da versão não corresponde ao contrato canônico.'
      );
    }

    return version;
  } catch (error) {
    if (error instanceof ExamTemplateDomainError) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_TEMPLATE_VERSION_INVALID',
        'Versão persistida está inconsistente.'
      );
    }

    throw error;
  }
}

function validateStoredAttempt(attemptId, snapshot) {
  try {
    return assertExamAttemptDocumentIdentity(
      attemptId,
      validateExamAttempt(snapshot || {})
    );
  } catch (error) {
    if (error instanceof ExamAttemptDomainError) {
      throw new ExamAttemptServiceError(
        error.code || 'EXAM_ATTEMPT_INVALID',
        error.message
      );
    }

    throw error;
  }
}

function validateStoredOrder(snapshot) {
  try {
    return validateOrder(snapshot || {});
  } catch (error) {
    if (error instanceof FinancialDomainError) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_ORDER_INVALID',
        'Pedido financeiro persistido está inconsistente.'
      );
    }

    throw error;
  }
}

function validateStoredTransaction(snapshot) {
  try {
    return validateTransaction(snapshot || {});
  } catch (error) {
    if (error instanceof FinancialDomainError) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_TRANSACTION_INVALID',
        'Transação financeira persistida está inconsistente.'
      );
    }

    throw error;
  }
}

function assertStudentMembership(
  membership,
  registration
) {
  if (
    membershipUserId(membership) !==
      registration.studentId ||
    membershipOrganizationId(membership) !==
      registration.organizationId ||
    !isActiveMembership(membership) ||
    membershipRole(membership) !== 'student'
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_ACTIVE_STUDENT_MEMBERSHIP_REQUIRED',
      'Aluno precisa manter vínculo ativo na organização.'
    );
  }
}

function assertSessionRegistrationIdentity(
  sessionId,
  session,
  registration
) {
  if (
    registration.sessionId !== sessionId ||
    registration.organizationId !==
      session.organizationId ||
    registration.targetBelt !==
      session.targetBelt
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_SESSION_REGISTRATION_MISMATCH',
      'Registration não corresponde à sessão.'
    );
  }

  if (
    ['cancelled', 'archived'].includes(
      session.status
    )
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_SESSION_NOT_EXECUTABLE',
      'Sessão cancelada ou arquivada não pode executar prova.'
    );
  }

  try {
    return requireBoundExamTemplate(session);
  } catch (error) {
    if (
      error instanceof ExamSessionDomainError &&
      error.code === 'EXAM_SESSION_TEMPLATE_REQUIRED'
    ) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_TEMPLATE_REQUIRED',
        'Sessão precisa possuir template oficial congelado.'
      );
    }

    throw error;
  }
}

function assertCanonicalFinancialState({
  orderId,
  order,
  transactionId,
  transaction,
  registration,
  sessionId,
  session
}) {
  if (registration.orderId !== orderId) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_ORDER_MISMATCH',
      'Pedido não corresponde à registration.'
    );
  }

  if (
    order.status !== 'paid' ||
    transaction.status !== 'paid'
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_PAYMENT_NOT_CONFIRMED',
      'Pedido e transação precisam estar pagos.'
    );
  }

  if (
    order.buyerUserId !==
      registration.studentId ||
    order.productType !== 'belt_exam' ||
    order.productId !== sessionId ||
    order.currentTransactionId !==
      transactionId
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_ORDER_IDENTITY_MISMATCH',
      'Pedido pago não corresponde ao exame.'
    );
  }

  if (
    transaction.orderId !== orderId ||
    transaction.buyerUserId !==
      registration.studentId
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_TRANSACTION_IDENTITY_MISMATCH',
      'Transação não corresponde ao pedido.'
    );
  }

  if (
    transaction.amountCents !==
      order.amountCents ||
    transaction.currency !==
      order.currency ||
    order.amountCents !==
      session.priceCents ||
    order.currency !==
      session.currency
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_FINANCIAL_AMOUNT_MISMATCH',
      'Estado financeiro não corresponde à sessão.'
    );
  }

  if (
    order.financialSnapshot.productType !==
      'belt_exam' ||
    order.financialSnapshot.productId !==
      sessionId ||
    transaction.financialSnapshot.productType !==
      'belt_exam' ||
    transaction.financialSnapshot.productId !==
      sessionId
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_FINANCIAL_SNAPSHOT_MISMATCH',
      'Snapshot financeiro não corresponde ao exame.'
    );
  }
}

function assertTemplateExecutionState({
  templateId,
  templateVersionId,
  template,
  version,
  session
}) {
  if (
    template.targetBelt !==
      session.targetBelt
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_TEMPLATE_BELT_MISMATCH',
      'Template não corresponde à faixa da sessão.'
    );
  }

  if (
    version.templateId !== templateId
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_TEMPLATE_VERSION_MISMATCH',
      'Versão pertence a outro template.'
    );
  }

  if (
    !['active', 'retired'].includes(
      version.status
    )
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_TEMPLATE_VERSION_NOT_EXECUTABLE',
      'Versão congelada não está publicada para execução.'
    );
  }

  if (
    session.templateId !==
      templateId ||
    session.templateVersionId !==
      templateVersionId
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_TEMPLATE_BINDING_MISMATCH',
      'Template carregado não corresponde ao binding da sessão.'
    );
  }
}

function assertExistingAttemptIdentity(
  attempt,
  expected
) {
  const fields = [
    'registrationId',
    'sessionId',
    'organizationId',
    'studentId',
    'templateId',
    'templateVersionId'
  ];

  for (const field of fields) {
    if (
      attempt[field] !== expected[field]
    ) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_EXISTING_IDENTITY_MISMATCH',
        `Tentativa existente diverge em ${field}.`
      );
    }
  }

  if (
    attempt.orderedQuestionIds.length !==
      expected.orderedQuestionIds.length
  ) {
    throw new ExamAttemptServiceError(
      'EXAM_ATTEMPT_EXISTING_QUESTION_ORDER_MISMATCH',
      'Tentativa existente possui ordem de questões divergente.'
    );
  }

  for (
    let index = 0;
    index <
      expected.orderedQuestionIds.length;
    index += 1
  ) {
    if (
      attempt.orderedQuestionIds[index] !==
        expected.orderedQuestionIds[index]
    ) {
      throw new ExamAttemptServiceError(
        'EXAM_ATTEMPT_EXISTING_QUESTION_ORDER_MISMATCH',
        'Tentativa existente possui ordem de questões divergente.'
      );
    }
  }
}

function createExamAttemptService(
  dependencies = {}
) {
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
    throw new TypeError(
      'Exam attempt service exige Firestore válido.'
    );
  }

  function timestamp() {
    const value = clock();

    const date =
      value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new ExamAttemptServiceError(
        'INVALID_EXAM_ATTEMPT_SERVICE_CLOCK',
        'Relógio do serviço retornou timestamp inválido.'
      );
    }

    return date;
  }

  async function readQuestions(
    tx,
    templateId,
    templateVersionId,
    orderedQuestionIds
  ) {
    const refs =
      orderedQuestionIds.map(
        questionId =>
          db.doc(
            `exam_templates/${templateId}` +
            `/versions/${templateVersionId}` +
            `/questions/${questionId}`
          )
      );

    const snapshots =
      await Promise.all(
        refs.map(ref => tx.get(ref))
      );

    return snapshots.map(
      (snapshot, index) => {
        const questionId =
          orderedQuestionIds[index];

        if (!snapshot.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_QUESTION_NOT_FOUND',
            `Questão oficial ausente: ${questionId}.`
          );
        }

        let question;

        try {
          question =
            validateExamQuestionSnapshot(
              snapshot.data() || {}
            );
        } catch (error) {
          if (
            error instanceof
              ExamQuestionDomainError
          ) {
            throw new ExamAttemptServiceError(
              'EXAM_ATTEMPT_QUESTION_INVALID',
              `Questão oficial inconsistente: ${questionId}.`
            );
          }

          throw error;
        }

        return publicExamQuestion(
          questionId,
          question
        );
      }
    );
  }

  async function startAttempt(input = {}) {
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

    const attemptId =
      examAttemptDocumentId(
        registrationId
      );

    const registrationRef =
      db.doc(
        `exam_registrations/${registrationId}`
      );

    const attemptRef =
      db.doc(
        `exam_attempts/${attemptId}`
      );

    const auditRef =
      db.collection('audit_logs').doc();

    const now = timestamp();

    let result = null;

    await db.runTransaction(
      async tx => {
        const registrationSnap =
          await tx.get(registrationRef);

        if (!registrationSnap.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_REGISTRATION_NOT_FOUND',
            'Registration de exame não encontrada.'
          );
        }

        const registration =
          validateStoredRegistration(
            registrationSnap.data()
          );

        if (
          registration.studentId !==
            actorId
        ) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_STUDENT_MISMATCH',
            'Somente o aluno da registration pode iniciar a prova.'
          );
        }

        if (
          ![
            'authorized',
            'started'
          ].includes(
            registration.status
          )
        ) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_REGISTRATION_NOT_STARTABLE',
            'Registration não está autorizada para início da prova.'
          );
        }

        const sessionId =
          registration.sessionId;

        const sessionRef =
          db.doc(
            `exam_sessions/${sessionId}`
          );

        const organizationRef =
          db.doc(
            `organizacoes/${registration.organizationId}`
          );

        const membershipRef =
          db.doc(
            `vinculos_organizacao/${registration.membershipId}`
          );

        const orderId =
          requiredIdentifier(
            registration.orderId,
            'orderId'
          );

        const orderRef =
          db.doc(
            `orders/${orderId}`
          );

        const [
          sessionSnap,
          organizationSnap,
          membershipSnap,
          orderSnap,
          attemptSnap
        ] =
          await Promise.all([
            tx.get(sessionRef),
            tx.get(organizationRef),
            tx.get(membershipRef),
            tx.get(orderRef),
            tx.get(attemptRef)
          ]);

        if (!sessionSnap.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_SESSION_NOT_FOUND',
            'Sessão de exame não encontrada.'
          );
        }

        if (!organizationSnap.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_ORGANIZATION_NOT_FOUND',
            'Organização não encontrada.'
          );
        }

        if (
          !organizationIsUsable(
            organizationSnap.data() || {}
          )
        ) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_ORGANIZATION_NOT_ACTIVE',
            'Organização não está ativa para execução de exame.'
          );
        }

        if (!membershipSnap.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_MEMBERSHIP_NOT_FOUND',
            'Vínculo do aluno não foi encontrado.'
          );
        }

        if (!orderSnap.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_ORDER_NOT_FOUND',
            'Pedido financeiro não foi encontrado.'
          );
        }

        const session =
          validateStoredSession(
            sessionSnap.data()
          );

        assertStudentMembership(
          {
            id: membershipSnap.id,
            ...(membershipSnap.data() || {})
          },
          registration
        );

        const binding =
          assertSessionRegistrationIdentity(
            sessionId,
            session,
            registration
          );

        const order =
          validateStoredOrder(
            orderSnap.data()
          );

        const transactionId =
          requiredIdentifier(
            order.currentTransactionId,
            'currentTransactionId'
          );

        const transactionRef =
          db.doc(
            `payment_transactions/${transactionId}`
          );

        const templateRef =
          db.doc(
            `exam_templates/${binding.templateId}`
          );

        const versionRef =
          db.doc(
            `exam_templates/${binding.templateId}` +
            `/versions/${binding.templateVersionId}`
          );

        const [
          transactionSnap,
          templateSnap,
          versionSnap
        ] =
          await Promise.all([
            tx.get(transactionRef),
            tx.get(templateRef),
            tx.get(versionRef)
          ]);

        if (!transactionSnap.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_TRANSACTION_NOT_FOUND',
            'Transação financeira não foi encontrada.'
          );
        }

        if (!templateSnap.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_TEMPLATE_NOT_FOUND',
            'Template oficial não foi encontrado.'
          );
        }

        if (!versionSnap.exists) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_TEMPLATE_VERSION_NOT_FOUND',
            'Versão congelada do template não foi encontrada.'
          );
        }

        const transaction =
          validateStoredTransaction(
            transactionSnap.data()
          );

        assertCanonicalFinancialState({
          orderId,
          order,
          transactionId,
          transaction,
          registration,
          sessionId,
          session
        });

        const template =
          validateStoredTemplate(
            templateSnap.data()
          );

        const version =
          validateStoredTemplateVersion(
            versionSnap.data(),
            versionSnap.id
          );

        assertTemplateExecutionState({
          templateId:
            binding.templateId,
          templateVersionId:
            binding.templateVersionId,
          template,
          version,
          session
        });

        const orderedQuestionIds =
          [...version.questionIds];

        const questions =
          await readQuestions(
            tx,
            binding.templateId,
            binding.templateVersionId,
            orderedQuestionIds
          );

        const expectedAttempt = {
          registrationId,
          sessionId,
          organizationId:
            registration.organizationId,
          studentId:
            registration.studentId,
          templateId:
            binding.templateId,
          templateVersionId:
            binding.templateVersionId,
          orderedQuestionIds
        };

        if (attemptSnap.exists) {
          if (
            registration.status !==
              'started' ||
            registration.attemptId !==
              attemptId
          ) {
            throw new ExamAttemptServiceError(
              'EXAM_ATTEMPT_STATE_INCONSISTENT',
              'Tentativa existe sem registration started correspondente.'
            );
          }

          const attempt =
            validateStoredAttempt(
              attemptId,
              attemptSnap.data()
            );

          assertExistingAttemptIdentity(
            attempt,
            expectedAttempt
          );

          try {
            assertExamAttemptResumeEligible(
              attempt,
              { now }
            );
          } catch (error) {
            if (
              error instanceof
                ExamAttemptDomainError
            ) {
              throw new ExamAttemptServiceError(
                error.code,
                error.message
              );
            }

            throw error;
          }

          result = {
            created: false,
            resumed: true,
            attempt:
              publicExamAttempt(
                attemptId,
                attempt
              ),
            questions
          };

          return;
        }

        if (
          registration.status !==
            'authorized' ||
          registration.attemptId !==
            null
        ) {
          throw new ExamAttemptServiceError(
            'EXAM_ATTEMPT_STATE_INCONSISTENT',
            'Registration started não possui tentativa canônica correspondente.'
          );
        }

        const expiresAt =
          new Date(
            now.getTime() +
            (
              version.timeLimitMinutes *
              60 *
              1000
            )
          );

        let attempt;
        let nextRegistration;

        try {
          attempt =
            buildInProgressExamAttempt({
              ...expectedAttempt,
              startedAt: now,
              expiresAt
            });

          nextRegistration =
            markRegistrationStarted(
              registration,
              {
                attemptId,
                startedAt: now
              }
            );
        } catch (error) {
          if (
            error instanceof
              ExamAttemptDomainError ||
            error instanceof
              ExamRegistrationDomainError
          ) {
            throw new ExamAttemptServiceError(
              error.code,
              error.message
            );
          }

          throw error;
        }

        tx.create(
          attemptRef,
          attempt
        );

        tx.update(
          registrationRef,
          {
            status:
              nextRegistration.status,
            attemptId:
              nextRegistration.attemptId,
            updatedAt:
              nextRegistration.updatedAt
          }
        );

        tx.create(
          auditRef,
          {
            actorId,
            actorRole: 'student',
            action:
              'exam.attempt.started',
            entityType:
              'exam_attempt',
            entityId:
              attemptId,
            before: {
              registrationStatus:
                registration.status
            },
            after: {
              registrationStatus:
                nextRegistration.status,
              attemptStatus:
                attempt.status,
              sessionId,
              questionCount:
                orderedQuestionIds.length
            },
            source: 'service',
            requestId: null,
            createdAt: now
          }
        );

        result = {
          created: true,
          resumed: false,
          attempt:
            publicExamAttempt(
              attemptId,
              attempt
            ),
          questions
        };
      }
    );

    return result;
  }

  return {
    startAttempt
  };
}

module.exports = {
  ExamAttemptServiceError,
  createExamAttemptService
};