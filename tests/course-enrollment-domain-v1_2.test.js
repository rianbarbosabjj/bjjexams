'use strict';

const assert = require('assert');
const {
  ENROLLMENT_SOURCES,
  ENROLLMENT_STATUSES,
  enrollmentDocumentId,
  validateEnrollment,
  enrollmentMatchesIdentity,
  assertCanSelfEnrollFreeCourse,
  buildFreeEnrollment,
  resolveCourseEntitlement
} = require('../functions/src/courses/course-enrollment-domain');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

const platformFreeCourse = {
  status: 'published',
  visibility: 'platform',
  organizationId: null,
  isPaid: false,
  priceCents: 0
};

const organizationFreeCourse = {
  status: 'published',
  visibility: 'organization',
  organizationId: 'org-1',
  isPaid: false,
  priceCents: 0
};

const activeMembership = {
  organizationId: 'org-1',
  userId: 'user-1',
  role: 'student',
  status: 'active'
};

function enrollment(overrides = {}) {
  return {
    courseId: 'course-1',
    userId: 'user-1',
    source: 'free',
    orderId: null,
    status: 'active',
    progressPercent: 0,
    ...overrides
  };
}

test('contrato canonico define fontes e status esperados', () => {
  assert.deepStrictEqual([...ENROLLMENT_SOURCES], ['free', 'order', 'admin_grant']);
  assert.deepStrictEqual([...ENROLLMENT_STATUSES], ['active', 'completed', 'cancelled', 'refunded']);
});

test('id da matricula e deterministico por curso e usuario', () => {
  const first = enrollmentDocumentId('course-1', 'user-1');
  const second = enrollmentDocumentId('course-1', 'user-1');
  const other = enrollmentDocumentId('course-1', 'user-2');
  assert.strictEqual(first, second);
  assert.notStrictEqual(first, other);
  assert.strictEqual(first.length, 64);
});

test('matricula originada de pedido exige orderId', () => {
  assert.throws(
    () => validateEnrollment(enrollment({ source: 'order', orderId: null })),
    error => error?.code === 'ORDER_REQUIRED'
  );

  const valid = validateEnrollment(enrollment({ source: 'order', orderId: 'order-1' }));
  assert.strictEqual(valid.orderId, 'order-1');
});

test('matricula precisa corresponder ao curso e usuario esperados', () => {
  assert.strictEqual(
    enrollmentMatchesIdentity(enrollment(), { courseId: 'course-1', userId: 'user-1' }),
    true
  );
  assert.strictEqual(
    enrollmentMatchesIdentity(enrollment({ userId: 'user-2' }), { courseId: 'course-1', userId: 'user-1' }),
    false
  );
  assert.strictEqual(
    enrollmentMatchesIdentity(enrollment({ courseId: 'course-2' }), { courseId: 'course-1', userId: 'user-1' }),
    false
  );
});

test('curso gratuito publicado da plataforma permite auto matricula', () => {
  assert.strictEqual(
    assertCanSelfEnrollFreeCourse({ course: platformFreeCourse, userId: 'user-1' }),
    true
  );

  const created = buildFreeEnrollment({ courseId: 'course-1', userId: 'user-1' });
  assert.strictEqual(created.source, 'free');
  assert.strictEqual(created.status, 'active');
  assert.strictEqual(created.progressPercent, 0);
});

test('curso nao publicado bloqueia auto matricula', () => {
  assert.throws(
    () => assertCanSelfEnrollFreeCourse({ course: { ...platformFreeCourse, status: 'draft' }, userId: 'user-1' }),
    error => error?.code === 'COURSE_NOT_AVAILABLE'
  );
});

test('curso pago nao cria entitlement gratuito', () => {
  assert.throws(
    () => assertCanSelfEnrollFreeCourse({
      course: { ...platformFreeCourse, isPaid: true, priceCents: 1990 },
      userId: 'user-1'
    }),
    error => error?.code === 'PAYMENT_REQUIRED'
  );
});

test('curso de organizacao exige membership ativo da mesma organizacao', () => {
  assert.throws(
    () => assertCanSelfEnrollFreeCourse({ course: organizationFreeCourse, membership: null, userId: 'user-1' }),
    error => error?.code === 'ORGANIZATION_MEMBERSHIP_REQUIRED'
  );

  assert.throws(
    () => assertCanSelfEnrollFreeCourse({
      course: organizationFreeCourse,
      membership: { ...activeMembership, organizationId: 'org-2' },
      userId: 'user-1'
    }),
    error => error?.code === 'ORGANIZATION_MEMBERSHIP_REQUIRED'
  );

  assert.strictEqual(
    assertCanSelfEnrollFreeCourse({ course: organizationFreeCourse, membership: activeMembership, userId: 'user-1' }),
    true
  );
});

