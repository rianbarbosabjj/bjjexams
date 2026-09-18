'use strict';

const {
  validateOrder,
  validateTransaction
} = require('./financial-domain');
const {
  paymentExternalReference
} = require('./asaas-checkout-adapter');

class FinancialCheckoutProviderStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialCheckoutProviderStateError';
    this.code = code;
  }
}

function requiredIdentifier(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.length > 200 || normalized.includes('/')) {
    throw new FinancialCheckoutProviderStateError(
      'INVALID_PROVIDER_STATE_IDENTIFIER',
      `${field} inválido.`
    );
  }
  return normalized;
}

function providerValueToCents(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new FinancialCheckoutProviderStateError(
      'INVALID_PROVIDER_PAYMENT_VALUE',
      'Valor da cobrança do provedor é inválido.'
    );
  }
  const cents = Math.round(numeric * 100);
  if (!Number.isSafeInteger(cents)) {
    throw new FinancialCheckoutProviderStateError(
      'INVALID_PROVIDER_PAYMENT_VALUE',
      'Valor da cobrança excede a faixa segura.'
    );
  }
  if (Math.abs((cents / 100) - numeric) > 0.000001) {
    throw new FinancialCheckoutProviderStateError(
      'INVALID_PROVIDER_PAYMENT_VALUE',
      'Valor da cobrança possui precisão incompatível.'
    );
  }
  return cents;
}

function normalizeProviderPayment(input = {}) {
  return {
    id: requiredIdentifier(input.id, 'providerPaymentId'),
    status: String(input.status || '').trim().toUpperCase() || 'PENDING',
    externalReference: String(input.externalReference || '').trim(),
    customer: typeof input.customer === 'string'
      ? input.customer.trim()
      : String(input.customer?.id || '').trim(),
    valueCents: providerValueToCents(input.value)
  };
}

