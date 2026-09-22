'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
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
  ExamReadServiceError,
  createExamReadService
} = require('../src/exams/exam-read-service');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-exam-read-service';
const app = initializeApp({ projectId }, `exam-read-${process.pid}-${Date.now()}`);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
let passed = 0;

function id(label) {
  return `examread_${label}_${runId}`;
}

function now(offsetMinutes = 0) {
  return new Date(Date.parse('2026-09-20T14:00:00.000Z') + offsetMinutes * 60000);
}

function sessionData({
  organizationId,
  instructorId,
  targetBelt = 'Azul',
  status = 'candidates_selected',
  offset = 0,
  withTemplateBinding = true
}) {
  const base = buildExamSession({
    organizationId,
    responsibleInstructorId: instructorId,
    targetBelt,
    templateId:
      withTemplateBinding
        ? id('template_bound')
        : null,
    templateVersionId:
      withTemplateBinding
        ? 'v0000001'
        : null,
    priceCents: 12500,
    currency: 'BRL',
    scheduledAt: now(1440),
    createdBy: instructorId,
    timestamp: now(offset)
  });
  return validateExamSession({ ...base, status, updatedAt: now(offset) });
}

function registrationData({
  sessionId,
  organizationId,
  studentId,
  instructorId,
  membershipId,
  targetBelt = 'Azul',
  status = 'selected',
  offset = 0
}) {
  const selected = buildSelectedExamRegistration({
    sessionId,
    organizationId,
    studentId,
    instructorId,
    currentBelt: 'Branca',
    targetBelt,
    membershipId,
    timestamp: now(offset)
  });
  const paymentBound = !['selected', 'cancelled'].includes(status);
  const paid = ['authorized', 'started', 'submitted', 'passed', 'failed', 'certified'].includes(status);
  const started = ['started', 'submitted', 'passed', 'failed', 'certified'].includes(status);
  const result = ['passed', 'failed', 'certified'].includes(status);
  return validateExamRegistration({
    ...selected,
    status,
    orderId: paymentBound ? id(`order_${sessionId}_${studentId}`) : null,
    paidAt: paid ? now(offset + 1) : null,
    authorizedAt: paid ? now(offset + 1) : null,
    attemptId: started ? id(`attempt_${sessionId}_${studentId}`) : null,
    resultId: result ? id(`result_${sessionId}_${studentId}`) : null,
    certificateId: status === 'certified' ? id(`cert_${sessionId}_${studentId}`) : null,
    cancelledAt: status === 'cancelled' ? now(offset + 1) : null,
    updatedAt: now(offset + 1)
  });
}

async function seedOrganization(orgId, name) {
  await db.doc(`organizacoes/${orgId}`).set({ nome: name, status: 'ativa' });
}

async function seedMembership({ membershipId, userId, organizationId, role, status = 'ativo', canApplyOfficialExam = false }) {
  await db.doc(`vinculos_organizacao/${membershipId}`).set({
    usuario_id: userId,
    organizacao_id: organizationId,
    papel: role,
    status,
    pode_aplicar_exames: canApplyOfficialExam
  });
}

async function seedSession({
  sessionId,
  organizationId,
  instructorId,
  status = 'candidates_selected',
  targetBelt = 'Azul',
  offset = 0,
  withTemplateBinding = true
}) {
  await db.doc(`exam_sessions/${sessionId}`).set(
    sessionData({
      organizationId,
      instructorId,
      status,
      targetBelt,
      offset,
      withTemplateBinding
    })
  );
}

async function seedRegistration(input) {
  const data = registrationData(input);
  const registrationId = examRegistrationDocumentId({
    sessionId: input.sessionId,
    studentId: input.studentId
  });
  await db.doc(`exam_registrations/${registrationId}`).set(data);
  return { registrationId, data };
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
  await deleteApp(app);
}

