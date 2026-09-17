'use strict';

const BPS_DENOMINATOR = 10000;
const DEFAULT_PLATFORM_FEE_BPS = 1000;
const FINANCIAL_CURRENCIES = Object.freeze(['BRL']);
const FINANCIAL_PRODUCT_TYPES = Object.freeze(['course', 'belt_exam']);
const FINANCIAL_RULE_STATUSES = Object.freeze(['active', 'inactive']);
const FINANCIAL_RULE_SCOPES = Object.freeze(['platform_default', 'product_override']);
const FINANCIAL_RECIPIENT_MODES = Object.freeze(['product_owner', 'explicit']);
const FINANCIAL_RECIPIENT_TYPES = Object.freeze(['platform', 'user', 'organization']);
const ORDER_STATUSES = Object.freeze([
  'pending_payment',
  'paid',
  'cancelled',
  'expired',
  'refunded',
  'chargeback'
]);
const TRANSACTION_STATUSES = Object.freeze([
  'created',
  'pending',
  'paid',
  'failed',
  'cancelled',
  'expired',
  'refunded',
  'chargeback'
]);
const PAYMENT_PROVIDERS = Object.freeze(['asaas']);

const ORDER_STATUS_TRANSITIONS = Object.freeze({
  pending_payment: Object.freeze(['pending_payment', 'paid', 'cancelled', 'expired']),
  paid: Object.freeze(['paid', 'refunded', 'chargeback']),
  cancelled: Object.freeze(['cancelled']),
  expired: Object.freeze(['expired']),
  refunded: Object.freeze(['refunded']),
  chargeback: Object.freeze(['chargeback'])
});

const TRANSACTION_STATUS_TRANSITIONS = Object.freeze({
  created: Object.freeze(['created', 'pending', 'failed', 'cancelled']),
  pending: Object.freeze(['pending', 'paid', 'failed', 'cancelled', 'expired']),
  paid: Object.freeze(['paid', 'refunded', 'chargeback']),
  failed: Object.freeze(['failed']),
  cancelled: Object.freeze(['cancelled']),
  expired: Object.freeze(['expired']),
  refunded: Object.freeze(['refunded']),
  chargeback: Object.freeze(['chargeback'])
});

class FinancialDomainError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FinancialDomainError';
    this.code = code;
  }
}

function text(value, max = 200) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  return normalized.slice(0, max);
}

function token(value, max = 80) {
  const normalized = text(value, max);
  return normalized ? normalized.toLowerCase() : null;
}

function integer(value) {
  if (value === undefined || value === null || value === '') return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new FinancialDomainError('INVALID_FINANCIAL_ENUM', `${field} inválido.`);
  }
}

function requireSafeInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new FinancialDomainError(
      'INVALID_FINANCIAL_INTEGER',
      `${field} precisa ser um inteiro seguro entre ${min} e ${max}.`
    );
  }
  return value;
}

function recipientKey(recipient = {}) {
  return `${recipient.recipientType || ''}:${recipient.recipientId || ''}`;
}

function normalizeRecipientShare(input = {}) {
  return {
    recipientType: token(input.recipientType, 40),
    recipientId: text(input.recipientId, 200),
    shareBps: integer(input.shareBps)
  };
}

function normalizeRecipientShares(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeRecipientShare)
    .sort((left, right) => recipientKey(left).localeCompare(recipientKey(right)));
}

function normalizeFinancialRule(input = {}) {
  return {
    id: text(input.id, 200),
    name: text(input.name, 160),
    status: token(input.status, 40),
    scope: token(input.scope, 40),
    productType: token(input.productType, 40),
    productId: text(input.productId, 200),
    platformFeeBps: integer(input.platformFeeBps),
    recipientMode: token(input.recipientMode, 40),
    recipientShares: normalizeRecipientShares(input.recipientShares),
    version: integer(input.version),
    createdBy: text(input.createdBy, 200),
    updatedBy: text(input.updatedBy, 200),
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null
  };
}

