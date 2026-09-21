'use strict';

const {
  AsaasCheckoutAdapterError,
  isDefinitiveAsaasProviderError,
  buildAsaasCustomerRequest,
  buildAsaasPixPaymentRequest,
  paymentExternalReference
} = require('./asaas-checkout-adapter');
const {
  FinancialCheckoutPersistenceError,
  createFinancialCheckoutPersistence
} = require('./financial-checkout-persistence');
const {
  FinancialCheckoutProviderStateError,
  createFinancialCheckoutProviderState
} = require('./financial-checkout-provider-state');

class FinancialCourseCheckoutServiceError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'FinancialCourseCheckoutServiceError';
    this.code = code;
    this.cause = cause || undefined;
  }
}

function requiredProviderPaymentId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 200 || id.includes('/')) {
    throw new FinancialCourseCheckoutServiceError(
      'INVALID_PROVIDER_PAYMENT',
      'Asaas retornou cobrança sem identificador válido.'
    );
  }
  return id;
}

function tomorrowDueDate(now = new Date()) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new FinancialCourseCheckoutServiceError(
      'INVALID_CHECKOUT_CLOCK',
      'Relógio do checkout retornou data inválida.'
    );
  }
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function sanitizedPix(input = {}) {
  return {
    encodedImage: input.encodedImage ? String(input.encodedImage) : null,
    payload: input.payload ? String(input.payload) : null,
    expirationDate: input.expirationDate
      ? String(input.expirationDate)
      : null
  };
}

function processingResponse(prepared) {
  return {
    orderId: prepared.orderId,
    transactionId: prepared.transactionId,
    status: 'processing',
    processing: true,
    paymentId: prepared.transaction?.providerPaymentId || null,
    pix: null
  };
}

function assertProvider(provider) {
  const requiredMethods = [
    'findCustomerByExternalReference',
    'createCustomer',
    'findPaymentByExternalReference',
    'createPixPayment',
    'getPixQrCode'
  ];
  for (const method of requiredMethods) {
    if (typeof provider?.[method] !== 'function') {
      throw new TypeError(`Checkout provider exige método ${method}.`);
    }
  }
}

