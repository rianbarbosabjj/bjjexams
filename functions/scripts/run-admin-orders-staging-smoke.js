'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const {
  buildFinancialSnapshot,
  validateOrder
} = require('../src/finance/financial-domain');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const REGION = 'southamerica-east1';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const ALLOWED_BRANCH = 'feature/marco8-ops-console';
const STATE_FILE = path.join(__dirname, '..', '.admin-orders-staging-smoke.local.json');
const WEB_CONFIG_FILE = path.join(__dirname, '..', '..', 'js', 'firebase-config.local.json');

const LIST_CALLABLE = 'listarPedidosOperacionaisV12';
const DETAIL_CALLABLE = 'obterPedidoOperacionalV12';

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function saveState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8'
  }).trim();
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ID ||
    ''
  ).trim();

  if (confirmation !== CONFIRMATION_VALUE) {
    fail(`Smoke bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  }
  if (declaredProject === PRODUCTION_PROJECT) {
    fail('Projeto de produção detectado. Execução bloqueada.');
  }
  if (declaredProject && declaredProject !== TARGET_PROJECT) {
    fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  }
  if (currentBranch() !== ALLOWED_BRANCH) {
    fail(`Branch não autorizada. Esperado: ${ALLOWED_BRANCH}.`);
  }
  if (!fs.existsSync(WEB_CONFIG_FILE)) {
    fail('Configuração Web de staging ausente.');
  }
  if (fs.existsSync(STATE_FILE)) {
    fail('Já existe smoke 8.5F pendente. Execute o cleanup antes de iniciar outro.');
  }

  const config = readJson(WEB_CONFIG_FILE);
  if (config.projectId !== TARGET_PROJECT) {
    fail(`Configuração Web incompatível: ${config.projectId || 'sem projectId'}.`);
  }
  if (!config.apiKey) {
    fail('Configuração Web de staging sem apiKey.');
  }

  return config;
}

function randomPassword() {
  return `BjjExams-${crypto.randomBytes(18).toString('hex')}!Aa9`;
}

function functionUrl(name) {
  return `https://${REGION}-${TARGET_PROJECT}.cloudfunctions.net/${name}`;
}

function sanitizeDiagnosticText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, '[REDACTED_TOKEN]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .slice(0, 240);
}

async function signIn(apiKey, email, password) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    }
  );

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.idToken) {
    fail(`Falha ao autenticar fixture em staging: HTTP ${response.status}.`);
  }

  return body.idToken;
}

async function callCallable(name, idToken, data = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  const headers = { 'Content-Type': 'application/json' };
  if (idToken) headers.Authorization = `Bearer ${idToken}`;

  try {
    const response = await fetch(functionUrl(name), {
      method: 'POST',
      headers,
      body: JSON.stringify({ data }),
      signal: controller.signal
    });

    const responseContentType = response.headers.get('content-type') || 'unknown';
    const rawBody = await response.text();
    let body = {};
    let responseKind = 'JSON';

    try {
      body = rawBody ? JSON.parse(rawBody) : {};
    } catch (_error) {
      responseKind = 'NON_JSON';
    }

    if (!response.ok || !Object.prototype.hasOwnProperty.call(body, 'result')) {
      const error = new Error(body?.error?.message || `Callable ${name} falhou.`);
      error.httpStatus = response.status;
      error.callableStatus = body?.error?.status || null;
      error.details = body?.error?.details || null;
      error.responseContentType = responseContentType;
      error.responseKind = responseKind;
      error.responsePreview = responseKind === 'NON_JSON'
        ? sanitizeDiagnosticText(rawBody)
        : null;
      throw error;
    }

    return body.result;
  } finally {
    clearTimeout(timeout);
  }
}

async function expectCallableError(
  name,
  idToken,
  data,
  expectedStatus,
  expectedDomainCode = null
) {
  try {
    await callCallable(name, idToken, data);
  } catch (error) {
    if (error.callableStatus !== expectedStatus) {
      fail(
        `${name} falhou com ${error.callableStatus || error.httpStatus}; ` +
        `esperado ${expectedStatus}.`
      );
    }
    if (expectedDomainCode && error.details?.domainCode !== expectedDomainCode) {
      fail(
        `${name} retornou domainCode=${error.details?.domainCode || 'ausente'}; ` +
        `esperado ${expectedDomainCode}.`
      );
    }
    return error;
  }

  fail(`${name} deveria falhar com ${expectedStatus}, mas concluiu com sucesso.`);
}

function exactKeys(value, expected, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} inválido.`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} possui campos inesperados: ${actual.join(', ')}.`
  );
}