function validateRecipientShares(shares = []) {
  if (!Array.isArray(shares) || shares.length < 1) {
    throw new FinancialDomainError(
      'FINANCIAL_RECIPIENTS_REQUIRED',
      'Regra explícita exige pelo menos um recebedor.'
    );
  }

  const seen = new Set();
  let totalBps = 0;

  for (const share of shares) {
    requireEnum(share.recipientType, FINANCIAL_RECIPIENT_TYPES, 'recipientType');
    requireSafeInteger(share.shareBps, 'shareBps', { min: 1, max: BPS_DENOMINATOR });

    if (share.recipientType === 'platform') {
      if (share.recipientId !== null) {
        throw new FinancialDomainError(
          'INVALID_PLATFORM_RECIPIENT',
          'Recebedor platform precisa usar recipientId nulo.'
        );
      }
    } else if (!share.recipientId || share.recipientId.includes('/')) {
      throw new FinancialDomainError(
        'FINANCIAL_RECIPIENT_ID_REQUIRED',
        'Recebedor user ou organization exige recipientId válido.'
      );
    }

    const key = recipientKey(share);
    if (seen.has(key)) {
      throw new FinancialDomainError(
        'DUPLICATE_FINANCIAL_RECIPIENT',
        `Recebedor financeiro duplicado: ${key}.`
      );
    }
    seen.add(key);
    totalBps += share.shareBps;
  }

  if (totalBps !== BPS_DENOMINATOR) {
    throw new FinancialDomainError(
      'INVALID_RECIPIENT_BPS_TOTAL',
      `A soma de recipientShares precisa ser ${BPS_DENOMINATOR} bps.`
    );
  }

  return true;
}

function validateFinancialRule(input = {}) {
  const rule = normalizeFinancialRule(input);

  if (!rule.id || rule.id.includes('/')) {
    throw new FinancialDomainError('FINANCIAL_RULE_ID_REQUIRED', 'Regra financeira exige id válido.');
  }
  if (!rule.name || rule.name.length < 3) {
    throw new FinancialDomainError('FINANCIAL_RULE_NAME_REQUIRED', 'Regra financeira exige nome válido.');
  }

  requireEnum(rule.status, FINANCIAL_RULE_STATUSES, 'status');
  requireEnum(rule.scope, FINANCIAL_RULE_SCOPES, 'scope');
  requireEnum(rule.recipientMode, FINANCIAL_RECIPIENT_MODES, 'recipientMode');
  requireSafeInteger(rule.platformFeeBps, 'platformFeeBps', { min: 0, max: BPS_DENOMINATOR });
  requireSafeInteger(rule.version, 'version', { min: 1 });

  if (rule.scope === 'platform_default') {
    if (rule.productType || rule.productId) {
      throw new FinancialDomainError(
        'INVALID_DEFAULT_RULE_SCOPE',
        'Regra padrão da plataforma não pode possuir produto específico.'
      );
    }
  } else {
    requireEnum(rule.productType, FINANCIAL_PRODUCT_TYPES, 'productType');
    if (!rule.productId || rule.productId.includes('/')) {
      throw new FinancialDomainError(
        'FINANCIAL_RULE_PRODUCT_REQUIRED',
        'Override financeiro exige productId válido.'
      );
    }
  }

  if (rule.recipientMode === 'product_owner') {
    if (rule.recipientShares.length !== 0) {
      throw new FinancialDomainError(
        'RECIPIENT_SHARES_NOT_ALLOWED',
        'recipientMode product_owner não aceita recipientShares explícitos.'
      );
    }
  } else {
    validateRecipientShares(rule.recipientShares);
  }

  return rule;
}

function assertActiveRule(rule) {
  if (rule.status !== 'active') {
    throw new FinancialDomainError(
      'FINANCIAL_RULE_INACTIVE',
      'Regra financeira inativa não pode originar novo snapshot.'
    );
  }
}

function normalizeProductContext(input = {}) {
  return {
    productType: token(input.productType, 40),
    productId: text(input.productId || input.id, 200),
    financialRuleId: text(input.financialRuleId, 200),
    ownerType: token(input.ownerType, 40),
    ownerId: text(input.ownerId, 200),
    currency: (text(input.currency, 10) || 'BRL').toUpperCase()
  };
}

function validateProductContext(input = {}) {
  const product = normalizeProductContext(input);
  requireEnum(product.productType, FINANCIAL_PRODUCT_TYPES, 'productType');
  requireEnum(product.currency, FINANCIAL_CURRENCIES, 'currency');
  if (!product.productId || product.productId.includes('/')) {
    throw new FinancialDomainError('FINANCIAL_PRODUCT_ID_REQUIRED', 'Produto financeiro exige productId válido.');
  }
  return product;
}

