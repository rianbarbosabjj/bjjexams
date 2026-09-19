'use strict';

const ASAAS_SANDBOX_ENVIRONMENT = 'sandbox';
const ASAAS_PAYMENT_PATH = '/payments';

class AsaasReversalAdapterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'AsaasReversalAdapterError';
    this.code = code;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new AsaasReversalAdapterError(
      'INVALID_ASAAS_REVERSAL_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function optionalDescription(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > 500) {
    throw new AsaasReversalAdapterError(
      'INVALID_ASAAS_REVERSAL_DESCRIPTION',
      'Descrição do estorno excede 500 caracteres.'
    );
  }
  return normalized;
}

function createAsaasReversalAdapter({
  http,
  environment = ASAAS_SANDBOX_ENVIRONMENT
} = {}) {
  if (String(environment || '').trim().toLowerCase() !== ASAAS_SANDBOX_ENVIRONMENT) {
    throw new AsaasReversalAdapterError(
      'ASAAS_REVERSAL_SANDBOX_ONLY',
      'Operações de reversão do Marco 5.5 aceitam somente sandbox.'
    );
  }

  if (
    !http ||
    typeof http.get !== 'function' ||
    typeof http.post !== 'function' ||
    typeof http.delete !== 'function'
  ) {
    throw new TypeError(
      'Asaas reversal adapter exige cliente HTTP com get/post/delete.'
    );
  }

  async function getPaymentById(providerPaymentId) {
    const paymentId = requiredIdentifier(providerPaymentId, 'providerPaymentId');
    const response = await http.get(
      `${ASAAS_PAYMENT_PATH}/${encodeURIComponent(paymentId)}`
    );
    return response?.data || null;
  }

  async function deletePendingPayment(providerPaymentId) {
    const paymentId = requiredIdentifier(providerPaymentId, 'providerPaymentId');
    const response = await http.delete(
      `${ASAAS_PAYMENT_PATH}/${encodeURIComponent(paymentId)}`
    );
    return response?.data || null;
  }

  async function requestFullRefund(
    providerPaymentId,
    { description = null } = {}
  ) {
    const paymentId = requiredIdentifier(providerPaymentId, 'providerPaymentId');
    const body = {};
    const canonicalDescription = optionalDescription(description);
    if (canonicalDescription) body.description = canonicalDescription;

    // No full refund, value/splitRefunds são deliberadamente omitidos.
    const response = await http.post(
      `${ASAAS_PAYMENT_PATH}/${encodeURIComponent(paymentId)}/refund`,
      body
    );
    return response?.data || null;
  }

  return {
    environment: ASAAS_SANDBOX_ENVIRONMENT,
    getPaymentById,
    deletePendingPayment,
    requestFullRefund
  };
}

module.exports = {
  ASAAS_SANDBOX_ENVIRONMENT,
  ASAAS_PAYMENT_PATH,
  AsaasReversalAdapterError,
  createAsaasReversalAdapter
};