function collectKeys(value, result = new Set()) {
  if (!value || typeof value !== 'object') return result;

  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, result);
    return result;
  }

  for (const [key, child] of Object.entries(value)) {
    result.add(key);
    collectKeys(child, result);
  }

  return result;
}

function assertSanitizedOperationalView(order, expected) {
  exactKeys(
    order,
    [
      'orderId',
      'productType',
      'productSummary',
      'buyerSummary',
      'paymentStatus',
      'fulfillmentStatus',
      'reversalStatus',
      'reconciliationStatus',
      'createdAt'
    ],
    'OperationalOrderView'
  );

  exactKeys(
    order.productSummary,
    ['productType', 'productId', 'label'],
    'productSummary'
  );
  exactKeys(
    order.buyerSummary,
    ['userId', 'displayName', 'email'],
    'buyerSummary'
  );
  exactKeys(
    order.paymentStatus,
    ['orderStatus', 'transactionStatus'],
    'paymentStatus'
  );
  exactKeys(
    order.fulfillmentStatus,
    ['kind', 'status'],
    'fulfillmentStatus'
  );
  exactKeys(
    order.reconciliationStatus,
    ['required'],
    'reconciliationStatus'
  );

  assert(order.orderId === expected.orderId, 'Pedido retornado não corresponde à fixture.');
  assert(order.productType === 'course', 'productType operacional inesperado.');
  assert(order.productSummary.productId === expected.courseId, 'productId operacional inesperado.');
  assert(order.productSummary.label === expected.courseTitle, 'label operacional inesperado.');
  assert(order.buyerSummary.userId === expected.buyerUserId, 'buyerUserId operacional inesperado.');
  assert(order.buyerSummary.displayName === 'Smoke Support Admin', 'displayName operacional inesperado.');
  assert(order.buyerSummary.email === expected.buyerEmail.toLowerCase(), 'email operacional inesperado.');
  assert(order.paymentStatus.orderStatus === 'pending_payment', 'orderStatus operacional inesperado.');
  assert(order.paymentStatus.transactionStatus === null, 'Pedido pendente não deve expor transação.');
  assert(order.fulfillmentStatus.kind === 'enrollment', 'Fulfillment de curso deve ser enrollment.');
  assert(order.fulfillmentStatus.status === null, 'Fixture sem matrícula deve ter fulfillment status nulo.');
  assert(order.reversalStatus === null, 'Fixture sem transação não deve ter reversal.');
  assert(order.reconciliationStatus.required === false, 'Fixture não deve exigir reconciliação.');

  const forbidden = [
    'providerPaymentId',
    'providerCustomerId',
    'walletId',
    'splitSnapshot',
    'recipientShares',
    'recipientAllocations',
    'platformFeeBps',
    'financialRuleId',
    'financialSnapshot',
    'idempotencyKey',
    'webhookToken',
    'apiKey',
    'cpf'
  ];

  const keys = collectKeys(order);
  for (const field of forbidden) {
    assert(!keys.has(field), `Campo sensível exposto: ${field}.`);
  }
}

function buildPendingOrder({
  buyerUserId,
  courseId,
  runId,
  suffix
}) {
  const now = Timestamp.now();
  const amountCents = 10000;

  const rule = {
    id: `smoke-85f-rule-${runId}`,
    name: 'Smoke 8.5F platform default',
    status: 'active',
    scope: 'platform_default',
    productType: null,
    productId: null,
    platformFeeBps: 1000,
    recipientMode: 'product_owner',
    recipientShares: [],
    version: 1,
    createdBy: 'marco8-5f-smoke',
    updatedBy: 'marco8-5f-smoke',
    createdAt: now,
    updatedAt: now
  };

  const product = {
    productType: 'course',
    productId: courseId,
    financialRuleId: null,
    ownerType: 'platform',
    ownerId: null,
    currency: 'BRL'
  };

  const financialSnapshot = buildFinancialSnapshot({
    rule,
    product,
    grossAmountCents: amountCents,
    currency: 'BRL',
    resolvedAt: now
  });

  return validateOrder({
    buyerUserId,
    productType: 'course',
    productId: courseId,
    quantity: 1,
    amountCents,
    currency: 'BRL',
    status: 'pending_payment',
    financialSnapshot,
    provider: null,
    providerCustomerId: null,
    currentTransactionId: null,
    idempotencyKey: `marco8-5f-${runId}-${suffix}`,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
    cancelledAt: null,
    expiredAt: null,
    refundedAt: null,
    chargebackAt: null
  });
}