function resolveEffectiveFinancialRule({ product: productInput = {}, overrideRule = null, defaultRule = null } = {}) {
  const product = validateProductContext(productInput);

  if (product.financialRuleId) {
    if (!overrideRule) {
      throw new FinancialDomainError(
        'FINANCIAL_OVERRIDE_NOT_FOUND',
        'Produto referencia regra financeira inexistente.'
      );
    }

    const rule = validateFinancialRule(overrideRule);
    assertActiveRule(rule);

    if (rule.id !== product.financialRuleId) {
      throw new FinancialDomainError(
        'FINANCIAL_OVERRIDE_ID_MISMATCH',
        'Regra financeira carregada não corresponde ao financialRuleId do produto.'
      );
    }
    if (
      rule.scope !== 'product_override' ||
      rule.productType !== product.productType ||
      rule.productId !== product.productId
    ) {
      throw new FinancialDomainError(
        'FINANCIAL_OVERRIDE_SCOPE_MISMATCH',
        'Override financeiro não corresponde ao produto comprado.'
      );
    }
    return rule;
  }

  if (!defaultRule) {
    throw new FinancialDomainError(
      'DEFAULT_FINANCIAL_RULE_REQUIRED',
      'Regra financeira padrão ativa é obrigatória.'
    );
  }

  const rule = validateFinancialRule(defaultRule);
  assertActiveRule(rule);
  if (rule.scope !== 'platform_default') {
    throw new FinancialDomainError(
      'INVALID_DEFAULT_FINANCIAL_RULE',
      'Fallback financeiro precisa usar regra platform_default.'
    );
  }
  return rule;
}

function resolveRecipientShares(ruleInput = {}, productInput = {}) {
  const rule = validateFinancialRule(ruleInput);
  const product = validateProductContext(productInput);

  if (rule.recipientMode === 'explicit') {
    return rule.recipientShares.map(share => ({ ...share }));
  }

  const ownerType = product.ownerType;
  if (!['platform', 'user', 'organization'].includes(ownerType)) {
    throw new FinancialDomainError(
      'FINANCIAL_PRODUCT_OWNER_REQUIRED',
      'Produto precisa possuir ownerType financeiro válido.'
    );
  }

  if (ownerType === 'platform') {
    return [{ recipientType: 'platform', recipientId: null, shareBps: BPS_DENOMINATOR }];
  }

  if (!product.ownerId || product.ownerId.includes('/')) {
    throw new FinancialDomainError(
      'FINANCIAL_PRODUCT_OWNER_ID_REQUIRED',
      'Produto de usuário ou organização exige ownerId válido.'
    );
  }

  return [{ recipientType: ownerType, recipientId: product.ownerId, shareBps: BPS_DENOMINATOR }];
}

function calculatePlatformFee({ grossAmountCents, platformFeeBps } = {}) {
  const gross = requireSafeInteger(integer(grossAmountCents), 'grossAmountCents', { min: 1 });
  const bps = requireSafeInteger(integer(platformFeeBps), 'platformFeeBps', {
    min: 0,
    max: BPS_DENOMINATOR
  });

  const raw = gross * bps;
  if (!Number.isSafeInteger(raw)) {
    throw new FinancialDomainError(
      'FINANCIAL_AMOUNT_OVERFLOW',
      'Valor financeiro excede a faixa segura para cálculo.'
    );
  }

  const platformFeeCents = Math.floor((raw + (BPS_DENOMINATOR / 2)) / BPS_DENOMINATOR);
  const sellerPoolCents = gross - platformFeeCents;

  return { grossAmountCents: gross, platformFeeBps: bps, platformFeeCents, sellerPoolCents };
}

