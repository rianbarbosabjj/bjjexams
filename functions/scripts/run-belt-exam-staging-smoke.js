'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const {
  createFinancialAdminService
} = require('../src/finance/financial-admin-service');
const {
  financialRecipientAccountId
} = require('../src/finance/financial-admin-domain');
const {
  buildExamSession,
  validateExamSession
} = require('../src/exams/exam-session-domain');
const {
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');
const {
  validateExamTemplate,
  validateExamTemplateVersion,
  examTemplateVersionDocumentId
} = require('../src/exams/exam-template-domain');
const {
  buildExamQuestionSnapshot,
  examQuestionSnapshotDocumentId
} = require('../src/exams/exam-question-domain');
const {
  beltExamFinancialOrderDocumentId
} = require('../src/finance/financial-belt-exam-order-service');
const {
  paymentTransactionId,
  providerCustomerDocumentId
} = require('../src/finance/financial-checkout-persistence');
const {
  paymentWebhookEventDocumentId
} = require('../src/finance/financial-webhook-domain');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const REGION = 'southamerica-east1';
const BRANCH = 'feature/marco6-official-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const ASAAS_BASE = 'https://api-sandbox.asaas.com/v3';
const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const ROOT = path.resolve(FUNCTIONS_DIR, '..');
const STATE_FILE = path.join(FUNCTIONS_DIR, '.belt-exam-staging-smoke.local.json');
const WEB_CONFIG_FILE = path.join(ROOT, 'js', 'firebase-config.local.json');

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: ROOT,
    encoding: 'utf8'
  }).trim();
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''
  ).trim();

  if (confirmation !== CONFIRMATION_VALUE) {
    fail(`Smoke bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  }
  if (declaredProject === PRODUCTION_PROJECT) {
    fail('Projeto de produção detectado. Smoke bloqueado.');
  }
  if (declaredProject && declaredProject !== TARGET_PROJECT) {
    fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  }
  if (TARGET_PROJECT === PRODUCTION_PROJECT) {
    fail('PRODUCTION ACCESS BLOCKED');
  }
  if (currentBranch() !== BRANCH) {
    fail(`Branch inesperada: ${currentBranch()}.`);
  }
  if (fs.existsSync(STATE_FILE)) {
    fail('Já existe estado local de smoke pendente. Execute o cleanup antes de iniciar novo smoke.');
  }
  if (!fs.existsSync(WEB_CONFIG_FILE)) {
    fail('js/firebase-config.local.json ausente.');
  }

  const asaasKey = String(process.env.BJJEXAMS_ASAAS_API_KEY || '').trim();
  const webhookToken = String(process.env.BJJEXAMS_ASAAS_WEBHOOK_TOKEN || '').trim();

  if (!/^\$aact_hmlg_/.test(asaasKey)) {
    fail('BJJEXAMS_ASAAS_API_KEY ausente ou não corresponde ao Sandbox.');
  }
  if (webhookToken.length < 16) {
    fail('BJJEXAMS_ASAAS_WEBHOOK_TOKEN ausente ou inválido.');
  }

  const webConfig = JSON.parse(fs.readFileSync(WEB_CONFIG_FILE, 'utf8'));
  if (webConfig.projectId !== TARGET_PROJECT) {
    fail(`Firebase Web config aponta para projeto inesperado: ${webConfig.projectId || 'sem projectId'}.`);
  }
  if (!webConfig.apiKey) {
    fail('Firebase Web config de staging sem apiKey.');
  }

  return { asaasKey, webhookToken, webApiKey: webConfig.apiKey };
}

function saveState(state) {
  fs.writeFileSync(
    STATE_FILE,
    `${JSON.stringify(state, null, 2)}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
}

function syntheticCpf(seed) {
  let base = String(seed)
    .replace(/\D/g, '')
    .padStart(9, '0')
    .slice(-9)
    .split('')
    .map(Number);

  if (new Set(base).size === 1) {
    base = [5, 2, 9, 9, 8, 2, 2, 4, 7];
  }

  const firstSum = base.reduce(
    (sum, digit, index) => sum + digit * (10 - index),
    0
  );
  const firstMod = firstSum % 11;
  const first = firstMod < 2 ? 0 : 11 - firstMod;
  const ten = [...base, first];
  const secondSum = ten.reduce(
    (sum, digit, index) => sum + digit * (11 - index),
    0
  );
  const secondMod = secondSum % 11;
  const second = secondMod < 2 ? 0 : 11 - secondMod;
  return `${base.join('')}${first}${second}`;
}

function functionUrl(name) {
  return `https://${REGION}-${TARGET_PROJECT}.cloudfunctions.net/${name}`;
}

async function jsonRequest(url, options, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch (_error) {
      body = {};
    }
    if (!response.ok) {
      fail(`${label}: HTTP ${response.status}.`);
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function listWallet(asaasKey) {
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < 50; page += 1) {
    const result = await jsonRequest(
      `${ASAAS_BASE}/accounts?offset=${offset}&limit=${limit}`,
      {
        method: 'GET',
        headers: {
          access_token: asaasKey,
          'User-Agent': 'BJJ-Exams/1.2'
        }
      },
      'Listagem de subcontas Sandbox'
    );

    const items = Array.isArray(result.body.data) ? result.body.data : [];
    const account = items.find(item => String(item?.walletId || '').trim());
    if (account) return String(account.walletId).trim();
    if (result.body.hasMore !== true) break;
    offset += limit;
  }

  fail('Nenhuma subconta Sandbox com walletId disponível.');
}

async function signInWithPassword(apiKey, email, password) {
  const result = await jsonRequest(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        returnSecureToken: true
      })
    },
    'Autenticacao da fixture por senha'
  );

  assert(
    result.body.idToken,
    'Identity Toolkit nao retornou ID token apos login por senha.'
  );

  return result.body.idToken;
}

