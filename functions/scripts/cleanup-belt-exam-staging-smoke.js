'use strict';

const fs = require('fs');
const path = require('path');

const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const FUNCTIONS_DIR = path.resolve(__dirname, '..');
const STATE_FILE = path.join(FUNCTIONS_DIR, '.belt-exam-staging-smoke.local.json');

function fail(message) {
  throw new Error(message);
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || ''
  ).trim();

  if (confirmation !== CONFIRMATION_VALUE) {
    fail(`Cleanup bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=${CONFIRMATION_VALUE}.`);
  }
  if (declaredProject === PRODUCTION_PROJECT) {
    fail('Projeto de produção detectado. Cleanup bloqueado.');
  }
  if (declaredProject && declaredProject !== TARGET_PROJECT) {
    fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  }
  if (!fs.existsSync(STATE_FILE)) {
    fail('Estado local do smoke Marco 6 não encontrado. Nada foi removido.');
  }

  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (state.projectId !== TARGET_PROJECT) {
    fail(`Estado local aponta para projeto inesperado: ${state.projectId || 'sem projectId'}.`);
  }
  if (!state.runId) fail('Estado local sem runId.');

  for (const field of [
    'studentUserId',
    'instructorId',
    'membershipId',
    'instructorMembershipId',
    'sessionId',
    'templateId',
    'templateVersionId',
    'questionSnapshotId'
  ]) {
    if (!state[field]) {
      fail(
        `Estado local Marco 6 sem ${field}.`
      );
    }
  }

  return state;
}

async function deleteIfOwned(ref, predicate, label) {
  const snap = await ref.get();
  if (!snap.exists) return 0;
  const data = snap.data() || {};
  if (!predicate(data)) {
    fail(`${label} ${ref.path} não pertence ao smoke atual. Cleanup interrompido.`);
  }
  await ref.delete();
  return 1;
}

async function deleteAuditsForEntityIds(db, entityIds) {
  let deleted = 0;
  for (const entityId of entityIds.filter(Boolean)) {
    const snap = await db.collection('audit_logs').where('entityId', '==', entityId).get();
    for (const doc of snap.docs) {
      await doc.ref.delete();
      deleted += 1;
    }
  }
  return deleted;
}

