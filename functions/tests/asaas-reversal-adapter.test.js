'use strict';

const assert = require('node:assert/strict');
const {
  AsaasReversalAdapterError,
  createAsaasReversalAdapter
} = require('../src/finance/asaas-reversal-adapter');

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`PASS | ${name}`);
    });
}

function httpSpy() {
  const calls = [];
  return {
    calls,
    async get(path) {
      calls.push({ method: 'get', path });
      return {
        data: {
          id: 'pay_1',
          status: 'PENDING'
        }
      };
    },
    async post(path, body) {
      calls.push({ method: 'post', path, body });
      return {
        data: {
          id: 'pay_1',
          status: 'REFUND_IN_PROGRESS'
        }
      };
    },
    async delete(path) {
      calls.push({ method: 'delete', path });
      return {
        data: {
          id: 'pay_1',
          deleted: true
        }
      };
    }
  };
}

async function main() {
  await test('consulta cobrança por id no path canônico', async () => {
    const http = httpSpy();
    const adapter = createAsaasReversalAdapter({ http, environment: 'sandbox' });
    const payment = await adapter.getPaymentById('pay_1');
    assert.equal(payment.id, 'pay_1');
    assert.deepEqual(http.calls[0], {
      method: 'get',
      path: '/payments/pay_1'
    });
  });

  await test('cancelamento pendente usa DELETE /payments/{id}', async () => {
    const http = httpSpy();
    const adapter = createAsaasReversalAdapter({ http, environment: 'sandbox' });
    const result = await adapter.deletePendingPayment('pay_1');
    assert.equal(result.deleted, true);
    assert.deepEqual(http.calls[0], {
      method: 'delete',
      path: '/payments/pay_1'
    });
  });

  await test('estorno integral omite value e splitRefunds', async () => {
    const http = httpSpy();
    const adapter = createAsaasReversalAdapter({ http, environment: 'sandbox' });
    const result = await adapter.requestFullRefund('pay_1', {
      description: 'Solicitação administrativa'
    });
    assert.equal(result.status, 'REFUND_IN_PROGRESS');
    assert.deepEqual(http.calls[0], {
      method: 'post',
      path: '/payments/pay_1/refund',
      body: {
        description: 'Solicitação administrativa'
      }
    });
    assert.equal('value' in http.calls[0].body, false);
    assert.equal('splitRefunds' in http.calls[0].body, false);
  });

  await test('estorno integral aceita body vazio sem descrição', async () => {
    const http = httpSpy();
    const adapter = createAsaasReversalAdapter({ http, environment: 'sandbox' });
    await adapter.requestFullRefund('pay_1');
    assert.deepEqual(http.calls[0].body, {});
  });

  await test('identificador inválido falha antes do HTTP', async () => {
    const http = httpSpy();
    const adapter = createAsaasReversalAdapter({ http, environment: 'sandbox' });
    await assert.rejects(
      adapter.deletePendingPayment('bad/id'),
      error => error instanceof AsaasReversalAdapterError &&
        error.code === 'INVALID_ASAAS_REVERSAL_IDENTIFIER'
    );
    assert.equal(http.calls.length, 0);
  });

  await test('descrição longa demais é rejeitada', async () => {
    const http = httpSpy();
    const adapter = createAsaasReversalAdapter({ http, environment: 'sandbox' });
    await assert.rejects(
      adapter.requestFullRefund('pay_1', { description: 'x'.repeat(501) }),
      error => error instanceof AsaasReversalAdapterError &&
        error.code === 'INVALID_ASAAS_REVERSAL_DESCRIPTION'
    );
    assert.equal(http.calls.length, 0);
  });

  await test('produção permanece bloqueada no adapter do Marco 5.5', async () => {
    assert.throws(
      () => createAsaasReversalAdapter({ http: httpSpy(), environment: 'production' }),
      error => error instanceof AsaasReversalAdapterError &&
        error.code === 'ASAAS_REVERSAL_SANDBOX_ONLY'
    );
  });

  console.log(`ASAAS_REVERSAL_ADAPTER_V1_2=${passed}/7`);
  if (passed !== 7) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
