"use strict";

(function initFinancialOpsAdminBootstrap(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsFinancialOpsAdmin = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildFinancialOpsAdminBootstrap(root) {
    const FINANCIAL_ROLES = Object.freeze([
      "super_admin",
      "platform_admin"
    ]);

    function financialRole(claims = {}) {
      if (claims.super_admin === true) return "super_admin";
      if (claims.platform_admin === true) return "platform_admin";
      return null;
    }

    function actionCopy(view = {}) {
      const action = String(view.action || "").trim().toLowerCase();
      const productType = String(view.productType || "").trim().toLowerCase();
      const isBeltExam = productType === "belt_exam";

      if (action === "refund_full") {
        return Object.freeze({
          title: isBeltExam
            ? "Solicitar estorno integral do exame?"
            : "Solicitar estorno integral?",
          text: isBeltExam
            ? "A solicitação será enviada ao provedor e a autorização financeira do exame só mudará após confirmação assíncrona."
            : "O pedido será enviado ao provedor e o acesso só mudará após confirmação assíncrona.",
          reasonLabel: "Justificativa do estorno",
          reasonPlaceholder: "Informe o motivo do estorno integral..."
        });
      }

      if (action === "cancel_pending") {
        return Object.freeze({
          title: isBeltExam
            ? "Cancelar cobrança pendente do exame?"
            : "Cancelar cobrança pendente?",
          text: isBeltExam
            ? "A cobrança pendente será cancelada no provedor; a inscrição permanecerá sem autorização financeira."
            : "A cobrança pendente será cancelada no provedor; nenhuma matrícula paga será criada.",
          reasonLabel: "Justificativa do cancelamento",
          reasonPlaceholder: "Informe o motivo do cancelamento..."
        });
      }

      return Object.freeze({
        title: "Confirmar operação financeira?",
        text: "Confirme apenas se o estado exibido estiver correto.",
        reasonLabel: "Justificativa",
        reasonPlaceholder: "Informe a justificativa..."
      });
    }

    function createSwalAdapters(Swal) {
      if (!Swal || typeof Swal.fire !== "function") {
        throw new TypeError("Integração financeira administrativa exige SweetAlert2.");
      }

      async function confirmAction(view) {
        const copy = actionCopy(view);
        const result = await Swal.fire({
          background: "var(--bg-card)",
          color: "var(--text-main)",
          icon: "warning",
          title: copy.title,
          text: copy.text,
          showCancelButton: true,
          confirmButtonText: "Confirmar",
          cancelButtonText: "Cancelar",
          confirmButtonColor: "#f43f5e",
          cancelButtonColor: "#334155",
          reverseButtons: true
        });
        return result?.isConfirmed === true;
      }

      async function requestReason(action, view = {}) {
        const copy = actionCopy({ ...view, action });
        const result = await Swal.fire({
          background: "var(--bg-card)",
          color: "var(--text-main)",
          icon: "question",
          title: copy.reasonLabel,
          input: "textarea",
          inputLabel: "Registro operacional obrigatório",
          inputPlaceholder: copy.reasonPlaceholder,
          inputAttributes: {
            minlength: "5",
            maxlength: "300",
            "aria-label": copy.reasonLabel
          },
          inputValidator: value => {
            const reason = String(value || "").trim();
            if (reason.length < 5) {
              return "Informe uma justificativa com pelo menos 5 caracteres.";
            }
            if (reason.length > 300) {
              return "A justificativa deve possuir no máximo 300 caracteres.";
            }
            return undefined;
          },
          showCancelButton: true,
          confirmButtonText: "Continuar",
          cancelButtonText: "Cancelar",
          confirmButtonColor: "var(--brand-color)",
          cancelButtonColor: "#334155"
        });

        return result?.isConfirmed
          ? String(result.value || "").trim()
          : "";
      }

      return Object.freeze({ confirmAction, requestReason });
    }

    function createBootstrap(options = {}) {
      const purchaseApi = options.purchaseApi || root?.BjjExamsCoursePurchase;
      const opsUi = options.opsUi || root?.BjjExamsFinancialOpsUI;
      const auth = options.auth || root?.__BJJ_EXAMS_AUTH__;
      const document = options.document || root?.document;
      const Swal = options.Swal || root?.Swal;
      const hostname = options.hostname ?? root?.location?.hostname ?? "";

      if (!purchaseApi || typeof purchaseApi.listAdminOperations !== "function") {
        throw new TypeError("Bootstrap financeiro exige course-purchase-api válido.");
      }
      if (!opsUi || typeof opsUi.createController !== "function") {
        throw new TypeError("Bootstrap financeiro exige financial-ops-ui válido.");
      }
      if (!auth) {
        throw new TypeError("Bootstrap financeiro exige Firebase Auth inicializado.");
      }
      if (!document || typeof document.getElementById !== "function") {
        throw new TypeError("Bootstrap financeiro exige documento DOM válido.");
      }

      const swalAdapters = createSwalAdapters(Swal);
      const state = {
        controller: null,
        role: null,
        userId: null
      };

      function assertStagingOnly() {
        if (
          typeof purchaseApi.inferEnvironment === "function" &&
          typeof purchaseApi.assertEnvironmentSafe === "function"
        ) {
          const environment = purchaseApi.inferEnvironment({ hostname });
          purchaseApi.assertEnvironmentSafe(environment);
          return environment;
        }
        return "staging";
      }

      async function resolveActor() {
        const user = auth.currentUser;
        if (!user || typeof user.getIdToken !== "function") {
          return Object.freeze({ user: null, role: null });
        }

        const tokenResult = typeof user.getIdTokenResult === "function"
          ? await user.getIdTokenResult()
          : { claims: {} };
        const role = financialRole(tokenResult?.claims || {});
        return Object.freeze({ user, role });
      }

      async function ensureController() {
        assertStagingOnly();
        const actor = await resolveActor();
        if (!actor.user || !actor.role) {
          state.controller = null;
          state.role = null;
          state.userId = actor.user?.uid || null;
          return null;
        }

        if (
          state.controller &&
          state.userId === actor.user.uid &&
          state.role === actor.role
        ) {
          return state.controller;
        }

        state.role = actor.role;
        state.userId = actor.user.uid;
        state.controller = opsUi.createController({
          api: purchaseApi,
          document,
          hostname,
          getIdToken: () => actor.user.getIdToken(),
          confirmAction: swalAdapters.confirmAction,
          requestReason: swalAdapters.requestReason
        });
        return state.controller;
      }

      async function mount() {
        const controller = await ensureController();
        if (!controller) return Object.freeze({ mounted: false, role: null, items: [] });
        const items = await controller.mount();
        return Object.freeze({
          mounted: true,
          role: state.role,
          items: Array.isArray(items) ? items : []
        });
      }

      async function load() {
        const controller = await ensureController();
        if (!controller) return [];
        const items = await controller.load();
        return Array.isArray(items) ? items : [];
      }

      return Object.freeze({
        state,
        assertStagingOnly,
        resolveActor,
        ensureController,
        mount,
        load
      });
    }

    return Object.freeze({
      FINANCIAL_ROLES,
      financialRole,
      actionCopy,
      createSwalAdapters,
      createBootstrap
    });
  }
);