function createFinancialCheckoutProviderState(dependencies = {}) {
  const {
    db,
    provider = 'asaas',
    environment = 'sandbox',
    clock = () => new Date()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !== 'function' ||
    typeof db.collection !== 'function' ||
    typeof db.runTransaction !== 'function'
  ) {
    throw new TypeError('Provider state exige Firestore válido.');
  }

  const canonicalProvider = String(provider || '').trim().toLowerCase();
  const canonicalEnvironment = String(environment || '').trim().toLowerCase();
  if (canonicalProvider !== 'asaas' || canonicalEnvironment !== 'sandbox') {
    throw new FinancialCheckoutProviderStateError(
      'CHECKOUT_SANDBOX_ONLY',
      'Provider state do Marco 5.3 aceita somente Asaas sandbox.'
    );
  }

  async function getBuyerProfile(userId) {
    const uid = requiredIdentifier(userId, 'userId');
    const snap = await db.doc(`usuarios/${uid}`).get();
    if (!snap.exists) {
      throw new FinancialCheckoutProviderStateError(
        'BUYER_PROFILE_REQUIRED',
        'Perfil canônico do comprador não encontrado.'
      );
    }
    const data = snap.data() || {};
    if (data.status_conta && String(data.status_conta).toLowerCase() !== 'ativo') {
      throw new FinancialCheckoutProviderStateError(
        'BUYER_ACCOUNT_NOT_ACTIVE',
        'Conta do comprador não está ativa.'
      );
    }
    return {
      userId: uid,
      nome: data.nome || data.name || null,
      email: data.email || null,
      cpf: data.cpf || data.cpfCnpj || null,
      telefone: data.telefone || data.mobilePhone || null
    };
  }

  async function bindPendingProviderPayment({
    orderId,
    transactionId,
    leaseToken,
    providerCustomerId,
    providerPayment
  } = {}) {
    const canonicalOrderId = requiredIdentifier(orderId, 'orderId');
    const canonicalTransactionId = requiredIdentifier(
      transactionId,
      'transactionId'
    );
    const canonicalLeaseToken = requiredIdentifier(leaseToken, 'leaseToken');
    const customerId = requiredIdentifier(
      providerCustomerId,
      'providerCustomerId'
    );
    const payment = normalizeProviderPayment(providerPayment || {});
    const now = clock();

    const orderRef = db.doc(`orders/${canonicalOrderId}`);
    const transactionRef = db.doc(
      `payment_transactions/${canonicalTransactionId}`
    );
    const leaseRef = db.doc(
      `financial_checkout_leases/${canonicalTransactionId}`
    );

    return db.runTransaction(async tx => {
      const [orderSnap, transactionSnap, leaseSnap] = await Promise.all([
        tx.get(orderRef),
        tx.get(transactionRef),
        tx.get(leaseRef)
      ]);

      if (!orderSnap.exists || !transactionSnap.exists) {
        throw new FinancialCheckoutProviderStateError(
          'CHECKOUT_STATE_REQUIRED',
          'Pedido/transação canônicos não encontrados.'
        );
      }

      const order = validateOrder(orderSnap.data() || {});
      const transaction = validateTransaction(transactionSnap.data() || {});

      if (
        transaction.orderId !== canonicalOrderId ||
        order.currentTransactionId !== canonicalTransactionId ||
        transaction.buyerUserId !== order.buyerUserId
      ) {
        throw new FinancialCheckoutProviderStateError(
          'CHECKOUT_STATE_MISMATCH',
          'Pedido e transação não correspondem entre si.'
        );
      }

      const expectedReference = paymentExternalReference(canonicalOrderId);
      if (
        payment.externalReference !== expectedReference ||
        payment.customer !== customerId ||
        payment.valueCents !== order.amountCents
      ) {
        throw new FinancialCheckoutProviderStateError(
          'PROVIDER_PAYMENT_MISMATCH',
          'Cobrança do provedor não corresponde ao pedido canônico.'
        );
      }

      if (transaction.providerPaymentId) {
        if (
          transaction.providerPaymentId !== payment.id ||
          order.providerCustomerId !== customerId
        ) {
          throw new FinancialCheckoutProviderStateError(
            'PROVIDER_PAYMENT_ID_MISMATCH',
            'Transação já está vinculada a outra cobrança/customer.'
          );
        }
        return {
          completed: false,
          order,
          transaction
        };
      }

      if (!leaseSnap.exists) {
        throw new FinancialCheckoutProviderStateError(
          'CHECKOUT_LEASE_REQUIRED',
          'Lease do checkout não encontrada.'
        );
      }
      const lease = leaseSnap.data() || {};
      if (
        lease.status !== 'active' ||
        lease.transactionId !== canonicalTransactionId ||
        lease.orderId !== canonicalOrderId ||
        lease.provider !== canonicalProvider ||
        lease.environment !== canonicalEnvironment ||
        lease.leaseToken !== canonicalLeaseToken
      ) {
        throw new FinancialCheckoutProviderStateError(
          'CHECKOUT_LEASE_MISMATCH',
          'Lease do checkout não pertence ao executor atual.'
        );
      }

      if (!['created', 'pending'].includes(transaction.status)) {
        throw new FinancialCheckoutProviderStateError(
          'TRANSACTION_NOT_PENDING',
          'Transação não pode receber nova cobrança neste estado.'
        );
      }

      const updatedTransaction = validateTransaction({
        ...transaction,
        providerPaymentId: payment.id,
        providerStatus: payment.status,
        status: 'pending',
        updatedAt: now
      });

      const updatedOrder = validateOrder({
        ...order,
        provider: canonicalProvider,
        providerCustomerId: customerId,
        currentTransactionId: canonicalTransactionId,
        updatedAt: now
      });

      tx.set(transactionRef, updatedTransaction);
      tx.set(orderRef, updatedOrder);
      tx.set(leaseRef, {
        ...lease,
        status: 'released',
        leaseToken: null,
        expiresAt: now,
        updatedAt: now
      });
      tx.create(db.collection('audit_logs').doc(), {
        actorId: order.buyerUserId,
        actorRole: 'student',
        action: 'financial.transaction.provider_bound',
        entityType: 'payment_transaction',
        entityId: canonicalTransactionId,
        before: {
          status: transaction.status,
          providerPaymentConfigured: Boolean(transaction.providerPaymentId)
        },
        after: {
          status: updatedTransaction.status,
          provider: canonicalProvider,
          providerStatus: payment.status,
          providerPaymentConfigured: true,
          externalReference: expectedReference
        },
        source: 'service',
        requestId: null,
        createdAt: now
      });

      return {
        completed: true,
        order: updatedOrder,
        transaction: updatedTransaction
      };
    });
  }

  return {
    getBuyerProfile,
    bindPendingProviderPayment
  };
}

module.exports = {
  FinancialCheckoutProviderStateError,
  providerValueToCents,
  normalizeProviderPayment,
  createFinancialCheckoutProviderState
};