async function callCallable(name, idToken, data) {
  const response = await fetch(functionUrl(name), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ data: data || {} })
  });

  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (_error) {
    body = {};
  }

  if (!response.ok || !Object.prototype.hasOwnProperty.call(body, 'result')) {
    const status = body?.error?.status || `HTTP_${response.status}`;
    const domainCode = body?.error?.details?.domainCode;
    fail(`${name}: ${status}${domainCode ? `/${domainCode}` : ''}`);
  }

  return body.result;
}

async function confirmPayment(asaasKey, paymentId) {
  const result = await jsonRequest(
    `${ASAAS_BASE}/sandbox/payment/${encodeURIComponent(paymentId)}/confirm`,
    {
      method: 'POST',
      headers: {
        access_token: asaasKey,
        'User-Agent': 'BJJ-Exams/1.2',
        'Content-Type': 'application/json'
      }
    },
    'Confirmação oficial Sandbox'
  );

  const status = String(result.body.status || '').toUpperCase();
  assert(
    ['CONFIRMED', 'RECEIVED'].includes(status),
    `Status Asaas inesperado após confirmação: ${status || 'vazio'}.`
  );
  return result.body;
}

async function sendWebhook(webhookToken, providerEventId, payment) {
  const providerStatus = String(payment.status || '').toUpperCase();
  const event = providerStatus === 'RECEIVED' ? 'PAYMENT_RECEIVED' : 'PAYMENT_CONFIRMED';

  const response = await fetch(functionUrl('webhookAsaasPagamentosV12'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'asaas-access-token': webhookToken
    },
    body: JSON.stringify({
      id: providerEventId,
      event,
      dateCreated: new Date().toISOString(),
      payment
    })
  });

  const body = await response.json().catch(() => ({}));
  assert(response.status === 202, `Webhook ingress retornou HTTP ${response.status}.`);
  assert(body.ok === true && body.accepted === true, 'Webhook não aceitou o evento.');
}

