"use strict";

(function initFirebaseRuntime(root, factory) {
  const runtime = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = runtime;
  }

  if (root) {
    root.BjjExamsFirebaseRuntime = runtime;
    if (root.document && typeof runtime.bootstrapPageModules === "function") {
      Promise.resolve()
        .then(() => runtime.bootstrapPageModules())
        .catch(error => root.console?.error?.("BJJ Exams runtime bootstrap:", error));
    }
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildFirebaseRuntime(root) {
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

    // Configuração web de produção já era pública no frontend legado.
    // Ela só pode ser selecionada automaticamente em hosts oficiais de produção.
    const PRODUCTION_CONFIG = Object.freeze({
      apiKey: "AIzaSyDMYhKseehy_V0bmotTo63WPJgcsz4sFwI",
      authDomain: "bjj-exams.firebaseapp.com",
      projectId: "bjj-exams",
      storageBucket: "bjj-exams.firebasestorage.app",
      messagingSenderId: "682125845998",
      appId: "1:682125845998:web:bf58e915a2860bc79e5aff"
    });

    const BELT_EXAM_PAGE_MODULES = Object.freeze({
      "painel_professor.html": Object.freeze([
        "js/belt-exam-api-v1_2.js",
        "js/belt-exam-instructor-ui-v1_2.js"
      ]),
      "painel_aluno.html": Object.freeze([
        "js/belt-exam-api-v1_2.js",
        "js/belt-exam-student-ui-v1_2.js"
      ]),
      "exame.html": Object.freeze([
        "js/belt-exam-api-v1_2.js",
        "js/belt-exam-execution-ui-v1_2.js"
      ])
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
      if (explicit) return explicit;

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

    function expectedProjectId(options = {}) {
      return PROJECTS[inferEnvironment(options)];
    }

    // Gate 9.1B: optional, staging-only bridge for a Firebase App Check SDK token.
    // SDK initialization and enforcement are separately gated; no site key is
    // bundled here and no request is blocked when App Check is not configured.
    let stagingAppCheckTokenProvider = null;

    function registerStagingAppCheckTokenProvider(provider, options = {}) {
      if (inferEnvironment(options) !== "staging") {
        throw new Error("App Check staging-only: produção bloqueada.");
      }
      if (provider !== null && typeof provider !== "function") {
        throw new TypeError("App Check token provider must be a function or null.");
      }
      stagingAppCheckTokenProvider = provider;
      return true;
    }

    async function getAppCheckHeaders(options = {}) {
      if (inferEnvironment(options) !== "staging") return {};
      const provider = typeof options.getAppCheckToken === "function"
        ? options.getAppCheckToken
        : stagingAppCheckTokenProvider;
      if (typeof provider !== "function") return {};
      try {
        const value = await provider();
        const token = typeof value === "string" ? value : value?.token;
        if (typeof token !== "string" || !token.trim() ||
            /[\r\n]/.test(token)) return {};
        return { "X-Firebase-AppCheck": token.trim() };
      } catch (_) {
        // Telemetry and enforcement are reserved for later gates.
        // Never log or include App Check token values in error messages.
        return {};
      }
    }

    // Stage 9.1B2: only initialize after an explicit public staging site key.
    let appCheckSdkPromise = null;
    async function initializeStagingAppCheck(app, options = {}) {
      const host = String(options.hostname ?? root?.location?.hostname ?? "").toLowerCase();
      if (PRODUCTION_HOSTS.has(host) || inferEnvironment(options) !== "staging") {
        return { status: "production_blocked" };
      }
      const key = options.siteKey ?? root?.__BJJ_EXAMS_APP_CHECK_SITE_KEY__;
      if (typeof key !== "string" || !key.trim()) return { status: "not_configured" };
      if (app?.options?.projectId !== PROJECTS.staging || !app?.options?.appId) {
        return { status: "wrong_firebase_app" };
      }
      if (appCheckSdkPromise) return appCheckSdkPromise;
      appCheckSdkPromise = (async () => {
        try {
          const sdk = options.sdk || await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js");
          const instance = sdk.initializeAppCheck(app, {
            provider: new sdk.ReCaptchaEnterpriseProvider(key.trim()),
            isTokenAutoRefreshEnabled: true
          });
          registerStagingAppCheckTokenProvider(() => sdk.getToken(instance), options);
          return { status: "sdk_initialized" };
        } catch (_) {
          return { status: "sdk_unavailable" };
        }
      })();
      const result = await appCheckSdkPromise;
      if (result.status !== "sdk_initialized") appCheckSdkPromise = null;
      return result;
    }

    async function initializeStagingAppCheckFromConfig(options = {}) {
      const host = String(options.hostname ?? root?.location?.hostname ?? "").toLowerCase();
      if (PRODUCTION_HOSTS.has(host) || inferEnvironment(options) !== "staging") {
        return { status: "production_blocked" };
      }
      const key = options.siteKey ?? root?.__BJJ_EXAMS_APP_CHECK_SITE_KEY__;
      if (typeof key !== "string" || !key.trim()) return { status: "not_configured" };
      try {
        const config = await loadConfig(options);
        const sdk = options.firebaseSdk || await import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js");
        const existing = sdk.getApps().find(item =>
          item.options?.projectId === config.projectId && item.options?.appId === config.appId);
        return initializeStagingAppCheck(existing || sdk.initializeApp(config), options);
      } catch (_) {
        return { status: "sdk_unavailable" };
      }
    }

    function validateConfig(config, expectedProject) {
      if (!config || typeof config !== "object") {
        throw new Error("Configuração Firebase ausente.");
      }

      const projectId = String(config.projectId || "").trim();
      if (projectId !== expectedProject) {
        throw new Error(
          `Configuração Firebase bloqueada: esperado ${expectedProject}, recebido ${projectId || "vazio"}.`
        );
      }

      for (const field of ["apiKey", "authDomain", "projectId", "appId"]) {
        if (!String(config[field] || "").trim()) {
          throw new Error(`Configuração Firebase incompleta: ${field}.`);
        }
      }

      return Object.freeze({ ...config });
    }

    async function fetchJson(url, fetchImpl) {
      const response = await fetchImpl(url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Configuração Firebase indisponível (${response.status}).`);
      }
      return response.json();
    }

    async function loadConfig(options = {}) {
      const environment = inferEnvironment(options);
      const expectedProject = PROJECTS[environment];
      const hostname = String(
        options.hostname ?? root?.location?.hostname ?? ""
      ).trim().toLowerCase();

      if (environment === "production") {
        if (!PRODUCTION_HOSTS.has(hostname) && !options.allowExplicitProduction) {
          throw new Error(
            "Produção bloqueada: host atual não pertence à lista oficial."
          );
        }
        return validateConfig(PRODUCTION_CONFIG, expectedProject);
      }

      const injected = options.injectedConfig ?? root?.__BJJ_EXAMS_FIREBASE_CONFIG__;
      if (injected) {
        return validateConfig(injected, expectedProject);
      }

      const fetchImpl = options.fetchImpl || root?.fetch;
      if (typeof fetchImpl !== "function") {
        throw new Error("Fetch indisponível para carregar a configuração Firebase.");
      }

      if (STAGING_HOSTS.has(hostname)) {
        const hosted = await fetchJson("/__/firebase/init.json", fetchImpl);
        return validateConfig(hosted, expectedProject);
      }

      try {
        const local = await fetchJson("js/firebase-config.local.json", fetchImpl);
        return validateConfig(local, expectedProject);
      } catch (error) {
        const wrapped = new Error(
          "Configuração local de staging ausente. Execute scripts/prepare-staging-firebase-web-config.ps1 antes de abrir o painel local."
        );
        wrapped.code = "STAGING_CONFIG_REQUIRED";
        wrapped.cause = error;
        throw wrapped;
      }
    }

    function currentPageName(options = {}) {
      const pathname = String(
        options.pathname ?? root?.location?.pathname ?? ""
      ).trim().toLowerCase();
      const parts = pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] || "";
    }

    function loadScriptOnce(src, options = {}) {
      const document = options.document || root?.document;
      if (!document || typeof document.createElement !== "function") {
        return Promise.resolve(false);
      }
      const normalized = String(src || "").trim();
      if (!normalized) return Promise.resolve(false);

      const existing = document.querySelector?.(`script[data-bjj-runtime-src="${normalized}"]`);
      if (existing?.dataset?.loaded === "true") return Promise.resolve(true);
      if (existing) {
        return new Promise((resolve, reject) => {
          existing.addEventListener("load", () => resolve(true), { once: true });
          existing.addEventListener("error", () => reject(new Error(`Falha ao carregar ${normalized}.`)), { once: true });
        });
      }

      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = normalized;
        script.async = false;
        script.dataset.bjjRuntimeSrc = normalized;
        script.addEventListener("load", () => {
          script.dataset.loaded = "true";
          resolve(true);
        }, { once: true });
        script.addEventListener("error", () => {
          reject(new Error(`Falha ao carregar ${normalized}.`));
        }, { once: true });
        (document.head || document.documentElement || document.body).appendChild(script);
      });
    }

    async function bootstrapPageModules(options = {}) {
      if (!root?.document && !options.document) return Object.freeze({ loaded: false, reason: "no_document" });
      const environment = inferEnvironment(options);
      if (environment !== "staging") {
        return Object.freeze({ loaded: false, reason: "production_blocked" });
      }

      const page = currentPageName(options);
      const modules = BELT_EXAM_PAGE_MODULES[page] || [];
      if (!modules.length) {
        return Object.freeze({ loaded: false, reason: "page_not_targeted" });
      }

      for (const src of modules) {
        await loadScriptOnce(src, options);
      }
      return Object.freeze({
        loaded: true,
        page,
        modules: Object.freeze([...modules])
      });
    }

    return Object.freeze({
      PROJECTS,
      PRODUCTION_HOSTS,
      STAGING_HOSTS,
      BELT_EXAM_PAGE_MODULES,
      inferEnvironment,
      expectedProjectId,
      registerStagingAppCheckTokenProvider,
      getAppCheckHeaders,
      initializeStagingAppCheck,
      initializeStagingAppCheckFromConfig,
      validateConfig,
      loadConfig,
      currentPageName,
      loadScriptOnce,
      bootstrapPageModules
    });
  }
);
