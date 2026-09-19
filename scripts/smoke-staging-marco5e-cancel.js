'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  initializeApp,
  applicationDefault,
  deleteApp
} = require('../functions/node_modules/firebase-admin/app');
const { getAuth } = require('../functions/node_modules/firebase-admin/auth');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5e-refund-chargeback';
const REGION = 'southamerica-east1';
const CHECKOUT_FUNCTION = 'iniciarCheckoutCursoV12';
const CANCEL_FUNCTION = 'cancelarCobrancaPendenteV12';
const WEBHOOK_INGRESS_FUNCTION = 'webhookAsaasPagamentosV12';
const WEBHOOK_WORKER_FUNCTION = 'processarWebhookPagamentoV12';
const WEB_APP_ID = '1:206338587822:web:d870ac4cf23b6a1b6f813f';
const SMOKE_MARKER_PATH = 'smoke_runs/marco5e-cancel-sandbox-v1';
const PRICE_CENTS = 500;
const ALLOW_ENV = 'BJJ_EXAMS_ALLOW_ASAAS_SANDBOX_REVERSAL_SMOKE';
const TIMEOUT_MS = 90000;
const POLL_MS = 1000;

function fail(message) {
  throw new Error(message);
}

function bool(value) {
  return value ? 'True' : 'False';
}

function escapeCmdArgument(value) {
  return String(value).replace(/([&|<>^()])/g, '^$1');
}

function command(name, args) {
  let executable = name;
  let executableArgs = args;

  if (process.platform === 'win32' && name === 'gcloud') {
    executable = process.env.ComSpec || 'cmd.exe';
    const commandLine = [
      'gcloud.cmd',
      ...args.map(escapeCmdArgument)
    ].join(' ');
    executableArgs = ['/d', '/s', '/c', commandLine];
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function generateCpf() {
  let digits;
  do {
    digits = Array.from({ length: 9 }, () => crypto.randomInt(0, 10));
  } while (digits.every(item => item === digits[0]));

  const check = base => {
    let sum = 0;
    for (let i = 0; i < base.length; i += 1) {
      sum += base[i] * (base.length + 1 - i);
    }
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
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(firestoreValue) } };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Valor numerico invalido para Firestore.');
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])
        )
      }
    };
  }
  fail('Tipo nao suportado para Firestore.');
}

function firestoreFields(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])
  );
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(decodeFirestoreValue);
  }
  if ('mapValue' in value) {
    return decodeFirestoreFields(value.mapValue.fields || {});
  }
  return null;
}

function decodeFirestoreFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)])
  );
}

