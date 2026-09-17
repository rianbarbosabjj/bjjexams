'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const {
  enrollmentDocumentId,
  membershipMatchesCourse,
  resolveCourseEntitlement
} = require('./course-enrollment-domain');
const {
  CourseConsumptionDomainError,
  lessonContentView,
  canAccessPublicPreview,
  buildStudentCourseStructure
} = require('./course-consumption-domain');

function createCourseConsumptionFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;

  if (!REGION || !db) {
    throw new Error('Course consumption: infraestrutura obrigatória ausente.');
  }

  function requireAuth(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
    return uid;
  }

  function optionalAuthUid(request) {
    return request.auth?.uid || null;
  }

  function parseId(value, label) {
    const id = String(value || '').trim();
    if (!id || id.length > 200 || id.includes('/')) {
      throw new HttpsError('invalid-argument', `${label} inválido.`);
    }
    return id;
  }

  function consumptionDomainError(error) {
    if (!(error instanceof CourseConsumptionDomainError)) throw error;
    throw new HttpsError(
      'failed-precondition',
      'O conteúdo do curso está temporariamente indisponível.',
      { domainCode: error.code }
    );
  }

  function matchingMembership(memberships = [], course = {}, uid = null) {
    if (course.visibility !== 'organization' || !course.organizationId || !uid) return null;
    return memberships.find(membership =>
      membershipMatchesCourse(course, membership, uid)
    ) || null;
  }

  async function membershipsForUser(uid) {
    if (!uid) return [];
    const snap = await db
      .collection('vinculos_organizacao')
      .where('usuario_id', '==', uid)
      .limit(100)
      .get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  async function resolveEntitlementForUser({ uid, courseId, course }) {
    if (!uid) {
      return { granted: false, reason: 'AUTH_REQUIRED' };
    }

    const enrollmentId = enrollmentDocumentId(courseId, uid);
    const [enrollmentSnap, memberships] = await Promise.all([
      db.doc(`enrollments/${enrollmentId}`).get(),
      course.visibility === 'organization' ? membershipsForUser(uid) : Promise.resolve([])
    ]);

    const enrollment = enrollmentSnap.exists ? enrollmentSnap.data() : null;
    const membership = matchingMembership(memberships, course, uid);

    return resolveCourseEntitlement({
      courseId,
      userId: uid,
      course,
      enrollment,
      membership
    });
  }

  const obterEstruturaConsumoCursoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      const courseId = parseId(request.data?.courseId, 'Curso');
      const courseRef = db.doc(`courses/${courseId}`);
      const courseSnap = await courseRef.get();

      if (!courseSnap.exists) {
        throw new HttpsError('not-found', 'Curso não encontrado.');
      }

      const course = courseSnap.data();
      const entitlement = await resolveEntitlementForUser({ uid, courseId, course });

      if (!entitlement.granted) {
        throw new HttpsError(
          'permission-denied',
          'Você não possui acesso ativo ao conteúdo deste curso.',
          { domainCode: entitlement.reason }
        );
      }

      const [modulesSnap, lessonsSnap] = await Promise.all([
        courseRef.collection('modules').get(),
        courseRef.collection('lessons').get()
      ]);

      let structure;
      try {
        structure = buildStudentCourseStructure({
          courseId,
          course,
          modules: modulesSnap.docs.map(doc => ({ id: doc.id, data: doc.data() })),
          lessons: lessonsSnap.docs.map(doc => ({ id: doc.id, data: doc.data() }))
        });
      } catch (error) {
        consumptionDomainError(error);
      }

      return {
        ok: true,
        entitlement,
        ...structure
      };
    }
  );

  const obterAulaConsumoCursoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = optionalAuthUid(request);
      const courseId = parseId(request.data?.courseId, 'Curso');
      const lessonId = parseId(request.data?.lessonId, 'Aula');
      const courseRef = db.doc(`courses/${courseId}`);
      const lessonRef = courseRef.collection('lessons').doc(lessonId);

      const [courseSnap, lessonSnap] = await Promise.all([
        courseRef.get(),
        lessonRef.get()
      ]);

      if (!courseSnap.exists || !lessonSnap.exists) {
        throw new HttpsError('not-found', 'Aula não disponível.');
      }

      const course = courseSnap.data();
      const persistedLesson = lessonSnap.data();
      let lesson;

      try {
        lesson = lessonContentView(lessonSnap.id, persistedLesson);
      } catch (error) {
        consumptionDomainError(error);
      }

      const moduleSnap = await courseRef.collection('modules').doc(lesson.moduleId).get();
      if (!moduleSnap.exists) {
        throw new HttpsError('not-found', 'Aula não disponível.');
      }

      let entitlement = { granted: false, reason: 'AUTH_REQUIRED' };
      if (uid) {
        entitlement = await resolveEntitlementForUser({ uid, courseId, course });
      }

      if (entitlement.granted) {
        return {
          ok: true,
          courseId,
          accessMode: 'entitled',
          entitlement,
          lesson
        };
      }

      if (canAccessPublicPreview({ course, lesson: persistedLesson })) {
        return {
          ok: true,
          courseId,
          accessMode: 'preview',
          entitlement: null,
          lesson
        };
      }

      throw new HttpsError('not-found', 'Aula não disponível.');
    }
  );

  return {
    obterEstruturaConsumoCursoV12,
    obterAulaConsumoCursoV12
  };
}

module.exports = {
  createCourseConsumptionFunctions
};
