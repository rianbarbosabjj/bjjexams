'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFileSync } = require('node:child_process');

const functionsRequire = createRequire(path.resolve(__dirname, '..', 'functions', 'package.json'));
const { initializeApp, applicationDefault, deleteApp } = functionsRequire('firebase-admin/app');
const { getAuth } = functionsRequire('firebase-admin/auth');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5e-refund-chargeback';
const REGION = 'southamerica-east1';
const CHECKOUT_FUNCTION = 'iniciarCheckoutCursoV12';
const REFUND_FUNCTION = 'solicitarEstornoIntegralV12';
const WEBHOOK_INGRESS_FUNCTION = 'webhookAsaasPagamentosV12';
const WEBHOOK_WORKER_FUNCTION = 'processarWebhookPagamentoV12';
const WEB_APP_ID = '1:206338587822:web:d870ac4cf23b6a1b6f813f';
const ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
const SMOKE_MARKER_PATH = 'smoke_runs/marco5e-refund-sandbox-v1';
const TARGET_PRICE_CENTS = 500;
const FUNDING_PRICE_CENTS = 2000;
const MIN_BALANCE_BEFORE_REFUND_CENTS = 1000;
const ALLOW_ENV = 'BJJ_EXAMS_ALLOW_ASAAS_SANDBOX_REVERSAL_SMOKE';
const TIMEOUT_MS = 120000;
const POLL_MS = 1000;

function fail(message) { throw new Error(message); }
function bool(value) { return value ? 'True' : 'False'; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function escapeCmdArgument(value) {
  return String(value).replace(/([&|<>^()])/g, '^$1');
}

function command(name, args) {
  let executable = name;
  let executableArgs = args;
  if (process.platform === 'win32' && name === 'gcloud') {
    executable = process.env.ComSpec || 'cmd.exe';
    executableArgs = ['/d', '/s', '/c', ['gcloud.cmd', ...args.map(escapeCmdArgument)].join(' ')];
  }
  try {
    return execFileSync(executable, executableArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const stderr = String(error?.stderr || '').trim();
    fail(`${name} falhou: ${stderr || error.message}`);
  }
}

function generateCpf() {
  let digits;
  do {
    digits = Array.from({ length: 9 }, () => crypto.randomInt(0, 10));
  } while (digits.every(item => item === digits[0]));
  const check = base => {
    let sum = 0;
    for (let i = 0; i < base.length; i += 1) sum += base[i] * (base.length + 1 - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };
  digits.push(check(digits));
  digits.push(check(digits));
  return digits.join('');
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Valor numerico invalido para Firestore.');
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'object') {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)])) } };
  }
  fail('Tipo nao suportado para Firestore.');
}

function firestoreFields(value) {
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)]));
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ('mapValue' in value) return decodeFirestoreFields(value.mapValue.fields || {});
  return null;
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decodeFirestoreValue(v)]));
}

async function readJson(response, label) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) {
    const providerMessage = body?.error?.message || body?.error?.status || body?.message ||
      body?.errors?.map(item => item?.description || item?.code).filter(Boolean).join('; ') || '';
    fail(`${label} falhou HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : ''}`);
  }
  return body;
}

