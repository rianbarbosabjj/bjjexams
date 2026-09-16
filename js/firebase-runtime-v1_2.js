"use strict";

(function initFirebaseRuntime(root, factory) {
  const runtime = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = runtime;
  }

  if (root) {
    root.BjjExamsFirebaseRuntime = runtime;
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

    return Object.freeze({
      PROJECTS,
      PRODUCTION_HOSTS,
      STAGING_HOSTS,
      inferEnvironment,
      expectedProjectId,
      validateConfig,
      loadConfig
    });
  }
);
