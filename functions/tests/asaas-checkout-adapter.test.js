'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  AsaasCheckoutAdapterError,
  centsToProviderValue,
  paymentExternalReference,
  splitExternalReference,
  buildAsaasSplit,
  buildAsaasPixPaymentRequest,
  createAsaasCheckoutAdapter
} = require('../src/finance/asaas-checkout-adapter');

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

function snapshot(overrides = {}) {
  return {
    ruleId: 'platform-default',
    ruleVersion: 1,
    productType: 'course',
    productId: 'course-1',
    currency: 'BRL',
    grossAmountCents: 10000,
    platformFeeBps: 1000,
    platformFeeCents: 1000,
    sellerPoolCents: 9000,
    recipientMode: 'product_owner',
    recipientAllocations: [
      {
        recipientType: 'user',
        recipientId: 'owner-1',
        shareBps: 10000,
        amountCents: 9000
      }
    ],
    resolvedAt: '2026-09-18T12:00:00.000Z',
    ...overrides
  };
}

function order(overrides = {}) {
  return {
    buyerUserId: 'buyer-1',
    productType: 'course',
    productId: 'course-1',
    quantity: 1,
    amountCents: 10000,
    currency: 'BRL',
    status: 'pending_payment',
    financialSnapshot: snapshot(),
    provider: null,
    providerCustomerId: null,
    currentTransactionId: null,
    idempotencyKey: 'intent-1',
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
    paidAt: null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null,
    ...overrides
  };
}

function fakeHttp() {
  const calls = [];
  const getQueue = [];
  const postQueue = [];

  return {
    calls,
    getQueue,
    postQueue,
    async get(url, options) {
      calls.push({ method: 'get', url, options });
      return getQueue.shift() || { data: {} };
    },
    async post(url, body) {
      calls.push({ method: 'post', url, body });
      return postQueue.shift() || { data: {} };
    }
  };
}

