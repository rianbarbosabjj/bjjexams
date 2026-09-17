'use strict';

const fs = require('fs');
const path = require('path');
const { initializeApp, applicationDefault, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const CONFIRMATION_VALUE = 'I_UNDERSTAND_STAGING_WRITES';
const FIXTURE_FILE = path.join(__dirname, '..', '.course-instructor-ui-staging.local.json');

function fail(message) {
  throw new Error(message);
}

function validateEnvironment() {
  const confirmation = String(process.env.BJJEXAMS_STAGING_SMOKE_CONFIRM || '').trim();
  const declaredProject = String(
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
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
  if (!fs.existsSync(FIXTURE_FILE)) {
    fail('Arquivo local da fixture não encontrado; nada foi removido automaticamente.');
  }
}

async function deleteQuery(db, query) {
  const snap = await query.get();
  if (snap.empty) return 0;

  let batch = db.batch();
  let count = 0;
  let total = 0;

  for (const doc of snap.docs) {
    batch.delete(doc.ref);
    count += 1;
    total += 1;
    if (count === 400) {
      await batch.commit();
      batch = db.batch();
      count = 0;
    }
  }

  if (count > 0) await batch.commit();
  return total;
}

async function main() {
  validateEnvironment();

  const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, 'utf8'));
  if (fixture.projectId !== TARGET_PROJECT) {
    fail(`Fixture local não pertence ao staging: ${fixture.projectId || 'vazio'}.`);
  }

  const app = initializeApp({
    credential: applicationDefault(),
    projectId: TARGET_PROJECT
  }, `course-ui-cleanup-${fixture.runId}`);

  const auth = getAuth(app);
  const db = getFirestore(app);

  console.log('=== MARCO 4A.4b/4A.5b - INSTRUCTOR UI STAGING CLEANUP ===');
  console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
  console.log('PRODUCTION_ACCESS=FORBIDDEN');
  console.log(`RUN_ID=${fixture.runId}`);

  try {
    await Promise.all([
      auth.listUsers(1),
      db.collection('courses').limit(1).get()
    ]);
    console.log('STAGING_ADMIN_PREFLIGHT=OK');

    const courseSnap = await db.collection('courses')
      .where('ownerId', '==', fixture.uid)
      .get();

    const courseIds = courseSnap.docs.map(doc => doc.id);
    let subcollectionDocsDeleted = 0;

    for (const courseDoc of courseSnap.docs) {
      const courseRef = courseDoc.ref;
      subcollectionDocsDeleted += await deleteQuery(db, courseRef.collection('modules'));
      subcollectionDocsDeleted += await deleteQuery(db, courseRef.collection('lessons'));

      const [remainingModules, remainingLessons] = await Promise.all([
        courseRef.collection('modules').limit(1).get(),
        courseRef.collection('lessons').limit(1).get()
      ]);
      if (!remainingModules.empty || !remainingLessons.empty) {
        fail(`Subcoleções do curso ${courseDoc.id} não foram limpas integralmente.`);
      }

      await courseRef.delete();
    }

    const auditDeleted = await deleteQuery(
      db,
      db.collection('audit_logs').where('actorId', '==', fixture.uid)
    );

    const batch = db.batch();
    batch.delete(db.doc(`usuarios/${fixture.uid}`));
    batch.delete(db.doc(`professores/${fixture.uid}`));
    if (fixture.organizationId) {
      batch.delete(db.doc(`equipes/${fixture.organizationId}`));
    }
    await batch.commit();

    try {
      await auth.deleteUser(fixture.uid);
    } catch (error) {
      if (error.code !== 'auth/user-not-found') throw error;
    }

    const [userDoc, professorDoc, orgDoc, remainingCourses, remainingAudits] = await Promise.all([
      db.doc(`usuarios/${fixture.uid}`).get(),
      db.doc(`professores/${fixture.uid}`).get(),
      fixture.organizationId
        ? db.doc(`equipes/${fixture.organizationId}`).get()
        : Promise.resolve({ exists: false }),
      db.collection('courses').where('ownerId', '==', fixture.uid).limit(1).get(),
      db.collection('audit_logs').where('actorId', '==', fixture.uid).limit(1).get()
    ]);

    if (
      userDoc.exists ||
      professorDoc.exists ||
      orgDoc.exists ||
      !remainingCourses.empty ||
      !remainingAudits.empty
    ) {
      fail('Cleanup remoto incompleto; arquivo local de credenciais foi preservado para recuperação.');
    }

    fs.unlinkSync(FIXTURE_FILE);

    console.log(`TEMP_SUBCOLLECTION_DOCS_DELETED=${subcollectionDocsDeleted}`);
    console.log(`TEMP_COURSES_DELETED=${courseIds.length}`);
    console.log(`TEMP_AUDIT_LOGS_DELETED=${auditDeleted}`);
    console.log('TEMP_INSTRUCTOR_PROFILE_DELETED=True');
    console.log('TEMP_LEGACY_TEAM_FIXTURE_DELETED=True');
    console.log('TEMP_AUTH_USER_DELETED=True');
    console.log('LOCAL_CREDENTIAL_FILE_DELETED=True');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log('MARCO4A5B_INSTRUCTOR_UI_CLEANUP=OK');
  } finally {
    await deleteApp(app).catch(() => undefined);
  }
}

main().catch(error => {
  console.error('MARCO4A5B_INSTRUCTOR_UI_CLEANUP=FAILED');
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});
