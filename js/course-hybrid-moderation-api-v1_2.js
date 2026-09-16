"use strict";

(function initCourseHybridModerationApi(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.BjjExamsCourseHybridModeration = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCourseHybridModerationApi(root) {
    const REGION = "southamerica-east1";
    const RESPONSIBILITY_TERMS_VERSION = "course-content-responsibility-v1";
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
      "solicitarPublicacaoCursoV12",
      "listarExcecoesModeracaoV12"
    ]);

    function inferEnvironment(options = {}) {
      const hostname = String(options.hostname ?? root?.location?.hostname ?? "")
        .trim()
        .toLowerCase();
      if (PRODUCTION_HOSTS.has(hostname)) return "production";
      if (
        STAGING_HOSTS.has(hostname) ||
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".localhost")
      ) return "staging";
      return "staging";
    }

    function functionUrl(functionName, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function de moderação fora do contrato: ${functionName}.`);
      }
      const env = inferEnvironment(options);
      const projectId = PROJECTS[env];
      return `https://${REGION}-${projectId}.cloudfunctions.net/${functionName}`;
    }

    async function callAuthenticated(functionName, data = {}, options = {}) {
      const idToken = String(options.idToken || "").trim();
      if (!idToken) throw new Error("Token autenticado obrigatório.");
      const fetchImpl = options.fetchImpl || root?.fetch;
      if (typeof fetchImpl !== "function") throw new Error("Fetch indisponível neste ambiente.");

      const controller = typeof AbortController === "function" ? new AbortController() : null;
      const timeoutMs = Number(options.timeoutMs || 25000);
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

      try {
        const response = await fetchImpl(functionUrl(functionName, options), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify({ data }),
          signal: controller?.signal
        });

        let body = {};
        try { body = await response.json(); } catch (_) {}
        if (response.ok && Object.prototype.hasOwnProperty.call(body, "result")) {
          return body.result;
        }

        const error = new Error(body?.error?.message || "Não foi possível concluir a moderação do curso.");
        error.httpStatus = response.status;
        error.callableStatus = body?.error?.status || null;
        error.details = body?.error?.details || null;
        throw error;
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error("A triagem demorou mais do que o esperado. Tente novamente.");
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    async function submitForPublication(courseId, options = {}) {
      const id = String(courseId || "").trim();
      if (!id) throw new Error("Curso inválido.");
      return callAuthenticated(
        "solicitarPublicacaoCursoV12",
        {
          courseId: id,
          responsibilityAccepted: options.responsibilityAccepted === true,
          termsVersion: options.termsVersion || RESPONSIBILITY_TERMS_VERSION
        },
        options
      );
    }

    async function listExceptions(options = {}) {
      const result = await callAuthenticated(
        "listarExcecoesModeracaoV12",
        {},
        options
      );
      return Array.isArray(result?.courses) ? result.courses : [];
    }

    return Object.freeze({
      REGION,
      PROJECTS,
      RESPONSIBILITY_TERMS_VERSION,
      inferEnvironment,
      functionUrl,
      callAuthenticated,
      submitForPublication,
      listExceptions
    });
  }
);
