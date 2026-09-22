'use strict';

const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const {
  createExamSelectionService,
  ExamSelectionServiceError
} = require('../src/exams/exam-selection-service');
const {
  examRegistrationDocumentId
} = require('../src/exams/exam-registration-domain');

function assertLocal(name, value) {
  if (!value || !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)) {
    throw new Error(`${name} nao e local: ${value || '<EMPTY>'}`);
  }
}

assertLocal('FIRESTORE_EMULATOR_HOST', process.env.FIRESTORE_EMULATOR_HOST);

const projectId = 'demo-bjj-exams-exam-selection';
const app = initializeApp(
  { projectId },
  `exam-selection-service-${process.pid}-${Date.now()}`
);
const db = getFirestore(app);
const runId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const fixedNow = new Date('2026-09-20T02:00:00.000Z');
const service = createExamSelectionService({
  db,
  clock: () => new Date(fixedNow.getTime())
});
let passed = 0;

function id(label) {
  return `exam_sel_${label}_${runId}`;
}

async function seedUser(uid, belt = 'Branca') {
  await db.doc(`usuarios/${uid}`).set({
    nome: uid,
    faixa: belt,
    faixa_atual: belt,
    status_conta: 'ativo'
  });
}

async function seedOrganization(organizationId, status = 'ativa') {
  await db.doc(`organizacoes/${organizationId}`).set({
    nome: organizationId,
    status
  });
}

async function seedMembership({ organizationId, userId, role, canApply = false, status = 'ativo' }) {
  const membershipId = `${organizationId}__${userId}`;
  await db.doc(`vinculos_organizacao/${membershipId}`).set({
    organizacao_id: organizationId,
    usuario_id: userId,
    papel: role,
    status,
    pode_aplicar_exames: canApply
  });
  return membershipId;
}

async function createSession(actorId, organizationId, targetBelt = 'Azul') {
  return service.createSession({
    actorId,
    data: {
      organizationId,
      targetBelt,
      priceCents: 12990,
      scheduledAt: null
    }
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
  await deleteApp(app);
}

async function main() {
  const orgA = id('org_a');
  const orgB = id('org_b');
  const ownerA = id('owner_a');
  const instructorNoPermission = id('instructor_no_permission');
  const instructorWithPermission = id('instructor_with_permission');
  const studentA = id('student_a');
  const studentB = id('student_b');
  const invalidBeltStudent = id('student_invalid_belt');

  try {
    await seedOrganization(orgA);
    await seedOrganization(orgB);
    for (const uid of [ownerA, instructorNoPermission, instructorWithPermission, studentA, studentB]) {
      await seedUser(uid, uid === studentA ? 'Branca' : 'Azul');
    }
    await seedUser(invalidBeltStudent, 'Coral');

    await seedMembership({ organizationId: orgA, userId: ownerA, role: 'owner' });
    await seedMembership({ organizationId: orgA, userId: instructorNoPermission, role: 'instructor' });
    await seedMembership({ organizationId: orgA, userId: instructorWithPermission, role: 'instructor', canApply: true });
    const studentAMembershipId = await seedMembership({ organizationId: orgA, userId: studentA, role: 'student' });
    await seedMembership({ organizationId: orgB, userId: studentB, role: 'student' });
    await seedMembership({ organizationId: orgA, userId: invalidBeltStudent, role: 'student' });

    let ownerSession;

    await test('owner ativo cria sessao draft com identidade server-side', async () => {
      ownerSession = await createSession(ownerA, orgA, 'Azul');
      assert.ok(ownerSession.sessionId);
      assert.equal(ownerSession.session.status, 'draft');
      assert.equal(ownerSession.session.organizationId, orgA);
      assert.equal(ownerSession.session.responsibleInstructorId, ownerA);
      assert.equal(ownerSession.session.createdBy, ownerA);
      assert.equal(ownerSession.session.priceCents, 12990);
      assert.equal(ownerSession.session.currency, 'BRL');
    });

    await test('instrutor sem permissao explicita nao cria sessao', async () => {
      await assert.rejects(
        () => createSession(instructorNoPermission, orgA),
        error => error instanceof ExamSelectionServiceError && error.code === 'EXAM_ACTOR_MEMBERSHIP_REQUIRED'
      );
    });

    await test('instrutor com permissao explicita cria sessao', async () => {
      const result = await createSession(instructorWithPermission, orgA, 'Roxa');
      assert.equal(result.session.responsibleInstructorId, instructorWithPermission);
      assert.equal(result.session.targetBelt, 'Roxa');
    });

    await test('selecao same-org cria registration deterministica e avanca sessao', async () => {
      const selected = await service.selectCandidate({
        actorId: ownerA,
        data: { sessionId: ownerSession.sessionId, studentId: studentA }
      });
      const expectedId = examRegistrationDocumentId({
        sessionId: ownerSession.sessionId,
        studentId: studentA
      });
      assert.equal(selected.created, true);
      assert.equal(selected.registrationId, expectedId);
      assert.equal(selected.registration.status, 'selected');
      assert.equal(selected.registration.membershipId, studentAMembershipId);
      assert.equal(selected.registration.currentBelt, 'Branca');
      assert.equal(selected.registration.targetBelt, 'Azul');
      assert.equal(selected.session.status, 'candidates_selected');
    });

    await test('repetir selecao e idempotente e nao duplica registration', async () => {
      const again = await service.selectCandidate({
        actorId: ownerA,
        data: { sessionId: ownerSession.sessionId, studentId: studentA }
      });
      assert.equal(again.created, false);
      const snap = await db.collection('exam_registrations')
        .where('sessionId', '==', ownerSession.sessionId)
        .where('studentId', '==', studentA)
        .get();
      assert.equal(snap.size, 1);
    });

    await test('aluno de outra organizacao nao pode ser selecionado', async () => {
      await assert.rejects(
        () => service.selectCandidate({
          actorId: ownerA,
          data: { sessionId: ownerSession.sessionId, studentId: studentB }
        }),
        error => error instanceof ExamSelectionServiceError && error.code === 'EXAM_STUDENT_MEMBERSHIP_REQUIRED'
      );
    });

    await test('faixa atual invalida do perfil bloqueia snapshot academico', async () => {
      await assert.rejects(
        () => service.selectCandidate({
          actorId: ownerA,
          data: { sessionId: ownerSession.sessionId, studentId: invalidBeltStudent }
        }),
        error => error?.code === 'INVALID_EXAM_BELT'
      );
    });

    await test('sessao cancelada nao aceita novo candidato', async () => {
      const blockedSession = await createSession(ownerA, orgA, 'Marrom');
      await db.doc(`exam_sessions/${blockedSession.sessionId}`).update({
        status: 'cancelled',
        updatedAt: fixedNow
      });
      await assert.rejects(
        () => service.selectCandidate({
          actorId: ownerA,
          data: { sessionId: blockedSession.sessionId, studentId: studentA }
        }),
        error => error instanceof ExamSelectionServiceError && error.code === 'EXAM_SESSION_NOT_SELECTABLE'
      );
    });

    console.log(`EXAM_SELECTION_SERVICE_EMULATOR_V1_2=${passed}/8`);
    if (passed !== 8) process.exitCode = 1;
  } finally {
    await cleanup();
  }
}

main().catch(async error => {
  console.error(error);
  process.exitCode = 1;
  try { await cleanup(); } catch (_) {}
});
