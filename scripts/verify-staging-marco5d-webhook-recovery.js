'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5d-webhook-fulfillment';
const ASAAS_BASE = 'https://api-sandbox.asaas.com/v3';
const SOURCE_SMOKE_MARKER = 'smoke_runs/marco5c-asaas-sandbox-v1';
const MARCO5D_SMOKE_MARKER = 'smoke_runs/marco5d-webhook-sandbox-v1';

function fail(message) {
  throw new Error(message);
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

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) {
    return (value.arrayValue.values || []).map(decodeValue);
  }
  if ('mapValue' in value) {
    return decodeFields(value.mapValue.fields || {});
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
  if (process.env.BJJ_EXAMS_ALLOW_STAGING_WEBHOOK_RECOVERY_VERIFY !== 'true') {
    fail('Verificacao bloqueada. Defina BJJ_EXAMS_ALLOW_STAGING_WEBHOOK_RECOVERY_VERIFY=true somente para staging.');
  }

  const branch = command('git', ['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  }

  const dirty = command('git', ['status', '--short']);
  if (dirty) fail('Worktree precisa estar limpa antes da verificacao.');

  const localHead = command('git', ['rev-parse', 'HEAD']);
  const remoteHead = command('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`]);
  if (localHead !== remoteHead) {
    fail('HEAD local diverge do remoto. Faca pull antes da verificacao.');
  }

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

  const [source, marco5dMarker] = await Promise.all([
    getDoc(SOURCE_SMOKE_MARKER),
    getDoc(MARCO5D_SMOKE_MARKER)
  ]);

  if (!source || source.status !== 'completed') {
    fail('Marker concluido do Marco 5.3 nao foi encontrado.');
  }
  if (!marco5dMarker) {
    fail('Marker do smoke Marco 5.4 nao foi encontrado.');
  }

  const paymentId = String(source.paymentId || '').trim();
  const orderId = String(source.orderId || '').trim();
  const transactionId = String(source.transactionId || '').trim();
  const courseId = String(source.courseId || '').trim();
  const userId = String(source.userId || '').trim();
  const priceCents = Number(source.priceCents || 0);
  if (!paymentId || !orderId || !transactionId || !courseId || !userId || !priceCents) {
    fail('Marker Marco 5.3 nao possui IDs canonicos suficientes.');
  }

  const enrollmentId = sha256(`course-enrollment-v1:${courseId}:${userId}`);
  const [order, transaction, enrollment, allEvents] = await Promise.all([
    getDoc(`orders/${orderId}`),
    getDoc(`payment_transactions/${transactionId}`),
    getDoc(`enrollments/${enrollmentId}`),
    listWebhookEvents()
  ]);

  if (!order || !transaction || !enrollment) {
    fail('Estado final canonico incompleto: order/transaction/enrollment obrigatorios.');
  }

  if (order.status !== 'paid') fail(`Order final inesperada: ${order.status}.`);
  if (transaction.status !== 'paid') {
    fail(`Transaction final inesperada: ${transaction.status}.`);
  }
  if (
    enrollment.status !== 'active' ||
    enrollment.source !== 'order' ||
    enrollment.orderId !== orderId ||
    enrollment.courseId !== courseId ||
    enrollment.userId !== userId
  ) {
    fail('Enrollment final nao corresponde ao entitlement canonico esperado.');
  }

  const matchingEvents = allEvents.filter(item =>
    item.provider === 'asaas' &&
    item.providerPaymentId === paymentId &&
    ['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED'].includes(item.eventType)
  );

  const processedEvents = matchingEvents.filter(item => item.status === 'processed');
  if (processedEvents.length < 1) {
    const summary = matchingEvents
      .map(item => `${item.eventType}:${item.status}:${item.errorCode || '-'}`)
      .join(', ');
    fail(`Nenhum evento processado encontrado. Eventos correlatos: ${summary || 'nenhum'}.`);
  }

  const expectedReference = `BJJEX-V12-ORDER-${orderId}`;
  const asaasResponse = await fetch(
    `${ASAAS_BASE}/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        access_token: apiKey,
        'user-agent': 'BJJ-Exams/1.2 (staging-webhook-recovery-verify)',
        accept: 'application/json'
      }
    }
  );
  const payment = await readJson(asaasResponse, 'GET Asaas payment');
  const providerStatus = String(payment.status || '').toUpperCase();
  if (!['CONFIRMED', 'RECEIVED'].includes(providerStatus)) {
    fail(`Cobranca Asaas nao esta confirmada: ${providerStatus || 'vazio'}.`);
  }
  if (
    payment.id !== paymentId ||
    payment.billingType !== 'PIX' ||
    payment.externalReference !== expectedReference ||
    Math.round(Number(payment.value) * 100) !== priceCents
  ) {
    fail('Cobranca Asaas atual diverge do pedido canonico.');
  }

  const eventSummary = matchingEvents
    .map(item => `${item.eventType}:${item.status}`)
    .join(',');

  console.log('MARCO5D_STAGING_WEBHOOK_RECOVERY_VERIFY=OK');
  console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
  console.log('ASAAS_ENVIRONMENT=sandbox');
  console.log('PRODUCTION_ACCESS=NOT_RUN');
  console.log(`PREVIOUS_SMOKE_MARKER_STATUS=${marco5dMarker.status || 'unknown'}`);
  console.log(`PROVIDER_STATUS=${providerStatus}`);
  console.log(`MATCHING_WEBHOOK_EVENTS=${matchingEvents.length}`);
  console.log(`PROCESSED_WEBHOOK_EVENTS=${processedEvents.length}`);
  console.log(`WEBHOOK_EVENT_SUMMARY=${eventSummary}`);
  console.log(`ORDER_STATUS=${order.status}`);
  console.log(`TRANSACTION_STATUS=${transaction.status}`);
  console.log(`ENROLLMENT_STATUS=${enrollment.status}`);
  console.log(`ENROLLMENT_SOURCE=${enrollment.source}`);
  console.log('ASAAS_MUTATION_PERFORMED=False');
  console.log('FIRESTORE_WRITE_PERFORMED=False');
  console.log('API_KEY_PRINTED=False');
  console.log('WEBHOOK_TOKEN_PRINTED=False');
}

main().catch(error => {
  console.error(`MARCO5D_STAGING_WEBHOOK_RECOVERY_VERIFY=FAILED | ${error.message}`);
  process.exitCode = 1;
});
