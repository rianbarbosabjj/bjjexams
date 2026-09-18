'use strict';

const crypto = require('crypto');

const {
  validateOrder,
  validateFinancialSnapshot
} = require('./financial-domain');

const ASAAS_SANDBOX_ENVIRONMENT = 'sandbox';
const ASAAS_PAYMENT_PATH = '/payments';
const ASAAS_CUSTOMER_PATH = '/customers';

class AsaasCheckoutAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AsaasCheckoutAdapterError';
    this.code = code;
  }
}

function requiredIdentifier(value, field, max = 200) {
  const normalized = String(value || '').trim();
  if (
    !normalized ||
    normalized.length > max ||
    normalized.includes('/')
  ) {
    throw new AsaasCheckoutAdapterError(
      'INVALID_ASAAS_CHECKOUT_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function requiredText(value, field, max = 500) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > max) {
    throw new AsaasCheckoutAdapterError(
      'INVALID_ASAAS_CHECKOUT_TEXT',
      `${field} inválido.`
    );
  }
  return normalized;
}

function optionalText(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function digits(value, max = 20) {
  return String(value || '').replace(/\D/g, '').slice(0, max);
}

function requiredDueDate(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new AsaasCheckoutAdapterError(
      'INVALID_ASAAS_DUE_DATE',
      'dueDate precisa usar YYYY-MM-DD.'
    );
  }

  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    throw new AsaasCheckoutAdapterError(
      'INVALID_ASAAS_DUE_DATE',
      'dueDate inválida.'
    );
  }

  return normalized;
}

function centsToProviderValue(value, field = 'amountCents') {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new AsaasCheckoutAdapterError(
      'INVALID_ASAAS_AMOUNT',
      `${field} precisa ser inteiro não negativo em centavos.`
    );
  }

  return Number((cents / 100).toFixed(2));
}

function paymentExternalReference(orderId) {
  const canonicalOrderId = requiredIdentifier(orderId, 'orderId');
  return `BJJEX-V12-ORDER-${canonicalOrderId}`;
}

function splitExternalReference({
  transactionId,
  recipientType,
  recipientId
} = {}) {
  const canonicalTransactionId = requiredIdentifier(
    transactionId,
    'transactionId'
  );
  const type = requiredIdentifier(recipientType, 'recipientType', 40)
    .toLowerCase();
  const id = requiredIdentifier(recipientId, 'recipientId');

  if (!['user', 'organization'].includes(type)) {
    throw new AsaasCheckoutAdapterError(
      'INVALID_ASAAS_SPLIT_RECIPIENT',
      'Split externo aceita somente user ou organization.'
    );
  }

  const recipientHash = crypto
    .createHash('sha256')
    .update(`${type}:${id}`)
    .digest('hex')
    .slice(0, 16);

  return `BJJEX-V12-SPLIT-${canonicalTransactionId}-${recipientHash}`;
}

function recipientKey(recipientType, recipientId) {
  return `${recipientType}:${recipientId}`;
}

function normalizeRecipientWallets(value = {}) {
  if (value instanceof Map) return new Map(value);

  if (Array.isArray(value)) {
    const result = new Map();
    for (const item of value) {
      if (!item) continue;
      result.set(
        recipientKey(
          String(item.recipientType || '').trim().toLowerCase(),
          String(item.recipientId || '').trim()
        ),
        String(item.walletId || '').trim()
      );
    }
    return result;
  }

  if (value && typeof value === 'object') {
    return new Map(
      Object.entries(value).map(([key, walletId]) => [
        key,
        String(walletId || '').trim()
      ])
    );
  }

  return new Map();
}

