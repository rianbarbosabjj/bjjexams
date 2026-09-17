'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FinancialDomainError
} = require('../src/finance/financial-domain');
const {
  DEFAULT_FINANCIAL_RULE_DOCUMENT_ID,
  FinancialOrderServiceError,
  createFinancialOrderService
} = require('../src/finance/financial-order-service');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function createFakeDb(seed = {}) {
  const store = new Map(
    Object.entries(seed).map(([key, value]) => [key, clone(value)])
  );
  const writes = [];
  let generated = 0;
  let transactionRuns = 0;

  function ref(pathValue) {
    const parts = pathValue.split('/');
    return {
      path: pathValue,
      id: parts[parts.length - 1]
    };
  }

  const db = {
    doc(pathValue) {
      return ref(pathValue);
    },

    collection(name) {
      return {
        doc(id = null) {
          const finalId = id || `auto-${++generated}`;
          return ref(`${name}/${finalId}`);
        }
      };
    },

    async runTransaction(callback) {
      transactionRuns += 1;
      const pending = [];

      const tx = {
        async get(documentRef) {
          const value = store.get(documentRef.path);
          return {
            id: documentRef.id,
            exists: value !== undefined,
            data: () => clone(value)
          };
        },

        create(documentRef, data) {
          if (
            store.has(documentRef.path) ||
            pending.some(item => item.path === documentRef.path)
          ) {
            throw new Error(`Document already exists: ${documentRef.path}`);
          }

          pending.push({
            path: documentRef.path,
            data: clone(data)
          });
        }
      };

      const result = await callback(tx);

      for (const item of pending) {
        store.set(item.path, clone(item.data));
        writes.push(clone(item));
      }

      return result;
    }
  };

  return {
    db,
    store,
    writes,
    get transactionRuns() {
      return transactionRuns;
    }
  };
}

function paidCourse(overrides = {}) {
  return {
    title: 'Curso financeiro',
    status: 'published',
    visibility: 'platform',
    isPaid: true,
    priceCents: 10000,
    currency: 'BRL',
    ownerType: 'user',
    ownerId: 'instrutor-1',
    financialRuleId: null,
    ...overrides
  };
}

function defaultRule(overrides = {}) {
  return {
    name: 'Regra padrão 10%',
    status: 'active',
    scope: 'platform_default',
    productType: null,
    productId: null,
    platformFeeBps: 1000,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 1,
    ...overrides
  };
}

function overrideRule(overrides = {}) {
  return {
    name: 'Override curso',
    status: 'active',
    scope: 'product_override',
    productType: 'course',
    productId: 'course-1',
    platformFeeBps: 1500,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 2,
    ...overrides
  };
}

function serviceFixture({
  course = paidCourse(),
  rules = {
    [DEFAULT_FINANCIAL_RULE_DOCUMENT_ID]: defaultRule()
  },
  now = '2026-09-17T20:00:00.000Z'
} = {}) {
  const seed = {
    'courses/course-1': course
  };

  for (const [id, rule] of Object.entries(rules)) {
    seed[`financial_rules/${id}`] = rule;
  }

  const fake = createFakeDb(seed);
  const service = createFinancialOrderService({
    db: fake.db,
    clock: () => now
  });

  return { ...fake, service, now };
}

