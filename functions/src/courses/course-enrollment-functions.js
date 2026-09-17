'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const {
  CourseEnrollmentDomainError,
  enrollmentDocumentId,
  validateEnrollment,
  assertCanSelfEnrollFreeCourse,
  buildFreeEnrollment,
  resolveCourseEntitlement
} = require('./course-enrollment-domain');
const { isActiveMembership } = require('../auth/organization-membership');

const MAX_MY_COURSES = 100;

function createCourseEnrollmentFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;

  if (!REGION || !db) {
    throw new Error('Course enrollment: infraestrutura obrigatória ausente.');
  }

  function requireAuth(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
    return uid;
  }

  function parseCourseId(value) {
    const id = String(value || '').trim();
    if (!id || id.length > 200 || id.includes('/')) {
      throw new HttpsError('invalid-argument', 'Curso inválido.');
    }
    return id;
  }

  function domainError(error) {
    if (!(error instanceof CourseEnrollmentDomainError)) throw error;

    const failedPrecondition = new Set([
      'COURSE_NOT_AVAILABLE',
      'PRIVATE_COURSE_REQUIRES_GRANT',
      'ORGANIZATION_MEMBERSHIP_REQUIRED',
      'PAYMENT_REQUIRED'
    ]);

    throw new HttpsError(
      failedPrecondition.has(error.code) ? 'failed-precondition' : 'invalid-argument',
      error.message,
      { domainCode: error.code }
    );
  }

  function enrollmentView(id, input = {}) {
    const enrollment = validateEnrollment(input);
    return {
      id,
      courseId: enrollment.courseId,
      source: enrollment.source,
      status: enrollment.status,
      progressPercent: enrollment.progressPercent,
      startedAt: enrollment.startedAt,
      completedAt: enrollment.completedAt,
      createdAt: enrollment.createdAt,
      updatedAt: enrollment.updatedAt
    };
  }

  function studentCourseView(id, course = {}) {
    return {
      id,
      title: course.title || null,
      description: course.description || null,
      visibility: course.visibility || null,
      isPaid: course.isPaid === true,
      priceCents: Number(course.priceCents || 0),
      currency: String(course.currency || 'BRL').toUpperCase(),
      publishedAt: course.publishedAt || null
    };
  }

  function audit({ action, entityId, actorId, before = null, after = null }) {
    return {
      actorId,
      actorRole: 'student',
      action,
      entityType: 'enrollment',
      entityId,
      before,
      after,
      source: 'function',
      requestId: null,
      createdAt: FieldValue.serverTimestamp()
    };
  }

  function matchingMembership(memberships = [], course = {}) {
    if (course.visibility !== 'organization' || !course.organizationId) return null;

    return memberships.find(membership => (
      isActiveMembership(membership) &&
      String(membership.organizationId || membership.organizacao_id || '') === String(course.organizationId)
    )) || null;
  }

  async function membershipsForUser(uid) {
    const snap = await db
      .collection('vinculos_organizacao')
      .where('usuario_id', '==', uid)
      .limit(100)
      .get();

    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async function membershipForCourseInTransaction(tx, uid, course = {}) {
    if (course.visibility !== 'organization' || !course.organizationId) return null;

    const snap = await tx.get(
      db.collection('vinculos_organizacao')
        .where('usuario_id', '==', uid)
        .limit(100)
    );

    return matchingMembership(
      snap.docs.map(doc => ({ id: doc.id, ...doc.data() })),
      course
    );
  }

  const matricularCursoGratuitoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      const courseId = parseCourseId(request.data?.courseId);
      const courseRef = db.doc(`courses/${courseId}`);
      const enrollmentId = enrollmentDocumentId(courseId, uid);
      const enrollmentRef = db.doc(`enrollments/${enrollmentId}`);
      let responseEnrollment = null;
      let created = false;

      await db.runTransaction(async tx => {
        const [courseSnap, enrollmentSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(enrollmentRef)
        ]);

        if (!courseSnap.exists) {
          throw new HttpsError('not-found', 'Curso não encontrado.');
        }

        const course = courseSnap.data();
        const membership = await membershipForCourseInTransaction(tx, uid, course);

        try {
          assertCanSelfEnrollFreeCourse({ course, membership });
        } catch (error) {
          domainError(error);
        }

        if (enrollmentSnap.exists) {
          let existing;
          try {
            existing = validateEnrollment(enrollmentSnap.data());
          } catch (error) {
            throw new HttpsError(
              'failed-precondition',
              'A matrícula existente está inconsistente e exige revisão administrativa.'
            );
          }

          if (existing.courseId !== courseId || existing.userId !== uid) {
            throw new HttpsError(
              'failed-precondition',
              'A matrícula existente não corresponde ao usuário e curso solicitados.'
            );
          }

          if (['active', 'completed'].includes(existing.status)) {
            responseEnrollment = enrollmentView(enrollmentSnap.id, enrollmentSnap.data());
            return;
          }

          throw new HttpsError(
            'failed-precondition',
            'Esta matrícula não pode ser reativada automaticamente.'
          );
        }

        const timestamp = FieldValue.serverTimestamp();
        let enrollment;
        try {
          enrollment = buildFreeEnrollment({
            courseId,
            userId: uid,
            createdAt: timestamp
          });
        } catch (error) {
          domainError(error);
        }

        tx.create(enrollmentRef, enrollment);
        tx.create(db.collection('audit_logs').doc(), audit({
          action: 'course.enrollment.created',
          entityId: enrollmentId,
          actorId: uid,
          after: {
            courseId,
            userId: uid,
            source: 'free',
            status: 'active'
          }
        }));

        responseEnrollment = enrollmentView(enrollmentId, enrollment);
        created = true;
      });

      return {
        ok: true,
        created,
        enrollment: responseEnrollment,
        entitlement: {
          granted: true,
          reason: 'ENTITLED'
        }
      };
    }
  );

  const obterEntitlementCursoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      const courseId = parseCourseId(request.data?.courseId);
      const enrollmentId = enrollmentDocumentId(courseId, uid);

      const [courseSnap, enrollmentSnap] = await Promise.all([
        db.doc(`courses/${courseId}`).get(),
        db.doc(`enrollments/${enrollmentId}`).get()
      ]);

      if (!courseSnap.exists) {
        throw new HttpsError('not-found', 'Curso não encontrado.');
      }

      const course = courseSnap.data();
      const memberships = course.visibility === 'organization'
        ? await membershipsForUser(uid)
        : [];
      const membership = matchingMembership(memberships, course);
      const enrollment = enrollmentSnap.exists ? enrollmentSnap.data() : null;
      const entitlement = resolveCourseEntitlement({ course, enrollment, membership });

      return {
        courseId,
        entitlement,
        enrollment: enrollmentSnap.exists
          ? enrollmentView(enrollmentSnap.id, enrollment)
          : null
      };
    }
  );

  const listarMeusCursosV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      const enrollmentSnap = await db
        .collection('enrollments')
        .where('userId', '==', uid)
        .limit(MAX_MY_COURSES)
        .get();

      const validEnrollments = enrollmentSnap.docs
        .map(doc => {
          try {
            const enrollment = validateEnrollment(doc.data());
            return ['active', 'completed'].includes(enrollment.status)
              ? { id: doc.id, data: doc.data(), normalized: enrollment }
              : null;
          } catch (_error) {
            return null;
          }
        })
        .filter(Boolean);

      if (!validEnrollments.length) {
        return { courses: [] };
      }

      const courseRefs = validEnrollments.map(item => db.doc(`courses/${item.normalized.courseId}`));
      const courseSnaps = await db.getAll(...courseRefs);
      const memberships = await membershipsForUser(uid);
      const courses = [];

      for (let index = 0; index < validEnrollments.length; index += 1) {
        const item = validEnrollments[index];
        const courseSnap = courseSnaps[index];
        if (!courseSnap?.exists) continue;

        const course = courseSnap.data();
        const membership = matchingMembership(memberships, course);
        const entitlement = resolveCourseEntitlement({
          course,
          enrollment: item.data,
          membership
        });

        courses.push({
          course: studentCourseView(courseSnap.id, course),
          enrollment: enrollmentView(item.id, item.data),
          entitlement
        });
      }

      courses.sort((left, right) => {
        const leftTime = Number(left.enrollment.startedAt?._seconds || left.enrollment.createdAt?._seconds || 0);
        const rightTime = Number(right.enrollment.startedAt?._seconds || right.enrollment.createdAt?._seconds || 0);
        return rightTime - leftTime;
      });

      return { courses };
    }
  );

  return {
    matricularCursoGratuitoV12,
    obterEntitlementCursoV12,
    listarMeusCursosV12
  };
}

module.exports = {
  MAX_MY_COURSES,
  createCourseEnrollmentFunctions
};
