'use strict';

const { execFileSync } = require('node:child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5e-refund-chargeback';
const ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
const ASAAS_API_SECRET = 'ASAAS_API_KEY';
const EXPECTED_API_KEY_PREFIX = '$aact_hmlg_';
const WEBHOOK_ID = 'a771d6d6-a928-4dfe-bcf6-0ba3c34b32bc';
const SMOKE_MARKER_PATH = 'smoke_runs/marco5e-refund-sandbox-v1';

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
      '/d',
      '/s',
      '/c',
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
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch (_) {
    fail(`${label} retornou JSON invalido.`);
  }
  if (!response.ok) {
    const summary =
      body?.error?.message ||
      body?.message ||
      body?.errors?.map(item => item?.description || item?.code).filter(Boolean).join('; ') ||
      `HTTP ${response.status}`;
    fail(`${label} falhou: ${summary}`);
  }
  return body;
}

async function main() {
  if (EXPECTED_PROJECT === PRODUCTION_PROJECT) {
    fail('Projeto alvo nao pode ser producao.');
  }

  const branch = command('git', ['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  }

  const dirty = command('git', ['status', '--short']);
  if (dirty) fail('Worktree precisa estar limpa para o diagnostico.');

  command('git', ['fetch', 'origin', EXPECTED_BRANCH]);
  const localHead = command('git', ['rev-parse', 'HEAD']);
  const remoteHead = command('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`]);
  if (localHead !== remoteHead) {
    fail('HEAD local precisa coincidir com o remoto.');
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

  let asaasApiKey = command('gcloud', [
    'secrets', 'versions', 'access', 'latest',
    `--secret=${ASAAS_API_SECRET}`,
    `--project=${EXPECTED_PROJECT}`
  ]);

  try {
    if (!asaasApiKey.startsWith(EXPECTED_API_KEY_PREFIX)) {
      fail('ASAAS_API_KEY nao possui prefixo Sandbox esperado.');
    }

    const firestoreBase =
      `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)/documents`;

    function docUrl(path) {
      return `${firestoreBase}/${path.split('/').map(encodeURIComponent).join('/')}`;
    }

    async function getDoc(path) {
      const response = await fetch(docUrl(path), {
        headers: { authorization: `Bearer ${accessToken}` }
      });
      if (response.status === 404) return null;
      const body = await readJson(response, `GET Firestore ${path}`);
      return {
        id: String(body.name || '').split('/').pop(),
        data: decodeFirestoreFields(body.fields || {})
      };
    }

    async function listCollection(collectionId) {
      const docs = [];
      let pageToken = null;
      do {
        const url = new URL(`${firestoreBase}/${collectionId}`);
        url.searchParams.set('pageSize', '200');
        if (pageToken) url.searchParams.set('pageToken', pageToken);
        const body = await readJson(
          await fetch(url, {
            headers: { authorization: `Bearer ${accessToken}` }
          }),
          `LIST Firestore ${collectionId}`
        );
        for (const document of body.documents || []) {
          docs.push({
            id: String(document.name || '').split('/').pop(),
            data: decodeFirestoreFields(document.fields || {})
          });
        }
        pageToken = body.nextPageToken || null;
      } while (pageToken);
      return docs;
    }

    async function asaas(pathname) {
      return readJson(
        await fetch(`${ASAAS_BASE_URL}${pathname}`, {
          headers: {
            accept: 'application/json',
            access_token: asaasApiKey
          }
        }),
        `Asaas GET ${pathname}`
      );
    }

    const marker = await getDoc(SMOKE_MARKER_PATH);
    if (!marker) fail('Marker do smoke de refund nao foi encontrado.');
    const targetCourseId = String(marker.data.targetCourseId || '').trim();
    if (!targetCourseId) fail('Marker nao possui targetCourseId.');

    const orders = await listCollection('orders');
    const matchingOrders = orders.filter(item => item.data.productId === targetCourseId);
    if (matchingOrders.length !== 1) {
      fail(`Esperado exatamente 1 order do smoke; encontrado ${matchingOrders.length}.`);
    }
    const order = matchingOrders[0];
    const transactionId = String(order.data.currentTransactionId || '').trim();
    if (!transactionId) fail('Order nao possui currentTransactionId.');

    const transaction = await getDoc(`payment_transactions/${transactionId}`);
    if (!transaction) fail('Transacao canonica do smoke nao foi encontrada.');
    const providerPaymentId = String(transaction.data.providerPaymentId || '').trim();
    if (!providerPaymentId) fail('Transacao nao possui providerPaymentId.');

    const [enrollments, reversalRequests, webhookEvents] = await Promise.all([
      listCollection('enrollments'),
      listCollection('financial_reversal_requests'),
      listCollection('payment_webhook_events')
    ]);

    const enrollment = enrollments.find(item => item.data.orderId === order.id) ||
      enrollments.find(item =>
        item.data.courseId === targetCourseId &&
        item.data.userId === order.data.buyerUserId
      ) || null;

    const reversal = reversalRequests.find(item => item.data.transactionId === transactionId) || null;
    const relatedEvents = webhookEvents
      .filter(item => item.data.providerPaymentId === providerPaymentId)
      .sort((a, b) => String(a.data.providerEventCreatedAt || '').localeCompare(String(b.data.providerEventCreatedAt || '')));

    const [payment, refunds, webhook] = await Promise.all([
      asaas(`/payments/${encodeURIComponent(providerPaymentId)}`),
      asaas(`/payments/${encodeURIComponent(providerPaymentId)}/refunds`),
      asaas(`/webhooks/${encodeURIComponent(WEBHOOK_ID)}`)
    ]);

    const refundItems = Array.isArray(refunds?.data)
      ? refunds.data
      : Array.isArray(refunds)
        ? refunds
        : [];
    const refundStatuses = [...new Set(
      refundItems
        .map(item => String(item?.status || '').trim().toUpperCase())
        .filter(Boolean)
    )].sort();
    const eventTypes = relatedEvents.map(item =>
      `${String(item.data.eventType || 'UNKNOWN')}:${String(item.data.status || 'UNKNOWN')}`
    );

    console.log('MARCO5E_STAGING_REFUND_DIAG=OK');
    console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
    console.log('ASAAS_ENVIRONMENT=sandbox');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log(`SMOKE_MARKER_STATUS=${marker.data.status || 'unknown'}`);
    console.log(`ORDER_STATUS=${order.data.status || 'unknown'}`);
    console.log(`TRANSACTION_STATUS=${transaction.data.status || 'unknown'}`);
    console.log(`ENROLLMENT_STATUS=${enrollment?.data.status || 'missing'}`);
    console.log(`REVERSAL_REQUEST_STATUS=${reversal?.data.status || 'missing'}`);
    console.log(`REVERSAL_PROVIDER_RESULT_STATUS=${reversal?.data.providerResultStatus || 'null'}`);
    console.log(`ASAAS_PAYMENT_STATUS=${String(payment?.status || 'unknown').toUpperCase()}`);
    console.log(`ASAAS_REFUND_COUNT=${refundItems.length}`);
    console.log(`ASAAS_REFUND_STATUSES=${refundStatuses.length ? refundStatuses.join(',') : 'none'}`);
    console.log(`WEBHOOK_ENABLED=${webhook?.enabled === true ? 'True' : 'False'}`);
    console.log(`WEBHOOK_INTERRUPTED=${webhook?.interrupted === true ? 'True' : 'False'}`);
    console.log(`WEBHOOK_HAS_PAYMENT_REFUNDED=${Array.isArray(webhook?.events) && webhook.events.includes('PAYMENT_REFUNDED') ? 'True' : 'False'}`);
    console.log(`TARGET_WEBHOOK_EVENTS=${eventTypes.length ? eventTypes.join(',') : 'none'}`);
    console.log(`PAYMENT_REFUNDED_EVENT_PRESENT=${relatedEvents.some(item => item.data.eventType === 'PAYMENT_REFUNDED') ? 'True' : 'False'}`);
    console.log(`PAYMENT_REFUND_IN_PROGRESS_EVENT_PRESENT=${relatedEvents.some(item => item.data.eventType === 'PAYMENT_REFUND_IN_PROGRESS') ? 'True' : 'False'}`);
    console.log('API_KEY_PRINTED=False');
    console.log('PROVIDER_PAYMENT_ID_PRINTED=False');
    console.log('REMOTE_READ_ONLY=True');
    console.log('STAGING_WRITE_PERFORMED=False');
  } finally {
    asaasApiKey = null;
  }
}

main().catch(error => {
  console.error(`MARCO5E_STAGING_REFUND_DIAG=FAILED | ${error.message}`);
  process.exitCode = 1;
});
