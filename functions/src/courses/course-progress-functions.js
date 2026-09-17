'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const {
  enrollmentDocumentId,
  membershipMatchesCourse,
  resolveCourseEntitlement
} = require('./course-enrollment-domain');
const {
  CourseConsumptionDomainError,
  lessonSummaryView
} = require('./course-consumption-domain');
const {
  CourseProgressDomainError,
  validateLessonProgress,
  normalizeEnrollmentProgressState,
  nextProgressAggregate,
  buildLessonProgress,
  buildCourseProgressView
} = require('./course-progress-domain');

function createCourseProgressFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;

  if (!REGION || !db) {
    throw new Error('Course progress v1.2: infraestrutura obrigatória ausente.');
  }

  function requireAuth(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
    return uid;
  }

  function parseId(value, label) {
    const id = String(value || '').trim();
    if (!id || id.length > 200 || id.includes('/')) {
      throw new HttpsError('invalid-argument', `${label} inválido.`);
    }
    return id;
  }

  function progressDomainError(error) {
    if (!(error instanceof CourseProgressDomainError)) throw error;
    throw new HttpsError(
      'failed-precondition',
      'O progresso do curso está inconsistente e exige revisão.',
      { domainCode: error.code }
    );
  }

  function contentDomainError(error) {
    if (!(error instanceof CourseConsumptionDomainError)) throw error;
    throw new HttpsError(
      'failed-precondition',
      'A estrutura do curso está temporariamente indisponível.',
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
      course,
      uid
    );
  }

  function assertEntitlement(entitlement) {
    if (entitlement?.granted === true) return;
    throw new HttpsError(
      'permission-denied',
      'Você não possui acesso ativo ao conteúdo deste curso.',
      { domainCode: entitlement?.reason || 'ENTITLEMENT_REQUIRED' }
    );
  }

  function audit({ action, entityId, actorId, before = null, after = null }) {
    return {
      actorId,
      actorRole: 'student',
      action,
      entityType: 'course_progress',
      entityId,
      before,
      after,
      source: 'function',
      requestId: null,
      createdAt: FieldValue.serverTimestamp()
    };
  }

  function aggregateView(enrollment = {}, totalLessonCount, contentRevision) {
    let state;
    try {
      state = normalizeEnrollmentProgressState(enrollment, {
        totalLessonCount,
        contentRevision
      });
    } catch (error) {
      progressDomainError(error);
    }

    return {
      status: enrollment.status || null,
      completedLessonCount: state.completedLessonCount,
      totalLessonCount: state.totalLessonCount,
      progressPercent: state.progressPercent,
      courseCompleted: state.courseCompleted,
      completedAt: enrollment.completedAt ?? null
    };
  }

  const concluirAulaCursoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      const courseId = parseId(request.data?.courseId, 'Curso');
      const lessonId = parseId(request.data?.lessonId, 'Aula');
      const courseRef = db.doc(`courses/${courseId}`);
      const enrollmentId = enrollmentDocumentId(courseId, uid);
      const enrollmentRef = db.doc(`enrollments/${enrollmentId}`);
      const lessonRef = courseRef.collection('lessons').doc(lessonId);
      const progressRef = enrollmentRef.collection('lesson_progress').doc(lessonId);
      let changed = false;
      let totalLessonCount = null;
      let contentRevision = null;

      await db.runTransaction(async tx => {
        const [courseSnap, enrollmentSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(enrollmentRef)
        ]);

        if (!courseSnap.exists) {
          throw new HttpsError('not-found', 'Curso não encontrado.');
        }

        const course = courseSnap.data();
        const enrollment = enrollmentSnap.exists ? enrollmentSnap.data() : null;
        const membership = await membershipForCourseInTransaction(tx, uid, course);
        const entitlement = resolveCourseEntitlement({
          courseId,
          userId: uid,
          course,
          enrollment,
          membership
        });
        assertEntitlement(entitlement);

        const lessonSnap = await tx.get(lessonRef);
        if (!lessonSnap.exists) {
          throw new HttpsError('not-found', 'Aula não disponível.');
        }

        let lesson;
        try {
          lesson = lessonSummaryView(lessonSnap.id, lessonSnap.data());
        } catch (error) {
          contentDomainError(error);
        }

        const moduleRef = courseRef.collection('modules').doc(lesson.moduleId);
        const [moduleSnap, progressSnap] = await Promise.all([
          tx.get(moduleRef),
          tx.get(progressRef)
        ]);

        if (!moduleSnap.exists) {
          throw new HttpsError(
            'failed-precondition',
            'A estrutura do curso está temporariamente indisponível.',
            { domainCode: 'ORPHAN_LESSON' }
          );
        }

        totalLessonCount = Number(course.lessonCount);
        contentRevision = Number(course.contentRevision ?? 0);

        let currentState;
        try {
          currentState = normalizeEnrollmentProgressState(enrollment, {
            totalLessonCount,
            contentRevision
          });
        } catch (error) {
          progressDomainError(error);
        }

        if (progressSnap.exists) {
          try {
            validateLessonProgress(progressSnap.data(), {
              courseId,
              userId: uid,
              lessonId,
              contentRevision
            });
          } catch (error) {
            progressDomainError(error);
          }

          if (progressSnap.id !== lessonId || currentState.completedLessonCount < 1) {
            throw new HttpsError(
              'failed-precondition',
              'O progresso do curso está inconsistente e exige revisão.',
              { domainCode: 'PROGRESS_DETAIL_AGGREGATE_MISMATCH' }
            );
          }

          changed = false;
          return;
        }

        let next;
        try {
          next = nextProgressAggregate({
            completedLessonCount: currentState.completedLessonCount,
            totalLessonCount,
            alreadyCompleted: false
          });
        } catch (error) {
          progressDomainError(error);
        }

        const timestamp = FieldValue.serverTimestamp();
        let lessonProgress;
        try {
          lessonProgress = buildLessonProgress({
            courseId,
            userId: uid,
            lessonId,
            contentRevision,
            timestamp
          });
        } catch (error) {
          progressDomainError(error);
        }

        tx.create(progressRef, lessonProgress);

        const enrollmentUpdate = {
          completedLessonCount: next.completedLessonCount,
          progressPercent: next.progressPercent,
          progressContentRevision: contentRevision,
          updatedAt: timestamp
        };

        if (next.courseCompleted) {
          enrollmentUpdate.status = 'completed';
          enrollmentUpdate.completedAt = timestamp;
        }

        tx.update(enrollmentRef, enrollmentUpdate);

        tx.create(db.collection('audit_logs').doc(), audit({
          action: 'course.progress.lesson.completed',
          entityId: `${enrollmentId}/lesson_progress/${lessonId}`,
          actorId: uid,
          before: {
            completedLessonCount: currentState.completedLessonCount,
            progressPercent: currentState.progressPercent,
            status: enrollment.status || null
          },
          after: {
            courseId,
            lessonId,
            contentRevision,
            completedLessonCount: next.completedLessonCount,
            progressPercent: next.progressPercent,
            status: next.courseCompleted ? 'completed' : enrollment.status
          }
        }));

        if (next.courseCompleted) {
          tx.create(db.collection('audit_logs').doc(), audit({
            action: 'course.progress.course.completed',
            entityId: enrollmentId,
            actorId: uid,
            before: {
              status: enrollment.status || null,
              progressPercent: currentState.progressPercent
            },
            after: {
              courseId,
              status: 'completed',
              progressPercent: 100,
              contentRevision
            }
          }));
        }

        changed = true;
      });

      const persistedEnrollmentSnap = await enrollmentRef.get();
      if (!persistedEnrollmentSnap.exists) {
        throw new HttpsError(
          'failed-precondition',
          'A matrícula não pôde ser confirmada após atualizar o progresso.'
        );
      }

      return {
        ok: true,
        changed,
        courseId,
        lessonId,
        enrollmentId,
        progress: aggregateView(
          persistedEnrollmentSnap.data(),
          totalLessonCount,
          contentRevision
        )
      };
    }
  );

  const obterProgressoCursoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      const courseId = parseId(request.data?.courseId, 'Curso');
      const courseRef = db.doc(`courses/${courseId}`);
      const enrollmentId = enrollmentDocumentId(courseId, uid);
      const enrollmentRef = db.doc(`enrollments/${enrollmentId}`);

      const [courseSnap, enrollmentSnap] = await Promise.all([
        courseRef.get(),
        enrollmentRef.get()
      ]);

      if (!courseSnap.exists) {
        throw new HttpsError('not-found', 'Curso não encontrado.');
      }

      const course = courseSnap.data();
      const enrollment = enrollmentSnap.exists ? enrollmentSnap.data() : null;
      const memberships = course.visibility === 'organization'
        ? await membershipsForUser(uid)
        : [];
      const membership = matchingMembership(memberships, course, uid);
      const entitlement = resolveCourseEntitlement({
        courseId,
        userId: uid,
        course,
        enrollment,
        membership
      });
      assertEntitlement(entitlement);

      const totalLessonCount = Number(course.lessonCount);
      const contentRevision = Number(course.contentRevision ?? 0);
      const progressSnap = await enrollmentRef.collection('lesson_progress').get();
      const completedLessonIds = [];

      for (const doc of progressSnap.docs) {
        let progress;
        try {
          progress = validateLessonProgress(doc.data(), {
            courseId,
            userId: uid,
            lessonId: doc.id,
            contentRevision
          });
        } catch (error) {
          progressDomainError(error);
        }

        if (progress.lessonId !== doc.id) {
          throw new HttpsError(
            'failed-precondition',
            'O progresso do curso está inconsistente e exige revisão.',
            { domainCode: 'PROGRESS_IDENTITY_MISMATCH' }
          );
        }
        completedLessonIds.push(doc.id);
      }

      if (completedLessonIds.length) {
        const lessonSnaps = await db.getAll(
          ...completedLessonIds.map(lessonId => courseRef.collection('lessons').doc(lessonId))
        );
        if (lessonSnaps.some(snap => !snap.exists)) {
          throw new HttpsError(
            'failed-precondition',
            'O progresso do curso está inconsistente e exige revisão.',
            { domainCode: 'PROGRESS_LESSON_NOT_FOUND' }
          );
        }
      }

      let progressView;
      try {
        progressView = buildCourseProgressView({
          enrollmentId,
          courseId,
          enrollment,
          totalLessonCount,
          contentRevision,
          completedLessonIds
        });
      } catch (error) {
        progressDomainError(error);
      }

      return {
        ok: true,
        entitlement,
        progress: progressView
      };
    }
  );

  return {
    concluirAulaCursoV12,
    obterProgressoCursoV12
  };
}

module.exports = {
  createCourseProgressFunctions
};
