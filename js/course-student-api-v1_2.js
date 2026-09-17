"use strict";

(function initCourseStudentApi(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsCourseStudent = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCourseStudentApi(root) {
    const REGION = "southamerica-east1";
    const PROJECTS = Object.freeze({
      staging: "bjj-exams-staging",
      production: "bjj-exams"
    });

    const PRODUCTION_HOSTS = new Set([
      "bjj-exams.web.app",
      "bjj-exams.firebaseapp.com"
    ]);

    const STAGING_HOSTS = new Set([
      "bjj-exams-staging.web.app",
      "bjj-exams-staging.firebaseapp.com"
    ]);

    const ALLOWED_FUNCTIONS = new Set([
      "matricularCursoGratuitoV12",
      "obterEntitlementCursoV12",
      "listarMeusCursosV12",
      "obterEstruturaConsumoCursoV12",
      "obterAulaConsumoCursoV12",
      "obterProgressoCursoV12",
      "concluirAulaCursoV12"
    ]);

    function normalizeEnvironment(value) {
      const env = String(value || "").trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(PROJECTS, env)
        ? env
        : null;
    }

    function currentHostname(options = {}) {
      return String(
        options.hostname ?? root?.location?.hostname ?? ""
      ).trim().toLowerCase();
    }

    function inferEnvironment(options = {}) {
      const runtime = options.runtime || root?.BjjExamsFirebaseRuntime;
      if (runtime && typeof runtime.inferEnvironment === "function") {
        return runtime.inferEnvironment(options);
      }

      const explicit = normalizeEnvironment(
        options.explicitEnvironment ?? root?.__BJJ_EXAMS_ENV__
      );
      if (explicit) return explicit;

      const hostname = currentHostname(options);

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

    function projectIdForEnvironment(environment, options = {}) {
      const runtime = options.runtime || root?.BjjExamsFirebaseRuntime;
      if (runtime && typeof runtime.projectIdForEnvironment === "function") {
        return runtime.projectIdForEnvironment(environment);
      }

      const env = normalizeEnvironment(environment);
      if (!env) throw new Error("Ambiente BJJ Exams inválido.");
      return PROJECTS[env];
    }

    function assertEnvironmentSafe(environment, options = {}) {
      if (environment !== "production") return;

      const hostname = currentHostname(options);
      if (
        !PRODUCTION_HOSTS.has(hostname) &&
        options.allowExplicitProduction !== true
      ) {
        throw new Error(
          "Produção bloqueada: a API privada do aluno só pode usar produção nos hosts oficiais."
        );
      }
    }

    function functionUrl(functionName, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function de aluno fora do contrato: ${functionName}.`);
      }

      const environment = inferEnvironment(options);
      assertEnvironmentSafe(environment, options);
      const projectId = projectIdForEnvironment(environment, options);
      return `https://${REGION}-${projectId}.cloudfunctions.net/${functionName}`;
    }

    async function resolveIdToken(options = {}) {
      const directToken = String(options.idToken || "").trim();
      if (directToken) return directToken;

      if (typeof options.getIdToken === "function") {
        const token = String(await options.getIdToken() || "").trim();
        if (token) return token;
      }

      throw new Error("Sessão autenticada obrigatória para acessar cursos do aluno.");
    }

    async function callPrivateCallable(functionName, data = {}, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function de aluno fora do contrato: ${functionName}.`);
      }

      const fetchImpl = options.fetchImpl || root?.fetch;
      if (typeof fetchImpl !== "function") {
        throw new Error("Fetch indisponível neste ambiente.");
      }

      const idToken = await resolveIdToken(options);
      const timeoutMs = Number(options.timeoutMs || 20000);
      const controller = typeof AbortController === "function"
        ? new AbortController()
        : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

      try {
        const response = await fetchImpl(
          functionUrl(functionName, options),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({ data }),
            signal: controller?.signal
          }
        );

        const contentType = response.headers?.get?.("content-type") || "";
        const rawBody = await response.text();
        let body = {};

        if (rawBody) {
          try {
            body = JSON.parse(rawBody);
          } catch (_) {
            body = {};
          }
        }

        if (
          response.ok &&
          Object.prototype.hasOwnProperty.call(body, "result")
        ) {
          return body.result;
        }

        const error = new Error(
          body?.error?.message ||
          (response.status === 401 || response.status === 403
            ? "Sua sessão não possui acesso a este recurso."
            : "Não foi possível carregar os dados do curso.")
        );
        error.httpStatus = response.status;
        error.callableStatus = body?.error?.status || null;
        error.domainCode = body?.error?.details?.domainCode || null;
        error.responseContentType = contentType;
        throw error;
      } catch (error) {
        if (error?.name === "AbortError") {
          const timeoutError = new Error("A consulta demorou mais do que o esperado.");
          timeoutError.code = "COURSE_STUDENT_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    function requireId(value, label) {
      const id = String(value || "").trim();
      if (!id || id.includes("/") || id.length > 200) {
        throw new Error(`${label} inválido.`);
      }
      return id;
    }

    async function listMyCourses(options = {}) {
      const result = await callPrivateCallable(
        "listarMeusCursosV12",
        {},
        options
      );
      return Array.isArray(result?.courses) ? result.courses : [];
    }

    async function getEntitlement(courseId, options = {}) {
      const id = requireId(courseId, "Curso");
      return callPrivateCallable(
        "obterEntitlementCursoV12",
        { courseId: id },
        options
      );
    }

    async function enrollFreeCourse(courseId, options = {}) {
      const id = requireId(courseId, "Curso");
      return callPrivateCallable(
        "matricularCursoGratuitoV12",
        { courseId: id },
        options
      );
    }

    async function getCourseStructure(courseId, options = {}) {
      const id = requireId(courseId, "Curso");
      return callPrivateCallable(
        "obterEstruturaConsumoCursoV12",
        { courseId: id },
        options
      );
    }

    async function getLesson(courseId, lessonId, options = {}) {
      const course = requireId(courseId, "Curso");
      const lesson = requireId(lessonId, "Aula");
      return callPrivateCallable(
        "obterAulaConsumoCursoV12",
        { courseId: course, lessonId: lesson },
        options
      );
    }

    async function getProgress(courseId, options = {}) {
      const id = requireId(courseId, "Curso");
      return callPrivateCallable(
        "obterProgressoCursoV12",
        { courseId: id },
        options
      );
    }

    async function completeLesson(courseId, lessonId, options = {}) {
      const course = requireId(courseId, "Curso");
      const lesson = requireId(lessonId, "Aula");
      return callPrivateCallable(
        "concluirAulaCursoV12",
        { courseId: course, lessonId: lesson },
        options
      );
    }

    return Object.freeze({
      REGION,
      PROJECTS,
      ALLOWED_FUNCTIONS,
      inferEnvironment,
      projectIdForEnvironment,
      assertEnvironmentSafe,
      functionUrl,
      resolveIdToken,
      callPrivateCallable,
      listMyCourses,
      getEntitlement,
      enrollFreeCourse,
      getCourseStructure,
      getLesson,
      getProgress,
      completeLesson
    });
  }
);
