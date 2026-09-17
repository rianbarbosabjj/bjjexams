"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");
const { hasGlobalRole } = require("../auth/global-claims");
const {
  CourseContentDomainError,
  validateModule,
  validateLesson,
  nextContentRevision,
  courseContentCounters
} = require("./course-content-domain");

function createCourseContentFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;

  if (!REGION || !db) {
    throw new Error("Course content v1.2: infraestrutura obrigatoria ausente.");
  }

  function requireAuth(request) {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Faça login para continuar.");
    }
    return uid;
  }

  function moderatorRole(request) {
    const claims = request.auth?.token || {};
    if (claims.super_admin === true) return "super_admin";
    if (hasGlobalRole(claims, "platform_admin")) return "platform_admin";
    if (hasGlobalRole(claims, "content_admin")) return "content_admin";
    return null;
  }

  function domainError(error) {
    if (error instanceof CourseContentDomainError) {
      throw new HttpsError("invalid-argument", error.message, {
        domainCode: error.code
      });
    }
    throw error;
  }

  function contentActor(request) {
    const uid = requireAuth(request);
    return {
      uid,
      moderatorRole: moderatorRole(request)
    };
  }

  function canReadCourse(actor, course = {}) {
    if (actor.moderatorRole) return true;
    return course.ownerType === "user" && course.ownerId === actor.uid;
  }

  function assertCanEditCourse(actor, course = {}) {
    if (course.status !== "draft") {
      throw new HttpsError(
        "failed-precondition",
        "O conteudo do curso so pode ser alterado enquanto o curso estiver em rascunho."
      );
    }

    if (course.ownerType === "user" && course.ownerId === actor.uid) return;
    if (course.ownerType === "platform" && actor.moderatorRole) return;

    throw new HttpsError(
      "permission-denied",
      "Você não pode alterar o conteúdo deste curso."
    );
  }

  function requireId(value, label) {
    const id = String(value || "").trim();
    if (!id || id.length > 160 || id.includes("/")) {
      throw new HttpsError("invalid-argument", `${label} inválido.`);
    }
    return id;
  }

  function auditPayload({ actor, action, entityId, before, after, revision }) {
    return {
      actorId: actor.uid,
      actorRole: actor.moderatorRole || "instructor",
      action,
      entityType: "course_content",
      entityId,
      before: before || null,
      after: after || null,
      contentRevision: revision,
      source: "function",
      requestId: null,
      createdAt: FieldValue.serverTimestamp()
    };
  }

  function moduleView(id, data = {}) {
    return {
      id,
      title: data.title || null,
      description: data.description || null,
      position: Number(data.position || 0),
      lessonCount: Number(data.lessonCount || 0),
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    };
  }

  function lessonView(id, data = {}) {
    return {
      id,
      moduleId: data.moduleId || null,
      title: data.title || null,
      description: data.description || null,
      position: Number(data.position || 0),
      contentType: data.contentType || null,
      durationMinutes: Number(data.durationMinutes || 0),
      isPreview: data.isPreview === true,
      videoUrl: data.videoUrl || null,
      body: data.body || null,
      documentUrl: data.documentUrl || null,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null
    };
  }

  const listarConteudoCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const courseRef = db.doc(`courses/${courseId}`);
      const courseSnap = await courseRef.get();

      if (!courseSnap.exists) {
        throw new HttpsError("not-found", "Curso não encontrado.");
      }

      const course = courseSnap.data();
      if (!canReadCourse(actor, course)) {
        throw new HttpsError(
          "permission-denied",
          "Você não pode consultar o conteúdo deste curso."
        );
      }

      const [modulesSnap, lessonsSnap] = await Promise.all([
        courseRef.collection("modules").get(),
        courseRef.collection("lessons").get()
      ]);

      const modules = modulesSnap.docs
        .map(doc => moduleView(doc.id, doc.data()))
        .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, "pt-BR"));

      const lessons = lessonsSnap.docs
        .map(doc => lessonView(doc.id, doc.data()))
        .sort((a, b) => {
          if (a.moduleId !== b.moduleId) return a.moduleId.localeCompare(b.moduleId);
          return a.position - b.position || a.title.localeCompare(b.title, "pt-BR");
        });

      return {
        ok: true,
        courseId,
        counters: courseContentCounters(course),
        modules,
        lessons
      };
    }
  );

  const criarModuloCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const courseRef = db.doc(`courses/${courseId}`);
      const moduleRef = courseRef.collection("modules").doc();
      const auditRef = db.collection("audit_logs").doc();
      let createdModule = null;
      let revision = null;

      await db.runTransaction(async tx => {
        const courseSnap = await tx.get(courseRef);
        if (!courseSnap.exists) throw new HttpsError("not-found", "Curso não encontrado.");
        const course = courseSnap.data();
        assertCanEditCourse(actor, course);

        let normalized;
        try {
          normalized = validateModule({
            title: request.data?.title,
            description: request.data?.description,
            position: request.data?.position,
            lessonCount: 0
          });
        } catch (error) {
          domainError(error);
        }

        revision = nextContentRevision(course);
        createdModule = {
          ...normalized,
          lessonCount: 0
        };

        tx.create(moduleRef, {
          ...createdModule,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });

        const counters = courseContentCounters(course);
        tx.update(courseRef, {
          contentRevision: revision,
          moduleCount: counters.moduleCount + 1,
          lessonCount: counters.lessonCount,
          estimatedDurationMinutes: counters.estimatedDurationMinutes,
          contentUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });

        tx.create(auditRef, auditPayload({
          actor,
          action: "course.content.module.created",
          entityId: `${courseId}/modules/${moduleRef.id}`,
          before: null,
          after: createdModule,
          revision
        }));
      });

      return {
        ok: true,
        contentRevision: revision,
        module: moduleView(moduleRef.id, createdModule)
      };
    }
  );

  const atualizarModuloCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const moduleId = requireId(request.data?.moduleId, "Módulo");
      const courseRef = db.doc(`courses/${courseId}`);
      const moduleRef = courseRef.collection("modules").doc(moduleId);
      const auditRef = db.collection("audit_logs").doc();
      let result = null;
      let revision = null;

      await db.runTransaction(async tx => {
        const [courseSnap, moduleSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(moduleRef)
        ]);
        if (!courseSnap.exists) throw new HttpsError("not-found", "Curso não encontrado.");
        if (!moduleSnap.exists) throw new HttpsError("not-found", "Módulo não encontrado.");

        const course = courseSnap.data();
        const existing = moduleSnap.data();
        assertCanEditCourse(actor, course);

        try {
          result = validateModule({
            ...existing,
            title: request.data?.title ?? existing.title,
            description: request.data?.description ?? existing.description,
            position: request.data?.position ?? existing.position,
            lessonCount: existing.lessonCount
          });
        } catch (error) {
          domainError(error);
        }

        revision = nextContentRevision(course);
        tx.update(moduleRef, {
          title: result.title,
          description: result.description,
          position: result.position,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.update(courseRef, {
          contentRevision: revision,
          contentUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(auditRef, auditPayload({
          actor,
          action: "course.content.module.updated",
          entityId: `${courseId}/modules/${moduleId}`,
          before: moduleView(moduleId, existing),
          after: result,
          revision
        }));
      });

      return {
        ok: true,
        contentRevision: revision,
        module: moduleView(moduleId, result)
      };
    }
  );

  const excluirModuloCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const moduleId = requireId(request.data?.moduleId, "Módulo");
      const courseRef = db.doc(`courses/${courseId}`);
      const moduleRef = courseRef.collection("modules").doc(moduleId);
      const auditRef = db.collection("audit_logs").doc();
      let revision = null;

      await db.runTransaction(async tx => {
        const [courseSnap, moduleSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(moduleRef)
        ]);
        if (!courseSnap.exists) throw new HttpsError("not-found", "Curso não encontrado.");
        if (!moduleSnap.exists) throw new HttpsError("not-found", "Módulo não encontrado.");

        const course = courseSnap.data();
        const module = moduleSnap.data();
        assertCanEditCourse(actor, course);

        if (Number(module.lessonCount || 0) > 0) {
          throw new HttpsError(
            "failed-precondition",
            "Remova ou mova as aulas deste módulo antes de excluí-lo."
          );
        }

        const counters = courseContentCounters(course);
        revision = nextContentRevision(course);
        tx.delete(moduleRef);
        tx.update(courseRef, {
          contentRevision: revision,
          moduleCount: Math.max(0, counters.moduleCount - 1),
          contentUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(auditRef, auditPayload({
          actor,
          action: "course.content.module.deleted",
          entityId: `${courseId}/modules/${moduleId}`,
          before: moduleView(moduleId, module),
          after: null,
          revision
        }));
      });

      return { ok: true, contentRevision: revision, moduleId };
    }
  );

  const criarAulaCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const moduleId = requireId(request.data?.moduleId, "Módulo");
      const courseRef = db.doc(`courses/${courseId}`);
      const moduleRef = courseRef.collection("modules").doc(moduleId);
      const lessonRef = courseRef.collection("lessons").doc();
      const auditRef = db.collection("audit_logs").doc();
      let lesson = null;
      let revision = null;

      await db.runTransaction(async tx => {
        const [courseSnap, moduleSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(moduleRef)
        ]);
        if (!courseSnap.exists) throw new HttpsError("not-found", "Curso não encontrado.");
        if (!moduleSnap.exists) throw new HttpsError("not-found", "Módulo não encontrado.");

        const course = courseSnap.data();
        const module = moduleSnap.data();
        assertCanEditCourse(actor, course);

        try {
          lesson = validateLesson({
            moduleId,
            title: request.data?.title,
            description: request.data?.description,
            position: request.data?.position,
            contentType: request.data?.contentType,
            durationMinutes: request.data?.durationMinutes,
            isPreview: request.data?.isPreview,
            videoUrl: request.data?.videoUrl,
            body: request.data?.body,
            documentUrl: request.data?.documentUrl
          });
        } catch (error) {
          domainError(error);
        }

        const counters = courseContentCounters(course);
        revision = nextContentRevision(course);
        tx.create(lessonRef, {
          ...lesson,
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.update(moduleRef, {
          lessonCount: Math.max(0, Number(module.lessonCount || 0)) + 1,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.update(courseRef, {
          contentRevision: revision,
          lessonCount: counters.lessonCount + 1,
          estimatedDurationMinutes:
            counters.estimatedDurationMinutes + lesson.durationMinutes,
          contentUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(auditRef, auditPayload({
          actor,
          action: "course.content.lesson.created",
          entityId: `${courseId}/lessons/${lessonRef.id}`,
          before: null,
          after: lesson,
          revision
        }));
      });

      return {
        ok: true,
        contentRevision: revision,
        lesson: lessonView(lessonRef.id, lesson)
      };
    }
  );

  const atualizarAulaCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const lessonId = requireId(request.data?.lessonId, "Aula");
      const courseRef = db.doc(`courses/${courseId}`);
      const lessonRef = courseRef.collection("lessons").doc(lessonId);
      const auditRef = db.collection("audit_logs").doc();
      let result = null;
      let revision = null;

      await db.runTransaction(async tx => {
        const [courseSnap, lessonSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(lessonRef)
        ]);
        if (!courseSnap.exists) throw new HttpsError("not-found", "Curso não encontrado.");
        if (!lessonSnap.exists) throw new HttpsError("not-found", "Aula não encontrada.");

        const course = courseSnap.data();
        const existing = lessonSnap.data();
        assertCanEditCourse(actor, course);

        const nextModuleId = requireId(
          request.data?.moduleId ?? existing.moduleId,
          "Módulo"
        );
        const oldModuleRef = courseRef.collection("modules").doc(existing.moduleId);
        const newModuleRef = courseRef.collection("modules").doc(nextModuleId);

        let oldModuleSnap;
        let newModuleSnap;
        if (existing.moduleId === nextModuleId) {
          oldModuleSnap = await tx.get(oldModuleRef);
          newModuleSnap = oldModuleSnap;
        } else {
          [oldModuleSnap, newModuleSnap] = await Promise.all([
            tx.get(oldModuleRef),
            tx.get(newModuleRef)
          ]);
        }

        if (!oldModuleSnap.exists) {
          throw new HttpsError("failed-precondition", "Módulo atual da aula não existe.");
        }
        if (!newModuleSnap.exists) {
          throw new HttpsError("not-found", "Módulo de destino não encontrado.");
        }

        try {
          result = validateLesson({
            ...existing,
            moduleId: nextModuleId,
            title: request.data?.title ?? existing.title,
            description: request.data?.description ?? existing.description,
            position: request.data?.position ?? existing.position,
            contentType: request.data?.contentType ?? existing.contentType,
            durationMinutes:
              request.data?.durationMinutes ?? existing.durationMinutes,
            isPreview: request.data?.isPreview ?? existing.isPreview,
            videoUrl: request.data?.videoUrl ?? existing.videoUrl,
            body: request.data?.body ?? existing.body,
            documentUrl: request.data?.documentUrl ?? existing.documentUrl
          });
        } catch (error) {
          domainError(error);
        }

        const counters = courseContentCounters(course);
        const oldDuration = Math.max(0, Number(existing.durationMinutes || 0));
        revision = nextContentRevision(course);

        tx.update(lessonRef, {
          ...result,
          updatedAt: FieldValue.serverTimestamp()
        });

        if (existing.moduleId !== nextModuleId) {
          tx.update(oldModuleRef, {
            lessonCount: Math.max(0, Number(oldModuleSnap.data().lessonCount || 0) - 1),
            updatedAt: FieldValue.serverTimestamp()
          });
          tx.update(newModuleRef, {
            lessonCount: Math.max(0, Number(newModuleSnap.data().lessonCount || 0)) + 1,
            updatedAt: FieldValue.serverTimestamp()
          });
        }

        tx.update(courseRef, {
          contentRevision: revision,
          estimatedDurationMinutes: Math.max(
            0,
            counters.estimatedDurationMinutes - oldDuration + result.durationMinutes
          ),
          contentUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(auditRef, auditPayload({
          actor,
          action: "course.content.lesson.updated",
          entityId: `${courseId}/lessons/${lessonId}`,
          before: lessonView(lessonId, existing),
          after: result,
          revision
        }));
      });

      return {
        ok: true,
        contentRevision: revision,
        lesson: lessonView(lessonId, result)
      };
    }
  );

  const excluirAulaCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const lessonId = requireId(request.data?.lessonId, "Aula");
      const courseRef = db.doc(`courses/${courseId}`);
      const lessonRef = courseRef.collection("lessons").doc(lessonId);
      const auditRef = db.collection("audit_logs").doc();
      let revision = null;

      await db.runTransaction(async tx => {
        const [courseSnap, lessonSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(lessonRef)
        ]);
        if (!courseSnap.exists) throw new HttpsError("not-found", "Curso não encontrado.");
        if (!lessonSnap.exists) throw new HttpsError("not-found", "Aula não encontrada.");

        const course = courseSnap.data();
        const lesson = lessonSnap.data();
        assertCanEditCourse(actor, course);

        const moduleRef = courseRef.collection("modules").doc(lesson.moduleId);
        const moduleSnap = await tx.get(moduleRef);
        if (!moduleSnap.exists) {
          throw new HttpsError(
            "failed-precondition",
            "Módulo da aula não encontrado; exclusão bloqueada para preservar consistência."
          );
        }

        const counters = courseContentCounters(course);
        const duration = Math.max(0, Number(lesson.durationMinutes || 0));
        revision = nextContentRevision(course);

        tx.delete(lessonRef);
        tx.update(moduleRef, {
          lessonCount: Math.max(0, Number(moduleSnap.data().lessonCount || 0) - 1),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.update(courseRef, {
          contentRevision: revision,
          lessonCount: Math.max(0, counters.lessonCount - 1),
          estimatedDurationMinutes: Math.max(
            0,
            counters.estimatedDurationMinutes - duration
          ),
          contentUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(auditRef, auditPayload({
          actor,
          action: "course.content.lesson.deleted",
          entityId: `${courseId}/lessons/${lessonId}`,
          before: lessonView(lessonId, lesson),
          after: null,
          revision
        }));
      });

      return { ok: true, contentRevision: revision, lessonId };
    }
  );

  const reordenarConteudoCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const entityType = String(request.data?.entityType || "").trim();
      if (entityType !== "module" && entityType !== "lesson") {
        throw new HttpsError("invalid-argument", "Tipo de conteudo invalido para reordenacao.");
      }

      const firstId = requireId(request.data?.firstId, "Primeiro item");
      const secondId = requireId(request.data?.secondId, "Segundo item");
      if (firstId === secondId) {
        throw new HttpsError("invalid-argument", "Os itens de reordenacao devem ser diferentes.");
      }

      const courseRef = db.doc(`courses/${courseId}`);
      const collectionName = entityType === "module" ? "modules" : "lessons";
      const firstRef = courseRef.collection(collectionName).doc(firstId);
      const secondRef = courseRef.collection(collectionName).doc(secondId);
      const auditRef = db.collection("audit_logs").doc();
      let revision = null;
      let firstPosition = null;
      let secondPosition = null;

      await db.runTransaction(async tx => {
        const [courseSnap, firstSnap, secondSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(firstRef),
          tx.get(secondRef)
        ]);

        if (!courseSnap.exists) throw new HttpsError("not-found", "Curso nao encontrado.");
        if (!firstSnap.exists || !secondSnap.exists) {
          throw new HttpsError("not-found", "Item de conteudo nao encontrado.");
        }

        const course = courseSnap.data();
        const first = firstSnap.data();
        const second = secondSnap.data();
        assertCanEditCourse(actor, course);

        if (entityType === "lesson" && first.moduleId !== second.moduleId) {
          throw new HttpsError(
            "failed-precondition",
            "Aulas so podem ser reordenadas atomicamente dentro do mesmo modulo."
          );
        }

        firstPosition = Number(first.position);
        secondPosition = Number(second.position);
        const positionsAreValid = [firstPosition, secondPosition].every(
          value => Number.isInteger(value) && value >= 0 && value <= 9999
        );
        if (!positionsAreValid || firstPosition === secondPosition) {
          throw new HttpsError(
            "failed-precondition",
            "As posicoes atuais nao permitem uma troca atomica segura."
          );
        }

        revision = nextContentRevision(course);
        tx.update(firstRef, {
          position: secondPosition,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.update(secondRef, {
          position: firstPosition,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.update(courseRef, {
          contentRevision: revision,
          contentUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(auditRef, auditPayload({
          actor,
          action: `course.content.${entityType}.reordered`,
          entityId: `${courseId}/${collectionName}/${firstId}<->${secondId}`,
          before: {
            first: { id: firstId, position: firstPosition },
            second: { id: secondId, position: secondPosition }
          },
          after: {
            first: { id: firstId, position: secondPosition },
            second: { id: secondId, position: firstPosition }
          },
          revision
        }));
      });

      return {
        ok: true,
        contentRevision: revision,
        entityType,
        first: { id: firstId, position: secondPosition },
        second: { id: secondId, position: firstPosition }
      };
    }
  );

  return {
    listarConteudoCursoV12,
    reordenarConteudoCursoV12,
    criarModuloCursoV12,
    atualizarModuloCursoV12,
    excluirModuloCursoV12,
    criarAulaCursoV12,
    atualizarAulaCursoV12,
    excluirAulaCursoV12
  };
}

module.exports = {
  createCourseContentFunctions
};