async function main() {
  const state = validateEnvironment();

  const app = initializeApp(
    { credential: applicationDefault(), projectId: TARGET_PROJECT },
    `belt-exam-staging-cleanup-${state.runId}`
  );
  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 6 - OFFICIAL BELT EXAM STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${state.runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('exam_sessions').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const counts = {
      webhookEvents: 0,
      leases: 0,
      transactions: 0,
      orders: 0,
      providerCustomers: 0,
      registrations: 0,
      sessions: 0,
      questionSnapshots: 0,
      templateVersions: 0,
      templates: 0,
      recipientAccounts: 0,
      memberships: 0,
      profiles: 0,
      organizations: 0,
      authUsers: 0,
      audits: 0
    };

    counts.webhookEvents += await deleteIfOwned(
      db.doc(`payment_webhook_events/${state.eventDocumentId}`),
      data =>
        data.provider === 'asaas' &&
        data.providerEventId === state.providerEventId,
      'Webhook event'
    );

    counts.leases += await deleteIfOwned(
      db.doc(`financial_checkout_leases/${state.transactionId}`),
      data =>
        data.transactionId === state.transactionId &&
        data.orderId === state.orderId &&
        data.environment === 'sandbox',
      'Checkout lease'
    );

    counts.transactions += await deleteIfOwned(
      db.doc(`payment_transactions/${state.transactionId}`),
      data =>
        data.orderId === state.orderId &&
        data.buyerUserId === state.studentUserId &&
        data.provider === 'asaas',
      'Payment transaction'
    );

    counts.orders += await deleteIfOwned(
      db.doc(`orders/${state.orderId}`),
      data =>
        data.buyerUserId === state.studentUserId &&
        data.productType === 'belt_exam' &&
        data.productId === state.sessionId,
      'Order'
    );

    counts.providerCustomers += await deleteIfOwned(
      db.doc(`financial_provider_customers/${state.providerCustomerDocId}`),
      data =>
        data.userId === state.studentUserId &&
        data.provider === 'asaas' &&
        data.environment === 'sandbox',
      'Provider customer binding'
    );

    counts.registrations += await deleteIfOwned(
      db.doc(`exam_registrations/${state.registrationId}`),
      data =>
        data.sessionId === state.sessionId &&
        data.studentId === state.studentUserId &&
        data.organizationId === state.organizationId,
      'Exam registration'
    );

    counts.sessions += await deleteIfOwned(
      db.doc(`exam_sessions/${state.sessionId}`),
      data =>
        data.organizationId === state.organizationId &&
        data.responsibleInstructorId === state.instructorId,
      'Exam session'
    );

    counts.questionSnapshots += await deleteIfOwned(
      db.doc(
        `exam_templates/${state.templateId}` +
        `/versions/${state.templateVersionId}` +
        `/questions/${state.questionSnapshotId}`
      ),
      data =>
        data.smokeRunId === state.runId &&
        data.sourceQuestionId === state.sourceQuestionId,
      'Exam question snapshot'
    );

    counts.templateVersions += await deleteIfOwned(
      db.doc(
        `exam_templates/${state.templateId}` +
        `/versions/${state.templateVersionId}`
      ),
      data =>
        data.smokeRunId === state.runId &&
        data.templateId === state.templateId,
      'Exam template version'
    );

    counts.templates += await deleteIfOwned(
      db.doc(`exam_templates/${state.templateId}`),
      data =>
        data.smokeRunId === state.runId &&
        data.targetBelt === 'Azul',
      'Exam template'
    );

    counts.recipientAccounts += await deleteIfOwned(
      db.doc(`financial_recipient_accounts/${state.recipientAccountId}`),
      data =>
        data.recipientType === 'organization' &&
        data.recipientId === state.organizationId &&
        data.provider === 'asaas' &&
        data.environment === 'sandbox',
      'Recipient account'
    );

    counts.memberships += await deleteIfOwned(
      db.doc(`vinculos_organizacao/${state.membershipId}`),
      data =>
        data.smokeRunId === state.runId &&
        data.usuario_id === state.studentUserId &&
        data.organizacao_id === state.organizationId,
      'Student membership'
    );

    counts.memberships += await deleteIfOwned(
      db.doc(
        `vinculos_organizacao/${state.instructorMembershipId}`
      ),
      data =>
        data.smokeRunId === state.runId &&
        data.usuario_id === state.instructorId &&
        data.organizacao_id === state.organizationId,
      'Instructor membership'
    );

    counts.profiles += await deleteIfOwned(
      db.doc(`usuarios/${state.studentUserId}`),
      data => data.smokeRunId === state.runId,
      'Student profile'
    );

    counts.profiles += await deleteIfOwned(
      db.doc(`usuarios/${state.instructorId}`),
      data => data.smokeRunId === state.runId,
      'Instructor profile'
    );

    counts.organizations += await deleteIfOwned(
      db.doc(`organizacoes/${state.organizationId}`),
      data => data.smokeRunId === state.runId,
      'Organization'
    );

    const auditEntityIds = [
      state.recipientAccountId,
      state.providerCustomerDocId,
      state.registrationId,
      state.sessionId,
      state.templateId,
      `${state.templateId}:${state.templateVersionId}`,
      state.orderId,
      state.transactionId,
      state.eventDocumentId
    ];
    counts.audits = await deleteAuditsForEntityIds(db, auditEntityIds);

    for (const userId of [
      state.studentUserId,
      state.instructorId
    ]) {
      try {
        await auth.deleteUser(userId);
        counts.authUsers += 1;
      } catch (error) {
        if (
          error?.code !==
          'auth/user-not-found'
        ) {
          throw error;
        }
      }
    }

    const residueRefs = [
      `payment_webhook_events/${state.eventDocumentId}`,
      `financial_checkout_leases/${state.transactionId}`,
      `payment_transactions/${state.transactionId}`,
      `orders/${state.orderId}`,
      `financial_provider_customers/${state.providerCustomerDocId}`,
      `exam_registrations/${state.registrationId}`,
      `exam_sessions/${state.sessionId}`,
      `exam_templates/${state.templateId}/versions/${state.templateVersionId}/questions/${state.questionSnapshotId}`,
      `exam_templates/${state.templateId}/versions/${state.templateVersionId}`,
      `exam_templates/${state.templateId}`,
      `financial_recipient_accounts/${state.recipientAccountId}`,
      `vinculos_organizacao/${state.membershipId}`,
      `vinculos_organizacao/${state.instructorMembershipId}`,
      `usuarios/${state.studentUserId}`,
      `usuarios/${state.instructorId}`,
      `organizacoes/${state.organizationId}`
    ];

    const residueSnaps = await Promise.all(residueRefs.map(ref => db.doc(ref).get()));
    const residues = residueSnaps
      .map((snap, index) => (snap.exists ? residueRefs[index] : null))
      .filter(Boolean);

    if (residues.length) {
      fail(`Cleanup remoto incompleto: ${residues.join(', ')}.`);
    }

    fs.unlinkSync(STATE_FILE);

    console.log(`TEMP_WEBHOOK_EVENTS_DELETED=${counts.webhookEvents}`);
    console.log(`TEMP_CHECKOUT_LEASES_DELETED=${counts.leases}`);
    console.log(`TEMP_TRANSACTIONS_DELETED=${counts.transactions}`);
    console.log(`TEMP_ORDERS_DELETED=${counts.orders}`);
    console.log(`TEMP_PROVIDER_CUSTOMERS_DELETED=${counts.providerCustomers}`);
    console.log(`TEMP_EXAM_REGISTRATIONS_DELETED=${counts.registrations}`);
    console.log(`TEMP_EXAM_SESSIONS_DELETED=${counts.sessions}`);
    console.log(`TEMP_EXAM_QUESTION_SNAPSHOTS_DELETED=${counts.questionSnapshots}`);
    console.log(`TEMP_EXAM_TEMPLATE_VERSIONS_DELETED=${counts.templateVersions}`);
    console.log(`TEMP_EXAM_TEMPLATES_DELETED=${counts.templates}`);
    console.log(`TEMP_RECIPIENT_ACCOUNTS_DELETED=${counts.recipientAccounts}`);
    console.log(`TEMP_MEMBERSHIPS_DELETED=${counts.memberships}`);
    console.log(`TEMP_PROFILES_DELETED=${counts.profiles}`);
    console.log(`TEMP_ORGANIZATIONS_DELETED=${counts.organizations}`);
    console.log(`TEMP_AUTH_USERS_DELETED=${counts.authUsers}`);
    console.log(`TEMP_AUDIT_LOGS_DELETED=${counts.audits}`);
    console.log('LOCAL_STATE_FILE_DELETED=True');
    console.log('ASAAS_SANDBOX_EXTERNAL_ARTIFACTS_RETAINED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO6_GATE2C2_SANDBOX_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO6_GATE2C2_SANDBOX_CLEANUP=FAILED');
  console.error(`ERROR=${String(error?.message || error)}`);
  process.exitCode = 1;
});
