'use strict';

const crypto = require('crypto');
const axios = require('axios');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const REGION = 'southamerica-east1';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const REQUIRED_FUNCTIONS = [
  'criarCursoV12',
  'atualizarCursoV12',
  'alterarStatusCursoV12',
  'listarCursosAdministraveisV12'
];

function fail(message) {
  const error = new Error(message);
  error.isSmokeAssertion = true;
  throw error;
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const apiKey = String(process.env.FIREBASE_WEB_API_KEY || '').trim();
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

  if (!apiKey) {
    fail('FIREBASE_WEB_API_KEY do projeto bjj-exams-staging é obrigatória.');
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

  return { apiKey };
}

function randomPassword() {
  return `BjjExams-${crypto.randomBytes(18).toString('hex')}!Aa9`;
}

function callableUrl(functionName) {
  return `https://${REGION}-${TARGET_PROJECT}.cloudfunctions.net/${functionName}`;
}

async function signInWithPassword({ apiKey, email, password }) {
  const response = await axios.post(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`,
    {
      email,
      password,
      returnSecureToken: true
    },
    {
      timeout: 30000,
      validateStatus: () => true
    }
  );

  if (response.status !== 200 || !response.data?.idToken) {
    const detail = response.data?.error?.message || `HTTP ${response.status}`;
    fail(`Falha ao autenticar usuário temporário no staging: ${detail}.`);
  }

  return response.data.idToken;
}

async function callCallable(functionName, idToken, data = {}) {
  if (!REQUIRED_FUNCTIONS.includes(functionName)) {
    fail(`Callable fora do escopo do Marco 4B: ${functionName}.`);
  }

  const response = await axios.post(
    callableUrl(functionName),
    { data },
    {
      headers: {
        Authorization: `Bearer ${idToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 45000,
      validateStatus: () => true
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

async function expectCallableError(label, expectedStatuses, operation) {
  try {
    await operation();
  } catch (error) {
    const actual = String(error.callableStatus || '').toUpperCase();
    if (expectedStatuses.includes(actual)) {
      console.log(`${label}=BLOCKED_${actual}`);
      return;
    }
    throw error;
  }

  fail(`${label}: operação deveria ter sido bloqueada.`);
}

async function deleteQuery(db, query) {
  const snap = await query.get();
  if (snap.empty) return 0;

  let deleted = 0;
  let batch = db.batch();
  let count = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    count += 1;
    deleted += 1;

    if (count === 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) await batch.commit();
  return deleted;
}

async function main() {
  const { apiKey } = validateEnvironment();
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const app = initializeApp({
    credential: applicationDefault(),
    projectId: TARGET_PROJECT
  }, `courses-smoke-${runId}`);

  const auth = getAuth(app);
  const db = getFirestore(app);
  const tempUsers = [];
  let instructorUid = null;
  let studentUid = null;
  let moderatorUid = null;
  let courseId = null;
  let cleanupOk = false;

  console.log('=== MARCO 4B - AUTHENTICATED COURSE STAGING SMOKE ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${runId}`);

  try {
    // Preflight somente leitura: confirma que as credenciais administrativas alcançam o staging.
    await Promise.all([
      auth.listUsers(1),
      db.collection('courses').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const password = randomPassword();
    const instructorEmail = `smoke-course-instructor-${runId}@example.invalid`;
    const studentEmail = `smoke-course-student-${runId}@example.invalid`;
    const moderatorEmail = `smoke-course-moderator-${runId}@example.invalid`;

    const instructorUser = await auth.createUser({
      email: instructorEmail,
      password,
      emailVerified: true,
      disabled: false
    });
    tempUsers.push(instructorUser.uid);
    instructorUid = instructorUser.uid;

    const studentUser = await auth.createUser({
      email: studentEmail,
      password,
      emailVerified: true,
      disabled: false
    });
    tempUsers.push(studentUser.uid);
    studentUid = studentUser.uid;

    const moderatorUser = await auth.createUser({
      email: moderatorEmail,
      password,
      emailVerified: true,
      disabled: false
    });
    tempUsers.push(moderatorUser.uid);
    moderatorUid = moderatorUser.uid;

    await auth.setCustomUserClaims(moderatorUid, { platform_admin: true });

    const fixtureBatch = db.batch();
    fixtureBatch.set(db.doc(`usuarios/${instructorUid}`), {
      nome: 'SMOKE COURSE INSTRUCTOR',
      email: instructorEmail,
      tipo_usuario: 'professor',
      papel_principal: 'instrutor',
      papeis: ['instrutor'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    fixtureBatch.set(db.doc(`usuarios/${studentUid}`), {
      nome: 'SMOKE COURSE STUDENT',
      email: studentEmail,
      tipo_usuario: 'aluno',
      papel_principal: 'aluno',
      papeis: ['aluno'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    fixtureBatch.set(db.doc(`usuarios/${moderatorUid}`), {
      nome: 'SMOKE COURSE MODERATOR',
      email: moderatorEmail,
      tipo_usuario: 'admin',
      papel_principal: 'admin',
      papeis: ['admin'],
      status_conta: 'ativo',
      smokeRunId: runId,
      criado_em: FieldValue.serverTimestamp()
    });
    await fixtureBatch.commit();
    console.log('TEMP_FIXTURES_CREATED=3');

    const [instructorToken, studentToken, moderatorToken] = await Promise.all([
      signInWithPassword({ apiKey, email: instructorEmail, password }),
      signInWithPassword({ apiKey, email: studentEmail, password }),
      signInWithPassword({ apiKey, email: moderatorEmail, password })
    ]);
    console.log('TEMP_AUTH_TOKENS=3/3');

    await expectCallableError(
      'REMOTE_STUDENT_CREATE',
      ['PERMISSION_DENIED'],
      () => callCallable('criarCursoV12', studentToken, {
        title: 'Smoke student forbidden',
        description: 'Este curso não deve ser criado por um aluno autenticado.',
        ownerType: 'user',
        visibility: 'platform',
        isPaid: false,
        priceCents: 0,
        currency: 'BRL'
      })
    );

    const created = await callCallable('criarCursoV12', instructorToken, {
      title: `Smoke Course ${runId}`,
      description: 'Curso temporário usado exclusivamente para validar o fluxo autenticado no staging.',
      ownerType: 'user',
      visibility: 'platform',
      isPaid: false,
      priceCents: 0,
      currency: 'BRL'
    });

    courseId = created?.course?.id || null;
    assert(courseId, 'criarCursoV12 não retornou course.id.');
    assert(created.course.status === 'draft', 'Curso recém-criado não está em draft.');
    assert(created.course.ownerId === instructorUid, 'Owner do curso não corresponde ao instrutor temporário.');
    console.log('REMOTE_INSTRUCTOR_CREATE_DRAFT=OK');

    const updated = await callCallable('atualizarCursoV12', instructorToken, {
      courseId,
      title: `Smoke Course Updated ${runId}`,
      description: 'Descrição atualizada e suficientemente completa para permitir revisão e publicação.',
      visibility: 'platform',
      isPaid: false,
      priceCents: 0,
      currency: 'BRL'
    });
    assert(updated?.course?.id === courseId, 'atualizarCursoV12 retornou curso inesperado.');
    assert(updated.course.status === 'draft', 'Atualização alterou o status do draft indevidamente.');
    console.log('REMOTE_INSTRUCTOR_UPDATE_DRAFT=OK');

    const instructorList = await callCallable('listarCursosAdministraveisV12', instructorToken, {});
    assert(
      Array.isArray(instructorList?.courses) && instructorList.courses.some(course => course.id === courseId),
      'Instrutor não encontrou seu próprio curso na listagem administrativa.'
    );
    console.log('REMOTE_INSTRUCTOR_LIST_OWN=OK');

    const review = await callCallable('alterarStatusCursoV12', instructorToken, {
      courseId,
      status: 'review'
    });
    assert(review?.course?.status === 'review', 'Curso não avançou para review.');
    console.log('REMOTE_INSTRUCTOR_SUBMIT_REVIEW=OK');

    await expectCallableError(
      'REMOTE_INSTRUCTOR_SELF_PUBLISH',
      ['PERMISSION_DENIED'],
      () => callCallable('alterarStatusCursoV12', instructorToken, {
        courseId,
        status: 'published'
      })
    );

    const moderatorList = await callCallable('listarCursosAdministraveisV12', moderatorToken, {});
    assert(
      Array.isArray(moderatorList?.courses) && moderatorList.courses.some(course => course.id === courseId),
      'Moderador não encontrou o curso submetido para revisão.'
    );
    console.log('REMOTE_PLATFORM_ADMIN_LIST=OK');

    const published = await callCallable('alterarStatusCursoV12', moderatorToken, {
      courseId,
      status: 'published'
    });
    assert(published?.course?.status === 'published', 'Moderador não publicou o curso.');
    console.log('REMOTE_PLATFORM_ADMIN_PUBLISH=OK');

    const persisted = await db.doc(`courses/${courseId}`).get();
    assert(persisted.exists, 'Curso publicado não existe no Firestore de staging.');
    assert(persisted.data().status === 'published', 'Status persistido do curso não é published.');
    assert(persisted.data().ownerId === instructorUid, 'Owner persistido foi alterado indevidamente.');
    assert(persisted.data().publishedAt, 'publishedAt não foi registrado.');
    console.log('REMOTE_PUBLISHED_STATE_CONFIRMED=True');

    await expectCallableError(
      'REMOTE_INSTRUCTOR_EDIT_PUBLISHED',
      ['FAILED_PRECONDITION'],
      () => callCallable('atualizarCursoV12', instructorToken, {
        courseId,
        title: 'Alteração indevida após publicação'
      })
    );

    console.log('COURSE_AUTHENTICATED_STAGING_SMOKE=APROVADO');
  } finally {
    const cleanupErrors = [];

    try {
      if (instructorUid) {
        const courseSnap = await db.collection('courses').where('ownerId', '==', instructorUid).get();
        for (const courseDoc of courseSnap.docs) {
          await deleteQuery(
            db,
            db.collection('audit_logs').where('entityId', '==', courseDoc.id)
          );
          await courseDoc.ref.delete();
        }
      } else if (courseId) {
        await deleteQuery(db, db.collection('audit_logs').where('entityId', '==', courseId));
        await db.doc(`courses/${courseId}`).delete();
      }
    } catch (error) {
      cleanupErrors.push(`courses/audit_logs: ${error.message}`);
    }

    for (const uid of [instructorUid, studentUid, moderatorUid].filter(Boolean)) {
      try {
        await Promise.all([
          db.doc(`usuarios/${uid}`).delete(),
          db.doc(`professores/${uid}`).delete(),
          db.doc(`alunos/${uid}`).delete()
        ]);
      } catch (error) {
        cleanupErrors.push(`profiles/${uid}: ${error.message}`);
      }
    }

    if (tempUsers.length > 0) {
      try {
        const deleteResult = await auth.deleteUsers(tempUsers);
        if (deleteResult.failureCount > 0) {
          cleanupErrors.push(`auth: ${deleteResult.failureCount} usuário(s) não removido(s)`);
        }
      } catch (error) {
        cleanupErrors.push(`auth: ${error.message}`);
      }
    }

    try {
      await deleteApp(app);
    } catch (error) {
      cleanupErrors.push(`firebase-app: ${error.message}`);
    }

    cleanupOk = cleanupErrors.length === 0;
    console.log(`REMOTE_TEST_DATA_CLEANUP=${cleanupOk ? 'OK' : 'FAILED'}`);
    console.log(`TEMP_AUTH_USERS_DELETED=${cleanupOk ? 'True' : 'CHECK_REQUIRED'}`);

    if (!cleanupOk) {
      console.error('CLEANUP_ERRORS=' + cleanupErrors.join(' | '));
      process.exitCode = 2;
    }
  }

  if (cleanupOk) {
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4B_COURSE_AUTHENTICATED_STAGING_SMOKE=APROVADO');
  }
}

main().catch(error => {
  console.error('MARCO4B_COURSE_AUTHENTICATED_STAGING_SMOKE=FALHOU');
  console.error(`ERROR=${error.message}`);
  if (!process.exitCode) process.exitCode = 1;
});
