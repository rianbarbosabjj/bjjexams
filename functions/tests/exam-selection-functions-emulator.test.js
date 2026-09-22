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

const projectId = 'demo-bjj-exams-exam-selection';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const app = initializeApp(
  { projectId },
  `exam-selection-functions-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `exam_sel_fn_${label}_${runId}`;
}

async function createUser(label, belt = 'Branca') {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `Exam-${runId}-${label}!Aa1`;
  await auth.createUser({ uid, email, password, emailVerified: true });
  createdUids.add(uid);
  await db.doc(`usuarios/${uid}`).set({
    nome: `Usuario ${label}`,
    email,
    faixa: belt,
    faixa_atual: belt,
    status_conta: 'ativo'
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

async function seedOrganization(organizationId) {
  await db.doc(`organizacoes/${organizationId}`).set({
    nome: organizationId,
    status: 'ativa'
  });
}

async function seedMembership({ organizationId, userId, role, canApply = false }) {
  await db.doc(`vinculos_organizacao/${organizationId}__${userId}`).set({
    organizacao_id: organizationId,
    usuario_id: userId,
    papel: role,
    status: 'ativo',
    pode_aplicar_exames: canApply
  });
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
  for (const name of [
    'audit_logs',
    'exam_registrations',
    'exam_sessions',
    'vinculos_organizacao',
    'organizacoes',
    'alunos',
    'usuarios'
  ]) {
    await deleteCollection(name);
  }
  await Promise.allSettled([...createdUids].map(uid => auth.deleteUser(uid)));
  await deleteApp(app);
}

async function main() {
  const orgA = id('org_a');
  const orgB = id('org_b');
  const owner = await createUser('owner', 'Marrom');
  const studentA = await createUser('student_a', 'Branca');
  const studentB = await createUser('student_b', 'Branca');
  const unauthorized = await createUser('unauthorized', 'Azul');

  try {
    await seedOrganization(orgA);
    await seedOrganization(orgB);
    await seedMembership({ organizationId: orgA, userId: owner.uid, role: 'owner' });
    await seedMembership({ organizationId: orgA, userId: studentA.uid, role: 'student' });
    await seedMembership({ organizationId: orgB, userId: studentB.uid, role: 'student' });
    await seedMembership({ organizationId: orgA, userId: unauthorized.uid, role: 'student' });

    const ownerToken = await signIn(owner);
    const unauthorizedToken = await signIn(unauthorized);
    let sessionId = null;

    await test('anonimo nao cria sessao de exame', async () => {
      const response = await call('criarSessaoExameFaixaV12', null, {
        organizationId: orgA,
        targetBelt: 'Azul',
        priceCents: 12990
      });
      assert.equal(response.status, 401, response.text);
    });

    await test('payload privilegiado extra e rejeitado antes do service', async () => {
      const response = await call('criarSessaoExameFaixaV12', ownerToken, {
        organizationId: orgA,
        targetBelt: 'Azul',
        priceCents: 12990,
        responsibleInstructorId: unauthorized.uid
      });
      assert.equal(response.status, 400, response.text);
    });

    await test('owner cria sessao e resposta nao expoe campos internos', async () => {
      const response = await call('criarSessaoExameFaixaV12', ownerToken, {
        organizationId: orgA,
        targetBelt: 'Azul',
        priceCents: 12990,
        scheduledAt: '2026-10-15T18:00:00.000Z'
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      sessionId = result.session.id;
      assert.equal(result.session.responsibleInstructorId, owner.uid);
      assert.equal(result.session.status, 'draft');
      assert.equal(result.session.currency, 'BRL');
      const serialized = JSON.stringify(result);
      assert.equal(serialized.includes('financialRuleId'), false);
      assert.equal(serialized.includes('createdBy'), false);
    });

    await test('aluno sem permissao de exame nao cria sessao', async () => {
      const response = await call('criarSessaoExameFaixaV12', unauthorizedToken, {
        organizationId: orgA,
        targetBelt: 'Roxa',
        priceCents: 15000
      });
      assert.equal(response.status, 403, response.text);
    });

    await test('owner seleciona aluno same-org por callable sanitizada', async () => {
      const response = await call('selecionarAlunoExameFaixaV12', ownerToken, {
        sessionId,
        studentId: studentA.uid
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.created, true);
      assert.equal(result.registration.studentId, studentA.uid);
      assert.equal(result.registration.status, 'selected');
      assert.equal(result.session.status, 'candidates_selected');
      const serialized = JSON.stringify(result.registration);
      assert.equal(serialized.includes('membershipId'), false);
      assert.equal(serialized.includes('orderId'), false);
    });

    await test('selecao repetida pela callable permanece idempotente', async () => {
      const response = await call('selecionarAlunoExameFaixaV12', ownerToken, {
        sessionId,
        studentId: studentA.uid
      });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.created, false);
      assert.equal(result.registration.status, 'selected');
    });

    await test('aluno de outra organizacao nao pode ser selecionado', async () => {
      const response = await call('selecionarAlunoExameFaixaV12', ownerToken, {
        sessionId,
        studentId: studentB.uid
      });
      assert.equal(response.status, 403, response.text);
    });

    console.log(`EXAM_SELECTION_FUNCTIONS_EMULATOR_V1_2=${passed}/7`);
    if (passed !== 7) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
