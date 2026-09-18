'use strict';

const crypto = require('crypto');

const {
  FinancialDomainError,
  resolveEffectiveFinancialRule,
  buildFinancialSnapshot,
  validateOrder
} = require('./financial-domain');

const DEFAULT_FINANCIAL_RULE_DOCUMENT_ID = 'platform-default';

class FinancialOrderServiceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialOrderServiceError';
    this.code = code;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialOrderServiceError(
      'INVALID_ORDER_IDENTITY',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requiredIdempotencyKey(value) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200) {
    throw new FinancialOrderServiceError(
      'INVALID_IDEMPOTENCY_KEY',
      'idempotencyKey precisa possuir entre 1 e 200 caracteres.'
    );
  }
  return normalized;
}

function financialOrderDocumentId({
  buyerUserId,
  courseId,
  idempotencyKey
} = {}) {
  const buyer = requiredIdentifier(
    buyerUserId,
    'buyerUserId'
  );
  const course = requiredIdentifier(
    courseId,
    'courseId'
  );
  const key = requiredIdempotencyKey(
    idempotencyKey
  );

  return crypto
    .createHash('sha256')
    .update(
      `financial-order-v1:${buyer}:${course}:${key}`
    )
    .digest('hex');
}

function assertPaidPublishedCourse(course = {}) {
  if (course.status !== 'published') {
    throw new FinancialOrderServiceError(
      'COURSE_NOT_AVAILABLE',
      'Somente curso publicado pode originar pedido.'
    );
  }

  if (course.isPaid !== true) {
    throw new FinancialOrderServiceError(
      'COURSE_NOT_PAID',
      'Curso gratuito não pode originar pedido financeiro.'
    );
  }

  const priceCents = Number(course.priceCents);
  if (!Number.isSafeInteger(priceCents) || priceCents <= 0) {
    throw new FinancialOrderServiceError(
      'COURSE_PRICE_INVALID',
      'Curso pago precisa possuir priceCents inteiro positivo.'
    );
  }

  return priceCents;
}

function validateExistingOrder({
  orderId,
  snapshot,
  buyerUserId,
  courseId,
  idempotencyKey
}) {
  let order;

  try {
    order = validateOrder(snapshot || {});
  } catch (error) {
    if (error instanceof FinancialDomainError) {
      throw new FinancialOrderServiceError(
        'EXISTING_ORDER_INVALID',
        `Pedido idempotente existente está inconsistente: ${orderId}.`
      );
    }
    throw error;
  }

  if (
    order.buyerUserId !== buyerUserId ||
    order.productType !== 'course' ||
    order.productId !== courseId ||
    order.idempotencyKey !== idempotencyKey
  ) {
    throw new FinancialOrderServiceError(
      'IDEMPOTENCY_ORDER_MISMATCH',
      'Pedido idempotente existente não corresponde à intenção solicitada.'
    );
  }

  return order;
}

