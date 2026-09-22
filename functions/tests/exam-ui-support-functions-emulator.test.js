'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);
assertLocal('FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-exam-ui-support';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const app = initializeApp(
  { projectId },
  `exam-ui-support-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `exam_ui_${label}_${runId}`;
}

async function createUser(label, extra = {}) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Gate6B-${label}-${runId}!Aa1`;
  await auth.createUser({ uid, email, password, emailVerified: true });
  createdUids.add(uid);
  await db.doc(`usuarios/${uid}`).set({
    nome: `Pessoa ${label}`,
    email,
    cpf: '12345678909',
    status_conta: 'ativo',
    ...extra
  });
  return { uid, email, password };
}

async function signIn(actor) {
  const response = await fetch(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: actor.email,
        password: actor.password,
        returnSecureToken: true
      })
    }
  );
  const body = await response.json();
  assert.ok(body.idToken, JSON.stringify(body));
  return body.idToken;
}

async function call(functionName, token, data = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${functionBase}/${functionName}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ data })
  });
  const text = await response.text();
  let body = {};
  try { body = JSON.parse(text); } catch (_) {}
  return { status: response.status, body, text };
}

function payload(response) {
  return response.body?.result ?? response.body?.data ?? null;
}

async function membership(label, userId, organizationId, papel, status = 'ativo', extra = {}) {
  await db.doc(`vinculos_organizacao/${id(`membership_${label}`)}`).set({
    usuario_id: userId,
    organizacao_id: organizationId,
    papel,
    status,
    ...extra
  });
}

async function seed() {
  const organizationId = id('org_main');
  const otherOrganizationId = id('org_other');
  await db.doc(`organizacoes/${organizationId}`).set({ nome: 'Academia Main', status: 'ativa' });
  await db.doc(`organizacoes/${otherOrganizationId}`).set({ nome: 'Academia Other', status: 'ativa' });

  const instructor = await createUser('instructor', { tipo_usuario: 'professor' });
  const deniedInstructor = await createUser('denied', { tipo_usuario: 'professor' });
  const activeStudent = await createUser('active_student', { nome: 'ALUNO ATIVO', faixa_atual: 'Branca' });
  const activeStudent2 = await createUser('active_student_2', { nome: 'ALUNO AZUL', faixa_atual: 'Azul' });
  const suspendedStudent = await createUser('suspended_student', { nome: 'ALUNO SUSPENSO', faixa_atual: 'Roxa' });
  const foreignStudent = await createUser('foreign_student', { nome: 'ALUNO OUTRA ORG', faixa_atual: 'Branca' });

  await membership('instructor', instructor.uid, organizationId, 'professor', 'ativo', { pode_aplicar_exames: true });
  await membership('denied', deniedInstructor.uid, organizationId, 'professor', 'ativo', { pode_aplicar_exames: false });
  await membership('active_student', activeStudent.uid, organizationId, 'aluno', 'ativo');
  await membership('active_student_2', activeStudent2.uid, organizationId, 'aluno', 'ativo');
  await membership('suspended_student', suspendedStudent.uid, organizationId, 'aluno', 'suspenso');
  await membership('foreign_student', foreignStudent.uid, otherOrganizationId, 'aluno', 'ativo');

  return {
    organizationId,
    otherOrganizationId,
    instructor,
    deniedInstructor,
    activeStudent,
    activeStudent2,
    suspendedStudent,
    foreignStudent
  };
}

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

async function deleteCollection(name) {
  const snap = await db.collection(name).get();
  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const batch = db.batch();
    for (const doc of snap.docs.slice(offset, offset + 400)) batch.delete(doc.ref);
    await batch.commit();
  }
}

async function cleanup() {
  for (const name of ['vinculos_organizacao', 'usuarios', 'alunos', 'organizacoes']) {
    await deleteCollection(name);
  }
  await Promise.allSettled([...createdUids].map(uid => auth.deleteUser(uid)));
  await deleteApp(app);
}

async function main() {
  try {
    const seeded = await seed();
    const instructorToken = await signIn(seeded.instructor);
    const deniedToken = await signIn(seeded.deniedInstructor);

    await test('anonimo nao lista candidatos elegiveis', async () => {
      const response = await call('listarAlunosElegiveisExameFaixaV12', null, {
        organizationId: seeded.organizationId
      });
      assert.equal(response.status, 401, response.text);
    });

    await test('payload extra e rejeitado', async () => {
      const response = await call('listarAlunosElegiveisExameFaixaV12', instructorToken, {
        organizationId: seeded.organizationId,
        studentId: seeded.activeStudent.uid
      });
      assert.equal(response.status, 400, response.text);
      assert.equal(response.body?.error?.status, 'INVALID_ARGUMENT', response.text);
    });

    let items = [];
    await test('instrutor autorizado recebe somente alunos ativos da organizacao', async () => {
      const response = await call('listarAlunosElegiveisExameFaixaV12', instructorToken, {
        organizationId: seeded.organizationId,
        limit: 100
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      items = result.items;
      assert.deepEqual(
        items.map(item => item.studentId).sort(),
        [seeded.activeStudent.uid, seeded.activeStudent2.uid].sort()
      );
      assert.equal(items.some(item => item.studentId === seeded.suspendedStudent.uid), false);
      assert.equal(items.some(item => item.studentId === seeded.foreignStudent.uid), false);
    });

    await test('view de candidato e estritamente sanitizada', async () => {
      assert.ok(items.length >= 2);
      for (const item of items) {
        assert.deepEqual(Object.keys(item).sort(), ['currentBelt', 'name', 'studentId']);
      }
      const serialized = JSON.stringify(items);
      for (const forbidden of ['cpf', '@example.test', 'membership', 'orderId', 'wallet', 'provider']) {
        assert.equal(serialized.includes(forbidden), false, forbidden);
      }
    });

    await test('instrutor sem canApplyOfficialExam recebe permission denied', async () => {
      const response = await call('listarAlunosElegiveisExameFaixaV12', deniedToken, {
        organizationId: seeded.organizationId
      });
      assert.equal(response.status, 403, response.text);
      assert.equal(response.body?.error?.status, 'PERMISSION_DENIED', response.text);
      assert.equal(
        response.body?.error?.details?.domainCode,
        'EXAM_UI_SUPPORT_PERMISSION_REQUIRED',
        response.text
      );
    });

    await test('instrutor nao atravessa isolamento organizacional', async () => {
      const response = await call('listarAlunosElegiveisExameFaixaV12', instructorToken, {
        organizationId: seeded.otherOrganizationId
      });
      assert.equal(response.status, 403, response.text);
      assert.equal(response.body?.error?.status, 'PERMISSION_DENIED', response.text);
    });

    console.log(`EXAM_UI_SUPPORT_FUNCTIONS_EMULATOR_V1_2=${passed}/6`);
    if (passed !== 6) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
