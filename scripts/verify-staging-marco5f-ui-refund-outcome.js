'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5f-purchase-ui-ops';
const SMOKE_USER_NAME = 'BJJ Exams Smoke UI 5.6';
const REFUND_COURSE_TITLE = 'Smoke Marco 5.5 - Refund Sandbox';
const REFUND_PRICE_CENTS = 500;

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
    executable = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
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
  try { body = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) {
    const message = body?.error?.message || body?.error?.status || '';
    fail(`${label} falhou HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }
  return body;
}

function toMillis(value) {
  const millis = Date.parse(String(value || ''));
  return Number.isFinite(millis) ? millis : 0;
}

async function main() {
  if (EXPECTED_PROJECT === PRODUCTION_PROJECT) {
    fail('Projeto alvo nao pode ser producao.');
  }

  const branch = command('git', ['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  }

  if (command('git', ['status', '--short'])) {
    fail('Working tree precisa estar limpa.');
  }

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
  if (!accessToken) fail('Access token gcloud ausente.');

  const firestoreBase =
    `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)/documents`;
  const headers = { authorization: `Bearer ${accessToken}` };

  function docUrl(path) {
    return `${firestoreBase}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function getDoc(path) {
    const response = await fetch(docUrl(path), { headers });
    if (response.status === 404) return null;
    const body = await readJson(response, `GET Firestore ${path}`);
    return {
      id: String(body.name || '').split('/').pop(),
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
      const body = await readJson(
        await fetch(url, { headers }),
        `LIST Firestore ${collectionId}`
      );
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

  const users = (await listCollection('usuarios'))
    .filter(entry =>
      entry.data?.smokeTest === true &&
      entry.data?.nome === SMOKE_USER_NAME &&
      String(entry.data?.tipo_usuario || '').toLowerCase() === 'aluno'
    )
    .sort((a, b) => toMillis(b.data?.createdAt) - toMillis(a.data?.createdAt));

  if (!users.length) fail('Aluno de smoke Marco 5.6 nao encontrado.');
  const buyer = users[0];

  const allOrders = await listCollection('orders');
  const candidateOrders = [];
  for (const entry of allOrders) {
    if (
      entry.data?.buyerUserId !== buyer.id ||
      entry.data?.productType !== 'course' ||
      Number(entry.data?.amountCents) !== REFUND_PRICE_CENTS
    ) {
      continue;
    }

    const courseId = String(entry.data?.productId || '').trim();
    if (!courseId) continue;
    const course = await getDoc(`courses/${courseId}`);
    if (course?.data?.title === REFUND_COURSE_TITLE) {
      candidateOrders.push({ order: entry, course });
    }
  }

  if (candidateOrders.length < 2) {
    fail(`Esperados ao menos 2 pedidos Refund do smoke; encontrados ${candidateOrders.length}.`);
  }

  const cancelledOrders = candidateOrders.filter(item => item.order.data?.status === 'cancelled');
  const paidOrders = candidateOrders
    .filter(item => item.order.data?.status === 'paid')
    .sort((a, b) => toMillis(b.order.data?.updatedAt || b.order.data?.createdAt) - toMillis(a.order.data?.updatedAt || a.order.data?.createdAt));

  if (cancelledOrders.length < 1) fail('Pedido Refund cancelado anterior nao encontrado.');
  if (paidOrders.length !== 1) {
    fail(`Esperado exatamente 1 pedido Refund pago atual; encontrados ${paidOrders.length}.`);
  }

  const target = paidOrders[0];
  const order = target.order.data || {};
  const transactionId = String(order.currentTransactionId || '').trim();
  if (!transactionId) fail('Pedido pago nao possui currentTransactionId.');

  const transaction = await getDoc(`payment_transactions/${transactionId}`);
  if (!transaction || transaction.data?.status !== 'paid') {
    fail(`Transacao alvo precisa permanecer paid; atual=${transaction?.data?.status || 'missing'}.`);
  }

  const enrollmentId = sha256(`course-enrollment-v1:${target.course.id}:${buyer.id}`);
  const enrollment = await getDoc(`enrollments/${enrollmentId}`);
  if (!enrollment || !['active', 'completed'].includes(enrollment.data?.status)) {
    fail(`Enrollment alvo precisa permanecer active/completed; atual=${enrollment?.data?.status || 'missing'}.`);
  }

  const requestId = sha256(`financial-reversal-request-v1:refund_full:${transactionId}`);
  const request = await getDoc(`financial_reversal_requests/${requestId}`);
  if (!request) fail('Solicitacao de estorno integral nao encontrada.');

  const requestData = request.data || {};
  if (
    requestData.operation !== 'refund_full' ||
    requestData.orderId !== target.order.id ||
    requestData.transactionId !== transactionId ||
    requestData.status !== 'needs_reconciliation'
  ) {
    fail('Solicitacao de estorno nao esta no estado needs_reconciliation esperado.');
  }

  const lifecycle = String(requestData.providerLifecycleStatus || '').trim();
  const errorCode = String(requestData.errorCode || '').trim();
  let outcome;
  let expectedEventType;

  if (lifecycle === 'denied' && errorCode === 'REVERSAL_PROVIDER_REFUND_DENIED') {
    outcome = 'REFUND_DENIED';
    expectedEventType = 'PAYMENT_REFUND_DENIED';
  } else if (
    lifecycle === 'partial_refund' &&
    errorCode === 'REVERSAL_PROVIDER_PARTIAL_REFUND'
  ) {
    outcome = 'PARTIAL_REFUND_REVIEW';
    expectedEventType = 'PAYMENT_PARTIALLY_REFUNDED';
  } else {
    fail(
      `Lifecycle de reconciliacao inesperado: ${lifecycle || '<EMPTY>'}/${errorCode || '<EMPTY>'}.`
    );
  }

  const webhookEventId = String(requestData.lastWebhookEventId || '').trim();
  if (!webhookEventId) fail('Solicitacao reconciliada nao possui lastWebhookEventId.');

  const event = await getDoc(`payment_webhook_events/${webhookEventId}`);
  if (
    !event ||
    event.data?.status !== 'processed' ||
    event.data?.eventType !== expectedEventType ||
    event.data?.orderId !== target.order.id ||
    event.data?.transactionId !== transactionId
  ) {
    fail('Webhook terminal de reconciliacao nao corresponde ao pedido/transacao alvo.');
  }

  console.log('MARCO5F_UI_REFUND_OUTCOME_VERIFY=OK');
  console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
  console.log('PRODUCTION_ACCESS=NOT_RUN');
  console.log('COURSE_MATCH=True');
  console.log(`COURSE_ORDER_COUNT=${candidateOrders.length}`);
  console.log(`PRIOR_CANCELLED_ORDER_COUNT=${cancelledOrders.length}`);
  console.log('TARGET_ORDER_STATUS=paid');
  console.log('TARGET_TRANSACTION_STATUS=paid');
  console.log(`TARGET_ENROLLMENT_STATUS=${enrollment.data.status}`);
  console.log('REVERSAL_OPERATION=refund_full');
  console.log('REVERSAL_REQUEST_STATUS=needs_reconciliation');
  console.log(`REVERSAL_PROVIDER_LIFECYCLE_STATUS=${lifecycle}`);
  console.log(`REVERSAL_ERROR_CODE=${errorCode}`);
  console.log(`REFUND_OUTCOME=${outcome}`);
  console.log(`WEBHOOK_EVENT_TYPE=${expectedEventType}`);
  console.log('WEBHOOK_EVENT_STATUS=processed');
  console.log('FALSE_REFUND_SUCCESS_REPORTED=False');
  console.log('REMOTE_READ_ONLY=True');
  console.log('STAGING_WRITE_PERFORMED=False');
  console.log('SECRET_VALUE_PRINTED=False');
  console.log('PROVIDER_ID_PRINTED=False');
}

main().catch(error => {
  console.error(`MARCO5F_UI_REFUND_OUTCOME_VERIFY=FAILED | ${error.message}`);
  process.exitCode = 1;
});