async function readJson(response, label) {
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    body = {};
  }
  if (!response.ok) {
    const providerMessage =
      body?.error?.message ||
      body?.error?.status ||
      body?.message ||
      '';
    fail(`${label} falhou HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : ''}`);
  }
  return body;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  if (process.env[ALLOW_ENV] !== 'true') {
    fail(`Smoke real bloqueado. Defina ${ALLOW_ENV}=true somente para o Asaas Sandbox.`);
  }
  if (EXPECTED_PROJECT === PRODUCTION_PROJECT) {
    fail('Projeto alvo nao pode ser producao.');
  }

  const branch = command('git', ['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  }

  const dirty = command('git', ['status', '--short']);
  if (dirty) fail('Worktree precisa estar limpa antes do smoke real.');

  command('git', ['fetch', 'origin', EXPECTED_BRANCH]);
  const localHead = command('git', ['rev-parse', 'HEAD']);
  const remoteHead = command('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`]);
  if (localHead !== remoteHead) {
    fail('HEAD local precisa coincidir com o remoto antes do smoke.');
  }

  const project = command('gcloud', [
    'projects', 'describe', EXPECTED_PROJECT,
    '--format=value(projectId)'
  ]);
  if (project !== EXPECTED_PROJECT || project === PRODUCTION_PROJECT) {
    fail('Projeto staging nao confirmado.');
  }

  const accessToken = command('gcloud', ['auth', 'print-access-token']);
  if (!accessToken) fail('Nao foi possivel obter access token do gcloud.');

  function describeFunction(name) {
    const raw = command('gcloud', [
      'functions', 'describe', name,
      '--gen2',
      `--region=${REGION}`,
      `--project=${EXPECTED_PROJECT}`,
      '--format=json'
    ]);
    const description = JSON.parse(raw);
    if (description?.state !== 'ACTIVE') {
      fail(`Function ${name} nao esta ACTIVE.`);
    }
    const uri = String(description?.serviceConfig?.uri || '').trim();
    if (!uri || uri.includes(PRODUCTION_PROJECT)) {
      fail(`URI invalida para ${name}.`);
    }
    return { description, uri };
  }

  const checkoutFn = describeFunction(CHECKOUT_FUNCTION);
  const cancelFn = describeFunction(CANCEL_FUNCTION);
  describeFunction(WEBHOOK_INGRESS_FUNCTION);
  describeFunction(WEBHOOK_WORKER_FUNCTION);

  const firestoreBase =
    `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)/documents`;
  const authHeaders = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json'
  };

  function docUrl(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${firestoreBase}/${encoded}`;
  }

  async function getDoc(path) {
    const response = await fetch(docUrl(path), {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 404) return null;
    const body = await readJson(response, `GET Firestore ${path}`);
    return {
      name: body.name,
      data: decodeFirestoreFields(body.fields || {})
    };
  }

  async function putDoc(path, data) {
    const response = await fetch(docUrl(path), {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ fields: firestoreFields(data) })
    });
    const body = await readJson(response, `PATCH Firestore ${path}`);
    return {
      name: body.name,
      data: decodeFirestoreFields(body.fields || {})
    };
  }

  async function listCollection(collectionId) {
    const result = [];
    let pageToken = null;
    do {
      const url = new URL(`${firestoreBase}/${collectionId}`);
      url.searchParams.set('pageSize', '200');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const response = await fetch(url, {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      const body = await readJson(response, `LIST Firestore ${collectionId}`);
      for (const document of body.documents || []) {
        result.push({
          id: String(document.name || '').split('/').pop(),
          data: decodeFirestoreFields(document.fields || {})
        });
      }
      pageToken = body.nextPageToken || null;
    } while (pageToken);
    return result;
  }

  const existingMarker = await getDoc(SMOKE_MARKER_PATH);
  if (existingMarker) {
    console.log('MARCO5E_STAGING_CANCEL_SMOKE=BLOCKED_ALREADY_STARTED');
    console.log(`SMOKE_MARKER_STATUS=${existingMarker.data.status || 'unknown'}`);
    console.log('NEW_ASAAS_MUTATION_PERFORMED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    process.exitCode = 2;
    return;
  }

  const defaultRule = await getDoc('financial_rules/platform-default');
  if (
    !defaultRule ||
    defaultRule.data.status !== 'active' ||
    defaultRule.data.scope !== 'platform_default' ||
    defaultRule.data.recipientMode !== 'product_owner'
  ) {
    fail('Regra financial_rules/platform-default nao esta pronta para o smoke.');
  }

  const configResponse = await fetch(
    `https://firebase.googleapis.com/v1beta1/projects/${EXPECTED_PROJECT}/webApps/${encodeURIComponent(WEB_APP_ID)}/config`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-goog-user-project': EXPECTED_PROJECT
      }
    }
  );
  const webConfig = await readJson(configResponse, 'Firebase Web config');
  if (webConfig.projectId !== EXPECTED_PROJECT || !webConfig.apiKey) {
    fail('Configuracao Web de staging invalida.');
  }

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const buyerEmail = `bjjexams-marco5e-cancel-buyer-${runId}@example.test`;
  const adminEmail = `bjjexams-marco5e-cancel-admin-${runId}@example.test`;
  const buyerPassword = `BjjBuyer-${crypto.randomBytes(18).toString('base64url')}!A1`;
  const adminPassword = `BjjAdmin-${crypto.randomBytes(18).toString('base64url')}!A1`;
  const cpf = generateCpf();
  const now = new Date();
  const courseId = `smoke-marco5e-cancel-${runId}`;
  const idempotencyKey = `smoke-marco5e-cancel-${runId}`;

  const markerBase = {
    smokeType: 'marco5e-asaas-sandbox-cancel-pending',
    runId,
    projectId: EXPECTED_PROJECT,
    environment: 'sandbox',
    status: 'prepared',
    courseId,
    idempotencyKey,
    priceCents: PRICE_CENTS,
    createdAt: now,
    updatedAt: now
  };
  await putDoc(SMOKE_MARKER_PATH, markerBase);

  async function signUp(email, password) {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(webConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      }
    );
    return readJson(response, `Firebase Auth signup ${email}`);
  }

  async function signIn(email, password) {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(webConfig.apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      }
    );
    return readJson(response, `Firebase Auth signin ${email}`);
  }

  async function callFunction(uri, idToken, data, label) {
    const response = await fetch(uri, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'content-type': 'application/json'
      },
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

  let adminApp = null;

  try {
    const buyerSigned = await signUp(buyerEmail, buyerPassword);
    const buyerUid = String(buyerSigned.localId || '').trim();
    const buyerIdToken = String(buyerSigned.idToken || '').trim();
    if (!buyerUid || !buyerIdToken) fail('Buyer signup nao retornou uid/idToken.');

    const adminSigned = await signUp(adminEmail, adminPassword);
    const adminUid = String(adminSigned.localId || '').trim();
    if (!adminUid) fail('Admin signup nao retornou uid.');

    adminApp = initializeApp(
      {
        credential: applicationDefault(),
        projectId: EXPECTED_PROJECT
      },
      `marco5e-cancel-${process.pid}-${Date.now()}`
    );
    await getAuth(adminApp).setCustomUserClaims(adminUid, {
      platform_admin: true
    });

    const adminFresh = await signIn(adminEmail, adminPassword);
    const adminIdToken = String(adminFresh.idToken || '').trim();
    if (!adminIdToken) fail('Admin signin nao retornou idToken atualizado.');

    const userProfile = {
      nome: 'BJJ Exams Marco 5.5 Cancel Buyer',
      email: buyerEmail,
      cpf,
      telefone: '61999990000',
      status_conta: 'ativo',
      smokeTest: true,
      smokeRunId: runId,
      createdAt: now,
      updatedAt: now
    };

    const course = {
      title: 'Smoke Marco 5.5 - Cancelamento Sandbox',
      description: 'Curso isolado de homologacao para cancelamento de cobranca pendente no Asaas Sandbox.',
      ownerType: 'platform',
      ownerId: null,
      instructorIds: [buyerUid],
      visibility: 'platform',
      organizationId: null,
      status: 'published',
      isPaid: true,
      priceCents: PRICE_CENTS,
      currency: 'BRL',
      financialRuleId: null,
      publishedAt: now,
      smokeTest: true,
      smokeRunId: runId,
      createdAt: now,
      updatedAt: now
    };

    await putDoc(`usuarios/${buyerUid}`, userProfile);
    await putDoc(`courses/${courseId}`, course);

    const expectedOrderId = sha256(
      `financial-order-v1:${buyerUid}:${courseId}:${idempotencyKey}`
    );
    const expectedTransactionId = sha256(
      `payment-transaction-v1:asaas:${expectedOrderId}`
    );
    const expectedEnrollmentId = sha256(
      `course-enrollment-v1:${courseId}:${buyerUid}`
    );

    const checkout = await callFunction(
      checkoutFn.uri,
      buyerIdToken,
      { courseId, idempotencyKey },
      CHECKOUT_FUNCTION
    );

    if (!checkout?.ok || checkout.status !== 'pending_payment' || !checkout.paymentId) {
      fail('Checkout do smoke nao ficou pending_payment com paymentId.');
    }
    if (
      checkout.orderId !== expectedOrderId ||
      checkout.transactionId !== expectedTransactionId
    ) {
      fail('Checkout retornou identidade canonica divergente.');
    }

    const [pendingOrder, pendingTransaction, pendingEnrollment] = await Promise.all([
      getDoc(`orders/${expectedOrderId}`),
      getDoc(`payment_transactions/${expectedTransactionId}`),
      getDoc(`enrollments/${expectedEnrollmentId}`)
    ]);

    if (
      !pendingOrder ||
      pendingOrder.data.status !== 'pending_payment' ||
      !pendingTransaction ||
      pendingTransaction.data.status !== 'pending' ||
      pendingTransaction.data.providerPaymentId !== checkout.paymentId ||
      pendingEnrollment
    ) {
      fail('Estado pre-cancelamento nao corresponde ao contrato canonico.');
    }

    await putDoc(SMOKE_MARKER_PATH, {
      ...markerBase,
      status: 'checkout_pending',
      buyerUserId: buyerUid,
      adminUserId: adminUid,
      orderId: expectedOrderId,
      transactionId: expectedTransactionId,
      providerPaymentId: checkout.paymentId,
      updatedAt: new Date()
    });

    const cancelResult = await callFunction(
      cancelFn.uri,
      adminIdToken,
      {
        orderId: expectedOrderId,
        reason: 'Smoke Marco 5.5 - cancelamento pendente em staging'
      },
      CANCEL_FUNCTION
    );

    if (
      !cancelResult?.ok ||
      cancelResult.operation !== 'cancel_pending' ||
      cancelResult.orderId !== expectedOrderId ||
      cancelResult.transactionId !== expectedTransactionId ||
      cancelResult.providerPaymentId !== checkout.paymentId ||
      cancelResult.status !== 'awaiting_webhook' ||
      cancelResult.awaitingWebhook !== true ||
      !cancelResult.requestId
    ) {
      fail('Callable de cancelamento nao retornou receipt awaiting_webhook valido.');
    }

    const deadline = Date.now() + TIMEOUT_MS;
    let finalOrder = null;
    let finalTransaction = null;
    let finalEnrollment = null;
    let matchingEvent = null;

    while (Date.now() < deadline) {
      [finalOrder, finalTransaction, finalEnrollment] = await Promise.all([
        getDoc(`orders/${expectedOrderId}`),
        getDoc(`payment_transactions/${expectedTransactionId}`),
        getDoc(`enrollments/${expectedEnrollmentId}`)
      ]);

      const events = await listCollection('payment_webhook_events');
      matchingEvent = events.find(item =>
        item.data.provider === 'asaas' &&
        item.data.providerPaymentId === checkout.paymentId &&
        item.data.eventType === 'PAYMENT_DELETED' &&
        item.data.status === 'processed'
      ) || null;

      if (
        finalOrder?.data.status === 'cancelled' &&
        finalTransaction?.data.status === 'cancelled' &&
        !finalEnrollment &&
        matchingEvent
      ) {
        break;
      }
      await sleep(POLL_MS);
    }

    if (finalOrder?.data.status !== 'cancelled') {
      fail(`Order nao convergiu para cancelled: ${finalOrder?.data.status || '<missing>'}.`);
    }
    if (finalTransaction?.data.status !== 'cancelled') {
      fail(`Transaction nao convergiu para cancelled: ${finalTransaction?.data.status || '<missing>'}.`);
    }
    if (finalEnrollment) {
      fail('Cancelamento pendente criou enrollment indevidamente.');
    }
    if (!matchingEvent) {
      fail('PAYMENT_DELETED processado nao foi localizado no webhook canonico.');
    }

    const requestDoc = await getDoc(
      `financial_reversal_requests/${cancelResult.requestId}`
    );
    if (
      !requestDoc ||
      requestDoc.data.operation !== 'cancel_pending' ||
      requestDoc.data.orderId !== expectedOrderId ||
      requestDoc.data.transactionId !== expectedTransactionId ||
      requestDoc.data.providerPaymentId !== checkout.paymentId ||
      !['awaiting_webhook', 'completed'].includes(requestDoc.data.status)
    ) {
      fail('Receipt administrativo de cancelamento ficou inconsistente.');
    }

    const archivedAt = new Date();
    await putDoc(`courses/${courseId}`, {
      ...course,
      status: 'archived',
      updatedAt: archivedAt
    });

    await putDoc(SMOKE_MARKER_PATH, {
      ...markerBase,
      status: 'completed',
      buyerUserId: buyerUid,
      adminUserId: adminUid,
      orderId: expectedOrderId,
      transactionId: expectedTransactionId,
      providerPaymentId: checkout.paymentId,
      reversalRequestId: cancelResult.requestId,
      reversalRequestStatus: requestDoc.data.status,
      webhookEventId: matchingEvent.id,
      webhookEventType: matchingEvent.data.eventType,
      webhookEventStatus: matchingEvent.data.status,
      orderStatus: finalOrder.data.status,
      transactionStatus: finalTransaction.data.status,
      enrollmentCreated: false,
      courseArchived: true,
      updatedAt: archivedAt
    });

    console.log('MARCO5E_STAGING_CANCEL_SMOKE=OK');
    console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
    console.log('ASAAS_ENVIRONMENT=sandbox');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('ADMIN_ROLE=platform_admin');
    console.log('CHECKOUT_STATUS=pending_payment');
    console.log('REVERSAL_OPERATION=cancel_pending');
    console.log(`REVERSAL_REQUEST_STATUS=${requestDoc.data.status}`);
    console.log('WEBHOOK_EVENT_TYPE=PAYMENT_DELETED');
    console.log('WEBHOOK_EVENT_STATUS=processed');
    console.log('ORDER_STATUS=cancelled');
    console.log('TRANSACTION_STATUS=cancelled');
    console.log('ENROLLMENT_CREATED=False');
    console.log('COURSE_ARCHIVED_AFTER_SMOKE=True');
    console.log('SMOKE_MARKER_STATUS=completed');
    console.log('API_KEY_PRINTED=False');
    console.log('WEBHOOK_TOKEN_PRINTED=False');
    console.log('PROVIDER_PAYMENT_ID_PRINTED=False');
  } catch (error) {
    await putDoc(SMOKE_MARKER_PATH, {
      ...markerBase,
      status: 'failed',
      failure: String(error?.message || 'unknown').slice(0, 300),
      updatedAt: new Date()
    }).catch(() => {});
    throw error;
  } finally {
    if (adminApp) {
      await deleteApp(adminApp).catch(() => {});
    }
  }
}

main().catch(error => {
  console.error(`MARCO5E_STAGING_CANCEL_SMOKE=FAILED | ${error.message}`);
  process.exitCode = 1;
});
