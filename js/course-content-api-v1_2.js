"use strict";

(function initCourseContentApi(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsCourseContent = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCourseContentApi(root) {
    const REGION = "southamerica-east1";
    const PROJECTS = Object.freeze({
      staging: "bjj-exams-staging",
      production: "bjj-exams"
    });

    const ALLOWED_FUNCTIONS = new Set([
      "listarConteudoCursoV12",
      "reordenarConteudoCursoV12",
      "criarModuloCursoV12",
      "atualizarModuloCursoV12",
      "excluirModuloCursoV12",
      "criarAulaCursoV12",
      "atualizarAulaCursoV12",
      "excluirAulaCursoV12"
    ]);

    const PRODUCTION_HOSTS = new Set([
      "bjj-exams.web.app",
      "bjj-exams.firebaseapp.com"
    ]);

    const STAGING_HOSTS = new Set([
      "bjj-exams-staging.web.app",
      "bjj-exams-staging.firebaseapp.com"
    ]);

    function inferEnvironment(options = {}) {
      const explicit = String(
        options.explicitEnvironment ?? root?.__BJJ_EXAMS_ENV__ ?? ""
      ).trim().toLowerCase();

      if (Object.prototype.hasOwnProperty.call(PROJECTS, explicit)) {
        return explicit;
      }

      const hostname = String(
        options.hostname ?? root?.location?.hostname ?? ""
      ).trim().toLowerCase();

      if (PRODUCTION_HOSTS.has(hostname)) return "production";
      if (
        STAGING_HOSTS.has(hostname) ||
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".localhost")
      ) {
        return "staging";
      }

      return "staging";
    }

    function projectIdForEnvironment(environment) {
      const value = String(environment || "").trim().toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(PROJECTS, value)) {
        throw new Error("Ambiente BJJ Exams inválido.");
      }
      return PROJECTS[value];
    }

    function functionUrl(functionName, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function de conteúdo fora do contrato: ${functionName}.`);
      }
      const projectId = projectIdForEnvironment(inferEnvironment(options));
      return `https://${REGION}-${projectId}.cloudfunctions.net/${functionName}`;
    }

    async function callAuthenticated(functionName, data = {}, options = {}) {
      const idToken = String(options.idToken || "").trim();
      if (!idToken) throw new Error("Token autenticado obrigatório.");

      const fetchImpl = options.fetchImpl || root?.fetch;
      if (typeof fetchImpl !== "function") {
        throw new Error("Fetch indisponível neste ambiente.");
      }

      const timeoutMs = Number(options.timeoutMs || 15000);
      const controller = typeof AbortController === "function"
        ? new AbortController()
        : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

      try {
        const response = await fetchImpl(functionUrl(functionName, options), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${idToken}`
          },
          body: JSON.stringify({ data }),
          signal: controller?.signal
        });

        let body = {};
        try {
          body = await response.json();
        } catch (_) {}

        if (response.ok && Object.prototype.hasOwnProperty.call(body, "result")) {
          return body.result;
        }

        const error = new Error(
          body?.error?.message || "Não foi possível concluir a operação de conteúdo."
        );
        error.httpStatus = response.status;
        error.callableStatus = body?.error?.status || null;
        error.details = body?.error?.details || null;
        throw error;
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error("A operação demorou mais do que o esperado.");
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    function requireId(value, label) {
      const id = String(value || "").trim();
      if (!id) throw new Error(`${label} obrigatório.`);
      return id;
    }

    async function listContent(courseId, options = {}) {
      return callAuthenticated(
        "listarConteudoCursoV12",
        { courseId: requireId(courseId, "Curso") },
        options
      );
    }

    async function createModule(courseId, input = {}, options = {}) {
      return callAuthenticated(
        "criarModuloCursoV12",
        {
          courseId: requireId(courseId, "Curso"),
          title: input.title,
          description: input.description,
          position: input.position
        },
        options
      );
    }

    async function updateModule(courseId, moduleId, input = {}, options = {}) {
      return callAuthenticated(
        "atualizarModuloCursoV12",
        {
          courseId: requireId(courseId, "Curso"),
          moduleId: requireId(moduleId, "Módulo"),
          ...input
        },
        options
      );
    }

    async function deleteModule(courseId, moduleId, options = {}) {
      return callAuthenticated(
        "excluirModuloCursoV12",
        {
          courseId: requireId(courseId, "Curso"),
          moduleId: requireId(moduleId, "Módulo")
        },
        options
      );
    }

    function lessonPayload(input = {}) {
      return {
        moduleId: input.moduleId,
        title: input.title,
        description: input.description,
        position: input.position,
        contentType: input.contentType,
        durationMinutes: input.durationMinutes,
        isPreview: input.isPreview === true,
        videoUrl: input.videoUrl,
        body: input.body,
        documentUrl: input.documentUrl
      };
    }

    async function createLesson(courseId, input = {}, options = {}) {
      return callAuthenticated(
        "criarAulaCursoV12",
        {
          courseId: requireId(courseId, "Curso"),
          ...lessonPayload(input)
        },
        options
      );
    }

    async function updateLesson(courseId, lessonId, input = {}, options = {}) {
      return callAuthenticated(
        "atualizarAulaCursoV12",
        {
          courseId: requireId(courseId, "Curso"),
          lessonId: requireId(lessonId, "Aula"),
          ...lessonPayload(input)
        },
        options
      );
    }

    async function deleteLesson(courseId, lessonId, options = {}) {
      return callAuthenticated(
        "excluirAulaCursoV12",
        {
          courseId: requireId(courseId, "Curso"),
          lessonId: requireId(lessonId, "Aula")
        },
        options
      );
    }

    async function reorderPair(courseId, entityType, firstId, secondId, options = {}) {
      const type = String(entityType || "").trim();
      if (type !== "module" && type !== "lesson") {
        throw new Error("Tipo de conteudo invalido para reordenacao.");
      }
      return callAuthenticated(
        "reordenarConteudoCursoV12",
        {
          courseId: requireId(courseId, "Curso"),
          entityType: type,
          firstId: requireId(firstId, "Primeiro item"),
          secondId: requireId(secondId, "Segundo item")
        },
        options
      );
    }

    return Object.freeze({
      REGION,
      PROJECTS,
      ALLOWED_FUNCTIONS,
      inferEnvironment,
      projectIdForEnvironment,
      functionUrl,
      callAuthenticated,
      listContent,
      reorderPair,
      createModule,
      updateModule,
      deleteModule,
      createLesson,
      updateLesson,
      deleteLesson
    });
  }
);