function createFinancialCourseCheckoutService(dependencies = {}) {
  const {
    db,
    provider,
    environment = 'sandbox',
    clock = () => new Date(),
    dueDateFactory = tomorrowDueDate,
    persistence = null,
    providerState = null
  } = dependencies;

  assertProvider(provider);

  const canonicalEnvironment = String(environment || '').trim().toLowerCase();
  if (canonicalEnvironment !== 'sandbox') {
    throw new FinancialCourseCheckoutServiceError(
      'CHECKOUT_SANDBOX_ONLY',
      'Marco 5.3 aceita somente ambiente sandbox.'
    );
  }

  const persistenceService = persistence ||
    createFinancialCheckoutPersistence({
      db,
      environment: canonicalEnvironment,
      provider: 'asaas',
      clock
    });

  const providerStateService = providerState ||
    createFinancialCheckoutProviderState({
      db,
      environment: canonicalEnvironment,
      provider: 'asaas',
      clock
    });

  async function releaseCheckout(prepared) {
    if (!prepared?.lease?.leaseToken) return false;
    try {
      return await persistenceService.releaseCheckoutLease({
        transactionId: prepared.transactionId,
        leaseToken: prepared.lease.leaseToken
      });
    } catch (_) {
      return false;
    }
  }

  async function resolveProviderCustomer(prepared) {
    if (
      prepared.customer?.status === 'ready' &&
      prepared.customer.providerCustomerId
    ) {
      return {
        processing: false,
        providerCustomerId: prepared.customer.providerCustomerId
      };
    }

    const lease = await persistenceService.acquireProviderCustomerLease({
      userId: prepared.order.buyerUserId
    });

    if (lease.ready) {
      return {
        processing: false,
        providerCustomerId: lease.providerCustomerId
      };
    }

    if (!lease.acquired) {
      return {
        processing: true,
        providerCustomerId: null
      };
    }

    let profile;
    let request;
    try {
      profile = await providerStateService.getBuyerProfile(
        prepared.order.buyerUserId
      );
      request = buildAsaasCustomerRequest({
        profile,
        externalReference: lease.externalReference
      });
    } catch (error) {
      await persistenceService.releaseProviderCustomerLease({
        userId: prepared.order.buyerUserId,
        leaseToken: lease.leaseToken
      }).catch(() => false);
      throw error;
    }

    let existing;
    try {
      existing = await provider.findCustomerByExternalReference(
        lease.externalReference
      );
    } catch (error) {
      await persistenceService.releaseProviderCustomerLease({
        userId: prepared.order.buyerUserId,
        leaseToken: lease.leaseToken
      }).catch(() => false);
      throw error;
    }

    let customer = existing;
    if (!customer) {
      try {
        // Em resultado inconclusivo, a lease de customer permanece ativa.
        // O próximo executor só poderá tentar novamente após expiração e
        // obrigatoriamente reconciliará por externalReference antes de criar.
        customer = await provider.createCustomer(request);
      } catch (error) {
        // Uma rejeição HTTP definitiva prova que o provider não criou o
        // customer. Nesse caso a lease pode ser liberada imediatamente.
        if (isDefinitiveAsaasProviderError(error)) {
          await persistenceService.releaseProviderCustomerLease({
            userId: prepared.order.buyerUserId,
            leaseToken: lease.leaseToken
          }).catch(() => false);
        }

        throw error;
      }
    }

    const providerCustomerId = String(customer?.id || '').trim();
    if (!providerCustomerId || providerCustomerId.includes('/')) {
      throw new FinancialCourseCheckoutServiceError(
        'INVALID_PROVIDER_CUSTOMER',
        'Asaas retornou cliente sem identificador válido.'
      );
    }

    if (
      customer?.externalReference &&
      String(customer.externalReference) !== lease.externalReference
    ) {
      throw new FinancialCourseCheckoutServiceError(
        'PROVIDER_CUSTOMER_REFERENCE_MISMATCH',
        'Cliente Asaas reconciliado não corresponde à referência canônica.'
      );
    }

    await persistenceService.completeProviderCustomerBinding({
      userId: prepared.order.buyerUserId,
      leaseToken: lease.leaseToken,
      providerCustomerId
    });

    return {
      processing: false,
      providerCustomerId
    };
  }

  async function responseForBoundTransaction(prepared) {
    const paymentId = requiredProviderPaymentId(
      prepared.transaction.providerPaymentId
    );
    try {
      const pix = await provider.getPixQrCode(paymentId);
      return {
        orderId: prepared.orderId,
        transactionId: prepared.transactionId,
        status: 'pending_payment',
        processing: false,
        paymentId,
        pix: sanitizedPix(pix || {})
      };
    } finally {
      await releaseCheckout(prepared);
    }
  }

  async function startCourseCheckout(input = {}) {
    const prepared = await persistenceService.prepareCourseCheckout(input);

    if (prepared.lease.processing || !prepared.lease.acquired) {
      return processingResponse(prepared);
    }

    if (prepared.transaction?.providerPaymentId) {
      return responseForBoundTransaction(prepared);
    }

    let customerResolution;
    try {
      customerResolution = await resolveProviderCustomer(prepared);
    } catch (error) {
      await releaseCheckout(prepared);
      throw error;
    }

    if (customerResolution.processing) {
      await releaseCheckout(prepared);
      return processingResponse(prepared);
    }

    const providerCustomerId = customerResolution.providerCustomerId;
    const externalReference = paymentExternalReference(prepared.orderId);

    let payment;
    try {
      // GET/reconciliação não cria efeito externo. Em falha dessa consulta,
      // a lease pode ser liberada para nova tentativa segura.
      payment = await provider.findPaymentByExternalReference(
        externalReference
      );
    } catch (error) {
      await releaseCheckout(prepared);
      throw error;
    }

    if (!payment) {
      const dueDate = dueDateFactory(clock());
      const built = buildAsaasPixPaymentRequest({
        orderId: prepared.orderId,
        transactionId: prepared.transactionId,
        providerCustomerId,
        order: prepared.order,
        recipientWallets: prepared.recipientWallets,
        dueDate,
        description: 'BJJ Exams - curso pago'
      });

      if (
        JSON.stringify(built.providerSplitSnapshot) !==
        JSON.stringify(prepared.providerSplitSnapshot)
      ) {
        await releaseCheckout(prepared);
        throw new FinancialCourseCheckoutServiceError(
          'PROVIDER_SPLIT_SNAPSHOT_MISMATCH',
          'Split preparado diverge do snapshot persistido.'
        );
      }

      try {
        // Resultado inconclusivo após POST mantém a lease ativa até expirar;
        // o próximo executor reconcilia por externalReference antes de
        // qualquer nova criação de cobrança.
        payment = await provider.createPixPayment(built.request);
      } catch (error) {
        // Rejeição definitiva significa que a cobrança não foi criada,
        // portanto uma nova tentativa pode adquirir nova checkout lease.
        if (isDefinitiveAsaasProviderError(error)) {
          await releaseCheckout(prepared);
        }

        throw error;
      }
    }

    const paymentId = requiredProviderPaymentId(payment?.id);

    await providerStateService.bindPendingProviderPayment({
      orderId: prepared.orderId,
      transactionId: prepared.transactionId,
      leaseToken: prepared.lease.leaseToken,
      providerCustomerId,
      providerPayment: payment
    });

    const pix = await provider.getPixQrCode(paymentId);

    return {
      orderId: prepared.orderId,
      transactionId: prepared.transactionId,
      status: 'pending_payment',
      processing: false,
      paymentId,
      pix: sanitizedPix(pix || {})
    };
  }

  return {
    startCourseCheckout
  };
}

module.exports = {
  FinancialCourseCheckoutServiceError,
  tomorrowDueDate,
  sanitizedPix,
  createFinancialCourseCheckoutService,
  AsaasCheckoutAdapterError,
  FinancialCheckoutPersistenceError,
  FinancialCheckoutProviderStateError
};