function allocateSellerPool(sellerPoolCents, recipientSharesInput = []) {
  const pool = requireSafeInteger(integer(sellerPoolCents), 'sellerPoolCents', { min: 0 });
  const shares = normalizeRecipientShares(recipientSharesInput);
  validateRecipientShares(shares);

  const working = shares.map(share => {
    const numerator = pool * share.shareBps;
    if (!Number.isSafeInteger(numerator)) {
      throw new FinancialDomainError(
        'FINANCIAL_AMOUNT_OVERFLOW',
        'Distribuição financeira excede a faixa segura para cálculo.'
      );
    }
    return {
      share,
      amountCents: Math.floor(numerator / BPS_DENOMINATOR),
      remainder: numerator % BPS_DENOMINATOR
    };
  });

  const distributedBase = working.reduce((sum, item) => sum + item.amountCents, 0);
  let residualCents = pool - distributedBase;

  const priority = working
    .map((item, index) => ({ index, remainder: item.remainder, key: recipientKey(item.share) }))
    .sort((left, right) => {
      if (right.remainder !== left.remainder) return right.remainder - left.remainder;
      return left.key.localeCompare(right.key);
    });

  for (let position = 0; position < priority.length && residualCents > 0; position += 1) {
    working[priority[position].index].amountCents += 1;
    residualCents -= 1;
  }

  if (residualCents !== 0) {
    throw new FinancialDomainError(
      'FINANCIAL_ALLOCATION_INCONSISTENT',
      'Não foi possível distribuir integralmente o seller pool.'
    );
  }

  return working.map(item => ({ ...item.share, amountCents: item.amountCents }));
}

function validateFinancialSnapshot(snapshot = {}) {
  const productType = token(snapshot.productType, 40);
  const productId = text(snapshot.productId, 200);
  const currency = (text(snapshot.currency, 10) || '').toUpperCase();
  const ruleId = text(snapshot.ruleId, 200);
  const ruleVersion = integer(snapshot.ruleVersion);
  const grossAmountCents = integer(snapshot.grossAmountCents);
  const platformFeeBps = integer(snapshot.platformFeeBps);
  const platformFeeCents = integer(snapshot.platformFeeCents);
  const sellerPoolCents = integer(snapshot.sellerPoolCents);
  const recipientMode = token(snapshot.recipientMode, 40);
  const allocations = Array.isArray(snapshot.recipientAllocations)
    ? snapshot.recipientAllocations.map(item => ({
      ...normalizeRecipientShare(item),
      amountCents: integer(item.amountCents)
    }))
    : [];

  requireEnum(productType, FINANCIAL_PRODUCT_TYPES, 'productType');
  requireEnum(currency, FINANCIAL_CURRENCIES, 'currency');
  requireEnum(recipientMode, FINANCIAL_RECIPIENT_MODES, 'recipientMode');
  if (!productId || productId.includes('/')) {
    throw new FinancialDomainError('FINANCIAL_PRODUCT_ID_REQUIRED', 'Snapshot exige productId válido.');
  }
  if (!ruleId || ruleId.includes('/')) {
    throw new FinancialDomainError('FINANCIAL_RULE_ID_REQUIRED', 'Snapshot exige ruleId válido.');
  }
  requireSafeInteger(ruleVersion, 'ruleVersion', { min: 1 });
  requireSafeInteger(grossAmountCents, 'grossAmountCents', { min: 1 });
  requireSafeInteger(platformFeeBps, 'platformFeeBps', { min: 0, max: BPS_DENOMINATOR });
  requireSafeInteger(platformFeeCents, 'platformFeeCents', { min: 0, max: grossAmountCents });
  requireSafeInteger(sellerPoolCents, 'sellerPoolCents', { min: 0, max: grossAmountCents });
  if (!snapshot.resolvedAt) {
    throw new FinancialDomainError('FINANCIAL_SNAPSHOT_TIMESTAMP_REQUIRED', 'Snapshot exige resolvedAt.');
  }

  validateRecipientShares(allocations);
  let allocationTotal = 0;
  for (const allocation of allocations) {
    requireSafeInteger(allocation.amountCents, 'recipient amountCents', { min: 0, max: grossAmountCents });
    allocationTotal += allocation.amountCents;
  }

  if (allocationTotal !== sellerPoolCents) {
    throw new FinancialDomainError(
      'FINANCIAL_SNAPSHOT_TOTAL_MISMATCH',
      'Alocações não correspondem ao seller pool do snapshot.'
    );
  }
  if (platformFeeCents + sellerPoolCents !== grossAmountCents) {
    throw new FinancialDomainError(
      'FINANCIAL_SNAPSHOT_TOTAL_MISMATCH',
      'Taxa e seller pool não fecham o valor bruto do snapshot.'
    );
  }

  return {
    ruleId,
    ruleVersion,
    productType,
    productId,
    currency,
    grossAmountCents,
    platformFeeBps,
    platformFeeCents,
    sellerPoolCents,
    recipientMode,
    recipientAllocations: allocations.map(item => ({ ...item })),
    resolvedAt: snapshot.resolvedAt
  };
}

