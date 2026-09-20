'use strict';

const crypto = require('crypto');

const {
  FinancialDomainError,
  resolveEffectiveFinancialRule,
  buildFinancialSnapshot,
  validateOrder
} = require('./financial-domain');
const {
  isActiveMembership,
  membershipRole
} = require('../auth/organization-membership');
const {
  ExamSessionDomainError,
  validateExamSession,
  examSessionFinancialProductContext,
  assertExamSessionStatusTransition
} = require('../exams/exam-session-domain');
const {
  ExamRegistrationDomainError,
  examRegistrationDocumentId,
  validateExamRegistration,
  markRegistrationAwaitingPayment
} = require('../exams/exam-registration-domain');

const DEFAULT_FINANCIAL_RULE_DOCUMENT_ID = 'platform-default';

class FinancialBeltExamOrderServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialBeltExamOrderServiceError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, max) : null;
}

function requiredIdentifier(value, field) {
  const id = text(value, 200);
  if (!id || id.includes('/')) {
    throw new FinancialBeltExamOrderServiceError(
      'INVALID_BELT_EXAM_ORDER_IDENTITY',
      `${field} inválido.`
    );
  }
  return id;
}

function requiredIdempotencyKey(value) {
  const key = text(value, 200);
  if (!key) {
    throw new FinancialBeltExamOrderServiceError(
      'INVALID_BELT_EXAM_IDEMPOTENCY_KEY',
      'idempotencyKey precisa possuir entre 1 e 200 caracteres.'
    );
  }
  return key;
}

function beltExamFinancialOrderDocumentId({
  buyerUserId,
  sessionId,
  idempotencyKey
} = {}) {
  const buyer = requiredIdentifier(buyerUserId, 'buyerUserId');
  const session = requiredIdentifier(sessionId, 'sessionId');
  const key = requiredIdempotencyKey(idempotencyKey);

  return crypto
    .createHash('sha256')
    .update(`financial-belt-exam-order-v1:${buyer}:${session}:${key}`)
    .digest('hex');
}

function membershipOrganizationId(membership = {}) {
  return text(membership.organizationId || membership.organizacao_id, 200);
}

function membershipUserId(membership = {}) {
  return text(membership.userId || membership.usuario_id, 200);
}

function assertActiveStudentMembership(memberships, registration) {
  const membership = memberships.find(item => (
    item.id === registration.membershipId &&
    membershipUserId(item) === registration.studentId &&
    membershipOrganizationId(item) === registration.organizationId &&
    isActiveMembership(item) &&
    membershipRole(item) === 'student'
  ));

  if (!membership) {
    throw new FinancialBeltExamOrderServiceError(
      'BELT_EXAM_STUDENT_MEMBERSHIP_REQUIRED',
      'O aluno precisa manter vínculo ativo na organização para comprar o exame.'
    );
  }

  return membership;
}

function validateStoredSession(snapshot) {
  try {
    return validateExamSession(snapshot || {});
  } catch (error) {
    if (error instanceof ExamSessionDomainError) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_SESSION_INVALID',
        'Sessão de exame persistida está inconsistente.'
      );
    }
    throw error;
  }
}

function validateStoredRegistration(snapshot) {
  try {
    return validateExamRegistration(snapshot || {});
  } catch (error) {
    if (error instanceof ExamRegistrationDomainError) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_REGISTRATION_INVALID',
        'Registration de exame persistida está inconsistente.'
      );
    }
    throw error;
  }
}

function validateExistingOrder({
  orderId,
  snapshot,
  buyerUserId,
  sessionId,
  idempotencyKey
}) {
  let order;
  try {
    order = validateOrder(snapshot || {});
  } catch (error) {
    if (error instanceof FinancialDomainError) {
      throw new FinancialBeltExamOrderServiceError(
        'EXISTING_BELT_EXAM_ORDER_INVALID',
        `Pedido idempotente existente está inconsistente: ${orderId}.`
      );
    }
    throw error;
  }

  if (
    order.buyerUserId !== buyerUserId ||
    order.productType !== 'belt_exam' ||
    order.productId !== sessionId ||
    order.idempotencyKey !== idempotencyKey
  ) {
    throw new FinancialBeltExamOrderServiceError(
      'BELT_EXAM_IDEMPOTENCY_ORDER_MISMATCH',
      'Pedido idempotente existente não corresponde ao exame solicitado.'
    );
  }

  return order;
}