(async () => {
  await test('serviço exige Firestore válido', async () => {
    assert.throws(
      () => createFinancialOrderService({}),
      /Firestore válido/
    );
  });

  await test('constante fixa o documento default platform-default', async () => {
    assert.equal(
      DEFAULT_FINANCIAL_RULE_DOCUMENT_ID,
      'platform-default'
    );
  });

  await test('cria pedido pending com regra default em transação única', async () => {
    const fixture = serviceFixture();

    const result = await fixture.service.createPendingCourseOrder({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'intent-1'
    });

    assert.equal(fixture.transactionRuns, 1);
    assert.equal(result.order.status, 'pending_payment');
    assert.equal(result.order.amountCents, 10000);
    assert.equal(result.order.financialSnapshot.ruleId, 'platform-default');
    assert.equal(result.order.financialSnapshot.platformFeeCents, 1000);
    assert.equal(result.order.financialSnapshot.sellerPoolCents, 9000);
    assert.equal(
      result.order.financialSnapshot.recipientAllocations[0].recipientId,
      'instrutor-1'
    );
  });

  await test('pedido ignora amountCents fornecido fora do curso canônico', async () => {
    const fixture = serviceFixture();

    const result = await fixture.service.createPendingCourseOrder({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'intent-2',
      amountCents: 1
    });

    assert.equal(result.order.amountCents, 10000);
    assert.equal(result.order.financialSnapshot.grossAmountCents, 10000);
  });

  await test('override ativo referenciado pelo curso substitui default', async () => {
    const fixture = serviceFixture({
      course: paidCourse({ financialRuleId: 'course-rule-1' }),
      rules: {
        'platform-default': defaultRule(),
        'course-rule-1': overrideRule()
      }
    });

    const result = await fixture.service.createPendingCourseOrder({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'intent-3'
    });

    assert.equal(result.order.financialSnapshot.ruleId, 'course-rule-1');
    assert.equal(result.order.financialSnapshot.ruleVersion, 2);
    assert.equal(result.order.financialSnapshot.platformFeeCents, 1500);
  });

  await test('id do documento da regra é autoritativo contra campo id adulterado', async () => {
    const fixture = serviceFixture({
      rules: {
        'platform-default': defaultRule({ id: 'spoofed-rule-id' })
      }
    });

    const result = await fixture.service.createPendingCourseOrder({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'intent-4'
    });

    assert.equal(result.order.financialSnapshot.ruleId, 'platform-default');
  });

  await test('override ausente falha fechado sem cair no default', async () => {
    const fixture = serviceFixture({
      course: paidCourse({ financialRuleId: 'missing-rule' }),
      rules: {
        'platform-default': defaultRule()
      }
    });

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: 'intent-5'
      }),
      error =>
        error instanceof FinancialDomainError &&
        error.code === 'FINANCIAL_OVERRIDE_NOT_FOUND'
    );

    assert.equal(fixture.writes.length, 0);
  });

  await test('regra default ausente falha fechado', async () => {
    const fixture = serviceFixture({ rules: {} });

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: 'intent-6'
      }),
      error =>
        error instanceof FinancialDomainError &&
        error.code === 'DEFAULT_FINANCIAL_RULE_REQUIRED'
    );

    assert.equal(fixture.writes.length, 0);
  });

  await test('regra inativa não cria pedido', async () => {
    const fixture = serviceFixture({
      rules: {
        'platform-default': defaultRule({ status: 'inactive' })
      }
    });

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: 'intent-7'
      }),
      error =>
        error instanceof FinancialDomainError &&
        error.code === 'FINANCIAL_RULE_INACTIVE'
    );

    assert.equal(fixture.writes.length, 0);
  });

  await test('curso inexistente não gera escrita parcial', async () => {
    const fixture = serviceFixture();
    fixture.store.delete('courses/course-1');

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: 'intent-8'
      }),
      error =>
        error instanceof FinancialOrderServiceError &&
        error.code === 'COURSE_NOT_FOUND'
    );

    assert.equal(fixture.writes.length, 0);
  });

  await test('curso não publicado não gera pedido', async () => {
    const fixture = serviceFixture({
      course: paidCourse({ status: 'draft' })
    });

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: 'intent-9'
      }),
      error =>
        error instanceof FinancialOrderServiceError &&
        error.code === 'COURSE_NOT_AVAILABLE'
    );

    assert.equal(fixture.writes.length, 0);
  });

  await test('curso gratuito não gera pedido financeiro', async () => {
    const fixture = serviceFixture({
      course: paidCourse({ isPaid: false, priceCents: 0 })
    });

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: 'intent-10'
      }),
      error =>
        error instanceof FinancialOrderServiceError &&
        error.code === 'COURSE_NOT_PAID'
    );

    assert.equal(fixture.writes.length, 0);
  });

  await test('preço inválido falha antes de qualquer escrita', async () => {
    const fixture = serviceFixture({
      course: paidCourse({ priceCents: 10.5 })
    });

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: 'intent-11'
      }),
      error =>
        error instanceof FinancialOrderServiceError &&
        error.code === 'COURSE_PRICE_INVALID'
    );

    assert.equal(fixture.writes.length, 0);
  });

  await test('criação persiste pedido e audit log atomicamente', async () => {
    const fixture = serviceFixture();

    const result = await fixture.service.createPendingCourseOrder({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'intent-12'
    });

    assert.equal(fixture.writes.length, 2);
    assert.ok(fixture.store.has(`orders/${result.orderId}`));

    const auditWrite = fixture.writes.find(
      item => item.path.startsWith('audit_logs/')
    );

    assert.ok(auditWrite);
    assert.equal(auditWrite.data.action, 'financial.order.created');
    assert.equal(auditWrite.data.entityId, result.orderId);
    assert.equal(auditWrite.data.after.ruleId, 'platform-default');
  });

  await test('pedido nasce sem provider e sem transação corrente', async () => {
    const fixture = serviceFixture();

    const result = await fixture.service.createPendingCourseOrder({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'intent-13'
    });

    assert.equal(result.order.provider, null);
    assert.equal(result.order.providerCustomerId, null);
    assert.equal(result.order.currentTransactionId, null);
  });

  await test('timestamp do snapshot e pedido vem somente do clock server-side', async () => {
    const fixture = serviceFixture({
      now: '2026-09-17T21:23:45.000Z'
    });

    const result = await fixture.service.createPendingCourseOrder({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'intent-14',
      createdAt: 'client-value'
    });

    assert.equal(result.order.createdAt, fixture.now);
    assert.equal(result.order.updatedAt, fixture.now);
    assert.equal(result.order.financialSnapshot.resolvedAt, fixture.now);
  });

  await test('identidades e chave de idempotência inválidas falham antes da transação', async () => {
    const fixture = serviceFixture();

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer/invalid',
        courseId: 'course-1',
        idempotencyKey: 'intent-15'
      }),
      error =>
        error instanceof FinancialOrderServiceError &&
        error.code === 'INVALID_ORDER_IDENTITY'
    );

    await assert.rejects(
      fixture.service.createPendingCourseOrder({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: ''
      }),
      error =>
        error instanceof FinancialOrderServiceError &&
        error.code === 'INVALID_IDEMPOTENCY_KEY'
    );

    assert.equal(fixture.transactionRuns, 0);
    assert.equal(fixture.writes.length, 0);
  });

  await test('serviço não importa Asaas nem coleções financeiras legadas', async () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/finance/financial-order-service.js'),
      'utf8'
    );

    for (const forbidden of [
      'asaas-helpers',
      'axios',
      'createPayment(',
      "collection('pedidos')",
      'collection("pedidos")',
      "collection('matriculas')",
      'collection("matriculas")'
    ]) {
      assert.equal(
        source.includes(forbidden),
        false,
        `Dependência proibida encontrada: ${forbidden}`
      );
    }
  });

  console.log(`FINANCIAL_ORDER_SERVICE_V1_2=${passed}/17`);
  if (passed !== 17) process.exitCode = 1;
})();