test('membership de outro usuario nao concede acesso ao curso da organizacao', () => {
  const otherUsersMembership = { ...activeMembership, userId: 'user-2' };

  assert.throws(
    () => assertCanSelfEnrollFreeCourse({
      course: organizationFreeCourse,
      membership: otherUsersMembership,
      userId: 'user-1'
    }),
    error => error?.code === 'ORGANIZATION_MEMBERSHIP_REQUIRED'
  );

  assert.deepStrictEqual(
    resolveCourseEntitlement({
      courseId: 'course-1',
      userId: 'user-1',
      course: organizationFreeCourse,
      enrollment: enrollment(),
      membership: otherUsersMembership
    }),
    { granted: false, reason: 'ORGANIZATION_MEMBERSHIP_REQUIRED' }
  );
});

test('curso privado nao permite auto matricula gratuita', () => {
  assert.throws(
    () => assertCanSelfEnrollFreeCourse({
      course: { ...platformFreeCourse, visibility: 'private' },
      userId: 'user-1'
    }),
    error => error?.code === 'PRIVATE_COURSE_REQUIRES_GRANT'
  );
});

test('entitlement da plataforma exige matricula ativa ou concluida', () => {
  assert.deepStrictEqual(
    resolveCourseEntitlement({ courseId: 'course-1', userId: 'user-1', course: platformFreeCourse, enrollment: null }),
    { granted: false, reason: 'ENROLLMENT_REQUIRED' }
  );

  assert.strictEqual(
    resolveCourseEntitlement({ courseId: 'course-1', userId: 'user-1', course: platformFreeCourse, enrollment: enrollment() }).granted,
    true
  );

  assert.strictEqual(
    resolveCourseEntitlement({ courseId: 'course-1', userId: 'user-1', course: platformFreeCourse, enrollment: enrollment({ status: 'completed' }) }).granted,
    true
  );

  assert.deepStrictEqual(
    resolveCourseEntitlement({ courseId: 'course-1', userId: 'user-1', course: platformFreeCourse, enrollment: enrollment({ status: 'cancelled' }) }),
    { granted: false, reason: 'ENROLLMENT_INACTIVE' }
  );
});

test('entitlement rejeita matricula vinculada a outra identidade', () => {
  assert.deepStrictEqual(
    resolveCourseEntitlement({
      courseId: 'course-1',
      userId: 'user-1',
      course: platformFreeCourse,
      enrollment: enrollment({ userId: 'user-2' })
    }),
    { granted: false, reason: 'ENROLLMENT_IDENTITY_MISMATCH' }
  );
});

test('curso pago exige source order ou admin_grant para entitlement', () => {
  const paid = { ...platformFreeCourse, isPaid: true, priceCents: 5000 };

  assert.deepStrictEqual(
    resolveCourseEntitlement({ courseId: 'course-1', userId: 'user-1', course: paid, enrollment: enrollment() }),
    { granted: false, reason: 'PAYMENT_ENTITLEMENT_REQUIRED' }
  );

  assert.strictEqual(
    resolveCourseEntitlement({
      courseId: 'course-1',
      userId: 'user-1',
      course: paid,
      enrollment: enrollment({ source: 'order', orderId: 'order-1' })
    }).granted,
    true
  );

  assert.strictEqual(
    resolveCourseEntitlement({
      courseId: 'course-1',
      userId: 'user-1',
      course: paid,
      enrollment: enrollment({ source: 'admin_grant' })
    }).granted,
    true
  );
});

test('curso de organizacao perde entitlement quando membership deixa de estar ativo', () => {
  assert.strictEqual(
    resolveCourseEntitlement({
      courseId: 'course-1',
      userId: 'user-1',
      course: organizationFreeCourse,
      enrollment: enrollment(),
      membership: activeMembership
    }).granted,
    true
  );

  assert.deepStrictEqual(
    resolveCourseEntitlement({
      courseId: 'course-1',
      userId: 'user-1',
      course: organizationFreeCourse,
      enrollment: enrollment(),
      membership: { ...activeMembership, status: 'ended' }
    }),
    { granted: false, reason: 'ORGANIZATION_MEMBERSHIP_REQUIRED' }
  );
});

test('curso privado pode ser consumido somente por concessao explicita', () => {
  const privateCourse = { ...platformFreeCourse, visibility: 'private' };

  assert.deepStrictEqual(
    resolveCourseEntitlement({ courseId: 'course-1', userId: 'user-1', course: privateCourse, enrollment: enrollment() }),
    { granted: false, reason: 'PRIVATE_COURSE_GRANT_REQUIRED' }
  );

  assert.strictEqual(
    resolveCourseEntitlement({
      courseId: 'course-1',
      userId: 'user-1',
      course: privateCourse,
      enrollment: enrollment({ source: 'admin_grant' })
    }).granted,
    true
  );
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`COURSE_ENROLLMENT_DOMAIN_V1_2=${passed}/${cases.length}`);