function buildAsaasSplit({
  transactionId,
  financialSnapshot,
  recipientWallets
} = {}) {
  const snapshot = validateFinancialSnapshot(financialSnapshot || {});
  const canonicalTransactionId = requiredIdentifier(
    transactionId,
    'transactionId'
  );
  const wallets = normalizeRecipientWallets(recipientWallets);
  const usedWallets = new Set();
  const split = [];
  const providerSplitSnapshot = [];

  for (const allocation of snapshot.recipientAllocations) {
    if (allocation.recipientType === 'platform') {
      continue;
    }

    if (!['user', 'organization'].includes(allocation.recipientType)) {
      throw new AsaasCheckoutAdapterError(
        'INVALID_ASAAS_SPLIT_RECIPIENT',
        'Snapshot possui recebedor externo inválido.'
      );
    }

    if (!Number.isSafeInteger(allocation.amountCents) || allocation.amountCents <= 0) {
      throw new AsaasCheckoutAdapterError(
        'INVALID_ASAAS_SPLIT_AMOUNT',
        'Recebedor externo precisa possuir valor positivo no snapshot.'
      );
    }

    const key = recipientKey(
      allocation.recipientType,
      allocation.recipientId
    );
    const walletId = String(wallets.get(key) || '').trim();

    if (!walletId) {
      throw new AsaasCheckoutAdapterError(
        'ASAAS_RECIPIENT_WALLET_REQUIRED',
        `Wallet Asaas ausente para ${key}.`
      );
    }

    if (usedWallets.has(walletId)) {
      throw new AsaasCheckoutAdapterError(
        'DUPLICATE_ASAAS_RECIPIENT_WALLET',
        'A mesma wallet Asaas não pode receber dois itens do split.'
      );
    }
    usedWallets.add(walletId);

    const externalReference = splitExternalReference({
      transactionId: canonicalTransactionId,
      recipientType: allocation.recipientType,
      recipientId: allocation.recipientId
    });

    split.push({
      walletId,
      fixedValue: centsToProviderValue(
        allocation.amountCents,
        'recipient amountCents'
      ),
      externalReference
    });

    providerSplitSnapshot.push({
      recipientType: allocation.recipientType,
      recipientId: allocation.recipientId,
      walletId,
      fixedValueCents: allocation.amountCents,
      externalReference
    });
  }

  return {
    split,
    providerSplitSnapshot
  };
}

function buildAsaasPixPaymentRequest({
  orderId,
  transactionId,
  providerCustomerId,
  order: orderInput,
  recipientWallets,
  dueDate,
  description = null
} = {}) {
  const order = validateOrder(orderInput || {});
  const canonicalOrderId = requiredIdentifier(orderId, 'orderId');
  const canonicalTransactionId = requiredIdentifier(
    transactionId,
    'transactionId'
  );
  const customerId = requiredIdentifier(
    providerCustomerId,
    'providerCustomerId'
  );
  const canonicalDueDate = requiredDueDate(dueDate);

  const {
    split,
    providerSplitSnapshot
  } = buildAsaasSplit({
    transactionId: canonicalTransactionId,
    financialSnapshot: order.financialSnapshot,
    recipientWallets
  });

  const externalReference = paymentExternalReference(canonicalOrderId);
  const request = {
    customer: customerId,
    billingType: 'PIX',
    value: centsToProviderValue(order.amountCents),
    dueDate: canonicalDueDate,
    externalReference
  };

  if (description !== null && description !== undefined) {
    request.description = requiredText(
      description,
      'description',
      500
    );
  }

  if (split.length > 0) {
    request.split = split;
  }

  return {
    request,
    externalReference,
    providerSplitSnapshot
  };
}

function buildAsaasCustomerRequest({
  profile = {},
  externalReference
} = {}) {
  const name = requiredText(
    profile.nome || profile.name,
    'customer.name',
    200
  );
  const cpfCnpj = digits(profile.cpfCnpj || profile.cpf, 14);
  if (!cpfCnpj || ![11, 14].includes(cpfCnpj.length)) {
    throw new AsaasCheckoutAdapterError(
      'ASAAS_CUSTOMER_DOCUMENT_REQUIRED',
      'Checkout exige CPF/CNPJ canônico válido para criar cliente Asaas.'
    );
  }

  const request = {
    name,
    cpfCnpj,
    externalReference: requiredText(
      externalReference,
      'customer.externalReference',
      200
    )
  };

  const email = optionalText(profile.email, 200);
  const mobilePhone = digits(profile.telefone || profile.mobilePhone, 20);
  if (email) request.email = email;
  if (mobilePhone) request.mobilePhone = mobilePhone;

  return request;
}