async function main() {
  const webConfig = validateEnvironment();
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const supportEmail = `orders-support-${runId}@example.invalid`;
  const contentEmail = `orders-content-${runId}@example.invalid`;
  const supportPassword = randomPassword();
  const contentPassword = randomPassword();
  const courseId = `smoke-85f-course-${runId}`;
  const courseTitle = `SMOKE 8.5F - Pedidos ${runId}`;
  const orderIds = [
    `00000000-marco85f-${runId}-a`,
    `00000000-marco85f-${runId}-b`
  ];

  const state = {
    projectId: TARGET_PROJECT,
    runId,
    supportUserId: null,
    contentUserId: null,
    courseId,
    orderIds,
    createdAt: new Date().toISOString()
  };

  saveState(state);

  const app = initializeApp(
    {
      credential: applicationDefault(),
      projectId: TARGET_PROJECT
    },
    `admin-orders-smoke-${runId}`
  );

  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 8.5F - ADMIN ORDERS STAGING SMOKE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('orders').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const supportUser = await auth.createUser({
      email: supportEmail,
      password: supportPassword,
      emailVerified: true
    });
    state.supportUserId = supportUser.uid;
    saveState(state);

    const contentUser = await auth.createUser({
      email: contentEmail,
      password: contentPassword,
      emailVerified: true
    });
    state.contentUserId = contentUser.uid;
    saveState(state);

    await auth.setCustomUserClaims(supportUser.uid, {
      support_admin: true
    });
    await auth.setCustomUserClaims(contentUser.uid, {
      content_admin: true
    });

    const orderA = buildPendingOrder({
      buyerUserId: supportUser.uid,
      courseId,
      runId,
      suffix: 'a'
    });
    const orderB = buildPendingOrder({
      buyerUserId: supportUser.uid,
      courseId,
      runId,
      suffix: 'b'
    });

    const batch = db.batch();

    batch.set(db.doc(`usuarios/${supportUser.uid}`), {
      nome: 'Smoke Support Admin',
      email: supportEmail,
      tipo_usuario: 'aluno',
      papel_principal: 'aluno',
      papeis: ['aluno'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: Timestamp.now()
    });

    batch.set(db.doc(`usuarios/${contentUser.uid}`), {
      nome: 'Smoke Content Admin',
      email: contentEmail,
      tipo_usuario: 'aluno',
      papel_principal: 'aluno',
      papeis: ['aluno'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: Timestamp.now()
    });

    batch.create(db.doc(`courses/${courseId}`), {
      title: courseTitle,
      name: courseTitle,
      ownerType: 'platform',
      ownerId: null,
      visibility: 'platform',
      status: 'published',
      isPaid: true,
      priceCents: 10000,
      currency: 'BRL',
      smokeRunId: runId,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });

    batch.create(db.doc(`orders/${orderIds[0]}`), {
      ...orderA,
      smokeRunId: runId
    });

    batch.create(db.doc(`orders/${orderIds[1]}`), {
      ...orderB,
      smokeRunId: runId
    });

    await batch.commit();

    console.log('TEMP_AUTH_USERS_CREATED=2');
    console.log('TEMP_PROFILES_CREATED=2');
    console.log('TEMP_COURSES_CREATED=1');
    console.log('TEMP_ORDERS_CREATED=2');
    console.log('TEMP_TRANSACTIONS_CREATED=0');
    console.log('LOCAL_STATE_FILE=READY');
    console.log('PASSWORDS_PRINTED=False');

    const supportToken = await signIn(
      webConfig.apiKey,
      supportEmail,
      supportPassword
    );
    const contentToken = await signIn(
      webConfig.apiKey,
      contentEmail,
      contentPassword
    );

    console.log('TEMP_AUTHENTICATION=2/2');

    await expectCallableError(
      LIST_CALLABLE,
      null,
      {
        limit: 1,
        productType: 'course',
        orderStatus: 'pending_payment'
      },
      'UNAUTHENTICATED'
    );
    console.log('UNAUTHENTICATED_ACCESS=BLOCKED');

    await expectCallableError(
      LIST_CALLABLE,
      contentToken,
      {
        limit: 1,
        productType: 'course',
        orderStatus: 'pending_payment'
      },
      'PERMISSION_DENIED',
      'ADMIN_CAPABILITY_REQUIRED'
    );
    console.log('CONTENT_ADMIN_ACCESS=BLOCKED');

    await expectCallableError(
      LIST_CALLABLE,
      supportToken,
      {
        limit: 1,
        productType: 'course',
        orderStatus: 'pending_payment',
        role: 'super_admin'
      },
      'INVALID_ARGUMENT'
    );
    console.log('CLIENT_ROLE_INPUT=BLOCKED');

    const firstPage = await callCallable(
      LIST_CALLABLE,
      supportToken,
      {
        limit: 1,
        productType: 'course',
        orderStatus: 'pending_payment'
      }
    );

    assert(firstPage.ok === true, 'Listagem operacional precisa retornar ok=true.');
    assert(firstPage.limit === 1, 'Listagem precisa respeitar limit=1.');
    assert(Array.isArray(firstPage.items), 'Listagem precisa retornar items.');
    assert(firstPage.items.length === 1, 'Primeira página precisa conter um pedido.');
    assert(
      firstPage.items[0].orderId === orderIds[0],
      `Primeiro pedido inesperado: ${firstPage.items[0].orderId || 'ausente'}.`
    );
    assert(
      typeof firstPage.nextCursor === 'string' && firstPage.nextCursor.length > 0,
      'Primeira página precisa retornar cursor.'
    );

    assertSanitizedOperationalView(firstPage.items[0], {
      orderId: orderIds[0],
      courseId,
      courseTitle,
      buyerUserId: supportUser.uid,
      buyerEmail: supportEmail
    });

    console.log('SUPPORT_LIST_PAGE_1=OK');
    console.log('LIST_VIEW_SANITIZED=OK');

    const secondPage = await callCallable(
      LIST_CALLABLE,
      supportToken,
      {
        limit: 1,
        cursor: firstPage.nextCursor,
        productType: 'course',
        orderStatus: 'pending_payment'
      }
    );

    assert(secondPage.ok === true, 'Segunda página precisa retornar ok=true.');
    assert(Array.isArray(secondPage.items), 'Segunda página precisa retornar items.');
    assert(secondPage.items.length === 1, 'Segunda página precisa conter um pedido.');
    assert(
      secondPage.items[0].orderId === orderIds[1],
      `Segundo pedido inesperado: ${secondPage.items[0].orderId || 'ausente'}.`
    );

    assertSanitizedOperationalView(secondPage.items[0], {
      orderId: orderIds[1],
      courseId,
      courseTitle,
      buyerUserId: supportUser.uid,
      buyerEmail: supportEmail
    });

    console.log('SUPPORT_LIST_CURSOR_PAGE_2=OK');

    const detail = await callCallable(
      DETAIL_CALLABLE,
      supportToken,
      {
        orderId: orderIds[0]
      }
    );

    assert(detail.ok === true, 'Detalhe operacional precisa retornar ok=true.');
    assertSanitizedOperationalView(detail.order, {
      orderId: orderIds[0],
      courseId,
      courseTitle,
      buyerUserId: supportUser.uid,
      buyerEmail: supportEmail
    });

    console.log('SUPPORT_DETAIL=OK');
    console.log('DETAIL_VIEW_SANITIZED=OK');

    const persistedOrders = await db.getAll(
      db.doc(`orders/${orderIds[0]}`),
      db.doc(`orders/${orderIds[1]}`)
    );

    for (const snap of persistedOrders) {
      assert(snap.exists, `Pedido temporário ${snap.id} desapareceu durante leitura.`);
      const data = snap.data() || {};
      assert(data.smokeRunId === runId, `Pedido temporário ${snap.id} perdeu ownership marker.`);
      assert(data.status === 'pending_payment', `Pedido temporário ${snap.id} foi mutado.`);
      assert(!data.currentTransactionId, `Pedido temporário ${snap.id} recebeu transação inesperada.`);
    }

    const txSnap = await db.collection('payment_transactions')
      .where('orderId', 'in', orderIds)
      .get();

    assert(txSnap.empty, 'Callables read-only não podem criar payment_transactions.');

    console.log('CANONICAL_ORDERS_UNCHANGED=OK');
    console.log('READ_CALLABLE_WRITES=False');
    console.log('PROVIDER_CALLS=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO8_5F_ADMIN_ORDERS_STAGING_SMOKE=OK');
  } catch (error) {
    console.error('MARCO8_5F_ADMIN_ORDERS_STAGING_SMOKE=FAILED');
    console.error(`ERROR=${sanitizeDiagnosticText(error.message)}`);
    if (error.httpStatus) console.error(`HTTP_STATUS=${error.httpStatus}`);
    if (error.callableStatus) console.error(`CALLABLE_STATUS=${error.callableStatus}`);
    if (error.responseContentType) {
      console.error(`RESPONSE_CONTENT_TYPE=${error.responseContentType}`);
    }
    if (error.responseKind) console.error(`RESPONSE_KIND=${error.responseKind}`);
    if (error.responsePreview) {
      console.error(`RESPONSE_PREVIEW=${error.responsePreview}`);
    }
    console.error(`CLEANUP_REQUIRED=${fs.existsSync(STATE_FILE)}`);
    process.exitCode = 1;
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main();