async function main() {
  if (process.env[ALLOW_ENV] !== 'true') {
    fail(`Smoke real bloqueado. Defina ${ALLOW_ENV}=true somente para o Asaas Sandbox.`);
  }
  if (EXPECTED_PROJECT === PRODUCTION_PROJECT) fail('Projeto alvo nao pode ser producao.');

  const branch = command('git', ['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  if (command('git', ['status', '--short'])) fail('Worktree precisa estar limpa antes do smoke real.');
  command('git', ['fetch', 'origin', EXPECTED_BRANCH]);
  if (command('git', ['rev-parse', 'HEAD']) !== command('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`])) {
    fail('HEAD local precisa coincidir com o remoto antes do smoke.');
  }

  const project = command('gcloud', ['projects', 'describe', EXPECTED_PROJECT, '--format=value(projectId)']);
  if (project !== EXPECTED_PROJECT || project === PRODUCTION_PROJECT) fail('Projeto staging nao confirmado.');
  const accessToken = command('gcloud', ['auth', 'print-access-token']);
  if (!accessToken) fail('Nao foi possivel obter access token do gcloud.');
  const asaasApiKey = command('gcloud', [
    'secrets', 'versions', 'access', 'latest',
    '--secret=ASAAS_API_KEY',
    `--project=${EXPECTED_PROJECT}`
  ]);
  if (!asaasApiKey.startsWith('$aact_hmlg_')) fail('ASAAS_API_KEY nao corresponde ao Sandbox.');

  function describeFunction(name) {
    const description = JSON.parse(command('gcloud', [
      'functions', 'describe', name, '--gen2', `--region=${REGION}`,
      `--project=${EXPECTED_PROJECT}`, '--format=json'
    ]));
    if (description?.state !== 'ACTIVE') fail(`Function ${name} nao esta ACTIVE.`);
    const uri = String(description?.serviceConfig?.uri || '').trim();
    if (!uri || uri.includes(PRODUCTION_PROJECT)) fail(`URI invalida para ${name}.`);
    return uri;
  }

  const checkoutUri = describeFunction(CHECKOUT_FUNCTION);
  const refundUri = describeFunction(REFUND_FUNCTION);
  describeFunction(WEBHOOK_INGRESS_FUNCTION);
  describeFunction(WEBHOOK_WORKER_FUNCTION);

  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)/documents`;
  const authHeaders = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  const docUrl = docPath => `${firestoreBase}/${docPath.split('/').map(encodeURIComponent).join('/')}`;

  async function getDoc(docPath) {
    const response = await fetch(docUrl(docPath), { headers: { authorization: `Bearer ${accessToken}` } });
    if (response.status === 404) return null;
    const body = await readJson(response, `GET Firestore ${docPath}`);
    return { id: String(body.name || '').split('/').pop(), data: decodeFirestoreFields(body.fields || {}) };
  }

  async function putDoc(docPath, data) {
    const response = await fetch(docUrl(docPath), {
      method: 'PATCH', headers: authHeaders, body: JSON.stringify({ fields: firestoreFields(data) })
    });
    const body = await readJson(response, `PATCH Firestore ${docPath}`);
    return { id: String(body.name || '').split('/').pop(), data: decodeFirestoreFields(body.fields || {}) };
  }

  async function listCollection(collectionId) {
    const docs = [];
    let pageToken = null;
    do {
      const url = new URL(`${firestoreBase}/${collectionId}`);
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const body = await readJson(await fetch(url, { headers: { authorization: `Bearer ${accessToken}` } }), `LIST Firestore ${collectionId}`);
      for (const document of body.documents || []) {
        docs.push({ id: String(document.name || '').split('/').pop(), data: decodeFirestoreFields(document.fields || {}) });
      }
      pageToken = body.nextPageToken || null;
    } while (pageToken);
    return docs;
  }

  async function asaas(pathname, options = {}) {
    return readJson(await fetch(`${ASAAS_BASE_URL}${pathname}`, {
      ...options,
      headers: {
        accept: 'application/json',
        access_token: asaasApiKey,
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    }), `Asaas ${options.method || 'GET'} ${pathname}`);
  }

  async function balanceCents() {
    const data = await asaas('/finance/balance');
    const value = Number(data?.balance);
    if (!Number.isFinite(value)) fail('Asaas nao retornou balance numerico.');
    return Math.round(value * 100);
  }

  async function confirmSandboxPayment(paymentId) {
    await asaas(`/sandbox/payment/${encodeURIComponent(paymentId)}/confirm`, { method: 'POST' });
  }

  async function callFunction(uri, idToken, data, label) {
    const response = await fetch(uri, {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ data })
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!response.ok) {
      const status = body?.error?.status || `HTTP_${response.status}`;
      const domainCode = body?.error?.details?.domainCode || null;
      fail(`${label} falhou: ${status}${domainCode ? `/${domainCode}` : ''}`);
    }
    return body?.result ?? body?.data ?? null;
  }

  async function waitUntil(label, probe) {
    const deadline = Date.now() + TIMEOUT_MS;
    let last = null;
    while (Date.now() < deadline) {
      last = await probe();
      if (last?.ok) return last.value;
      await sleep(POLL_MS);
    }
    fail(`${label} excedeu timeout. Ultimo estado: ${JSON.stringify(last?.debug || null)}`);
  }

  if (await getDoc(SMOKE_MARKER_PATH)) {
    console.log('MARCO5E_STAGING_REFUND_SMOKE=BLOCKED_ALREADY_STARTED');
    console.log('NEW_ASAAS_MUTATION_PERFORMED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    process.exitCode = 2;
    return;
  }

  const defaultRule = await getDoc('financial_rules/platform-default');
  if (!defaultRule || defaultRule.data.status !== 'active' || defaultRule.data.scope !== 'platform_default' || defaultRule.data.recipientMode !== 'product_owner') {
    fail('Regra financial_rules/platform-default nao esta pronta para o smoke.');
  }

  const webConfig = await readJson(await fetch(
    `https://firebase.googleapis.com/v1beta1/projects/${EXPECTED_PROJECT}/webApps/${encodeURIComponent(WEB_APP_ID)}/config`,
    { headers: { authorization: `Bearer ${accessToken}`, 'x-goog-user-project': EXPECTED_PROJECT } }
  ), 'Firebase Web config');
  if (webConfig.projectId !== EXPECTED_PROJECT || !webConfig.apiKey) fail('Configuracao Web de staging invalida.');

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const now = new Date();
  const buyerEmail = `bjjexams-marco5e-refund-buyer-${runId}@example.test`;
  const adminEmail = `bjjexams-marco5e-refund-admin-${runId}@example.test`;
  const buyerPassword = `BjjBuyer-${crypto.randomBytes(18).toString('base64url')}!A1`;
  const adminPassword = `BjjAdmin-${crypto.randomBytes(18).toString('base64url')}!A1`;
  const targetCourseId = `smoke-marco5e-refund-${runId}`;
  const fundingCourseId = `smoke-marco5e-refund-funding-${runId}`;
  const targetKey = `smoke-marco5e-refund-${runId}`;
  const fundingKey = `smoke-marco5e-refund-funding-${runId}`;
  const markerBase = {
    smokeType: 'marco5e-asaas-sandbox-full-refund', runId, projectId: EXPECTED_PROJECT,
    environment: 'sandbox', status: 'prepared', targetCourseId, fundingCourseId,
    targetPriceCents: TARGET_PRICE_CENTS, fundingPriceCents: FUNDING_PRICE_CENTS,
    createdAt: now, updatedAt: now
  };
  await putDoc(SMOKE_MARKER_PATH, markerBase);

  async function signUp(email, password) {
    return readJson(await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(webConfig.apiKey)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
    ), `Firebase Auth signup ${email}`);
  }
  async function signIn(email, password) {
    return readJson(await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webConfig.apiKey)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) }
    ), `Firebase Auth signin ${email}`);
  }

  let adminApp = null;
  try {
    const buyerSigned = await signUp(buyerEmail, buyerPassword);
    const buyerUid = String(buyerSigned.localId || '').trim();
    const buyerIdToken = String(buyerSigned.idToken || '').trim();
    if (!buyerUid || !buyerIdToken) fail('Buyer signup nao retornou uid/idToken.');

    const adminSigned = await signUp(adminEmail, adminPassword);
    const adminUid = String(adminSigned.localId || '').trim();
    if (!adminUid) fail('Admin signup nao retornou uid.');

    adminApp = initializeApp({ credential: applicationDefault(), projectId: EXPECTED_PROJECT }, `marco5e-refund-${process.pid}-${Date.now()}`);
    await getAuth(adminApp).setCustomUserClaims(adminUid, { super_admin: true });
    const adminFresh = await signIn(adminEmail, adminPassword);
    const adminIdToken = String(adminFresh.idToken || '').trim();
    if (!adminIdToken) fail('Admin signin nao retornou idToken atualizado.');

    await putDoc(`usuarios/${buyerUid}`, {
      nome: 'BJJ Exams Marco 5.5 Refund Buyer', email: buyerEmail, cpf: generateCpf(),
      telefone: '61999990000', status_conta: 'ativo', smokeTest: true, smokeRunId: runId,
      createdAt: now, updatedAt: now
    });

    const courseBase = {
      description: 'Curso isolado de homologacao do Marco 5.5 no Asaas Sandbox.', ownerType: 'platform',
      ownerId: null, instructorIds: [buyerUid], visibility: 'platform', organizationId: null,
      status: 'published', isPaid: true, currency: 'BRL', financialRuleId: null,
      publishedAt: now, smokeTest: true, smokeRunId: runId, createdAt: now, updatedAt: now
    };
    await putDoc(`courses/${targetCourseId}`, { ...courseBase, title: 'Smoke Marco 5.5 - Refund Sandbox', priceCents: TARGET_PRICE_CENTS });
    await putDoc(`courses/${fundingCourseId}`, { ...courseBase, title: 'Smoke Marco 5.5 - Funding Sandbox', priceCents: FUNDING_PRICE_CENTS });

    async function checkout(courseId, idempotencyKey, priceCents) {
      const result = await callFunction(checkoutUri, buyerIdToken, { courseId, idempotencyKey }, CHECKOUT_FUNCTION);
      if (!result?.ok || result.status !== 'pending_payment' || !result.paymentId) fail(`Checkout ${courseId} nao ficou pending_payment.`);
      const orderId = sha256(`financial-order-v1:${buyerUid}:${courseId}:${idempotencyKey}`);
      const transactionId = sha256(`payment-transaction-v1:asaas:${orderId}`);
      const enrollmentId = sha256(`course-enrollment-v1:${courseId}:${buyerUid}`);
      if (result.orderId !== orderId || result.transactionId !== transactionId) fail('Checkout retornou identidade canonica divergente.');
      const order = await getDoc(`orders/${orderId}`);
      if (!order || order.data.amountCents !== priceCents || order.data.status !== 'pending_payment') fail('Pedido pendente divergente.');
      return { ...result, orderId, transactionId, enrollmentId, providerCustomerId: order.data.providerCustomerId };
    }

    async function waitPaid(flow) {
      return waitUntil(`pagamento ${flow.orderId}`, async () => {
        const [order, tx, enrollment] = await Promise.all([
          getDoc(`orders/${flow.orderId}`), getDoc(`payment_transactions/${flow.transactionId}`), getDoc(`enrollments/${flow.enrollmentId}`)
        ]);
        const ok = order?.data.status === 'paid' && tx?.data.status === 'paid' && ['active', 'completed'].includes(enrollment?.data.status);
        return { ok, value: { order, tx, enrollment }, debug: { order: order?.data.status, tx: tx?.data.status, enrollment: enrollment?.data.status } };
      });
    }

    const target = await checkout(targetCourseId, targetKey, TARGET_PRICE_CENTS);
    await putDoc(SMOKE_MARKER_PATH, { ...markerBase, status: 'target_checkout_pending', buyerUserId: buyerUid, adminUserId: adminUid, orderId: target.orderId, transactionId: target.transactionId, updatedAt: new Date() });

    await confirmSandboxPayment(target.paymentId);
    await waitPaid(target);

    let balanceBeforeRefund = await balanceCents();
    let fundingCreated = false;
    let funding = null;
    if (balanceBeforeRefund < MIN_BALANCE_BEFORE_REFUND_CENTS) {
      fundingCreated = true;
      funding = await checkout(fundingCourseId, fundingKey, FUNDING_PRICE_CENTS);
      await confirmSandboxPayment(funding.paymentId);
      await waitPaid(funding);
      balanceBeforeRefund = await waitUntil('saldo sandbox para refund', async () => {
        const cents = await balanceCents();
        return { ok: cents >= MIN_BALANCE_BEFORE_REFUND_CENTS, value: cents, debug: { balanceCents: cents } };
      });
    }

    const refundResult = await callFunction(refundUri, adminIdToken, {
      orderId: target.orderId,
      reason: 'Smoke Marco 5.5 - estorno integral em staging'
    }, REFUND_FUNCTION);
    if (!refundResult?.ok || refundResult.operation !== 'refund_full' || refundResult.status !== 'awaiting_webhook' || refundResult.awaitingWebhook !== true || !refundResult.requestId) {
      fail('Callable de refund nao retornou receipt awaiting_webhook valido.');
    }

    const finalState = await waitUntil('webhook PAYMENT_REFUNDED', async () => {
      const [order, tx, enrollment, events] = await Promise.all([
        getDoc(`orders/${target.orderId}`), getDoc(`payment_transactions/${target.transactionId}`),
        getDoc(`enrollments/${target.enrollmentId}`), listCollection('payment_webhook_events')
      ]);
      const event = events.find(item => item.data.providerPaymentId === target.paymentId && item.data.eventType === 'PAYMENT_REFUNDED' && item.data.status === 'processed');
      const ok = order?.data.status === 'refunded' && tx?.data.status === 'refunded' && enrollment?.data.status === 'refunded' && Boolean(event);
      return { ok, value: { order, tx, enrollment, event }, debug: { order: order?.data.status, tx: tx?.data.status, enrollment: enrollment?.data.status, refundEvent: event?.data.status || null } };
    });

    const archivedAt = new Date();
    await putDoc(`courses/${targetCourseId}`, { ...courseBase, title: 'Smoke Marco 5.5 - Refund Sandbox', priceCents: TARGET_PRICE_CENTS, status: 'archived', updatedAt: archivedAt });
    await putDoc(`courses/${fundingCourseId}`, { ...courseBase, title: 'Smoke Marco 5.5 - Funding Sandbox', priceCents: FUNDING_PRICE_CENTS, status: 'archived', updatedAt: archivedAt });

    await putDoc(SMOKE_MARKER_PATH, {
      ...markerBase, status: 'completed', buyerUserId: buyerUid, adminUserId: adminUid,
      orderId: target.orderId, transactionId: target.transactionId, reversalRequestId: refundResult.requestId,
      fundingCreated, fundingOrderId: funding?.orderId || null, balanceBeforeRefundCents: balanceBeforeRefund,
      webhookEventId: finalState.event.id, courseArchived: true, updatedAt: archivedAt
    });

    console.log('MARCO5E_STAGING_REFUND_SMOKE=OK');
    console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
    console.log('ASAAS_ENVIRONMENT=sandbox');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('ADMIN_ROLE=super_admin');
    console.log('PAYMENT_CONFIRMED_IN_SANDBOX=True');
    console.log(`FUNDING_FIXTURE_CREATED=${bool(fundingCreated)}`);
    console.log('REVERSAL_OPERATION=refund_full');
    console.log(`REVERSAL_REQUEST_STATUS=${refundResult.status}`);
    console.log('WEBHOOK_EVENT_TYPE=PAYMENT_REFUNDED');
    console.log(`WEBHOOK_EVENT_STATUS=${finalState.event.data.status}`);
    console.log(`ORDER_STATUS=${finalState.order.data.status}`);
    console.log(`TRANSACTION_STATUS=${finalState.tx.data.status}`);
    console.log(`ENROLLMENT_STATUS=${finalState.enrollment.data.status}`);
    console.log('COURSES_ARCHIVED_AFTER_SMOKE=True');
    console.log('SMOKE_MARKER_STATUS=completed');
    console.log('API_KEY_PRINTED=False');
    console.log('WEBHOOK_TOKEN_PRINTED=False');
    console.log('PROVIDER_PAYMENT_ID_PRINTED=False');
  } catch (error) {
    await putDoc(SMOKE_MARKER_PATH, { ...markerBase, status: 'failed', failure: String(error?.message || 'unknown').slice(0, 300), updatedAt: new Date() }).catch(() => {});
    throw error;
  } finally {
    if (adminApp) await deleteApp(adminApp).catch(() => {});
  }
}

main().catch(error => {
  console.error(`MARCO5E_STAGING_REFUND_SMOKE=FAILED | ${error.message}`);
  process.exitCode = 1;
});
