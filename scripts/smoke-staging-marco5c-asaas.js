'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5c-asaas-sandbox-checkout';
const REGION = 'southamerica-east1';
const FUNCTION_NAME = 'iniciarCheckoutCursoV12';
const WEB_APP_ID = '1:206338587822:web:d870ac4cf23b6a1b6f813f';
const SMOKE_MARKER_PATH = 'smoke_runs/marco5c-asaas-sandbox-v1';
const PRICE_CENTS = 1000;

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
    const providerMessage = body?.error?.message || body?.error?.status || '';
    fail(`${label} falhou HTTP ${response.status}${providerMessage ? `: ${providerMessage}` : ''}`);
  }
  return body;
}

async function main() {
  if (process.env.BJJ_EXAMS_ALLOW_ASAAS_SANDBOX_SMOKE !== 'true') {
    fail('Smoke real bloqueado. Defina BJJ_EXAMS_ALLOW_ASAAS_SANDBOX_SMOKE=true somente para o Asaas Sandbox.');
  }

  const branch = command('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch invalida para smoke: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  }

  const dirty = command('git', ['status', '--short']);
  if (dirty) fail('Worktree precisa estar limpa antes do smoke real.');

  const project = command('gcloud', [
    'projects', 'describe', EXPECTED_PROJECT,
    '--format=value(projectId)'
  ]);
  if (project !== EXPECTED_PROJECT || project === PRODUCTION_PROJECT) {
    fail('Projeto staging nao confirmado.');
  }

  const accessToken = command('gcloud', ['auth', 'print-access-token']);
  if (!accessToken) fail('Nao foi possivel obter access token do gcloud.');

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

  const existingMarker = await getDoc(SMOKE_MARKER_PATH);
  if (existingMarker) {
    console.log('MARCO5C_STAGING_ASAAS_SMOKE=BLOCKED_ALREADY_STARTED');
    console.log(`SMOKE_MARKER_STATUS=${existingMarker.data.status || 'unknown'}`);
    console.log('NEW_ASAAS_CALLS_PERFORMED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    process.exitCode = 2;
    return;
  }

  const defaultRule = await getDoc('financial_rules/platform-default');
  if (!defaultRule) {
    fail('Regra financial_rules/platform-default nao esta persistida em staging.');
  }
  if (
    defaultRule.data.status !== 'active' ||
    defaultRule.data.scope !== 'platform_default' ||
    defaultRule.data.recipientMode !== 'product_owner'
  ) {
    fail('Regra default de staging nao esta ativa/compativel para o smoke.');
  }

  const functionDescription = JSON.parse(command('gcloud', [
    'functions', 'describe', FUNCTION_NAME,
    '--gen2',
    `--region=${REGION}`,
    `--project=${EXPECTED_PROJECT}`,
    '--format=json'
  ]));

  if (
    functionDescription?.state !== 'ACTIVE' ||
    functionDescription?.buildConfig?.runtime !== 'nodejs22'
  ) {
    fail('Function staging nao esta ACTIVE em nodejs22.');
  }

  const functionUri = String(functionDescription?.serviceConfig?.uri || '').trim();
  if (!functionUri || functionUri.includes(PRODUCTION_PROJECT)) {
    fail('URI da function staging invalida.');
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
  const email = `bjjexams-marco5c-${runId}@example.test`;
  const password = `BjjSmoke-${crypto.randomBytes(18).toString('base64url')}!A1`;
  const cpf = generateCpf();

  const signUpResponse = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(webConfig.apiKey)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    }
  );
  const signed = await readJson(signUpResponse, 'Firebase Auth signup staging');
  const uid = String(signed.localId || '').trim();
  const idToken = String(signed.idToken || '').trim();
  if (!uid || !idToken) fail('Firebase Auth nao retornou uid/idToken para smoke.');

  const courseId = `smoke-marco5c-platform-${runId}`;
  const idempotencyKey = `smoke-marco5c-${runId}`;
  const now = new Date();

  const markerBase = {
    smokeType: 'marco5c-asaas-sandbox-course-checkout',
    runId,
    projectId: EXPECTED_PROJECT,
    environment: 'sandbox',
    status: 'prepared',
    userId: uid,
    courseId,
    idempotencyKey,
    priceCents: PRICE_CENTS,
    createdAt: now,
    updatedAt: now
  };

  await putDoc(SMOKE_MARKER_PATH, markerBase);

  const userProfile = {
    nome: 'BJJ Exams Smoke Test',
    email,
    cpf,
    telefone: '61999990000',
    status_conta: 'ativo',
    smokeTest: true,
    smokeRunId: runId,
    createdAt: now,
    updatedAt: now
  };

  const course = {
    title: 'Smoke Marco 5.3 - Asaas Sandbox',
    description: 'Curso de homologacao isolado para validar o checkout PIX do Marco 5.3 no ambiente staging.',
    ownerType: 'platform',
    ownerId: null,
    instructorIds: [uid],
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

  await putDoc(`usuarios/${uid}`, userProfile);
  await putDoc(`courses/${courseId}`, course);

  const expectedOrderId = sha256(
    `financial-order-v1:${uid}:${courseId}:${idempotencyKey}`
  );
  const expectedTransactionId = sha256(
    `payment-transaction-v1:asaas:${expectedOrderId}`
  );
  const expectedCustomerDocId = sha256(
    `financial-provider-customer-v1:asaas:sandbox:${uid}`
  );
  const expectedEnrollmentId = sha256(
    `course-enrollment-v1:${courseId}:${uid}`
  );

  async function checkout() {
    const response = await fetch(functionUri, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        data: {
          courseId,
          idempotencyKey
        }
      })
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!response.ok) {
      const status = body?.error?.status || `HTTP_${response.status}`;
      const domainCode = body?.error?.details?.domainCode || null;
      fail(`Callable falhou: ${status}${domainCode ? `/${domainCode}` : ''}`);
    }
    return body?.result ?? body?.data ?? null;
  }

  try {
    const first = await checkout();
    if (!first?.ok) fail('Callable nao retornou ok=true.');
    if (first.status !== 'pending_payment' || first.processing !== false) {
      fail(`Checkout real nao ficou pending_payment: ${first.status}.`);
    }
    if (first.orderId !== expectedOrderId) fail('orderId retornado diverge do deterministico.');
    if (first.transactionId !== expectedTransactionId) {
      fail('transactionId retornado diverge do deterministico.');
    }
    if (!first.paymentId) fail('Asaas nao retornou paymentId.');
    if (!first.pix?.payload || !first.pix?.encodedImage) {
      fail('Asaas nao retornou PIX payload/encodedImage.');
    }

    const [orderDoc, transactionDoc, customerDoc, leaseDoc, enrollmentDoc] =
      await Promise.all([
        getDoc(`orders/${expectedOrderId}`),
        getDoc(`payment_transactions/${expectedTransactionId}`),
        getDoc(`financial_provider_customers/${expectedCustomerDocId}`),
        getDoc(`financial_checkout_leases/${expectedTransactionId}`),
        getDoc(`enrollments/${expectedEnrollmentId}`)
      ]);

    if (!orderDoc || !transactionDoc || !customerDoc || !leaseDoc) {
      fail('Estado canonico do checkout nao foi persistido integralmente.');
    }

    const order = orderDoc.data;
    const transaction = transactionDoc.data;
    const customer = customerDoc.data;
    const lease = leaseDoc.data;

    if (
      order.status !== 'pending_payment' ||
      order.buyerUserId !== uid ||
      order.productId !== courseId ||
      order.amountCents !== PRICE_CENTS ||
      order.provider !== 'asaas' ||
      order.currentTransactionId !== expectedTransactionId ||
      !order.providerCustomerId
    ) {
      fail('Pedido canonico nao corresponde ao smoke esperado.');
    }

    const externalAllocations = (
      order.financialSnapshot?.recipientAllocations || []
    ).filter(item => item?.recipientType !== 'platform');
    if (externalAllocations.length !== 0) {
      fail('Curso platform do smoke gerou recebedor externo inesperado.');
    }

    if (
      transaction.status !== 'pending' ||
      transaction.providerPaymentId !== first.paymentId ||
      !Array.isArray(transaction.providerSplitSnapshot) ||
      transaction.providerSplitSnapshot.length !== 0
    ) {
      fail('Transacao canonica nao corresponde ao PIX pending sem split externo.');
    }

    if (
      customer.status !== 'ready' ||
      customer.provider !== 'asaas' ||
      customer.environment !== 'sandbox' ||
      customer.userId !== uid ||
      !customer.providerCustomerId
    ) {
      fail('Customer binding canonico nao ficou ready.');
    }

    if (lease.status !== 'released') {
      fail('Checkout lease nao foi liberada apos vincular a cobranca.');
    }

    if (enrollmentDoc) {
      fail('Checkout pendente criou enrollment indevidamente.');
    }

    const retry = await checkout();
    if (
      retry?.orderId !== first.orderId ||
      retry?.transactionId !== first.transactionId ||
      retry?.paymentId !== first.paymentId ||
      retry?.status !== 'pending_payment'
    ) {
      fail('Retry nao reutilizou o mesmo pedido/transacao/payment.');
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
      orderId: first.orderId,
      transactionId: first.transactionId,
      paymentId: first.paymentId,
      paymentStatus: 'pending_payment',
      customerBindingStatus: customer.status,
      checkoutLeaseStatus: lease.status,
      externalSplitCount: 0,
      enrollmentCreated: false,
      pixPayloadPresent: true,
      pixEncodedImagePresent: true,
      retrySameOrder: true,
      retrySameTransaction: true,
      retrySamePayment: true,
      courseArchived: true,
      updatedAt: archivedAt
    });

    console.log('MARCO5C_STAGING_ASAAS_SMOKE=OK');
    console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
    console.log('ASAAS_ENVIRONMENT=sandbox');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log(`PAYMENT_STATUS=${first.status}`);
    console.log(`PAYMENT_ID_PRESENT=${bool(Boolean(first.paymentId))}`);
    console.log(`PIX_PAYLOAD_PRESENT=${bool(Boolean(first.pix?.payload))}`);
    console.log(`PIX_IMAGE_PRESENT=${bool(Boolean(first.pix?.encodedImage))}`);
    console.log('EXTERNAL_SPLIT_COUNT=0');
    console.log(`ORDER_STATUS=${order.status}`);
    console.log(`TRANSACTION_STATUS=${transaction.status}`);
    console.log(`CUSTOMER_BINDING_STATUS=${customer.status}`);
    console.log(`CHECKOUT_LEASE_STATUS=${lease.status}`);
    console.log('RETRY_SAME_ORDER=True');
    console.log('RETRY_SAME_TRANSACTION=True');
    console.log('RETRY_SAME_PAYMENT=True');
    console.log('ENROLLMENT_CREATED=False');
    console.log('COURSE_ARCHIVED_AFTER_SMOKE=True');
    console.log('SMOKE_MARKER_STATUS=completed');
    console.log('SECRET_VALUE_PRINTED=False');
    console.log('PIX_VALUE_PRINTED=False');
  } catch (error) {
    await putDoc(SMOKE_MARKER_PATH, {
      ...markerBase,
      status: 'failed',
      failure: String(error?.message || 'unknown').slice(0, 300),
      updatedAt: new Date()
    }).catch(() => {});
    throw error;
  }
}

main().catch(error => {
  console.error(`MARCO5C_STAGING_ASAAS_SMOKE=FAILED | ${error.message}`);
  process.exitCode = 1;
});