function cloneFinancialSnapshot(snapshot = {}) {
  const valid = validateFinancialSnapshot(snapshot);
  return {
    ...valid,
    recipientAllocations: valid.recipientAllocations.map(item => ({ ...item }))
  };
}

function buildFinancialSnapshot({
  rule: ruleInput = {},
  product: productInput = {},
  grossAmountCents,
  currency = 'BRL',
  resolvedAt
} = {}) {
  const rule = validateFinancialRule(ruleInput);
  assertActiveRule(rule);
  const product = validateProductContext({ ...productInput, currency });
  const fee = calculatePlatformFee({ grossAmountCents, platformFeeBps: rule.platformFeeBps });
  const recipientShares = resolveRecipientShares(rule, product);
  const recipientAllocations = allocateSellerPool(fee.sellerPoolCents, recipientShares);

  return validateFinancialSnapshot({
    ruleId: rule.id,
    ruleVersion: rule.version,
    productType: product.productType,
    productId: product.productId,
    currency: product.currency,
    grossAmountCents: fee.grossAmountCents,
    platformFeeBps: fee.platformFeeBps,
    platformFeeCents: fee.platformFeeCents,
    sellerPoolCents: fee.sellerPoolCents,
    recipientMode: rule.recipientMode,
    recipientAllocations,
    resolvedAt
  });
}

function canTransition(status, targetStatus, transitions, allowedStatuses) {
  const from = token(status, 40);
  const to = token(targetStatus, 40);
  if (!allowedStatuses.includes(from) || !allowedStatuses.includes(to)) return false;
  return Boolean(transitions[from]?.includes(to));
}

function canTransitionOrderStatus(fromStatus, toStatus) {
  return canTransition(fromStatus, toStatus, ORDER_STATUS_TRANSITIONS, ORDER_STATUSES);
}

function assertOrderStatusTransition(fromStatus, toStatus) {
  if (!canTransitionOrderStatus(fromStatus, toStatus)) {
    throw new FinancialDomainError(
      'INVALID_ORDER_STATUS_TRANSITION',
      `Transição de pedido ${fromStatus} -> ${toStatus} não permitida.`
    );
  }
  return true;
}

function canTransitionTransactionStatus(fromStatus, toStatus) {
  return canTransition(fromStatus, toStatus, TRANSACTION_STATUS_TRANSITIONS, TRANSACTION_STATUSES);
}

function assertTransactionStatusTransition(fromStatus, toStatus) {
  if (!canTransitionTransactionStatus(fromStatus, toStatus)) {
    throw new FinancialDomainError(
      'INVALID_TRANSACTION_STATUS_TRANSITION',
      `Transição de transação ${fromStatus} -> ${toStatus} não permitida.`
    );
  }
  return true;
}

function normalizeOrderInput(input = {}) {
  return {
    buyerUserId: text(input.buyerUserId, 200),
    productType: token(input.productType, 40),
    productId: text(input.productId, 200),
    quantity: integer(input.quantity),
    amountCents: integer(input.amountCents),
    currency: (text(input.currency, 10) || '').toUpperCase(),
    status: token(input.status, 40),
    financialSnapshot: input.financialSnapshot || null,
    provider: token(input.provider, 40),
    providerCustomerId: text(input.providerCustomerId, 200),
    currentTransactionId: text(input.currentTransactionId, 200),
    idempotencyKey: text(input.idempotencyKey, 200),
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,
    paidAt: input.paidAt ?? null,
    cancelledAt: input.cancelledAt ?? null,
    expiredAt: input.expiredAt ?? null,
    refundedAt: input.refundedAt ?? null,
    chargebackAt: input.chargebackAt ?? null
  };
}

