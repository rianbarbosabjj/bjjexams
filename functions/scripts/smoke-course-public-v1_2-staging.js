'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const REGION = 'southamerica-east1';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const ALLOWED_FUNCTIONS = new Set([
  'listarCatalogoCursosV12',
  'obterCursoPublicoV12'
]);

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
  ).trim();

  if (confirmation !== CONFIRMATION_VALUE) {
    fail(
      'Smoke remoto bloqueado. Defina BJJEXAMS_STAGING_SMOKE_CONFIRM=' +
      CONFIRMATION_VALUE +
      ' para confirmar escritas temporárias exclusivamente em staging.'
    );
  }

  if (declaredProject === PRODUCTION_PROJECT) {
    fail('Projeto de produção detectado nas variáveis de ambiente. Execução bloqueada.');
  }

  if (declaredProject && declaredProject !== TARGET_PROJECT) {
    fail(`Projeto declarado incompatível com staging: ${declaredProject}.`);
  }

  if (process.env.FIREBASE_CONFIG) {
    let firebaseConfig;
    try {
      firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG);
    } catch {
      fail('FIREBASE_CONFIG inválido.');
    }

    if (firebaseConfig?.projectId && firebaseConfig.projectId !== TARGET_PROJECT) {
      fail(`FIREBASE_CONFIG aponta para projeto não autorizado: ${firebaseConfig.projectId}.`);
    }
  }
}

function functionUrl(functionName) {
  if (!ALLOWED_FUNCTIONS.has(functionName)) {
    fail(`Callable fora do escopo do smoke público: ${functionName}.`);
  }

  return `https://${REGION}-${TARGET_PROJECT}.cloudfunctions.net/${functionName}`;
}

async function callCallable(functionName, data = {}) {
  const response = await axios.post(
    functionUrl(functionName),
    { data },
    {
      timeout: 45000,
      validateStatus: () => true,
      headers: { 'Content-Type': 'application/json' }
    }
  );

  if (response.status >= 200 && response.status < 300 && response.data?.result !== undefined) {
    return response.data.result;
  }

  const error = new Error(
    response.data?.error?.message ||
    `Callable ${functionName} falhou com HTTP ${response.status}.`
  );
  error.httpStatus = response.status;
  error.callableStatus = String(response.data?.error?.status || '').toUpperCase();
  error.callableDetails = response.data?.error?.details || null;
  throw error;
}

async function expectNotFound(label, operation) {
  try {
    await operation();
  } catch (error) {
    if (error.callableStatus === 'NOT_FOUND' || error.httpStatus === 404) {
      console.log(`${label}=NOT_FOUND`);
      return;
    }
    throw error;
  }
  fail(`${label}: curso não público foi exposto.`);
}