async function main() {
  try {
    const orgA = id('org_a');
    const orgB = id('org_b');
    const instructor = id('instructor');
    const blockedInstructor = id('blocked_instructor');
    const studentA = id('student_a');
    const studentB = id('student_b');
    const studentInactive = id('student_inactive');
    const sessionA = id('session_a');
    const sessionB = id('session_b');

    await seedOrganization(orgA, 'Academia A');
    await seedOrganization(orgB, 'Academia B');
    await seedMembership({
      membershipId: id('membership_instructor_a'),
      userId: instructor,
      organizationId: orgA,
      role: 'professor',
      canApplyOfficialExam: true
    });
    await seedMembership({
      membershipId: id('membership_blocked'),
      userId: blockedInstructor,
      organizationId: orgA,
      role: 'professor',
      canApplyOfficialExam: false
    });
    const membershipStudentA = id('membership_student_a');
    const membershipStudentB = id('membership_student_b');
    const membershipInactive = id('membership_student_inactive');
    await seedMembership({ membershipId: membershipStudentA, userId: studentA, organizationId: orgA, role: 'aluno' });
    await seedMembership({ membershipId: membershipStudentB, userId: studentB, organizationId: orgA, role: 'aluno' });
    await seedMembership({ membershipId: membershipInactive, userId: studentInactive, organizationId: orgA, role: 'aluno', status: 'suspenso' });
    await db.doc(`usuarios/${studentA}`).set({ nome: 'Aluno A' });
    await db.doc(`usuarios/${studentB}`).set({ nome: 'Aluno B' });
    await db.doc(`usuarios/${studentInactive}`).set({ nome: 'Aluno Inativo' });
    await seedSession({ sessionId: sessionA, organizationId: orgA, instructorId: instructor, offset: 2 });
    await seedSession({ sessionId: sessionB, organizationId: orgB, instructorId: id('instructor_b'), offset: 1 });
    await seedRegistration({
      sessionId: sessionA,
      organizationId: orgA,
      studentId: studentA,
      instructorId: instructor,
      membershipId: membershipStudentA,
      status: 'selected',
      offset: 3
    });
    await seedRegistration({
      sessionId: sessionA,
      organizationId: orgA,
      studentId: studentB,
      instructorId: instructor,
      membershipId: membershipStudentB,
      status: 'authorized',
      offset: 4
    });
    await seedRegistration({
      sessionId: sessionA,
      organizationId: orgA,
      studentId: studentInactive,
      instructorId: instructor,
      membershipId: membershipInactive,
      status: 'selected',
      offset: 5
    });

    const service = createExamReadService({ db });

    await test('instrutor autorizado lista apenas sessoes da propria organizacao', async () => {
      const result = await service.listInstructorSessions({ actorId: instructor, organizationId: orgA, limit: 20 });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].sessionId, sessionA);
      assert.equal(result.items[0].organization.name, 'Academia A');
      assert.equal(result.items[0].templateBound, true);
    });

    await test('instrutor sem permissao de exame nao acessa read model', async () => {
      await assert.rejects(
        service.listInstructorSessions({ actorId: blockedInstructor, organizationId: orgA }),
        error => error instanceof ExamReadServiceError && error.code === 'EXAM_READ_PERMISSION_REQUIRED'
      );
    });

    await test('detalhe da sessao sanitiza candidatos e nao expoe orderId', async () => {
      const result = await service.getInstructorSession({ actorId: instructor, sessionId: sessionA });
      assert.equal(result.candidates.length, 3);
      const authorized = result.candidates.find(item => item.student.studentId === studentB);
      assert.equal(authorized.authorized, true);
      assert.equal(authorized.student.name, 'Aluno B');
      assert.equal(Object.hasOwn(authorized, 'orderId'), false);
      assert.equal(Object.hasOwn(authorized, 'attemptId'), false);
    });

    await test('aluno ve apenas registrations do proprio uid', async () => {
      const result = await service.listStudentExams({ actorId: studentA });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].sessionId, sessionA);
      assert.equal(result.items[0].state, 'selected');
      assert.equal(result.items[0].canStartCheckout, true);
      assert.equal(Object.hasOwn(result.items[0], 'studentId'), false);
      assert.equal(Object.hasOwn(result.items[0], 'orderId'), false);
    });

    await test(
      'aluno selecionado sem template oficial nao recebe checkout habilitado',
      async () => {
        const unboundSession =
          id('session_unbound');

        const unboundStudent =
          id('student_unbound');

        const unboundMembership =
          id('membership_student_unbound');

        await seedMembership({
          membershipId: unboundMembership,
          userId: unboundStudent,
          organizationId: orgA,
          role: 'aluno'
        });

        await db.doc(
          `usuarios/${unboundStudent}`
        ).set({
          nome: 'Aluno Unbound'
        });

        await seedSession({
          sessionId: unboundSession,
          organizationId: orgA,
          instructorId: instructor,
          offset: 20,
          withTemplateBinding: false
        });

        await seedRegistration({
          sessionId: unboundSession,
          organizationId: orgA,
          studentId: unboundStudent,
          instructorId: instructor,
          membershipId: unboundMembership,
          status: 'selected',
          offset: 21
        });

        const result =
          await service.listStudentExams({
            actorId: unboundStudent
          });

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
      }
    );

    await test('vinculo suspenso deixa exam visivel mas bloqueia checkout', async () => {
      const result = await service.listStudentExams({ actorId: studentInactive });
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0].state, 'selected');
      assert.equal(result.items[0].canStartCheckout, false);
    });

    await test('estado academico aparece apenas como started_or_later e nao libera prova', async () => {
      const sessionStarted = id('session_started');
      const studentStarted = id('student_started');
      const membershipStarted = id('membership_started');
      await seedMembership({ membershipId: membershipStarted, userId: studentStarted, organizationId: orgA, role: 'aluno' });
      await db.doc(`usuarios/${studentStarted}`).set({ nome: 'Aluno Started' });
      await seedSession({ sessionId: sessionStarted, organizationId: orgA, instructorId: instructor, status: 'ready', offset: 6 });
      await seedRegistration({
        sessionId: sessionStarted,
        organizationId: orgA,
        studentId: studentStarted,
        instructorId: instructor,
        membershipId: membershipStarted,
        status: 'started',
        offset: 7
      });
      const result = await service.listStudentExams({ actorId: studentStarted });
      assert.equal(result.items[0].state, 'started_or_later');
      assert.equal(result.items[0].canStartExam, false);
    });

    await test('mismatch canonico entre registration e sessao falha fechado', async () => {
      const badStudent = id('student_bad');
      const badMembership = id('membership_bad');
      await seedMembership({ membershipId: badMembership, userId: badStudent, organizationId: orgA, role: 'aluno' });
      const badRegistrationId = examRegistrationDocumentId({ sessionId: sessionA, studentId: badStudent });
      const bad = registrationData({
        sessionId: sessionA,
        organizationId: orgA,
        studentId: badStudent,
        instructorId: instructor,
        membershipId: badMembership,
        targetBelt: 'Roxa',
        status: 'selected',
        offset: 8
      });
      await db.doc(`exam_registrations/${badRegistrationId}`).set(bad);
      await assert.rejects(
        service.listStudentExams({ actorId: badStudent }),
        error => error instanceof ExamReadServiceError && error.code === 'EXAM_READ_CANONICAL_STATE_INVALID'
      );
    });

    console.log(`EXAM_READ_SERVICE_EMULATOR_V1_2=${passed}/8`);
    if (passed !== 8) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
