'use strict';

const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5f-purchase-ui-ops';
const EXPECTED_COURSE_TITLE = 'Smoke Marco 5.5 - Funding Sandbox';
const EXPECTED_PRICE_CENTS = 2000;

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
    const commandLine = ['gcloud.cmd', ...args.map(escapeCmdArgument)].join(' ');
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

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('referenceValue' in value) return value.referenceValue;
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
    const message = body?.error?.message || body?.error?.status || '';
    fail(`${label} falhou HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }
  return body;
}

function toMillis(value) {
  const millis = new Date(value || 0).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

function enrollmentDocumentId(courseId, userId) {
  return crypto
    .createHash('sha256')
    .update(`course-enrollment-v1:${courseId}:${userId}`)
    .digest('hex');
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
    fail('Worktree precisa estar limpa.');
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
      data: decodeFields(body.fields || {})
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
      if (response.status === 404) return result;
      const body = await readJson(response, `LIST Firestore ${collectionId}`);
      for (const document of body.documents || []) {
        result.push({
          id: String(document.name || '').split('/').pop(),
          data: decodeFields(document.fields || {})
        });
      }
      pageToken = body.nextPageToken || null;
    } while (pageToken);
    return result;
  }

  const users = await listCollection('usuarios');
  const smokeUsers = users
    .filter(entry => (
      entry.data?.smokeTest === true &&
      entry.data?.nome === 'BJJ Exams Smoke UI 5.6' &&
      /^bjjexams-marco5f-ui-.*@example\.test$/i.test(String(entry.data?.email || ''))
    ))
    .sort((left, right) => (
      toMillis(right.data?.createdAt) - toMillis(left.data?.createdAt)
    ));

  if (!smokeUsers.length) {
    fail('Aluno de smoke do Marco 5.6 nao encontrado.');
  }

  const student = smokeUsers[0];
  const userId = student.id;

  const allOrders = await listCollection('orders');
  const userOrders = allOrders.filter(entry => entry.data?.buyerUserId === userId);
  if (userOrders.length !== 1) {
    fail(`Esperado exatamente 1 pedido para o aluno de smoke; encontrado ${userOrders.length}.`);
  }

  const orderEntry = userOrders[0];
  const order = orderEntry.data || {};
  if (
    order.productType !== 'course' ||
    order.status !== 'pending_payment' ||
    order.provider !== 'asaas' ||
    !order.currentTransactionId ||
    Number(order.amountCents) !== EXPECTED_PRICE_CENTS
  ) {
    fail('Pedido do smoke nao esta no estado pending_payment esperado.');
  }

  const course = await getDoc(`courses/${order.productId}`);
  if (!course) fail('Curso do pedido nao encontrado.');
  if (
    course.data?.title !== EXPECTED_COURSE_TITLE ||
    course.data?.status !== 'published' ||
    course.data?.isPaid !== true ||
    Number(course.data?.priceCents) !== EXPECTED_PRICE_CENTS
  ) {
    fail('Pedido nao pertence ao curso Funding Sandbox esperado.');
  }

  const allTransactions = await listCollection('payment_transactions');
  const orderTransactions = allTransactions.filter(
    entry => entry.data?.orderId === orderEntry.id
  );
  if (orderTransactions.length !== 1) {
    fail(`Esperado exatamente 1 transacao para o pedido; encontrado ${orderTransactions.length}.`);
  }

  const transactionEntry = orderTransactions[0];
  const transaction = transactionEntry.data || {};
  if (
    transactionEntry.id !== order.currentTransactionId ||
    transaction.status !== 'pending' ||
    transaction.provider !== 'asaas' ||
    !transaction.providerPaymentId
  ) {
    fail('Transacao do smoke nao esta no estado pending esperado.');
  }

  const expectedEnrollmentId = enrollmentDocumentId(order.productId, userId);
  const enrollment = await getDoc(`enrollments/${expectedEnrollmentId}`);
  if (enrollment) {
    fail('Checkout pendente criou enrollment indevidamente.');
  }

  const allEnrollments = await listCollection('enrollments');
  const matchingEnrollments = allEnrollments.filter(entry => (
    entry.data?.courseId === order.productId &&
    entry.data?.userId === userId
  ));
  if (matchingEnrollments.length !== 0) {
    fail('Foi encontrado enrollment inesperado para o aluno/curso do smoke.');
  }

  console.log('MARCO5F_UI_PENDING_VERIFY=OK');
  console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
  console.log('PRODUCTION_ACCESS=NOT_RUN');
  console.log('SMOKE_STUDENT_FOUND=True');
  console.log('COURSE_MATCH=True');
  console.log('ORDER_COUNT=1');
  console.log('ORDER_STATUS=pending_payment');
  console.log('TRANSACTION_COUNT=1');
  console.log('TRANSACTION_STATUS=pending');
  console.log('PROVIDER_PAYMENT_ID_PRESENT=True');
  console.log('ENROLLMENT_COUNT=0');
  console.log('RELOAD_DUPLICATED_ORDER=False');
  console.log('RELOAD_DUPLICATED_TRANSACTION=False');
  console.log('REMOTE_READ_ONLY=True');
  console.log('STAGING_WRITE_PERFORMED=False');
  console.log('SECRET_VALUE_PRINTED=False');
  console.log('PROVIDER_ID_PRINTED=False');
}

main().catch(error => {
  console.error(`MARCO5F_UI_PENDING_VERIFY=FAILED | ${error.message}`);
  process.exitCode = 1;
});