(async () => {
  await test('converte centavos para valor decimal somente na borda', async () => {
    assert.equal(centsToProviderValue(9000), 90);
    assert.equal(centsToProviderValue(1), 0.01);
    assert.equal(centsToProviderValue(12345), 123.45);
  });

  await test('externalReference de pagamento é canônica e determinística', async () => {
    assert.equal(
      paymentExternalReference('order-123'),
      'BJJEX-V12-ORDER-order-123'
    );
    assert.equal(
      paymentExternalReference('order-123'),
      paymentExternalReference('order-123')
    );
  });

  await test('externalReference de split não expõe recipientId em claro', async () => {
    const reference = splitExternalReference({
      transactionId: 'transaction-1',
      recipientType: 'user',
      recipientId: 'usuario-sensivel-123'
    });

    assert.match(reference, /^BJJEX-V12-SPLIT-transaction-1-[a-f0-9]{16}$/);
    assert.equal(reference.includes('usuario-sensivel-123'), false);
  });

  await test('split usa fixedValue exato do snapshot e omite plataforma', async () => {
    const explicit = snapshot({
      recipientMode: 'explicit',
      recipientAllocations: [
        {
          recipientType: 'organization',
          recipientId: 'org-1',
          shareBps: 4000,
          amountCents: 3600
        },
        {
          recipientType: 'platform',
          recipientId: null,
          shareBps: 1000,
          amountCents: 900
        },
        {
          recipientType: 'user',
          recipientId: 'user-1',
          shareBps: 5000,
          amountCents: 4500
        }
      ]
    });

    const result = buildAsaasSplit({
      transactionId: 'tx-1',
      financialSnapshot: explicit,
      recipientWallets: {
        'organization:org-1': 'wallet-org',
        'user:user-1': 'wallet-user'
      }
    });

    assert.deepEqual(
      result.split.map(item => [item.walletId, item.fixedValue]),
      [
        ['wallet-org', 36],
        ['wallet-user', 45]
      ]
    );
    assert.equal(result.providerSplitSnapshot.length, 2);
    assert.equal(
      result.providerSplitSnapshot.reduce(
        (sum, item) => sum + item.fixedValueCents,
        0
      ),
      8100
    );
  });

  await test('produto da plataforma não envia split para a própria conta', async () => {
    const platformSnapshot = snapshot({
      recipientAllocations: [
        {
          recipientType: 'platform',
          recipientId: null,
          shareBps: 10000,
          amountCents: 9000
        }
      ]
    });

    const result = buildAsaasSplit({
      transactionId: 'tx-platform',
      financialSnapshot: platformSnapshot,
      recipientWallets: {}
    });

    assert.deepEqual(result.split, []);
    assert.deepEqual(result.providerSplitSnapshot, []);
  });

  await test('wallet ausente para recebedor externo falha fechado', async () => {
    assert.throws(
      () => buildAsaasSplit({
        transactionId: 'tx-2',
        financialSnapshot: snapshot(),
        recipientWallets: {}
      }),
      error =>
        error instanceof AsaasCheckoutAdapterError &&
        error.code === 'ASAAS_RECIPIENT_WALLET_REQUIRED'
    );
  });

  await test('mesma wallet em dois recebedores falha fechado', async () => {
    const explicit = snapshot({
      recipientMode: 'explicit',
      recipientAllocations: [
        {
          recipientType: 'organization',
          recipientId: 'org-1',
          shareBps: 5000,
          amountCents: 4500
        },
        {
          recipientType: 'user',
          recipientId: 'user-1',
          shareBps: 5000,
          amountCents: 4500
        }
      ]
    });

    assert.throws(
      () => buildAsaasSplit({
        transactionId: 'tx-3',
        financialSnapshot: explicit,
        recipientWallets: {
          'organization:org-1': 'wallet-shared',
          'user:user-1': 'wallet-shared'
        }
      }),
      error =>
        error instanceof AsaasCheckoutAdapterError &&
        error.code === 'DUPLICATE_ASAAS_RECIPIENT_WALLET'
    );
  });

  await test('alocação externa de zero centavos falha fechado', async () => {
    const tinySnapshot = snapshot({
      grossAmountCents: 2,
      platformFeeBps: 0,
      platformFeeCents: 0,
      sellerPoolCents: 2,
      recipientMode: 'explicit',
      recipientAllocations: [
        {
          recipientType: 'organization',
          recipientId: 'org-zero',
          shareBps: 1,
          amountCents: 0
        },
        {
          recipientType: 'user',
          recipientId: 'user-two',
          shareBps: 9999,
          amountCents: 2
        }
      ]
    });

    assert.throws(
      () => buildAsaasSplit({
        transactionId: 'tx-zero',
        financialSnapshot: tinySnapshot,
        recipientWallets: {
          'organization:org-zero': 'wallet-zero',
          'user:user-two': 'wallet-two'
        }
      }),
      error =>
        error instanceof AsaasCheckoutAdapterError &&
        error.code === 'INVALID_ASAAS_SPLIT_AMOUNT'
    );
  });

  await test('request PIX deriva valor somente do order canônico', async () => {
    const result = buildAsaasPixPaymentRequest({
      orderId: 'order-1',
      transactionId: 'tx-4',
      providerCustomerId: 'cus-1',
      order: order(),
      recipientWallets: {
        'user:owner-1': 'wallet-owner'
      },
      dueDate: '2026-09-20',
      description: 'Curso BJJ Exams'
    });

    assert.equal(result.request.customer, 'cus-1');
    assert.equal(result.request.billingType, 'PIX');
    assert.equal(result.request.value, 100);
    assert.equal(result.request.dueDate, '2026-09-20');
    assert.equal(
      result.request.externalReference,
      'BJJEX-V12-ORDER-order-1'
    );
    assert.equal(result.request.split[0].fixedValue, 90);
    assert.equal(result.providerSplitSnapshot[0].fixedValueCents, 9000);
  });

  await test('request sem recebedor externo não envia campo split vazio', async () => {
    const platformSnapshot = snapshot({
      recipientAllocations: [
        {
          recipientType: 'platform',
          recipientId: null,
          shareBps: 10000,
          amountCents: 9000
        }
      ]
    });

    const result = buildAsaasPixPaymentRequest({
      orderId: 'order-platform',
      transactionId: 'tx-platform-2',
      providerCustomerId: 'cus-platform',
      order: order({
        financialSnapshot: platformSnapshot
      }),
      recipientWallets: {},
      dueDate: '2026-09-20'
    });

    assert.equal(Object.hasOwn(result.request, 'split'), false);
  });

  await test('dueDate inválida é rejeitada antes do provider', async () => {
    assert.throws(
      () => buildAsaasPixPaymentRequest({
        orderId: 'order-date',
        transactionId: 'tx-date',
        providerCustomerId: 'cus-date',
        order: order(),
        recipientWallets: {
          'user:owner-1': 'wallet-owner'
        },
        dueDate: '2026-02-30'
      }),
      error =>
        error instanceof AsaasCheckoutAdapterError &&
        error.code === 'INVALID_ASAAS_DUE_DATE'
    );
  });

  await test('adapter do Marco 5.3 bloqueia ambiente production', async () => {
    const http = fakeHttp();
    assert.throws(
      () => createAsaasCheckoutAdapter({
        http,
        environment: 'production'
      }),
      error =>
        error instanceof AsaasCheckoutAdapterError &&
        error.code === 'ASAAS_CHECKOUT_SANDBOX_ONLY'
    );
  });

  await test('reconciliação consulta payments por externalReference com limite 2', async () => {
    const http = fakeHttp();
    http.getQueue.push({
      data: {
        data: [{ id: 'pay-1', externalReference: 'ref-1' }]
      }
    });

    const adapter = createAsaasCheckoutAdapter({
      http,
      environment: 'sandbox'
    });

    const payment = await adapter.findPaymentByExternalReference('ref-1');

    assert.equal(payment.id, 'pay-1');
    assert.deepEqual(http.calls[0], {
      method: 'get',
      url: '/payments',
      options: {
        params: {
          externalReference: 'ref-1',
          offset: 0,
          limit: 2
        }
      }
    });
  });

  await test('externalReference duplicada no Asaas falha como ambígua', async () => {
    const http = fakeHttp();
    http.getQueue.push({
      data: {
        data: [{ id: 'pay-a' }, { id: 'pay-b' }]
      }
    });

    const adapter = createAsaasCheckoutAdapter({ http });

    await assert.rejects(
      adapter.findPaymentByExternalReference('ref-ambiguous'),
      error =>
        error instanceof AsaasCheckoutAdapterError &&
        error.code === 'AMBIGUOUS_ASAAS_EXTERNAL_REFERENCE'
    );
  });

  await test('adapter usa endpoints canônicos para cobrança e QR Code', async () => {
    const http = fakeHttp();
    http.postQueue.push({ data: { id: 'pay-created' } });
    http.getQueue.push({ data: { payload: 'pix-payload' } });

    const adapter = createAsaasCheckoutAdapter({ http });

    const created = await adapter.createPixPayment({
      customer: 'cus-1',
      billingType: 'PIX',
      value: 100,
      dueDate: '2026-09-20',
      externalReference: 'BJJEX-V12-ORDER-order-1'
    });
    const pix = await adapter.getPixQrCode('pay-created');

    assert.equal(created.id, 'pay-created');
    assert.equal(pix.payload, 'pix-payload');
    assert.equal(http.calls[0].method, 'post');
    assert.equal(http.calls[0].url, '/payments');
    assert.equal(http.calls[1].method, 'get');
    assert.equal(http.calls[1].url, '/payments/pay-created/pixQrCode');
  });

  await test('adapter canônico não importa helper Asaas legado nem coleções legadas', async () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../src/finance/asaas-checkout-adapter.js'),
      'utf8'
    );

    for (const forbidden of [
      'asaas-helpers',
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

  console.log(`ASAAS_CHECKOUT_ADAPTER_V1_2=${passed}/16`);
  if (passed !== 16) process.exitCode = 1;
})();