async function waitForAuthorized(db, state) {
  const deadline = Date.now() + 180000;

  while (Date.now() < deadline) {
    const [registrationSnap, orderSnap, transactionSnap, eventSnap] = await Promise.all([
      db.doc(`exam_registrations/${state.registrationId}`).get(),
      db.doc(`orders/${state.orderId}`).get(),
      db.doc(`payment_transactions/${state.transactionId}`).get(),
      db.doc(`payment_webhook_events/${state.eventDocumentId}`).get()
    ]);

    const registration = registrationSnap.data() || {};
    const order = orderSnap.data() || {};
    const transaction = transactionSnap.data() || {};
    const event = eventSnap.data() || {};

    if (event.status === 'error') {
      fail(`Webhook terminou em error/${String(event.errorCode || 'UNKNOWN')}.`);
    }

    if (
      registration.status === 'authorized' &&
      order.status === 'paid' &&
      transaction.status === 'paid' &&
      event.status === 'processed'
    ) {
      return true;
    }

    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  fail('Timeout aguardando estado financeiro authorized/paid/processed.');
}

async function main() {
  const { asaasKey, webhookToken, webApiKey } = validateEnvironment();
  const walletId = await listWallet(asaasKey);
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const organizationId = `m6-smoke-org-${runId}`;
  const studentUserId = `m6-smoke-student-${runId}`;
  const instructorId = `m6-smoke-prof-${runId}`;
  const adminActorId = `m6-smoke-admin-${runId}`;
  const membershipId = `m6-smoke-student-membership-${runId}`;
  const instructorMembershipId =
    `m6-smoke-instructor-membership-${runId}`;
  const sessionId = `m6-smoke-session-${runId}`;
  const templateId = `m6-smoke-template-${runId}`;
  const templateVersionId =
    examTemplateVersionDocumentId(1);
  const sourceQuestionId =
    `m6-smoke-question-source-${runId}`;
  const questionSnapshotId =
    examQuestionSnapshotDocumentId(
      sourceQuestionId
    );
  const idempotencyKey =
    `gate2c2-${runId}`;
  const studentEmail =
    `m6-student-${runId}@example.com`;
  const instructorEmail =
    `m6-instructor-${runId}@example.com`;
  const studentPassword =
    `${crypto.randomBytes(24).toString('base64url')}Aa1!`;
  const instructorPassword =
    `${crypto.randomBytes(24).toString('base64url')}Aa1!`;

  const registrationId = examRegistrationDocumentId({
    sessionId,
    studentId: studentUserId
  });
  const orderId = beltExamFinancialOrderDocumentId({
    buyerUserId: studentUserId,
    sessionId,
    idempotencyKey
  });
  const transactionId = paymentTransactionId({ provider: 'asaas', orderId });
  const providerCustomerDocId = providerCustomerDocumentId({
    provider: 'asaas',
    environment: 'sandbox',
    userId: studentUserId
  });
  const recipientAccountId = financialRecipientAccountId({
    provider: 'asaas',
    environment: 'sandbox',
    recipientType: 'organization',
    recipientId: organizationId
  });
  const providerEventId = `BJJEX-GATE7-${runId}`;
  const eventDocumentId = paymentWebhookEventDocumentId({
    provider: 'asaas',
    providerEventId
  });

  const state = {
    projectId: TARGET_PROJECT,
    runId,
    createdAt: new Date().toISOString(),
    organizationId,
    studentUserId,
    instructorId,
    adminActorId,
    membershipId,
    instructorMembershipId,
    sessionId,
    templateId,
    templateVersionId,
    sourceQuestionId,
    questionSnapshotId,
    registrationId,
    orderId,
    transactionId,
    providerCustomerDocId,
    recipientAccountId,
    providerEventId,
    eventDocumentId
  };
  saveState(state);

  const app = initializeApp(
    { credential: applicationDefault(), projectId: TARGET_PROJECT },
    `belt-exam-staging-smoke-${runId}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);

  let passed = 0;
  const pass = name => {
    passed += 1;
    console.log(`PASS | ${name}`);
  };

  console.log('=== MARCO 6 - OFFICIAL BELT EXAM STAGING SANDBOX SMOKE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log('ASAAS_ENV=sandbox');
  console.log('SECRETS_EXPOSED=False');
  console.log('WALLET_IDS_EXPOSED=False');
  console.log(`RUN_ID=${runId}`);

  try {
    const defaultRuleSnap = await db.doc('financial_rules/platform-default').get();
    assert(defaultRuleSnap.exists, 'financial_rules/platform-default ausente.');
    const defaultRule = defaultRuleSnap.data() || {};
    assert(String(defaultRule.status || '').toLowerCase() === 'active', 'Regra padrão inativa.');
    assert(Number(defaultRule.platformFeeBps) === 1000, 'Taxa padrão não é 10%.');
    pass('regra financeira padrão ativa');

    await db.doc(`organizacoes/${organizationId}`).set({
      nome: 'Academia Smoke Marco 6',
      status: 'active',
      smokeRunId: runId,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const financialAdmin = createFinancialAdminService({
      db,
      environment: 'sandbox'
    });
    const account = await financialAdmin.configureRecipientAccount({
      actorId: adminActorId,
      claims: { platform_admin: true },
      data: {
        recipientType: 'organization',
        recipientId: organizationId,
        walletId,
        status: 'ready'
      }
    });
    assert(account.accountId === recipientAccountId, 'Conta recebedora inesperada.');
    assert(account.account?.status === 'ready', 'Conta recebedora não ficou ready.');
    pass('wallet Sandbox vinculado sem exposição');

    await Promise.all([
      auth.createUser({
        uid: studentUserId,
        email: studentEmail,
        password: studentPassword,
        emailVerified: true,
        displayName: 'Aluno Smoke Marco 6'
      }),
      auth.createUser({
        uid: instructorId,
        email: instructorEmail,
        password: instructorPassword,
        emailVerified: true,
        displayName: 'Instrutor Smoke Marco 6'
      })
    ]);

    await Promise.all([
      db.doc(`usuarios/${studentUserId}`).set({
        nome: 'Aluno Smoke Marco 6',
        email: studentEmail,
        cpf: syntheticCpf(Date.now()),
        telefone: '4799376637',
        status_conta: 'ativo',
        faixa_atual: 'Branca',
        smokeRunId: runId
      }),
      db.doc(`usuarios/${instructorId}`).set({
        nome: 'Instrutor Smoke Marco 6',
        email: instructorEmail,
        status_conta: 'ativo',
        faixa_atual: 'Preta',
        smokeRunId: runId
      }),
      db.doc(`vinculos_organizacao/${membershipId}`).set({
        usuario_id: studentUserId,
        organizacao_id: organizationId,
        papel: 'aluno',
        status: 'ativo',
        smokeRunId: runId
      }),
      db.doc(`vinculos_organizacao/${instructorMembershipId}`).set({
        usuario_id: instructorId,
        organizacao_id: organizationId,
        papel: 'professor',
        status: 'ativo',
        pode_aplicar_exames: true,
        smokeRunId: runId
      })
    ]);

    const now = new Date();

    const baseSession = buildExamSession({
      organizationId,
      responsibleInstructorId: instructorId,
      targetBelt: 'Azul',
      priceCents: 10000,
      currency: 'BRL',
      financialRuleId: null,
      scheduledAt: new Date(Date.now() + 86400000),
      createdBy: instructorId,
      timestamp: now
    });

    const session = validateExamSession({
      ...baseSession,
      status: 'draft',
      updatedAt: now
    });

    const questionSnapshot =
      buildExamQuestionSnapshot({
        prompt:
          'Qual alternativa representa uma regra básica de segurança no treino?',
        alternatives: {
          A: 'Respeitar a sinalização de desistência do parceiro.',
          B: 'Ignorar a sinalização para concluir a técnica.'
        },
        correctAnswer: 'A',
        category: 'Segurança',
        difficulty: 1,
        media: null,
        sourceQuestionId,
        timestamp: now
      });

    const template =
      validateExamTemplate({
        name:
          'Template Oficial Smoke Marco 6',
        targetBelt:
          'Azul',
        status:
          'active',
        activeVersionId:
          templateVersionId,
        createdBy:
          instructorId,
        createdAt:
          now,
        updatedAt:
          now
      });

    const templateVersion =
      validateExamTemplateVersion({
        templateId,
        version: 1,
        status: 'active',
        timeLimitMinutes: 60,
        passingScoreBps: 7000,
        questionCount: 1,
        questionIds: [
          questionSnapshotId
        ],
        source: 'staging_smoke',
        createdBy: instructorId,
        createdAt: now,
        activatedAt: now
      });

    await Promise.all([
      db.doc(
        `exam_sessions/${sessionId}`
      ).set({
        ...session,
        smokeRunId: runId
      }),

      db.doc(
        `exam_templates/${templateId}`
      ).set({
        ...template,
        smokeRunId: runId
      }),

      db.doc(
        `exam_templates/${templateId}` +
        `/versions/${templateVersionId}`
      ).set({
        ...templateVersion,
        smokeRunId: runId
      }),

      db.doc(
        `exam_templates/${templateId}` +
        `/versions/${templateVersionId}` +
        `/questions/${questionSnapshotId}`
      ).set({
        ...questionSnapshot,
        smokeRunId: runId
      })
    ]);

    pass(
      'fixture acadêmica Marco 6 criada com template oficial ativo'
    );

    const [
      idToken,
      instructorToken
    ] = await Promise.all([
      signInWithPassword(
        webApiKey,
        studentEmail,
        studentPassword
      ),
      signInWithPassword(
        webApiKey,
        instructorEmail,
        instructorPassword
      )
    ]);

    const selection =
      await callCallable(
        'selecionarAlunoExameFaixaV12',
        instructorToken,
        {
          sessionId,
          studentId:
            studentUserId
        }
      );

    assert(
      selection.created === true,
      'Seleção não criou registration.'
    );

    assert(
      selection.registration?.id ===
        registrationId,
      'registrationId inesperado após seleção.'
    );

    assert(
      selection.session?.status ===
        'candidates_selected',
      'Sessão não transitou para candidates_selected.'
    );

    pass(
      'seleção oficial ocorreu pela callable'
    );

    const unboundRead =
      await callCallable(
        'listarMeusExamesFaixaV12',
        idToken,
        { limit: 20 }
      );

    const unboundView =
      (unboundRead.items || [])
        .find(
          item =>
            item.sessionId === sessionId
        );

    assert(
      unboundView?.state === 'selected',
      'Read model não refletiu selected antes do binding.'
    );

    assert(
      unboundView?.canStartCheckout === false,
      'Read model liberou checkout antes do binding.'
    );

    assert(
      unboundView?.canResumePayment === false,
      'Read model liberou resume antes do binding.'
    );

    assert(
      unboundView?.canStartExam === false,
      'Read model liberou prova antes do binding.'
    );

    pass(
      'read model bloqueou checkout antes do binding'
    );

    const binding =
      await callCallable(
        'vincularTemplateSessaoExameFaixaV12',
        instructorToken,
        {
          sessionId,
          templateId
        }
      );

    assert(
      binding.bound === true,
      'Binding oficial não confirmou bound.'
    );

    assert(
      binding.alreadyBound === false,
      'Primeiro binding foi tratado como retry.'
    );

    assert(
      binding.session?.templateId ===
        templateId,
      'templateId congelado inesperado.'
    );

    assert(
      binding.session?.templateVersionId ===
        templateVersionId,
      'templateVersionId congelado inesperado.'
    );

    pass(
      'template oficial foi congelado pela callable'
    );

    const bindingRetry =
      await callCallable(
        'vincularTemplateSessaoExameFaixaV12',
        instructorToken,
        {
          sessionId,
          templateId
        }
      );

    assert(
      bindingRetry.bound === true &&
      bindingRetry.alreadyBound === true,
      'Retry do binding não foi idempotente.'
    );

    assert(
      bindingRetry.session?.templateVersionId ===
        templateVersionId,
      'Retry alterou a versão congelada.'
    );

    pass(
      'retry do binding preservou versão congelada'
    );

    const selectedRead =
      await callCallable(
        'listarMeusExamesFaixaV12',
        idToken,
        { limit: 20 }
      );

    const selectedView =
      (selectedRead.items || [])
        .find(
          item =>
            item.sessionId === sessionId
        );

    assert(
      selectedView?.state === 'selected',
      'Read model não refletiu selected após binding.'
    );

    assert(
      selectedView?.canStartCheckout === true,
      'Checkout não foi liberado após binding.'
    );

    assert(
      selectedView?.canStartExam === false,
      'Binding liberou prova indevidamente.'
    );

    assert(
      !Object.prototype.hasOwnProperty.call(
        selectedView,
        'templateId'
      ),
      'View do aluno expôs templateId.'
    );

    assert(
      !Object.prototype.hasOwnProperty.call(
        selectedView,
        'templateVersionId'
      ),
      'View do aluno expôs templateVersionId.'
    );

    pass(
      'read model liberou checkout somente após binding'
    );

    const checkout = await callCallable('iniciarCheckoutExameFaixaV12', idToken, {
      sessionId,
      idempotencyKey
    });
    assert(checkout.orderId === orderId, 'orderId inesperado.');
    assert(checkout.transactionId === transactionId, 'transactionId inesperado.');
    assert(checkout.status === 'pending_payment', 'Checkout não ficou pending_payment.');
    assert(checkout.processing === false, 'Checkout ficou processing.');
    assert(checkout.pix?.payload && checkout.pix?.encodedImage, 'PIX sanitizado ausente.');
    assert(
      !Object.prototype.hasOwnProperty.call(checkout, 'paymentId'),
      'Resposta pública expôs paymentId.'
    );
    pass('PIX real criado no Asaas Sandbox');

    const resumed = await callCallable('retomarCheckoutExameFaixaV12', idToken, { sessionId });
    assert(resumed.orderId === orderId, 'Retomada mudou orderId.');
    assert(resumed.transactionId === transactionId, 'Retomada mudou transactionId.');
    assert(resumed.status === 'pending_payment', 'Retomada não permaneceu pending_payment.');
    pass('retomada idempotente validada');

    const transactionSnap = await db.doc(`payment_transactions/${transactionId}`).get();
    assert(transactionSnap.exists, 'Transação canônica ausente.');
    const providerPaymentId = String(transactionSnap.data()?.providerPaymentId || '').trim();
    assert(providerPaymentId, 'providerPaymentId interno ausente.');

    const confirmedPayment = await confirmPayment(asaasKey, providerPaymentId);
    pass('pagamento confirmado pelo endpoint Sandbox');

    await sendWebhook(webhookToken, providerEventId, confirmedPayment);
    await waitForAuthorized(db, state);
    pass('webhook e worker autorizaram registration');

    const paidRead = await callCallable('listarMeusExamesFaixaV12', idToken, { limit: 20 });
    const paidView = (paidRead.items || []).find(item => item.sessionId === sessionId);
    assert(paidView?.state === 'authorized', 'Read model final não está authorized.');
    assert(paidView?.canStartExam === false, 'Pagamento liberou prova antes do Marco acadêmico de execução.');

    const legacyCredit = await db.doc(`creditos_professor/${instructorId}`).get();
    assert(!legacyCredit.exists, 'Fluxo belt_exam consumiu/criou crédito legado do professor.');
    pass('authorized sem crédito legado e sem iniciar prova');

    assert(passed === 13, `Smoke concluiu ${passed}/13 checks.`);
    console.log(`MARCO6_GATE2C2_SANDBOX_SMOKE=${passed}/13`);
    console.log('CANONICAL_FINAL_STATE=authorized');
    console.log('CAN_START_EXAM=False');
    console.log('LEGACY_PROFESSOR_CREDIT_CONSUMED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('CLEANUP_REQUIRED=True');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO6_GATE2C2_SANDBOX_SMOKE=FAILED');
  console.error(`ERROR=${String(error?.message || error)}`);
  console.error(`CLEANUP_REQUIRED=${fs.existsSync(STATE_FILE) ? 'True' : 'False'}`);
  process.exitCode = 1;
});
