'use strict';

const crypto = require('crypto');

const fakeCustomersByExternalReference = new Map();
const fakePaymentsById = new Map();
const fakePaymentIdsByExternalReference = new Map();

function hash(value, length = 20) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex')
    .slice(0, length);
}

function assertFakeProviderAllowed({
  projectId,
  env = process.env
} = {}) {
  const demoProject = String(projectId || '').startsWith('demo-');
  const functionsEmulator =
    String(env.FUNCTIONS_EMULATOR || '').trim().toLowerCase() === 'true';
  const fakeEnabled =
    String(env.BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE || '')
      .trim()
      .toLowerCase() === 'true';
  const firestoreLocal =
    /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(
      String(env.FIRESTORE_EMULATOR_HOST || '')
    );

  if (!demoProject || !functionsEmulator || !fakeEnabled || !firestoreLocal) {
    throw new Error(
      'Fake Asaas checkout provider permitido apenas em projeto demo + Functions/Firestore Emulator.'
    );
  }

  return true;
}

function fakeAutoConfirmEnabled(env = process.env) {
  return String(env.BJJ_EXAMS_FAKE_ASAAS_AUTO_CONFIRM || '')
    .trim()
    .toLowerCase() === 'true';
}

function clone(value) {
  return value ? JSON.parse(JSON.stringify(value)) : null;
}

function createFakeAsaasCheckoutProvider(options = {}) {
  assertFakeProviderAllowed(options);
  const env = options.env || process.env;

  return {
    async findCustomerByExternalReference(externalReference) {
      return clone(
        fakeCustomersByExternalReference.get(String(externalReference || '')) || null
      );
    },

    async createCustomer(request = {}) {
      const customer = {
        id: `cus_fake_${hash(request.externalReference)}`,
        externalReference: request.externalReference,
        name: request.name,
        cpfCnpj: request.cpfCnpj
      };
      fakeCustomersByExternalReference.set(
        String(request.externalReference || ''),
        customer
      );
      return clone(customer);
    },

    async findPaymentByExternalReference(externalReference) {
      const paymentId = fakePaymentIdsByExternalReference.get(
        String(externalReference || '')
      );
      return paymentId
        ? clone(fakePaymentsById.get(paymentId) || null)
        : null;
    },

    async createPixPayment(request = {}) {
      const payment = {
        id: `pay_fake_${hash(request.externalReference)}`,
        customer: request.customer,
        billingType: 'PIX',
        status: 'PENDING',
        value: request.value,
        externalReference: request.externalReference
      };
      fakePaymentsById.set(payment.id, payment);
      fakePaymentIdsByExternalReference.set(
        String(request.externalReference || ''),
        payment.id
      );
      return clone(payment);
    },

    async getPaymentById(providerPaymentId) {
      const payment = fakePaymentsById.get(String(providerPaymentId || ''));
      if (!payment) return null;
      return {
        ...clone(payment),
        status: fakeAutoConfirmEnabled(env) ? 'RECEIVED' : payment.status
      };
    },

    async getPixQrCode(providerPaymentId) {
      const paymentId = String(providerPaymentId || '');
      return {
        encodedImage: Buffer.from(`fake:${paymentId}`).toString('base64'),
        payload: `000201BJJEXFAKE${hash(paymentId, 24)}`,
        expirationDate: '2099-12-31T23:59:59Z'
      };
    }
  };
}

module.exports = {
  assertFakeProviderAllowed,
  fakeAutoConfirmEnabled,
  createFakeAsaasCheckoutProvider
};