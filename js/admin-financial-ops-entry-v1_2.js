"use strict";

(function initAdminFinancialOpsEntry(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminFinancialOpsEntry = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildAdminFinancialOpsEntry(root) {
    const FIREBASE_APP_URL =
      "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
    const FIREBASE_AUTH_URL =
      "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    function hasFinanceHost(document) {
      return Boolean(
        document &&
        typeof document.getElementById === "function" &&
        document.getElementById("financeiro")
      );
    }

    async function resolveFirebaseAuth(options = {}) {
      if (options.auth) return options.auth;

      const importModule = options.importModule || (specifier => import(specifier));
      const [appModule, authModule] = await Promise.all([
        importModule(FIREBASE_APP_URL),
        importModule(FIREBASE_AUTH_URL)
      ]);

      if (
        typeof appModule?.getApps !== "function" ||
        typeof appModule?.getApp !== "function" ||
        typeof authModule?.getAuth !== "function"
      ) {
        throw new Error("Firebase Auth administrativo indisponível.");
      }

      const apps = appModule.getApps();
      if (!Array.isArray(apps) || apps.length === 0) {
        throw new Error("Firebase App administrativo ainda não foi inicializado.");
      }

      return authModule.getAuth(appModule.getApp());
    }

    function createEntry(options = {}) {
      const rootRef = options.root || root;
      const document = options.document || rootRef?.document;
      const purchaseApi = options.purchaseApi || rootRef?.BjjExamsCoursePurchase;
      const opsUi = options.opsUi || rootRef?.BjjExamsFinancialOpsUI;
      const bootstrapApi =
        options.bootstrapApi || rootRef?.BjjExamsFinancialOpsAdmin;
      const Swal = options.Swal || rootRef?.Swal;
      const hostname = options.hostname ?? rootRef?.location?.hostname ?? "";
      const logger = options.logger || rootRef?.console || console;

      if (!hasFinanceHost(document)) {
        return Object.freeze({
          installed: false,
          reason: "FINANCE_HOST_MISSING",
          mount: async () => null
        });
      }

      if (!purchaseApi || typeof purchaseApi.listAdminOperations !== "function") {
        throw new TypeError("Entry financeiro exige course-purchase-api válido.");
      }
      if (!opsUi || typeof opsUi.createController !== "function") {
        throw new TypeError("Entry financeiro exige financial-ops-ui válido.");
      }
      if (!bootstrapApi || typeof bootstrapApi.createBootstrap !== "function") {
        throw new TypeError("Entry financeiro exige bootstrap administrativo válido.");
      }
      if (!Swal || typeof Swal.fire !== "function") {
        throw new TypeError("Entry financeiro exige SweetAlert2.");
      }

      const state = {
        installed: false,
        bootstrap: null,
        originalTabHandler: null,
        mountPromise: null
      };

      async function ensureBootstrap() {
        if (state.bootstrap) return state.bootstrap;

        const auth = await resolveFirebaseAuth({
          auth: options.auth,
          importModule: options.importModule
        });

        state.bootstrap = bootstrapApi.createBootstrap({
          purchaseApi,
          opsUi,
          auth,
          document,
          Swal,
          hostname
        });
        return state.bootstrap;
      }

      async function mount() {
        if (state.mountPromise) return state.mountPromise;

        state.mountPromise = (async () => {
          const bootstrap = await ensureBootstrap();
          return bootstrap.mount();
        })();

        try {
          return await state.mountPromise;
        } finally {
          state.mountPromise = null;
        }
      }

      function reportMountError(error) {
        if (typeof logger?.error === "function") {
          logger.error("Erro ao carregar operações financeiras V1.2:", error);
        }
      }

      function triggerMount() {
        mount().catch(reportMountError);
      }

      function install() {
        if (state.installed) {
          return Object.freeze({ installed: true, reused: true });
        }

        const original = rootRef?.mudarAba;
        if (typeof original !== "function") {
          throw new Error("Navegação administrativa ainda não foi inicializada.");
        }

        state.originalTabHandler = original;
        rootRef.mudarAba = function wrappedAdminTabHandler(evt, tabName) {
          const result = state.originalTabHandler.apply(this, arguments);
          if (String(tabName || "").trim() === "financeiro") {
            triggerMount();
          }
          return result;
        };

        state.installed = true;

        const financeHost = document.getElementById("financeiro");
        if (financeHost?.classList?.contains?.("active")) {
          triggerMount();
        }

        return Object.freeze({ installed: true, reused: false });
      }

      return Object.freeze({
        installed: true,
        state,
        install,
        mount,
        ensureBootstrap
      });
    }

    function install(options = {}) {
      const entry = createEntry(options);
      if (entry.installed === false) return entry;
      entry.install();
      return entry;
    }

    return Object.freeze({
      FIREBASE_APP_URL,
      FIREBASE_AUTH_URL,
      hasFinanceHost,
      resolveFirebaseAuth,
      createEntry,
      install
    });
  }
);