function validateOrder(input = {}) {
  const order = normalizeOrderInput(input);
  if (!order.buyerUserId || order.buyerUserId.includes('/')) {
    throw new FinancialDomainError('ORDER_BUYER_REQUIRED', 'Pedido exige buyerUserId válido.');
  }
  requireEnum(order.productType, FINANCIAL_PRODUCT_TYPES, 'productType');
  if (!order.productId || order.productId.includes('/')) {
    throw new FinancialDomainError('ORDER_PRODUCT_REQUIRED', 'Pedido exige productId válido.');
  }
  requireSafeInteger(order.quantity, 'quantity', { min: 1 });
  requireSafeInteger(order.amountCents, 'amountCents', { min: 1 });
  requireEnum(order.currency, FINANCIAL_CURRENCIES, 'currency');
  requireEnum(order.status, ORDER_STATUSES, 'status');
  if (!order.idempotencyKey) {
    throw new FinancialDomainError('ORDER_IDEMPOTENCY_REQUIRED', 'Pedido exige idempotencyKey.');
  }
  if (!order.createdAt || !order.updatedAt) {
    throw new FinancialDomainError('ORDER_TIMESTAMP_REQUIRED', 'Pedido exige createdAt e updatedAt.');
  }

  const snapshot = validateFinancialSnapshot(order.financialSnapshot || {});
  if (
    snapshot.productType !== order.productType ||
    snapshot.productId !== order.productId ||
    snapshot.currency !== order.currency ||
    snapshot.grossAmountCents !== order.amountCents
  ) {
    throw new FinancialDomainError(
      'ORDER_SNAPSHOT_MISMATCH',
      'Snapshot financeiro não corresponde ao pedido.'
    );
  }

  if (order.provider) requireEnum(order.provider, PAYMENT_PROVIDERS, 'provider');
  if (order.status === 'paid' && !order.paidAt) {
    throw new FinancialDomainError('ORDER_PAID_TIMESTAMP_REQUIRED', 'Pedido pago exige paidAt.');
  }
  if (order.status === 'cancelled' && !order.cancelledAt) {
    throw new FinancialDomainError('ORDER_CANCEL_TIMESTAMP_REQUIRED', 'Pedido cancelado exige cancelledAt.');
  }
  if (order.status === 'expired' && !order.expiredAt) {
    throw new FinancialDomainError('ORDER_EXPIRED_TIMESTAMP_REQUIRED', 'Pedido expirado exige expiredAt.');
  }
  if (order.status === 'refunded' && !order.refundedAt) {
    throw new FinancialDomainError('ORDER_REFUND_TIMESTAMP_REQUIRED', 'Pedido reembolsado exige refundedAt.');
  }
  if (order.status === 'chargeback' && !order.chargebackAt) {
    throw new FinancialDomainError('ORDER_CHARGEBACK_TIMESTAMP_REQUIRED', 'Pedido em chargeback exige chargebackAt.');
  }

  return { ...order, financialSnapshot: cloneFinancialSnapshot(snapshot) };
}

function normalizeTransactionInput(input = {}) {
  return {
    orderId: text(input.orderId, 200),
    buyerUserId: text(input.buyerUserId, 200),
    provider: token(input.provider, 40),
    providerPaymentId: text(input.providerPaymentId, 200),
    providerStatus: text(input.providerStatus, 80),
    status: token(input.status, 40),
    amountCents: integer(input.amountCents),
    currency: (text(input.currency, 10) || '').toUpperCase(),
    financialSnapshot: input.financialSnapshot || null,
    providerSplitSnapshot: input.providerSplitSnapshot ?? null,
    createdAt: input.createdAt ?? null,
    updatedAt: input.updatedAt ?? null,
    confirmedAt: input.confirmedAt ?? null,
    refundedAt: input.refundedAt ?? null,
    chargebackAt: input.chargebackAt ?? null
  };
}

