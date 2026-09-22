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
  validateExamRegistration,
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');
const {
  examResultDocumentId,
  validateExamResult
} = require('../src/exams/exam-result-domain');

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

async function seedAcademicStudentFixture({
  label,
  organizationId,
  instructorId,
  status,
  offset,
  writeResult = true
}) {
  const student =
    await createUser(label);

  const membershipId =
    id(`membership_${label}`);

  const sessionId =
    id(`session_${label}`);

  const templateId =
    id(`template_${label}`);

  await seedMembership({
    membershipId,
    userId:
      student.uid,
    organizationId,
    role:
      'aluno'
  });

  const session =
    validateExamSession({
      ...buildExamSession({
        organizationId,
        responsibleInstructorId:
          instructorId,
        targetBelt:
          'Azul',
        templateId,
        templateVersionId:
          'v0000001',
        priceCents:
          15000,
        currency:
          'BRL',
        scheduledAt:
          now(offset + 60),
        createdBy:
          instructorId,
        timestamp:
          now(offset)
      }),
      status:
        'ready',
      updatedAt:
        now(offset)
    });

  await db.doc(
    `exam_sessions/${sessionId}`
  ).set(session);

  const selected =
    buildSelectedExamRegistration({
      sessionId,
      organizationId,
      studentId:
        student.uid,
      instructorId,
      currentBelt:
        'Branca',
      targetBelt:
        'Azul',
      membershipId,
      timestamp:
        now(offset + 1)
    });

  const registrationId =
    examRegistrationDocumentId({
      sessionId,
      studentId:
        student.uid
    });

  const started =
    [
      'started',
      'submitted',
      'passed',
      'failed',
      'certified'
    ].includes(status);

  const hasResult =
    [
      'submitted',
      'passed',
      'failed',
      'certified'
    ].includes(status);

  const attemptId =
    started
      ? id(`attempt_${label}`)
      : null;

  const resultId =
    hasResult
      ? examResultDocumentId(
          attemptId
        )
      : null;

  const registration =
    validateExamRegistration({
      ...selected,
      status,
      orderId:
        id(`order_${label}`),
      paidAt:
        now(offset + 2),
      authorizedAt:
        now(offset + 2),
      attemptId,
      resultId,
      certificateId:
        status === 'certified'
          ? id(`certificate_${label}`)
          : null,
      updatedAt:
        now(offset + 3)
    });

  await db.doc(
    `exam_registrations/${registrationId}`
  ).set(registration);

  if (
    resultId &&
    writeResult
  ) {
    const outcome =
      status === 'failed'
        ? 'failed'
        : 'passed';

    const result =
      validateExamResult({
        resultVersion:
          1,
        attemptId,
        registrationId,
        sessionId,
        organizationId,
        studentId:
          student.uid,
        templateId:
          session.templateId,
        templateVersionId:
          session.templateVersionId,
        targetBelt:
          registration.targetBelt,
        scoreBps:
          outcome === 'passed'
            ? 10000
            : 5000,
        correctCount:
          outcome === 'passed'
            ? 2
            : 1,
        totalQuestions:
          2,
        outcome,
        reason:
          outcome === 'passed'
            ? 'score_passed'
            : 'score_failed',
        certificateEligible:
          outcome === 'passed',
        finalizedAt:
          now(offset + 4)
      });

    await db.doc(
      `exam_results/${resultId}`
    ).set(result);
  }

  return {
    student,
    token:
      await signIn(student),
    membershipId,
    sessionId,
    registrationId,
    attemptId,
    resultId
  };
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
    'exam_results',
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

    await test(
      'authorized expoe registrationId e libera start via callable',
      async () => {
        const fixture =
          await seedAcademicStudentFixture({
            label:
              'authorized_student',
            organizationId:
              orgId,
            instructorId:
              instructor.uid,
            status:
              'authorized',
            offset:
              200
          });

        const response =
          await call(
            'listarMeusExamesFaixaV12',
            fixture.token,
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
          result.ok,
          true
        );

        assert.equal(
          result.items.length,
          1
        );

        const item =
          result.items[0];

        assert.equal(
          item.registrationId,
          fixture.registrationId
        );

        assert.equal(
          item.state,
          'authorized'
        );

        assert.equal(
          item.examState,
          'not_started'
        );

        assert.equal(
          item.canStartExam,
          true
        );

        assert.equal(
          item.canResumeExam,
          false
        );

        assert.equal(
          item.result,
          null
        );

        for (
          const forbidden of [
            'orderId',
            'providerPaymentId',
            'attemptId',
            'templateId',
            'templateVersionId',
            'correctAnswer',
            'answers'
          ]
        ) {
          assert.equal(
            Object.hasOwn(
              item,
              forbidden
            ),
            false
          );
        }
      }
    );

    await test(
      'started libera somente resume via callable',
      async () => {
        const fixture =
          await seedAcademicStudentFixture({
            label:
              'started_student',
            organizationId:
              orgId,
            instructorId:
              instructor.uid,
            status:
              'started',
            offset:
              300
          });

        const response =
          await call(
            'listarMeusExamesFaixaV12',
            fixture.token,
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

        const item =
          result.items[0];

        assert.equal(
          item.registrationId,
          fixture.registrationId
        );

        assert.equal(
          item.state,
          'started_or_later'
        );

        assert.equal(
          item.examState,
          'in_progress'
        );

        assert.equal(
          item.canStartExam,
          false
        );

        assert.equal(
          item.canResumeExam,
          true
        );

        assert.equal(
          item.result,
          null
        );

        assert.equal(
          Object.hasOwn(
            item,
            'attemptId'
          ),
          false
        );
      }
    );

    await test(
      'passed retorna somente resultado academico sanitizado via callable',
      async () => {
        const fixture =
          await seedAcademicStudentFixture({
            label:
              'passed_student',
            organizationId:
              orgId,
            instructorId:
              instructor.uid,
            status:
              'passed',
            offset:
              400
          });

        const response =
          await call(
            'listarMeusExamesFaixaV12',
            fixture.token,
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

        const item =
          result.items[0];

        assert.equal(
          item.registrationId,
          fixture.registrationId
        );

        assert.equal(
          item.state,
          'started_or_later'
        );

        assert.equal(
          item.examState,
          'passed'
        );

        assert.equal(
          item.canStartExam,
          false
        );

        assert.equal(
          item.canResumeExam,
          false
        );

        assert.equal(
          item.result.resultId,
          fixture.resultId
        );

        assert.equal(
          item.result.status,
          'passed'
        );

        assert.equal(
          item.result.scoreBps,
          10000
        );

        assert.equal(
          item.result.correctCount,
          2
        );

        assert.equal(
          item.result.totalQuestions,
          2
        );

        assert.equal(
          item.result.certificateEligible,
          true
        );

        const serializedResult =
          JSON.stringify(
            item.result
          );

        for (
          const forbidden of [
            'attemptId',
            'registrationId',
            'sessionId',
            'organizationId',
            'studentId',
            'templateId',
            'templateVersionId',
            'targetBelt',
            'reason',
            'correctAnswer',
            'answers'
          ]
        ) {
          assert.equal(
            serializedResult.includes(
              forbidden
            ),
            false
          );
        }
      }
    );

    await test(
      'resultado referenciado ausente falha fechado na callable',
      async () => {
        const fixture =
          await seedAcademicStudentFixture({
            label:
              'missing_result_student',
            organizationId:
              orgId,
            instructorId:
              instructor.uid,
            status:
              'passed',
            offset:
              500,
            writeResult:
              false
          });

        const response =
          await call(
            'listarMeusExamesFaixaV12',
            fixture.token,
            { limit: 20 }
          );

        assert.equal(
          response.status,
          404,
          response.text
        );

        assert.equal(
          response.body?.error?.status,
          'NOT_FOUND',
          response.text
        );

        assert.equal(
          response.body?.error?.details
            ?.domainCode,
          'EXAM_READ_RESULT_NOT_FOUND',
          response.text
        );
      }
    );

    console.log(`EXAM_READ_FUNCTIONS_EMULATOR_V1_2=${passed}/11`);
    if (passed !== 11) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
