'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const {
  buildExamSession,
  validateExamSession
} = require('../src/exams/exam-session-domain');
const {
  buildSelectedExamRegistration,
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);
assertLocal('FIREBASE_AUTH_EMULATOR_HOST', process.env.FIREBASE_AUTH_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-exam-read-functions';
const functionBase = `http://127.0.0.1:5001/${projectId}/southamerica-east1`;
const authBase = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;
const app = initializeApp({ projectId }, `exam-read-functions-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const auth = getAuth(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const createdUids = new Set();
let passed = 0;

function id(label) {
  return `examreadfn_${label}_${runId}`;
}

function now(offset = 0) {
  return new Date(Date.parse('2026-09-20T15:00:00.000Z') + offset * 60000);
}

async function createUser(label) {
  const uid = id(label);
  const email = `${uid}@example.test`;
  const password = `ExamRead-${runId}-${label}!Aa1`;
  await auth.createUser({ uid, email, password, emailVerified: true });
  createdUids.add(uid);
  await db.doc(`usuarios/${uid}`).set({ nome: label, email, status_conta: 'ativo' });
  return { uid, email, password };
}

async function signIn(actor) {
  const response = await fetch(
    `${authBase}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: actor.email, password: actor.password, returnSecureToken: true })
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

async function seedMembership({ membershipId, userId, organizationId, role, canApply = false }) {
  await db.doc(`vinculos_organizacao/${membershipId}`).set({
    usuario_id: userId,
    organizacao_id: organizationId,
    papel: role,
    status: 'ativo',
    pode_aplicar_exames: canApply
  });
}

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
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
    'exam_registrations',
    'exam_sessions',
    'vinculos_organizacao',
    'organizacoes',
    'usuarios',
    'alunos'
  ]) {
    await deleteCollection(name);
  }
  await Promise.allSettled([...createdUids].map(uid => auth.deleteUser(uid)));
  await deleteApp(app);
}