function createFinancialBeltExamOrderService(dependencies = {}) {
  const {
    db,
    clock = () => new Date(),
    defaultRuleId = DEFAULT_FINANCIAL_RULE_DOCUMENT_ID
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Belt exam order service exige Firestore válido.');
  }

  const canonicalDefaultRuleId = requiredIdentifier(defaultRuleId, 'defaultRuleId');

  async function membershipsForUserInTransaction(tx, userId) {
    const snap = await tx.get(
      db.collection('vinculos_organizacao')
        .where('usuario_id', '==', userId)
        .limit(100)
    );
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async function createPendingBeltExamOrder(input = {}) {
    const buyerUserId = requiredIdentifier(input.buyerUserId, 'buyerUserId');
    const sessionId = requiredIdentifier(input.sessionId, 'sessionId');
    const idempotencyKey = requiredIdempotencyKey(input.idempotencyKey);
    const orderId = beltExamFinancialOrderDocumentId({
      buyerUserId,
      sessionId,
      idempotencyKey
    });
    const registrationId = examRegistrationDocumentId({
      sessionId,
      studentId: buyerUserId
    });
    const now = clock();
    if (!now) {
      throw new FinancialBeltExamOrderServiceError(
        'BELT_EXAM_ORDER_TIMESTAMP_REQUIRED',
        'Relógio do serviço não retornou timestamp válido.'
      );
    }

    const orderRef = db.doc(`orders/${orderId}`);
    const sessionRef = db.doc(`exam_sessions/${sessionId}`);
    const registrationRef = db.doc(`exam_registrations/${registrationId}`);
    const auditOrderRef = db.collection('audit_logs').doc();
    const auditRegistrationRef = db.collection('audit_logs').doc();

    let result = null;

    await db.runTransaction(async tx => {
      const [orderSnap, sessionSnap, registrationSnap, memberships] = await Promise.all([
        tx.get(orderRef),
        tx.get(sessionRef),
        tx.get(registrationRef),
        membershipsForUserInTransaction(tx, buyerUserId)
      ]);

      if (!sessionSnap.exists) {
        throw new FinancialBeltExamOrderServiceError(
          'BELT_EXAM_SESSION_NOT_FOUND',
          'Sessão de exame não encontrada.'
        );
      }
      if (!registrationSnap.exists) {
        throw new FinancialBeltExamOrderServiceError(
          'BELT_EXAM_REGISTRATION_NOT_FOUND',
          'O aluno não foi selecionado para esta sessão de exame.'
        );
      }

      const session = validateStoredSession(sessionSnap.data());
      const registration = validateStoredRegistration(registrationSnap.data());

      if (
        registration.sessionId !== sessionId ||
        registration.studentId !== buyerUserId ||
        registration.organizationId !== session.organizationId ||
        registration.targetBelt !== session.targetBelt
      ) {
        throw new FinancialBeltExamOrderServiceError(
          'BELT_EXAM_REGISTRATION_IDENTITY_MISMATCH',
          'Registration não corresponde ao aluno e à sessão solicitados.'
        );
      }

      assertActiveStudentMembership(memberships, registration);

      if (!['candidates_selected', 'awaiting_payment', 'ready'].includes(session.status)) {
        throw new FinancialBeltExamOrderServiceError(
          'BELT_EXAM_SESSION_NOT_SALEABLE',
          'Sessão não aceita novas cobranças neste estado.'
        );
      }

      if (registration.attemptId || registration.resultId || registration.certificateId) {
        throw new FinancialBeltExamOrderServiceError(
          'BELT_EXAM_ACADEMIC_STATE_EXISTS',
          'Registration com atividade acadêmica não pode iniciar nova cobrança.'
        );
      }

      if (orderSnap.exists) {
        const order = validateExistingOrder({
          orderId,
          snapshot: orderSnap.data(),
          buyerUserId,
          sessionId,
          idempotencyKey
        });
        if (
          order.status !== 'pending_payment' ||
          registration.status !== 'awaiting_payment' ||
          registration.orderId !== orderId
        ) {
          throw new FinancialBeltExamOrderServiceError(
            'BELT_EXAM_ORDER_NOT_RESUMABLE',
            'Pedido existente não está em estado retomável para checkout.'
          );
        }
        result = { orderId, created: false, order, registrationId, registration };
        return;
      }

      if (registration.status === 'awaiting_payment') {
        throw new FinancialBeltExamOrderServiceError(
          'BELT_EXAM_ACTIVE_ORDER_CONFLICT',
          'Já existe uma cobrança pendente vinculada a esta registration.'
        );
      }
      if (registration.status !== 'selected') {
        throw new FinancialBeltExamOrderServiceError(
          'BELT_EXAM_REGISTRATION_NOT_CHECKOUT_ELIGIBLE',
          'Registration não está elegível para nova cobrança.'
        );
      }

      let product;
      try {
        product = examSessionFinancialProductContext(sessionId, session);
      } catch (error) {
        if (error instanceof ExamSessionDomainError) {
          throw new FinancialBeltExamOrderServiceError(
            error.code || 'BELT_EXAM_SESSION_NOT_SALEABLE',
            error.message
          );
        }
        throw error;
      }

      const effectiveRuleId = product.financialRuleId || canonicalDefaultRuleId;
      const ruleSnap = await tx.get(db.doc(`financial_rules/${effectiveRuleId}`));
      const ruleData = ruleSnap.exists
        ? { ...(ruleSnap.data() || {}), id: ruleSnap.id }
        : null;

      let effectiveRule;
      try {
        effectiveRule = product.financialRuleId
          ? resolveEffectiveFinancialRule({
              product,
              overrideRule: ruleData,
              defaultRule: null
            })
          : resolveEffectiveFinancialRule({
              product,
              overrideRule: null,
              defaultRule: ruleData
            });
      } catch (error) {
        if (error instanceof FinancialDomainError) throw error;
        throw error;
      }

      const financialSnapshot = buildFinancialSnapshot({
        rule: effectiveRule,
        product,
        grossAmountCents: product.amountCents,
        currency: product.currency,
        resolvedAt: now
      });

      const pendingOrder = validateOrder({
        buyerUserId,
        productType: 'belt_exam',
        productId: sessionId,
        quantity: 1,
        amountCents: product.amountCents,
        currency: product.currency,
        status: 'pending_payment',
        financialSnapshot,
        provider: null,
        providerCustomerId: null,
        currentTransactionId: null,
        idempotencyKey,
        createdAt: now,
        updatedAt: now,
        paidAt: null,
        cancelledAt: null,
        expiredAt: null,
        refundedAt: null,
        chargebackAt: null
      });

      let nextRegistration;
      try {
        nextRegistration = markRegistrationAwaitingPayment(registration, {
          orderId,
          updatedAt: now
        });
      } catch (error) {
        if (error instanceof ExamRegistrationDomainError) {
          throw new FinancialBeltExamOrderServiceError(
            error.code || 'BELT_EXAM_REGISTRATION_NOT_CHECKOUT_ELIGIBLE',
            error.message
          );
        }
        throw error;
      }

      let nextSession = session;
      if (session.status === 'candidates_selected') {
        assertExamSessionStatusTransition('candidates_selected', 'awaiting_payment');
        nextSession = validateExamSession({
          ...session,
          status: 'awaiting_payment',
          updatedAt: now
        });
        tx.set(sessionRef, nextSession);
      }

      tx.create(orderRef, pendingOrder);
      tx.set(registrationRef, nextRegistration);
      tx.create(auditOrderRef, {
        actorId: buyerUserId,
        actorRole: 'student',
        action: 'financial.order.created',
        entityType: 'financial_order',
        entityId: orderId,
        before: null,
        after: {
          buyerUserId,
          productType: 'belt_exam',
          productId: sessionId,
          amountCents: pendingOrder.amountCents,
          currency: pendingOrder.currency,
          status: pendingOrder.status,
          ruleId: financialSnapshot.ruleId,
          ruleVersion: financialSnapshot.ruleVersion
        },
        source: 'service',
        requestId: null,
        createdAt: now
      });
      tx.create(auditRegistrationRef, {
        actorId: buyerUserId,
        actorRole: 'student',
        action: 'exam.registration.payment_started',
        entityType: 'exam_registration',
        entityId: registrationId,
        before: { status: registration.status, orderId: registration.orderId },
        after: { status: nextRegistration.status, orderId },
        source: 'service',
        requestId: null,
        createdAt: now
      });

      result = {
        orderId,
        created: true,
        order: pendingOrder,
        registrationId,
        registration: nextRegistration,
        session: nextSession
      };
    });

    return result;
  }

  return {
    createPendingBeltExamOrder
  };
}

module.exports = {
  DEFAULT_FINANCIAL_RULE_DOCUMENT_ID,
  FinancialBeltExamOrderServiceError,
  beltExamFinancialOrderDocumentId,
  createFinancialBeltExamOrderService
};
