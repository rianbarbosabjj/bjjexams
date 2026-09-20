'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5f-purchase-ui-ops';
const REGION = 'southamerica-east1';
const WEBHOOK_FUNCTION = 'webhookAsaasPagamentosV12';
const ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
const ASAAS_API_SECRET = 'ASAAS_API_KEY';
const EXPECTED_API_KEY_PREFIX = '$aact_hmlg_';
const WEBHOOK_ID = 'a771d6d6-a928-4dfe-bcf6-0ba3c34b32bc';
const SMOKE_USER_NAME = 'BJJ Exams Smoke UI 5.6';
const FUNDING_COURSE_TITLE = 'Smoke Marco 5.5 - Funding Sandbox';
const FUNDING_PRICE_CENTS = 2000;
const ALLOW_ENV = 'BJJ_EXAMS_ALLOW_ASAAS_SANDBOX_UI_PAYMENT_CONFIRM';
const TIMEOUT_MS = 180000;
const POLL_MS = 1000;

function fail(message) {
  throw new Error(message);
}

function bool(value) {
  return value ? 'True' : 'False';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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

function readSecret(name) {
  return command('gcloud', [
    'secrets', 'versions', 'access', 'latest',
    `--secret=${name}`,
    `--project=${EXPECTED_PROJECT}`
  ]);
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
  } catch (_) {}

  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.error?.status ||
      body?.message ||
      body?.errors?.map(item => item?.description || item?.code)
        .filter(Boolean)
        .join('; ') ||
      '';
    fail(`${label} falhou HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }

  return body;
}

function timeValue(value) {
  const millis = Date.parse(String(value || ''));
  return Number.isFinite(millis) ? millis : 0;
}

async function main() {
  if (process.env[ALLOW_ENV] !== 'true') {
    fail(`Confirmacao Sandbox bloqueada. Defina ${ALLOW_ENV}=true somente para este smoke em staging.`);
  }

  if (EXPECTED_PROJECT === PRODUCTION_PROJECT) {
    fail('Projeto alvo nao pode ser producao.');
  }

  const branch = command('git', ['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  }

  if (command('git', ['status', '--short'])) {
    fail('Working tree precisa estar limpa antes da confirmacao Sandbox.');
  }

  command('git', ['fetch', 'origin', EXPECTED_BRANCH]);
  const localHead = command('git', ['rev-parse', 'HEAD']);
  const remoteHead = command('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`]);
  if (localHead !== remoteHead) {
    fail('HEAD local precisa coincidir com o remoto antes da confirmacao Sandbox.');
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

  let asaasApiKey = null;
  try {
    asaasApiKey = readSecret(ASAAS_API_SECRET);
    if (!asaasApiKey.startsWith(EXPECTED_API_KEY_PREFIX)) {
      fail('ASAAS_API_KEY nao possui prefixo Sandbox esperado.');
    }

    const webhookDescription = JSON.parse(command('gcloud', [
      'functions', 'describe', WEBHOOK_FUNCTION,
      '--gen2',
      `--region=${REGION}`,
      `--project=${EXPECTED_PROJECT}`,
      '--format=json'
    ]));

    if (webhookDescription?.state !== 'ACTIVE') {
      fail('Webhook ingress de staging nao esta ACTIVE.');
    }

    const webhookUri = String(webhookDescription?.serviceConfig?.uri || '').trim();
    if (!webhookUri || webhookUri.includes(PRODUCTION_PROJECT)) {
      fail('URI do webhook ingress de staging invalida.');
    }

    async function asaas(pathname, options = {}) {
      return readJson(
        await fetch(`${ASAAS_BASE_URL}${pathname}`, {
          ...options,
          headers: {
            accept: 'application/json',
            access_token: asaasApiKey,
            ...(options.body ? { 'content-type': 'application/json' } : {}),
            ...(options.headers || {})
          }
        }),
        `Asaas ${options.method || 'GET'} ${pathname}`
      );
    }

    const webhook = await asaas(`/webhooks/${encodeURIComponent(WEBHOOK_ID)}`);
    const webhookEvents = new Set(Array.isArray(webhook?.events) ? webhook.events.map(String) : []);
    if (
      webhook?.enabled !== true ||
      webhook?.interrupted !== false ||
      String(webhook?.url || '').trim() !== webhookUri ||
      !webhookEvents.has('PAYMENT_CONFIRMED') ||
      !webhookEvents.has('PAYMENT_RECEIVED')
    ) {
      fail('Webhook Sandbox nao esta pronto para confirmar pagamento do smoke.');
    }

    const firestoreBase =
      `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)/documents`;
    const firestoreHeaders = { authorization: `Bearer ${accessToken}` };

    function docUrl(path) {
      const encoded = path.split('/').map(encodeURIComponent).join('/');
      return `${firestoreBase}/${encoded}`;
    }

    async function getDoc(path) {
      const response = await fetch(docUrl(path), { headers: firestoreHeaders });
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
          await fetch(url, { headers: firestoreHeaders }),
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
      .sort((a, b) => timeValue(b.data?.createdAt) - timeValue(a.data?.createdAt));

    if (users.length < 1) fail('Aluno de smoke Marco 5.6 nao encontrado.');
    const buyer = users[0];

    const buyerOrders = (await listCollection('orders'))
      .filter(entry =>
        entry.data?.buyerUserId === buyer.id &&
        entry.data?.productType === 'course'
      );

    const matching = [];
    for (const entry of buyerOrders) {
      const courseId = String(entry.data?.productId || '').trim();
      if (!courseId) continue;
      const course = await getDoc(`courses/${courseId}`);
      if (
        course?.data?.title === FUNDING_COURSE_TITLE &&
        Number(entry.data?.amountCents) === FUNDING_PRICE_CENTS
      ) {
        matching.push({ order: entry, course });
      }
    }

    if (matching.length !== 1) {
      fail(`Esperado exatamente 1 pedido Funding do aluno de smoke; encontrado ${matching.length}.`);
    }

    const orderEntry = matching[0].order;
    const courseId = matching[0].course.id;
    const order = orderEntry.data || {};
    if (order.status !== 'pending_payment') {
      fail(`Pedido Funding nao esta pending_payment: ${order.status || '<EMPTY>'}.`);
    }

    const transactionId = String(order.currentTransactionId || '').trim();
    if (!transactionId) fail('Pedido pendente nao possui currentTransactionId.');

    const transactionEntry = await getDoc(`payment_transactions/${transactionId}`);
    if (!transactionEntry) fail('Transacao canonica nao encontrada.');
    const transaction = transactionEntry.data || {};
    if (transaction.status !== 'pending') {
      fail(`Transacao nao esta pending: ${transaction.status || '<EMPTY>'}.`);
    }

    const providerPaymentId = String(transaction.providerPaymentId || '').trim();
    if (!providerPaymentId) fail('Transacao pending nao possui providerPaymentId.');

    const enrollmentId = sha256(`course-enrollment-v1:${courseId}:${buyer.id}`);
    const enrollmentBefore = await getDoc(`enrollments/${enrollmentId}`);
    if (enrollmentBefore) {
      fail('Enrollment ja existe antes da confirmacao do pagamento.');
    }

    await asaas(`/sandbox/payment/${encodeURIComponent(providerPaymentId)}/confirm`, {
      method: 'POST'
    });

    const deadline = Date.now() + TIMEOUT_MS;
    let finalState = null;
    while (Date.now() < deadline) {
      const [nextOrder, nextTransaction, nextEnrollment] = await Promise.all([
        getDoc(`orders/${orderEntry.id}`),
        getDoc(`payment_transactions/${transactionId}`),
        getDoc(`enrollments/${enrollmentId}`)
      ]);

      finalState = {
        order: nextOrder?.data || null,
        transaction: nextTransaction?.data || null,
        enrollment: nextEnrollment?.data || null
      };

      if (
        finalState.order?.status === 'paid' &&
        finalState.transaction?.status === 'paid' &&
        finalState.enrollment?.status === 'active' &&
        finalState.enrollment?.source === 'order' &&
        finalState.enrollment?.orderId === orderEntry.id
      ) {
        break;
      }

      await sleep(POLL_MS);
    }

    if (
      finalState?.order?.status !== 'paid' ||
      finalState?.transaction?.status !== 'paid' ||
      finalState?.enrollment?.status !== 'active' ||
      finalState?.enrollment?.source !== 'order' ||
      finalState?.enrollment?.orderId !== orderEntry.id
    ) {
      fail(
        'Timeout aguardando fulfillment. ' +
        `order=${finalState?.order?.status || 'missing'}, ` +
        `transaction=${finalState?.transaction?.status || 'missing'}, ` +
        `enrollment=${finalState?.enrollment?.status || 'missing'}`
      );
    }

    const finalBuyerOrders = (await listCollection('orders'))
      .filter(entry =>
        entry.data?.buyerUserId === buyer.id &&
        entry.data?.productType === 'course' &&
        entry.data?.productId === courseId
      );

    const finalBuyerTransactions = (await listCollection('payment_transactions'))
      .filter(entry => entry.data?.orderId === orderEntry.id);

    console.log('MARCO5F_UI_PAYMENT_CONFIRM=OK');
    console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
    console.log('ASAAS_ENVIRONMENT=sandbox');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('WEBHOOK_READY=True');
    console.log('PAYMENT_CONFIRMATION_REQUESTED=True');
    console.log(`ORDER_COUNT=${finalBuyerOrders.length}`);
    console.log(`ORDER_STATUS=${finalState.order.status}`);
    console.log(`TRANSACTION_COUNT=${finalBuyerTransactions.length}`);
    console.log(`TRANSACTION_STATUS=${finalState.transaction.status}`);
    console.log('ENROLLMENT_COUNT=1');
    console.log(`ENROLLMENT_STATUS=${finalState.enrollment.status}`);
    console.log(`ENROLLMENT_SOURCE=${finalState.enrollment.source}`);
    console.log(`ENTITLEMENT_GRANTED=${bool(finalState.enrollment.status === 'active')}`);
    console.log(`DUPLICATED_ORDER=${bool(finalBuyerOrders.length !== 1)}`);
    console.log(`DUPLICATED_TRANSACTION=${bool(finalBuyerTransactions.length !== 1)}`);
    console.log('SECRET_VALUE_PRINTED=False');
    console.log('PROVIDER_ID_PRINTED=False');
  } finally {
    asaasApiKey = null;
  }
}

main().catch(error => {
  console.error(`MARCO5F_UI_PAYMENT_CONFIRM=FAILED | ${error.message}`);
  process.exitCode = 1;
});