function createFinancialOrderService(dependencies = {}) {
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
    throw new TypeError('Financial order service exige Firestore válido.');
  }

  const canonicalDefaultRuleId = requiredIdentifier(
    defaultRuleId,
    'defaultRuleId'
  );

  async function createPendingCourseOrder(input = {}) {
    const buyerUserId = requiredIdentifier(
      input.buyerUserId,
      'buyerUserId'
    );
    const courseId = requiredIdentifier(
      input.courseId,
      'courseId'
    );
    const idempotencyKey = requiredIdempotencyKey(
      input.idempotencyKey
    );

    const orderId = financialOrderDocumentId({
      buyerUserId,
      courseId,
      idempotencyKey
    });

    const timestamp = clock();
    if (!timestamp) {
      throw new FinancialOrderServiceError(
        'ORDER_TIMESTAMP_REQUIRED',
        'Relógio do serviço não retornou timestamp válido.'
      );
    }

    // IDs são definidos antes da transação para permanecerem estáveis
    // caso o Firestore faça retry otimista do callback.
    const orderRef = db.doc(`orders/${orderId}`);
    const auditRef = db.collection('audit_logs').doc();

    const result = await db.runTransaction(async tx => {
      // A idempotência é resolvida antes de reler curso/regra. Um pedido já
      // persistido mantém preço e snapshot históricos mesmo que o produto
      // seja alterado posteriormente.
      const existingOrderSnap = await tx.get(orderRef);

      if (existingOrderSnap.exists) {
        return {
          created: false,
          order: validateExistingOrder({
            orderId,
            snapshot: existingOrderSnap.data(),
            buyerUserId,
            courseId,
            idempotencyKey
          })
        };
      }

      const courseRef = db.doc(`courses/${courseId}`);
      const courseSnap = await tx.get(courseRef);

      if (!courseSnap.exists) {
        throw new FinancialOrderServiceError(
          'COURSE_NOT_FOUND',
          'Curso não encontrado.'
        );
      }

      const course = courseSnap.data() || {};
      const amountCents = assertPaidPublishedCourse(course);
      const currency = String(course.currency || 'BRL').trim().toUpperCase();

      const product = {
        productType: 'course',
        productId: courseId,
        financialRuleId: course.financialRuleId || null,
        ownerType: course.ownerType || null,
        ownerId: course.ownerId || null,
        currency
      };

      const effectiveRuleId =
        product.financialRuleId || canonicalDefaultRuleId;
      const ruleRef = db.doc(`financial_rules/${effectiveRuleId}`);
      const ruleSnap = await tx.get(ruleRef);

      const ruleData = ruleSnap.exists
        ? {
            ...(ruleSnap.data() || {}),
            // O ID do documento é autoritativo; um campo id divergente
            // dentro do payload não pode redirecionar o snapshot.
            id: ruleSnap.id
          }
        : null;

      let effectiveRule;
      if (product.financialRuleId) {
        effectiveRule = resolveEffectiveFinancialRule({
          product,
          overrideRule: ruleData,
          defaultRule: null
        });
      } else {
        effectiveRule = resolveEffectiveFinancialRule({
          product,
          overrideRule: null,
          defaultRule: ruleData
        });
      }

      const financialSnapshot = buildFinancialSnapshot({
        rule: effectiveRule,
        product,
        grossAmountCents: amountCents,
        currency,
        resolvedAt: timestamp
      });

      const pendingOrder = validateOrder({
        buyerUserId,
        productType: 'course',
        productId: courseId,
        quantity: 1,
        amountCents,
        currency,
        status: 'pending_payment',
        financialSnapshot,
        provider: null,
        providerCustomerId: null,
        currentTransactionId: null,
        idempotencyKey,
        createdAt: timestamp,
        updatedAt: timestamp,
        paidAt: null,
        cancelledAt: null,
        expiredAt: null,
        refundedAt: null,
        chargebackAt: null
      });

      tx.create(orderRef, pendingOrder);
      tx.create(auditRef, {
        actorId: buyerUserId,
        actorRole: 'student',
        action: 'financial.order.created',
        entityType: 'financial_order',
        entityId: orderId,
        before: null,
        after: {
          buyerUserId,
          productType: 'course',
          productId: courseId,
          amountCents,
          currency,
          status: 'pending_payment',
          ruleId: financialSnapshot.ruleId,
          ruleVersion: financialSnapshot.ruleVersion
        },
        source: 'service',
        requestId: null,
        createdAt: timestamp
      });

      return {
        created: true,
        order: pendingOrder
      };
    });

    return {
      orderId,
      created: result.created,
      order: result.order
    };
  }

  return {
    createPendingCourseOrder
  };
}

module.exports = {
  DEFAULT_FINANCIAL_RULE_DOCUMENT_ID,
  FinancialOrderServiceError,
  financialOrderDocumentId,
  createFinancialOrderService
};
