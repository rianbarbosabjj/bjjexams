'use strict';

const assert = require('node:assert/strict');

const {
  FinancialOrderServiceError,
  financialOrderDocumentId,
  createFinancialOrderService
} = require('../src/finance/financial-order-service');

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function createFakeDb(seed = {}) {
  const store = new Map(
    Object.entries(seed).map(([path, value]) => [path, clone(value)])
  );
  const writes = [];
  let generated = 0;

  function ref(path) {
    const parts = path.split('/');
    return {
      path,
      id: parts[parts.length - 1]
    };
  }

  const db = {
    doc(path) {
      return ref(path);
    },

    collection(name) {
      return {
        doc(id = null) {
          return ref(`${name}/${id || `auto-${++generated}`}`);
        }
      };
    },

    async runTransaction(callback) {
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
    writes
  };
}

function course(overrides = {}) {
  return {
    title: 'Curso pago',
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
    name: 'Regra padrão',
    status: 'active',
    scope: 'platform_default',
    productType: null,
    productId: null,
    platformFeeBps: 1000,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 1,
    createdBy: 'admin-1',
    updatedBy: 'admin-1',
    createdAt: '2026-09-18T10:00:00.000Z',
    updatedAt: '2026-09-18T10:00:00.000Z',
    ...overrides
  };
}

function fixture() {
  const fake = createFakeDb({
    'courses/course-1': course(),
    'financial_rules/platform-default': defaultRule()
  });

  const service = createFinancialOrderService({
    db: fake.db,
    clock: () => '2026-09-18T11:00:00.000Z'
  });

  return {
    ...fake,
    service
  };
}

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

(async () => {
  await test('orderId determinístico é estável para a mesma intenção', async () => {
    const input = {
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'checkout-abc'
    };

    const first = financialOrderDocumentId(input);
    const second = financialOrderDocumentId(input);

    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });

  await test('idempotencyKey diferente gera orderId diferente', async () => {
    const first = financialOrderDocumentId({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'checkout-a'
    });

    const second = financialOrderDocumentId({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'checkout-b'
    });

    assert.notEqual(first, second);
  });

  await test('primeira intenção cria pedido determinístico e audit uma única vez', async () => {
    const f = fixture();

    const result = await f.service.createPendingCourseOrder({
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'checkout-1'
    });

    assert.equal(result.created, true);
    assert.equal(
      result.orderId,
      financialOrderDocumentId({
        buyerUserId: 'buyer-1',
        courseId: 'course-1',
        idempotencyKey: 'checkout-1'
      })
    );
    assert.ok(f.store.has(`orders/${result.orderId}`));
    assert.equal(
      f.writes.filter(item => item.path.startsWith('audit_logs/')).length,
      1
    );
  });

  await test('retry da mesma intenção retorna mesmo pedido sem nova escrita', async () => {
    const f = fixture();
    const input = {
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'checkout-2'
    };

    const first = await f.service.createPendingCourseOrder(input);
    const writesAfterFirst = f.writes.length;
    const second = await f.service.createPendingCourseOrder(input);

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(second.orderId, first.orderId);
    assert.deepEqual(second.order, first.order);
    assert.equal(f.writes.length, writesAfterFirst);
    assert.equal(
      f.writes.filter(item => item.path.startsWith('audit_logs/')).length,
      1
    );
  });

  await test('retry preserva preço e snapshot históricos após mudança do curso/regra', async () => {
    const f = fixture();
    const input = {
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'checkout-3'
    };

    const first = await f.service.createPendingCourseOrder(input);

    f.store.set(
      'courses/course-1',
      course({ priceCents: 25000 })
    );
    f.store.set(
      'financial_rules/platform-default',
      defaultRule({
        platformFeeBps: 2000,
        version: 2,
        updatedAt: '2026-09-18T12:00:00.000Z'
      })
    );

    const second = await f.service.createPendingCourseOrder(input);

    assert.equal(second.created, false);
    assert.equal(second.order.amountCents, 10000);
    assert.equal(second.order.financialSnapshot.ruleVersion, 1);
    assert.equal(second.order.financialSnapshot.platformFeeBps, 1000);
    assert.deepEqual(second.order, first.order);
  });

  await test('pedido idempotente corrompido falha fechado', async () => {
    const f = fixture();
    const input = {
      buyerUserId: 'buyer-1',
      courseId: 'course-1',
      idempotencyKey: 'checkout-4'
    };

    const orderId = financialOrderDocumentId(input);
    f.store.set(`orders/${orderId}`, {
      buyerUserId: 'outro-usuario',
      productType: 'course',
      productId: 'course-1'
    });

    await assert.rejects(
      f.service.createPendingCourseOrder(input),
      error =>
        error instanceof FinancialOrderServiceError &&
        error.code === 'EXISTING_ORDER_INVALID'
    );

    assert.equal(f.writes.length, 0);
  });

  console.log(`FINANCIAL_ORDER_IDEMPOTENCY_V1_2=${passed}/6`);
  if (passed !== 6) process.exitCode = 1;
})();
