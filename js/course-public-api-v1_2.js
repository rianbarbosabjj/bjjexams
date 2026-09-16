"use strict";

(function initCoursePublicApi(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsCoursePublic = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCoursePublicApi(root) {
    const REGION = "southamerica-east1";
    const PROJECTS = Object.freeze({
      staging: "bjj-exams-staging",
      production: "bjj-exams"
    });

    const ALLOWED_FUNCTIONS = new Set([
      "listarCatalogoCursosV12",
      "obterCursoPublicoV12"
    ]);

    const PRODUCTION_HOSTS = new Set([
      "bjj-exams.web.app",
      "bjj-exams.firebaseapp.com"
    ]);

    const STAGING_HOSTS = new Set([
      "bjj-exams-staging.web.app",
      "bjj-exams-staging.firebaseapp.com"
    ]);

    function ensureBrandUtilities() {
      const document = root?.document;
      if (!document || document.getElementById("bjj-course-public-brand-utilities")) {
        return;
      }

      const style = document.createElement("style");
      style.id = "bjj-course-public-brand-utilities";
      style.textContent = `
        .text-neon{color:#00FFD1!important}
        .bg-neon{background-color:#00FFD1!important}
        .border-neon{border-color:#00FFD1!important}
        .border-t-neon{border-top-color:#00FFD1!important}
        .text-neon\\/40{color:rgba(0,255,209,.40)!important}
        .bg-neon\\/10{background-color:rgba(0,255,209,.10)!important}
        .border-neon\\/20{border-color:rgba(0,255,209,.20)!important}
        .border-neon\\/30{border-color:rgba(0,255,209,.30)!important}
        .hover\\:border-neon:hover{border-color:#00FFD1!important}
      `;
      document.head.appendChild(style);
    }

    ensureBrandUtilities();

    function normalizeEnvironment(value) {
      const env = String(value || "").trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(PROJECTS, env)
        ? env
        : null;
    }

    function inferEnvironment(options = {}) {
      const explicit = normalizeEnvironment(
        options.explicitEnvironment ?? root?.__BJJ_EXAMS_ENV__
      );

      if (explicit) {
        return explicit;
      }

      const hostname = String(
        options.hostname ?? root?.location?.hostname ?? ""
      ).trim().toLowerCase();

      if (PRODUCTION_HOSTS.has(hostname)) {
        return "production";
      }

      if (
        STAGING_HOSTS.has(hostname) ||
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1" ||
        hostname.endsWith(".localhost")
      ) {
        return "staging";
      }

      // Fail-safe: hosts desconhecidos nunca apontam automaticamente para produção.
      return "staging";
    }

    function projectIdForEnvironment(environment) {
      const env = normalizeEnvironment(environment);
      if (!env) {
        throw new Error("Ambiente BJJ Exams inválido.");
      }
      return PROJECTS[env];
    }

    function functionUrl(functionName, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function pública fora do contrato: ${functionName}.`);
      }

      const environment = inferEnvironment(options);
      const projectId = projectIdForEnvironment(environment);
      return `https://${REGION}-${projectId}.cloudfunctions.net/${functionName}`;
    }

    async function callCallable(functionName, data = {}, options = {}) {
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
        const response = await fetchImpl(
          functionUrl(functionName, options),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ data }),
            signal: controller?.signal
          }
        );

        let body = {};
        try {
          body = await response.json();
        } catch (_) {}

        if (
          response.ok &&
          Object.prototype.hasOwnProperty.call(body, "result")
        ) {
          return body.result;
        }

        const error = new Error(
          body?.error?.message ||
          "Não foi possível carregar as informações do curso."
        );
        error.httpStatus = response.status;
        error.callableStatus = body?.error?.status || null;
        throw error;
      } catch (error) {
        if (error?.name === "AbortError") {
          throw new Error("A consulta demorou mais do que o esperado.");
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    async function listCourses(options = {}) {
      const limit = options.limit ?? 24;
      const result = await callCallable(
        "listarCatalogoCursosV12",
        { limit },
        options
      );
      return Array.isArray(result?.courses) ? result.courses : [];
    }

    async function getCourse(courseId, options = {}) {
      const id = String(courseId || "").trim();
      if (!id) {
        throw new Error("Curso inválido.");
      }

      const result = await callCallable(
        "obterCursoPublicoV12",
        { courseId: id },
        options
      );
      return result?.course || null;
    }

    function formatPrice(course) {
      if (!course?.isPaid) {
        return "GRÁTIS";
      }

      const cents = Number(course.priceCents || 0);
      const currency = String(course.currency || "BRL").toUpperCase();
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency
      }).format(cents / 100);
    }

    return Object.freeze({
      REGION,
      PROJECTS,
      inferEnvironment,
      projectIdForEnvironment,
      functionUrl,
      callCallable,
      listCourses,
      getCourse,
      formatPrice
    });
  }
);
