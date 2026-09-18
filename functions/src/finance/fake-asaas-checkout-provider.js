'use strict';

const crypto = require('crypto');

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

function createFakeAsaasCheckoutProvider(options = {}) {
  assertFakeProviderAllowed(options);

  return {
    async findCustomerByExternalReference() {
      return null;
    },

    async createCustomer(request = {}) {
      return {
        id: `cus_fake_${hash(request.externalReference)}`,
        externalReference: request.externalReference,
        name: request.name,
        cpfCnpj: request.cpfCnpj
      };
    },

    async findPaymentByExternalReference() {
      return null;
    },

    async createPixPayment(request = {}) {
      return {
        id: `pay_fake_${hash(request.externalReference)}`,
        customer: request.customer,
        billingType: 'PIX',
        status: 'PENDING',
        value: request.value,
        externalReference: request.externalReference
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
  createFakeAsaasCheckoutProvider
};