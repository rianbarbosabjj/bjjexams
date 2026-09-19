'use strict';

const crypto = require('crypto');

const FAKE_CUSTOMERS_COLLECTION = '__emulator_asaas_fake_customers';
const FAKE_PAYMENTS_COLLECTION = '__emulator_asaas_fake_payments';

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

function supportsSharedFirestoreState(db) {
  return Boolean(db && typeof db.doc === 'function');
}

function fakeCustomerId(externalReference) {
  return `cus_fake_${hash(externalReference)}`;
}

function fakePaymentId(externalReference) {
  return `pay_fake_${hash(externalReference)}`;
}

function customerRef(db, externalReference) {
  return db.doc(
    `${FAKE_CUSTOMERS_COLLECTION}/${fakeCustomerId(externalReference)}`
  );
}

function paymentRef(db, providerPaymentId) {
  return db.doc(`${FAKE_PAYMENTS_COLLECTION}/${providerPaymentId}`);
}

async function readSharedDocument(ref) {
  const snap = await ref.get();
  return snap.exists ? clone(snap.data()) : null;
}

function createFakeAsaasCheckoutProvider(options = {}) {
  assertFakeProviderAllowed(options);
  const env = options.env || process.env;
  const db = options.db || null;
  const sharedState = supportsSharedFirestoreState(db);

  async function readPayment(providerPaymentId) {
    const paymentId = String(providerPaymentId || '');
    return sharedState
      ? readSharedDocument(paymentRef(db, paymentId))
      : clone(fakePaymentsById.get(paymentId) || null);
  }

  return {
    async findCustomerByExternalReference(externalReference) {
      const reference = String(externalReference || '');
      if (sharedState) {
        return readSharedDocument(customerRef(db, reference));
      }
      return clone(fakeCustomersByExternalReference.get(reference) || null);
    },

    async createCustomer(request = {}) {
      const reference = String(request.externalReference || '');
      const customer = {
        id: fakeCustomerId(reference),
        externalReference: request.externalReference,
        name: request.name,
        cpfCnpj: request.cpfCnpj
      };

      if (sharedState) {
        await customerRef(db, reference).set(customer);
      } else {
        fakeCustomersByExternalReference.set(reference, customer);
      }
      return clone(customer);
    },

    async findPaymentByExternalReference(externalReference) {
      const reference = String(externalReference || '');
      if (sharedState) {
        return readSharedDocument(paymentRef(db, fakePaymentId(reference)));
      }
      const paymentId = fakePaymentIdsByExternalReference.get(reference);
      return paymentId
        ? clone(fakePaymentsById.get(paymentId) || null)
        : null;
    },

    async createPixPayment(request = {}) {
      const reference = String(request.externalReference || '');
      const payment = {
        id: fakePaymentId(reference),
        customer: request.customer,
        billingType: 'PIX',
        status: 'PENDING',
        value: request.value,
        externalReference: request.externalReference
      };

      if (sharedState) {
        await paymentRef(db, payment.id).set(payment);
      } else {
        fakePaymentsById.set(payment.id, payment);
        fakePaymentIdsByExternalReference.set(reference, payment.id);
      }
      return clone(payment);
    },

    async getPaymentById(providerPaymentId) {
      const payment = await readPayment(providerPaymentId);
      if (!payment) return null;
      return {
        ...payment,
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
    },

    async deletePendingPayment(providerPaymentId) {
      const payment = await readPayment(providerPaymentId);
      if (!payment) return null;
      return {
        ...payment,
        status: 'DELETED',
        deleted: true
      };
    },

    async requestFullRefund(providerPaymentId, { description = null } = {}) {
      const payment = await readPayment(providerPaymentId);
      if (!payment) return null;
      return {
        ...payment,
        status: 'REFUND_IN_PROGRESS',
        refundDescription: description || null
      };
    }
  };
}

module.exports = {
  FAKE_CUSTOMERS_COLLECTION,
  FAKE_PAYMENTS_COLLECTION,
  assertFakeProviderAllowed,
  fakeAutoConfirmEnabled,
  supportsSharedFirestoreState,
  createFakeAsaasCheckoutProvider
};