async function main() {
  try {
    const instructor = await createUser('instructor');
    const blocked = await createUser('blocked');
    const student = await createUser('student');
    const outsider = await createUser('outsider');
    const orgId = id('org');
    const otherOrgId = id('other_org');
    const sessionId = id('session');
    const otherSessionId = id('other_session');
    const instructorMembership = id('membership_instructor');
    const blockedMembership = id('membership_blocked');
    const studentMembership = id('membership_student');

    await db.doc(`organizacoes/${orgId}`).set({ nome: 'Academia Read', status: 'ativa' });
    await db.doc(`organizacoes/${otherOrgId}`).set({ nome: 'Academia Outra', status: 'ativa' });
    await seedMembership({ membershipId: instructorMembership, userId: instructor.uid, organizationId: orgId, role: 'professor', canApply: true });
    await seedMembership({ membershipId: blockedMembership, userId: blocked.uid, organizationId: orgId, role: 'professor', canApply: false });
    await seedMembership({ membershipId: studentMembership, userId: student.uid, organizationId: orgId, role: 'aluno' });

    const session = validateExamSession({
      ...buildExamSession({
        organizationId: orgId,
        responsibleInstructorId: instructor.uid,
        targetBelt: 'Azul',
        templateId: id('template_bound'),
        templateVersionId: 'v0000001',
        priceCents: 15000,
        currency: 'BRL',
        scheduledAt: now(60),
        createdBy: instructor.uid,
        timestamp: now()
      }),
      status: 'candidates_selected'
    });
    await db.doc(`exam_sessions/${sessionId}`).set(session);
    await db.doc(`exam_sessions/${otherSessionId}`).set(validateExamSession({
      ...buildExamSession({
        organizationId: otherOrgId,
        responsibleInstructorId: outsider.uid,
        targetBelt: 'Roxa',
        priceCents: 18000,
        currency: 'BRL',
        scheduledAt: now(120),
        createdBy: outsider.uid,
        timestamp: now()
      }),
      status: 'candidates_selected'
    }));

    const registration = buildSelectedExamRegistration({
      sessionId,
      organizationId: orgId,
      studentId: student.uid,
      instructorId: instructor.uid,
      currentBelt: 'Branca',
      targetBelt: 'Azul',
      membershipId: studentMembership,
      timestamp: now(1)
    });
    const registrationId = examRegistrationDocumentId({ sessionId, studentId: student.uid });
    await db.doc(`exam_registrations/${registrationId}`).set(registration);

    const instructorToken = await signIn(instructor);
    const blockedToken = await signIn(blocked);
    const studentToken = await signIn(student);
    const outsiderToken = await signIn(outsider);

    await test('anonimo nao lista exames do aluno', async () => {
      const response = await call('listarMeusExamesFaixaV12', null, {});
      assert.equal(response.status, 401, response.text);
    });

    await test('payload extra e rejeitado antes da leitura', async () => {
      const response = await call('listarMeusExamesFaixaV12', studentToken, { limit: 20, studentId: student.uid });
      assert.equal(response.status, 400, response.text);
    });

    await test('aluno recebe somente view sanitizada da propria registration', async () => {
      const response = await call('listarMeusExamesFaixaV12', studentToken, { limit: 20 });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].sessionId, sessionId);
      assert.equal(result.items[0].canStartCheckout, true);
      assert.equal(result.items[0].canStartExam, false);
      assert.equal(Object.hasOwn(result.items[0], 'orderId'), false);
      assert.equal(Object.hasOwn(result.items[0], 'providerPaymentId'), false);
    });

    await test('instrutor autorizado lista sessoes da organizacao', async () => {
      const response = await call('listarSessoesExameFaixaV12', instructorToken, { organizationId: orgId, limit: 20 });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].sessionId, sessionId);
      assert.equal(result.items[0].templateBound, true);
    });

    await test('detalhe do instrutor retorna candidato sem order ou provider id', async () => {
      const response = await call('obterSessaoExameFaixaV12', instructorToken, { sessionId });
      assert.equal(response.status, 200, response.text);
      const result = payload(response);
      assert.equal(result.ok, true);
      assert.equal(result.candidates.length, 1);
      assert.equal(result.candidates[0].student.studentId, student.uid);
      assert.equal(Object.hasOwn(result.candidates[0], 'orderId'), false);
      assert.equal(Object.hasOwn(result.candidates[0], 'providerPaymentId'), false);
      assert.equal(result.session.templateBound, true);
    });

    await test(
      'read callable bloqueia checkout visual quando template oficial ainda nao foi vinculado',
      async () => {
        const unboundStudent =
          await createUser('unbound_student');

        const unboundMembership =
          id('membership_unbound_student');

        const unboundSessionId =
          id('session_unbound');

        await seedMembership({
          membershipId: unboundMembership,
          userId: unboundStudent.uid,
          organizationId: orgId,
          role: 'aluno'
        });

        const unboundSession =
          validateExamSession({
            ...buildExamSession({
              organizationId: orgId,
              responsibleInstructorId:
                instructor.uid,
              targetBelt: 'Azul',
              priceCents: 15000,
              currency: 'BRL',
              scheduledAt: now(180),
              createdBy: instructor.uid,
              timestamp: now(30)
            }),
            status: 'candidates_selected'
          });

        await db.doc(
          `exam_sessions/${unboundSessionId}`
        ).set(unboundSession);

        const unboundRegistration =
          buildSelectedExamRegistration({
            sessionId: unboundSessionId,
            organizationId: orgId,
            studentId: unboundStudent.uid,
            instructorId: instructor.uid,
            currentBelt: 'Branca',
            targetBelt: 'Azul',
            membershipId: unboundMembership,
            timestamp: now(31)
          });

        await db.doc(
          `exam_registrations/${
            examRegistrationDocumentId({
              sessionId: unboundSessionId,
              studentId: unboundStudent.uid
            })
          }`
        ).set(unboundRegistration);

        const unboundToken =
          await signIn(unboundStudent);

        const response =
          await call(
            'listarMeusExamesFaixaV12',
            unboundToken,
            { limit: 20 }
          );

        assert.equal(
          response.status,
          200,
          response.text
        );

        const result =
          payload(response);

        assert.equal(
          result.items.length,
          1
        );

        assert.equal(
          result.items[0].state,
          'selected'
        );

        assert.equal(
          result.items[0].canStartCheckout,
          false
        );

        assert.equal(
          result.items[0].canResumePayment,
          false
        );

        assert.equal(
          Object.hasOwn(
            result.items[0],
            'templateId'
          ),
          false
        );

        assert.equal(
          Object.hasOwn(
            result.items[0],
            'templateVersionId'
          ),
          false
        );
      }
    );

    await test('instrutor sem canApplyOfficialExam recebe permission-denied', async () => {
      const response = await call('listarSessoesExameFaixaV12', blockedToken, { organizationId: orgId });
      assert.equal(response.status, 403, response.text);
      const crossOrg = await call('obterSessaoExameFaixaV12', outsiderToken, { sessionId });
      assert.equal(crossOrg.status, 403, crossOrg.text);
    });

    console.log(`EXAM_READ_FUNCTIONS_EMULATOR_V1_2=${passed}/7`);
    if (passed !== 7) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