async function main() {
  validateEnvironment();

  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const app = initializeApp(
    {
      credential: applicationDefault(),
      projectId: TARGET_PROJECT
    },
    `course-public-smoke-${runId}`
  );

  const db = getFirestore(app);
  const createdPaths = [];

  console.log('=== MARCO 4A.3 - PUBLIC COURSE STAGING SMOKE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    await db.collection('courses').limit(1).get();
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const now = Date.now();
    const ownerId = `smoke_owner_${runId}`;
    const instructorId = `smoke_instructor_${runId}`;
    const publishedFreeId = `smoke_public_free_${runId}`;
    const publishedPaidId = `smoke_public_paid_${runId}`;
    const draftId = `smoke_draft_${runId}`;
    const privateId = `smoke_private_${runId}`;

    const base = {
      description: 'Descrição temporária completa para validar o catálogo público canônico no staging.',
      ownerType: 'user',
      ownerId,
      instructorIds: [instructorId],
      organizationId: null,
      currency: 'BRL',
      financialRuleId: `secret_rule_${runId}`,
      createdBy: ownerId,
      createdAt: Timestamp.fromMillis(now - 10000),
      updatedAt: Timestamp.fromMillis(now - 5000)
    };

    const fixtures = [
      [publishedFreeId, {
        ...base,
        title: `Smoke Public Free ${runId}`,
        visibility: 'platform',
        status: 'published',
        isPaid: false,
        priceCents: 0,
        publishedAt: Timestamp.fromMillis(now - 2000)
      }],
      [publishedPaidId, {
        ...base,
        title: `Smoke Public Paid ${runId}`,
        visibility: 'platform',
        status: 'published',
        isPaid: true,
        priceCents: 12900,
        publishedAt: Timestamp.fromMillis(now - 1000)
      }],
      [draftId, {
        ...base,
        title: `Smoke Draft ${runId}`,
        visibility: 'platform',
        status: 'draft',
        isPaid: false,
        priceCents: 0,
        publishedAt: null
      }],
      [privateId, {
        ...base,
        title: `Smoke Private ${runId}`,
        visibility: 'private',
        status: 'published',
        isPaid: false,
        priceCents: 0,
        publishedAt: Timestamp.fromMillis(now - 500)
      }]
    ];

    const batch = db.batch();
    for (const [id, data] of fixtures) {
      const ref = db.doc(`courses/${id}`);
      batch.set(ref, data);
      createdPaths.push(ref.path);
    }
    await batch.commit();
    console.log('TEMP_PUBLIC_COURSE_FIXTURES=4');

    const catalog = await callCallable('listarCatalogoCursosV12', { limit: 50 });
    assert(Array.isArray(catalog?.courses), 'Catálogo remoto não retornou courses[].');

    const byId = new Map(catalog.courses.map(course => [course.id, course]));
    assert(byId.has(publishedFreeId), 'Curso público gratuito temporário não apareceu no catálogo.');
    assert(byId.has(publishedPaidId), 'Curso público pago temporário não apareceu no catálogo.');
    assert(!byId.has(draftId), 'Draft temporário apareceu no catálogo público.');
    assert(!byId.has(privateId), 'Curso private temporário apareceu no catálogo público.');
    console.log('REMOTE_PUBLIC_CATALOG_FILTERING=OK');

    const publicPaid = byId.get(publishedPaidId);
    for (const forbidden of [
      'ownerType',
      'ownerId',
      'instructorIds',
      'organizationId',
      'financialRuleId',
      'createdBy',
      'status',
      'createdAt',
      'updatedAt'
    ]) {
      assert(publicPaid[forbidden] === undefined, `Campo interno exposto no catálogo: ${forbidden}.`);
    }
    assert(publicPaid.priceCents === 12900, 'Preço público em centavos não foi preservado.');
    console.log('REMOTE_PUBLIC_CATALOG_SANITIZATION=OK');

    const detail = await callCallable('obterCursoPublicoV12', { courseId: publishedFreeId });
    assert(detail?.course?.id === publishedFreeId, 'Detalhe público retornou curso inesperado.');
    assert(detail.course.ownerId === undefined, 'Detalhe público expôs ownerId.');
    assert(detail.course.instructorIds === undefined, 'Detalhe público expôs instructorIds.');
    console.log('REMOTE_PUBLIC_COURSE_DETAIL=OK');

    await expectNotFound(
      'REMOTE_PRIVATE_COURSE_DETAIL',
      () => callCallable('obterCursoPublicoV12', { courseId: privateId })
    );
    await expectNotFound(
      'REMOTE_DRAFT_COURSE_DETAIL',
      () => callCallable('obterCursoPublicoV12', { courseId: draftId })
    );

    console.log('COURSE_PUBLIC_STAGING_SMOKE=APROVADO');
  } finally {
    const cleanupErrors = [];

    for (const path of createdPaths.reverse()) {
      try {
        await db.doc(path).delete();
      } catch (error) {
        cleanupErrors.push(`${path}: ${error.message}`);
      }
    }

    try {
      await deleteApp(app);
    } catch (error) {
      cleanupErrors.push(`firebase-app: ${error.message}`);
    }

    const cleanupOk = cleanupErrors.length === 0;
    console.log(`REMOTE_TEST_DATA_CLEANUP=${cleanupOk ? 'OK' : 'FAILED'}`);

    if (!cleanupOk) {
      console.error('CLEANUP_ERRORS=' + cleanupErrors.join(' | '));
      process.exitCode = 2;
    } else {
      console.log('PRODUCTION_ACCESS=NOT_RUN');
      console.log('MARCO4A3_PUBLIC_CATALOG_STAGING_SMOKE=APROVADO');
    }
  }
}

main().catch(error => {
  console.error('MARCO4A3_PUBLIC_CATALOG_STAGING_SMOKE=FALHOU');
  console.error(`ERROR=${error.message}`);
  if (!process.exitCode) process.exitCode = 1;
});