function createAsaasCheckoutAdapter({
  http,
  environment = ASAAS_SANDBOX_ENVIRONMENT
} = {}) {
  if (String(environment || '').trim().toLowerCase() !== ASAAS_SANDBOX_ENVIRONMENT) {
    throw new AsaasCheckoutAdapterError(
      'ASAAS_CHECKOUT_SANDBOX_ONLY',
      'Checkout Asaas do Marco 5.3 aceita somente sandbox.'
    );
  }

  if (
    !http ||
    typeof http.get !== 'function' ||
    typeof http.post !== 'function'
  ) {
    throw new TypeError(
      'Asaas checkout adapter exige cliente HTTP com get/post.'
    );
  }

  async function findUnique(path, params, duplicateCode, duplicateMessage) {
    const response = await http.get(path, {
      params: {
        ...params,
        offset: 0,
        limit: 2
      }
    });

    const rows = Array.isArray(response?.data?.data)
      ? response.data.data
      : [];

    if (rows.length > 1) {
      throw new AsaasCheckoutAdapterError(
        duplicateCode,
        duplicateMessage
      );
    }

    return rows[0] || null;
  }

  async function findCustomerByExternalReference(externalReference) {
    const reference = requiredText(
      externalReference,
      'externalReference',
      200
    );
    return findUnique(
      ASAAS_CUSTOMER_PATH,
      { externalReference: reference },
      'AMBIGUOUS_ASAAS_CUSTOMER_EXTERNAL_REFERENCE',
      'Mais de um cliente Asaas usa a mesma externalReference.'
    );
  }

  async function createCustomer(request) {
    if (!request || typeof request !== 'object') {
      throw new AsaasCheckoutAdapterError(
        'INVALID_ASAAS_CUSTOMER_REQUEST',
        'Payload de cliente Asaas inválido.'
      );
    }
    const response = await http.post(
      ASAAS_CUSTOMER_PATH,
      request
    );
    return response?.data || null;
  }

  async function findPaymentByExternalReference(externalReference) {
    const reference = requiredText(
      externalReference,
      'externalReference',
      200
    );
    return findUnique(
      ASAAS_PAYMENT_PATH,
      { externalReference: reference },
      'AMBIGUOUS_ASAAS_EXTERNAL_REFERENCE',
      'Mais de uma cobrança Asaas usa a mesma externalReference.'
    );
  }

  async function createPixPayment(request) {
    if (!request || typeof request !== 'object') {
      throw new AsaasCheckoutAdapterError(
        'INVALID_ASAAS_PAYMENT_REQUEST',
        'Payload de cobrança Asaas inválido.'
      );
    }

    const response = await http.post(
      ASAAS_PAYMENT_PATH,
      request
    );

    return response?.data || null;
  }

  async function getPixQrCode(providerPaymentId) {
    const paymentId = requiredIdentifier(
      providerPaymentId,
      'providerPaymentId'
    );

    const response = await http.get(
      `${ASAAS_PAYMENT_PATH}/${encodeURIComponent(paymentId)}/pixQrCode`
    );

    return response?.data || null;
  }

  return {
    environment: ASAAS_SANDBOX_ENVIRONMENT,
    findCustomerByExternalReference,
    createCustomer,
    findPaymentByExternalReference,
    createPixPayment,
    getPixQrCode
  };
}

module.exports = {
  ASAAS_SANDBOX_ENVIRONMENT,
  ASAAS_PAYMENT_PATH,
  ASAAS_CUSTOMER_PATH,
  AsaasCheckoutAdapterError,
  centsToProviderValue,
  paymentExternalReference,
  splitExternalReference,
  buildAsaasSplit,
  buildAsaasPixPaymentRequest,
  buildAsaasCustomerRequest,
  createAsaasCheckoutAdapter
};