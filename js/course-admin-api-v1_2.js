"use strict";

(function initCourseAdminApi(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsCourseAdmin = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCourseAdminApi(root) {
    const REGION = "southamerica-east1";
    const PROJECTS = Object.freeze({
      staging: "bjj-exams-staging",
      production: "bjj-exams"
    });

    const ALLOWED_FUNCTIONS = new Set([
      "criarCursoV12",
      "atualizarCursoV12",
      "alterarStatusCursoV12",
      "listarCursosAdministraveisV12"
    ]);

    const PRODUCTION_HOSTS = new Set([
      "bjj-exams.web.app",
      "bjj-exams.firebaseapp.com"
    ]);

    const STAGING_HOSTS = new Set([
      "bjj-exams-staging.web.app",
      "bjj-exams-staging.firebaseapp.com"
    ]);

    const STATUS_LABELS = Object.freeze({
      draft: "Rascunho",
      review: "Em revisão",
      published: "Publicado",
      suspended: "Suspenso",
      archived: "Arquivado"
    });

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

      // Fail-safe: previews/hosts desconhecidos nunca usam produção por padrão.
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
        throw new Error(`Function administrativa fora do contrato: ${functionName}.`);
      }

      const environment = inferEnvironment(options);
      const projectId = projectIdForEnvironment(environment);
      return `https://${REGION}-${projectId}.cloudfunctions.net/${functionName}`;
    }

    async function callAuthenticated(functionName, data = {}, options = {}) {
      const idToken = String(options.idToken || "").trim();
      if (!idToken) {
        throw new Error("Token autenticado obrigatório.");
      }

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
              "Content-Type": "application/json",
              "Authorization": `Bearer ${idToken}`
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
          "Não foi possível concluir a operação do curso."
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

    function normalizeMoneyToCents(value) {
      if (Number.isInteger(value) && value >= 0) {
        return value;
      }

      const normalized = String(value ?? "")
        .trim()
        .replace(/\s+/g, "")
        .replace(/\.(?=\d{3}(?:\D|$))/g, "")
        .replace(",", ".");

      if (!normalized) {
        return 0;
      }

      const amount = Number(normalized);
      if (!Number.isFinite(amount) || amount < 0) {
        throw new Error("Preço inválido.");
      }

      return Math.round(amount * 100);
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

    function statusLabel(status) {
      const normalized = String(status || "").trim().toLowerCase();
      return STATUS_LABELS[normalized] || normalized || "Desconhecido";
    }

    function instructorActions(course) {
      const status = String(course?.status || "").trim().toLowerCase();

      if (status === "draft") {
        return ["edit", "content", "review", "archive"];
      }

      if (status === "review") {
        return ["archive"];
      }

      if (status === "published") {
        return ["view-public"];
      }

      return [];
    }

    async function listCourses(options = {}) {
      const result = await callAuthenticated(
        "listarCursosAdministraveisV12",
        {},
        options
      );
      return Array.isArray(result?.courses) ? result.courses : [];
    }

    async function createCourse(courseInput = {}, options = {}) {
      const result = await callAuthenticated(
        "criarCursoV12",
        {
          title: courseInput.title,
          description: courseInput.description,
          ownerType: courseInput.ownerType || "user",
          visibility: courseInput.visibility || "platform",
          organizationId: courseInput.organizationId || null,
          instructorIds: Array.isArray(courseInput.instructorIds)
            ? courseInput.instructorIds
            : [],
          isPaid: courseInput.isPaid === true,
          priceCents: Number(courseInput.priceCents || 0),
          currency: courseInput.currency || "BRL"
        },
        options
      );
      return result?.course || null;
    }

    async function updateCourse(courseInput = {}, options = {}) {
      const courseId = String(courseInput.courseId || "").trim();
      if (!courseId) {
        throw new Error("Curso inválido.");
      }

      const payload = { courseId };
      for (const field of [
        "title",
        "description",
        "instructorIds",
        "visibility",
        "organizationId",
        "isPaid",
        "priceCents",
        "currency"
      ]) {
        if (Object.prototype.hasOwnProperty.call(courseInput, field)) {
          payload[field] = courseInput[field];
        }
      }

      const result = await callAuthenticated(
        "atualizarCursoV12",
        payload,
        options
      );
      return result?.course || null;
    }

    async function changeStatus(courseId, status, options = {}) {
      const id = String(courseId || "").trim();
      const target = String(status || "").trim().toLowerCase();
      if (!id || !target) {
        throw new Error("Curso e status são obrigatórios.");
      }

      const result = await callAuthenticated(
        "alterarStatusCursoV12",
        { courseId: id, status: target },
        options
      );
      return result?.course || null;
    }

    return Object.freeze({
      REGION,
      PROJECTS,
      STATUS_LABELS,
      inferEnvironment,
      projectIdForEnvironment,
      functionUrl,
      callAuthenticated,
      normalizeMoneyToCents,
      formatPrice,
      statusLabel,
      instructorActions,
      listCourses,
      createCourse,
      updateCourse,
      changeStatus
    });
  }
);

// O painel administrativo legado já carrega este módulo antes do seu script
// Firebase principal. Para manter a integração do Marco 5.6 isolada e sem
// duplicar Firebase/Auth, carregamos o console financeiro como extensão lazy
// apenas quando a página realmente possui a aba #financeiro. A instalação
// acontece no evento load, depois de o painel ter inicializado seu handler de
// navegação e o Firebase App padrão.
(function loadAdminFinancialOpsExtension(root) {
  if (
    !root ||
    !root.document ||
    typeof root.document.getElementById !== "function" ||
    !root.document.getElementById("financeiro") ||
    typeof root.addEventListener !== "function"
  ) {
    return;
  }

  const currentScript = root.document.currentScript;
  const currentSrc = String(currentScript?.src || "").trim();
  if (!currentSrc) return;

  const baseUrl = new URL(".", currentSrc);
  const modules = [
    "course-purchase-api-v1_2.js",
    "financial-ops-ui-v1_2.js",
    "financial-ops-admin-bootstrap-v1_2.js",
    "admin-financial-ops-entry-v1_2.js"
  ];

  let loadChain = Promise.resolve();
  for (const moduleName of modules) {
    const moduleUrl = new URL(moduleName, baseUrl).href;
    loadChain = loadChain.then(() => import(moduleUrl));
  }

  loadChain
    .then(() => {
      const install = () => {
        try {
          const entry = root.BjjExamsAdminFinancialOpsEntry;
          if (!entry || typeof entry.install !== "function") {
            throw new Error("Entry financeiro administrativo não carregado.");
          }
          if (!root.__bjjFinancialOpsAdminEntryV12) {
            root.__bjjFinancialOpsAdminEntryV12 = entry.install({ root });
          }
        } catch (error) {
          root.console?.error?.(
            "Erro ao instalar console financeiro administrativo V1.2:",
            error
          );
        }
      };

      if (root.document.readyState === "complete") {
        install();
      } else {
        root.addEventListener("load", install, { once: true });
      }
    })
    .catch(error => {
      root.console?.error?.(
        "Erro ao carregar módulos financeiros administrativos V1.2:",
        error
      );
    });
})(typeof globalThis !== "undefined" ? globalThis : this);