function validateTransaction(input = {}) {
  const transaction = normalizeTransactionInput(input);
  if (!transaction.orderId || transaction.orderId.includes('/')) {
    throw new FinancialDomainError('TRANSACTION_ORDER_REQUIRED', 'Transação exige orderId válido.');
  }
  if (!transaction.buyerUserId || transaction.buyerUserId.includes('/')) {
    throw new FinancialDomainError('TRANSACTION_BUYER_REQUIRED', 'Transação exige buyerUserId válido.');
  }
  requireEnum(transaction.provider, PAYMENT_PROVIDERS, 'provider');
  requireEnum(transaction.status, TRANSACTION_STATUSES, 'status');
  requireSafeInteger(transaction.amountCents, 'amountCents', { min: 1 });
  requireEnum(transaction.currency, FINANCIAL_CURRENCIES, 'currency');
  if (!transaction.createdAt || !transaction.updatedAt) {
    throw new FinancialDomainError(
      'TRANSACTION_TIMESTAMP_REQUIRED',
      'Transação exige createdAt e updatedAt.'
    );
  }

  const snapshot = validateFinancialSnapshot(transaction.financialSnapshot || {});
  if (
    snapshot.currency !== transaction.currency ||
    snapshot.grossAmountCents !== transaction.amountCents
  ) {
    throw new FinancialDomainError(
      'TRANSACTION_SNAPSHOT_MISMATCH',
      'Snapshot financeiro não corresponde à transação.'
    );
  }

  if (['paid', 'refunded', 'chargeback'].includes(transaction.status)) {
    if (!transaction.providerPaymentId) {
      throw new FinancialDomainError(
        'TRANSACTION_PROVIDER_PAYMENT_REQUIRED',
        'Transação confirmada exige providerPaymentId.'
      );
    }
    if (!transaction.confirmedAt) {
      throw new FinancialDomainError(
        'TRANSACTION_CONFIRMED_TIMESTAMP_REQUIRED',
        'Transação confirmada exige confirmedAt.'
      );
    }
  }
  if (transaction.status === 'refunded' && !transaction.refundedAt) {
    throw new FinancialDomainError(
      'TRANSACTION_REFUND_TIMESTAMP_REQUIRED',
      'Transação reembolsada exige refundedAt.'
    );
  }
  if (transaction.status === 'chargeback' && !transaction.chargebackAt) {
    throw new FinancialDomainError(
      'TRANSACTION_CHARGEBACK_TIMESTAMP_REQUIRED',
      'Transação em chargeback exige chargebackAt.'
    );
  }

  return { ...transaction, financialSnapshot: cloneFinancialSnapshot(snapshot) };
}

function buildTransactionFromOrder({ orderId, order: orderInput = {}, provider = 'asaas', createdAt } = {}) {
  const order = validateOrder(orderInput);
  if (!orderId || String(orderId).includes('/')) {
    throw new FinancialDomainError('TRANSACTION_ORDER_REQUIRED', 'Transação exige orderId válido.');
  }
  if (!createdAt) {
    throw new FinancialDomainError('TRANSACTION_TIMESTAMP_REQUIRED', 'Transação exige createdAt.');
  }

  return validateTransaction({
    orderId: String(orderId),
    buyerUserId: order.buyerUserId,
    provider,
    providerPaymentId: null,
    providerStatus: null,
    status: 'created',
    amountCents: order.amountCents,
    currency: order.currency,
    financialSnapshot: cloneFinancialSnapshot(order.financialSnapshot),
    providerSplitSnapshot: null,
    createdAt,
    updatedAt: createdAt,
    confirmedAt: null,
    refundedAt: null,
    chargebackAt: null
  });
}

module.exports = {
  BPS_DENOMINATOR,
  DEFAULT_PLATFORM_FEE_BPS,
  FINANCIAL_CURRENCIES,
  FINANCIAL_PRODUCT_TYPES,
  FINANCIAL_RULE_STATUSES,
  FINANCIAL_RULE_SCOPES,
  FINANCIAL_RECIPIENT_MODES,
  FINANCIAL_RECIPIENT_TYPES,
  ORDER_STATUSES,
  TRANSACTION_STATUSES,
  PAYMENT_PROVIDERS,
  ORDER_STATUS_TRANSITIONS,
  TRANSACTION_STATUS_TRANSITIONS,
  FinancialDomainError,
  normalizeFinancialRule,
  validateFinancialRule,
  normalizeProductContext,
  validateProductContext,
  resolveEffectiveFinancialRule,
  resolveRecipientShares,
  calculatePlatformFee,
  allocateSellerPool,
  buildFinancialSnapshot,
  validateFinancialSnapshot,
  cloneFinancialSnapshot,
  canTransitionOrderStatus,
  assertOrderStatusTransition,
  canTransitionTransactionStatus,
  assertTransactionStatusTransition,
  normalizeOrderInput,
  validateOrder,
  normalizeTransactionInput,
  validateTransaction,
  buildTransactionFromOrder
};
