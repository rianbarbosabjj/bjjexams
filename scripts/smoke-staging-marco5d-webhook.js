'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5d-webhook-fulfillment';
const ASAAS_BASE = 'https://api-sandbox.asaas.com/v3';
const SOURCE_SMOKE_MARKER = 'smoke_runs/marco5c-asaas-sandbox-v1';
const THIS_SMOKE_MARKER = 'smoke_runs/marco5d-webhook-sandbox-v1';
const POLL_TIMEOUT_MS = 120000;
const POLL_INTERVAL_MS = 3000;

function fail(message) {
  throw new Error(message);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeCmdArgument(value) {
  return String(value).replace(/([&|<>^()])/g, '^$1');
}

function command(name, args) {
  let executable = name;
  let executableArgs = args;

  if (process.platform === 'win32' && name === 'gcloud') {
    executable = process.env.ComSpec || 'cmd.exe';
    executableArgs = [
      '/d', '/s', '/c',
      ['gcloud.cmd', ...args.map(escapeCmdArgument)].join(' ')
    ];
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

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Valor numerico invalido para Firestore.');
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function firestoreFields(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])
  );
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(decodeValue);
  }
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])
  );
}

async function readJson(response, label) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) {
    const message = body?.errors?.[0]?.description || body?.error?.message || '';
    fail(`${label} falhou HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }
  return body;
}

async function main() {
  if (process.env.BJJ_EXAMS_ALLOW_ASAAS_SANDBOX_WEBHOOK_SMOKE !== 'true') {
    fail('Smoke real bloqueado. Defina BJJ_EXAMS_ALLOW_ASAAS_SANDBOX_WEBHOOK_SMOKE=true somente para staging/sandbox.');
  }

  const branch = command('git', ['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  }

  const dirty = command('git', ['status', '--short']);
  if (dirty) fail('Worktree precisa estar limpa antes do smoke real.');

  const localHead = command('git', ['rev-parse', 'HEAD']);
  const remoteHead = command('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`]);
  if (localHead !== remoteHead) fail('HEAD local diverge do remoto. Faça pull antes do smoke.');

  const project = command('gcloud', [
    'projects', 'describe', EXPECTED_PROJECT,
    '--format=value(projectId)'
  ]);
  if (project !== EXPECTED_PROJECT || project === PRODUCTION_PROJECT) {
    fail('Projeto staging nao confirmado.');
  }

  const accessToken = command('gcloud', ['auth', 'print-access-token']);
  const apiKey = command('gcloud', [
    'secrets', 'versions', 'access', 'latest',
    '--secret=ASAAS_API_KEY',
    `--project=${EXPECTED_PROJECT}`
  ]);
  if (!apiKey.startsWith('$aact_hmlg_')) {
    fail('ASAAS_API_KEY nao possui prefixo Sandbox esperado.');
  }

  const firestoreBase =
    `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)/documents`;
  const authHeaders = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json',
    'x-goog-user-project': EXPECTED_PROJECT
  };

  function docUrl(path) {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `${firestoreBase}/${encoded}`;
  }

  async function getDoc(path) {
    const response = await fetch(docUrl(path), {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-goog-user-project': EXPECTED_PROJECT
      }
    });
    if (response.status === 404) return null;
    const body = await readJson(response, `GET Firestore ${path}`);
    return decodeFields(body.fields || {});
  }

  async function putDoc(path, data) {
    const response = await fetch(docUrl(path), {
      method: 'PATCH',
      headers: authHeaders,
      body: JSON.stringify({ fields: firestoreFields(data) })
    });
    return readJson(response, `PATCH Firestore ${path}`);
  }

  async function listWebhookEvents() {
    const events = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ pageSize: '200' });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await fetch(
        `${firestoreBase}/payment_webhook_events?${query.toString()}`,
        {
          headers: {
            authorization: `Bearer ${accessToken}`,
            'x-goog-user-project': EXPECTED_PROJECT
          }
        }
      );
      const body = await readJson(response, 'LIST payment_webhook_events');
      for (const item of body.documents || []) {
        events.push(decodeFields(item.fields || {}));
      }
      pageToken = String(body.nextPageToken || '');
    } while (pageToken);
    return events;
  }

  const existingRun = await getDoc(THIS_SMOKE_MARKER);
  if (existingRun) {
    console.log('MARCO5D_STAGING_WEBHOOK_SMOKE=BLOCKED_ALREADY_STARTED');
    console.log(`SMOKE_MARKER_STATUS=${existingRun.status || 'unknown'}`);
    console.log('NEW_ASAAS_MUTATION_PERFORMED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    process.exitCode = 2;
    return;
  }

  const source = await getDoc(SOURCE_SMOKE_MARKER);
  if (!source || source.status !== 'completed') {
    fail('Smoke Marco 5.3 concluido nao foi encontrado em staging.');
  }

  const paymentId = String(source.paymentId || '').trim();
  const orderId = String(source.orderId || '').trim();
  const transactionId = String(source.transactionId || '').trim();
  const courseId = String(source.courseId || '').trim();
  const userId = String(source.userId || '').trim();
  const priceCents = Number(source.priceCents || 0);
  if (!paymentId || !orderId || !transactionId || !courseId || !userId || !priceCents) {
    fail('Marker Marco 5.3 nao possui IDs canonicos suficientes para o smoke.');
  }

  const enrollmentId = sha256(`course-enrollment-v1:${courseId}:${userId}`);
  const [orderBefore, transactionBefore, enrollmentBefore] = await Promise.all([
    getDoc(`orders/${orderId}`),
    getDoc(`payment_transactions/${transactionId}`),
    getDoc(`enrollments/${enrollmentId}`)
  ]);

  if (!orderBefore || !transactionBefore) {
    fail('Order/transaction do smoke Marco 5.3 nao existem mais em staging.');
  }
  if (orderBefore.status !== 'pending_payment' || transactionBefore.status !== 'pending') {
    fail(`Estado financeiro inicial inesperado: order=${orderBefore.status}, transaction=${transactionBefore.status}.`);
  }
  if (enrollmentBefore) {
    fail('Enrollment ja existe antes da confirmacao sandbox; smoke abortado.');
  }
  if (
    orderBefore.currentTransactionId !== transactionId ||
    transactionBefore.providerPaymentId !== paymentId ||
    orderBefore.productId !== courseId ||
    orderBefore.buyerUserId !== userId ||
    orderBefore.amountCents !== priceCents
  ) {
    fail('Estado canonico inicial diverge do marker Marco 5.3.');
  }

  const asaasHeaders = {
    access_token: apiKey,
    'user-agent': 'BJJ-Exams/1.2 (staging-webhook-smoke)',
    accept: 'application/json'
  };

  const paymentResponse = await fetch(`${ASAAS_BASE}/payments/${encodeURIComponent(paymentId)}`, {
    headers: asaasHeaders
  });
  const paymentBefore = await readJson(paymentResponse, 'GET Asaas payment');
  const expectedReference = `BJJEX-V12-ORDER-${orderId}`;
  if (
    paymentBefore.id !== paymentId ||
    paymentBefore.billingType !== 'PIX' ||
    paymentBefore.externalReference !== expectedReference
  ) {
    fail('Cobranca Asaas nao corresponde ao pedido PIX canonico.');
  }
  const providerValueCents = Math.round(Number(paymentBefore.value) * 100);
  if (providerValueCents !== priceCents) {
    fail('Valor da cobranca Asaas diverge do pedido canonico.');
  }
  if (['CONFIRMED', 'RECEIVED'].includes(String(paymentBefore.status || '').toUpperCase())) {
    fail('Cobranca Asaas ja esta paga; este smoke exige uma cobranca pendente para gerar novo webhook.');
  }

  const now = new Date();
  await putDoc(THIS_SMOKE_MARKER, {
    smokeType: 'marco5d-asaas-sandbox-webhook-fulfillment',
    status: 'confirming',
    projectId: EXPECTED_PROJECT,
    environment: 'sandbox',
    sourceSmokeMarker: SOURCE_SMOKE_MARKER,
    orderId,
    transactionId,
    enrollmentId,
    paymentId,
    providerStatusBefore: String(paymentBefore.status || ''),
    createdAt: now,
    updatedAt: now
  });

  try {
    const confirmResponse = await fetch(
      `${ASAAS_BASE}/sandbox/payment/${encodeURIComponent(paymentId)}/confirm`,
      {
        method: 'POST',
        headers: {
          ...asaasHeaders,
          'content-type': 'application/json'
        },
        body: '{}'
      }
    );
    const confirmed = await readJson(confirmResponse, 'POST Asaas sandbox payment confirm');
    const confirmedStatus = String(confirmed.status || '').toUpperCase();
    if (!['CONFIRMED', 'RECEIVED'].includes(confirmedStatus)) {
      fail(`Asaas confirmou operacao, mas status retornado foi ${confirmedStatus || 'vazio'}.`);
    }
    if (confirmed.billingType !== 'PIX') {
      fail(`Asaas alterou billingType inesperadamente para ${confirmed.billingType}.`);
    }

    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let finalOrder = null;
    let finalTransaction = null;
    let finalEnrollment = null;
    let finalEvent = null;

    while (Date.now() < deadline) {
      [finalOrder, finalTransaction, finalEnrollment] = await Promise.all([
        getDoc(`orders/${orderId}`),
        getDoc(`payment_transactions/${transactionId}`),
        getDoc(`enrollments/${enrollmentId}`)
      ]);

      const events = await listWebhookEvents();
      const matchingEvents = events.filter(item =>
        item.provider === 'asaas' &&
        item.providerPaymentId === paymentId &&
        ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(item.eventType)
      );
      finalEvent = matchingEvents.find(item => item.status === 'processed') ||
        matchingEvents[0] ||
        null;

      if (
        finalOrder?.status === 'paid' &&
        finalTransaction?.status === 'paid' &&
        finalEnrollment?.status === 'active' &&
        finalEnrollment?.source === 'order' &&
        finalEnrollment?.orderId === orderId &&
        finalEvent?.status === 'processed'
      ) {
        break;
      }
      await sleep(POLL_INTERVAL_MS);
    }

    if (finalOrder?.status !== 'paid') fail('Order nao convergiu para paid no tempo limite.');
    if (finalTransaction?.status !== 'paid') fail('Transaction nao convergiu para paid no tempo limite.');
    if (!finalEnrollment) fail('Enrollment nao foi criado no tempo limite.');
    if (
      finalEnrollment.status !== 'active' ||
      finalEnrollment.source !== 'order' ||
      finalEnrollment.orderId !== orderId ||
      finalEnrollment.courseId !== courseId ||
      finalEnrollment.userId !== userId
    ) {
      fail('Enrollment criado nao corresponde ao entitlement canonico esperado.');
    }
    if (!finalEvent || finalEvent.status !== 'processed') {
      fail('Webhook event correspondente nao convergiu para processed.');
    }

    await putDoc(THIS_SMOKE_MARKER, {
      smokeType: 'marco5d-asaas-sandbox-webhook-fulfillment',
      status: 'completed',
      projectId: EXPECTED_PROJECT,
      environment: 'sandbox',
      sourceSmokeMarker: SOURCE_SMOKE_MARKER,
      orderId,
      transactionId,
      enrollmentId,
      paymentId,
      providerStatusBefore: String(paymentBefore.status || ''),
      providerStatusAfter: confirmedStatus,
      webhookEventType: finalEvent.eventType,
      webhookEventStatus: finalEvent.status,
      orderStatus: finalOrder.status,
      transactionStatus: finalTransaction.status,
      enrollmentStatus: finalEnrollment.status,
      enrollmentSource: finalEnrollment.source,
      createdAt: now,
      updatedAt: new Date()
    });

    console.log('MARCO5D_STAGING_WEBHOOK_SMOKE=OK');
    console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
    console.log('ASAAS_ENVIRONMENT=sandbox');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log(`PROVIDER_STATUS_BEFORE=${String(paymentBefore.status || '').toUpperCase()}`);
    console.log(`PROVIDER_STATUS_AFTER=${confirmedStatus}`);
    console.log(`WEBHOOK_EVENT_TYPE=${finalEvent.eventType}`);
    console.log(`WEBHOOK_EVENT_STATUS=${finalEvent.status}`);
    console.log(`ORDER_STATUS=${finalOrder.status}`);
    console.log(`TRANSACTION_STATUS=${finalTransaction.status}`);
    console.log(`ENROLLMENT_STATUS=${finalEnrollment.status}`);
    console.log(`ENROLLMENT_SOURCE=${finalEnrollment.source}`);
    console.log('API_KEY_PRINTED=False');
    console.log('WEBHOOK_TOKEN_PRINTED=False');
    console.log('PIX_VALUE_PRINTED=False');
  } catch (error) {
    await putDoc(THIS_SMOKE_MARKER, {
      smokeType: 'marco5d-asaas-sandbox-webhook-fulfillment',
      status: 'failed',
      projectId: EXPECTED_PROJECT,
      environment: 'sandbox',
      sourceSmokeMarker: SOURCE_SMOKE_MARKER,
      orderId,
      transactionId,
      enrollmentId,
      paymentId,
      failure: String(error?.message || 'unknown').slice(0, 300),
      createdAt: now,
      updatedAt: new Date()
    }).catch(() => {});
    throw error;
  }
}

main().catch(error => {
  console.error(`MARCO5D_STAGING_ASAAS_SMOKE=FAILED | ${error.message}`);
  process.exitCode = 1;
});
