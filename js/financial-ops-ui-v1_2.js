"use strict";

(function initFinancialOpsUi(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsFinancialOpsUI = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildFinancialOpsUi(root) {
    const ACTIONS = Object.freeze({
      CANCEL: "cancel_pending",
      REFUND: "refund_full"
    });

    const STATUS_LABELS = Object.freeze({
      pending_payment: "Aguardando pagamento",
      paid: "Pago",
      cancelled: "Cancelado",
      expired: "Expirado",
      refunded: "Estornado",
      chargeback: "Chargeback"
    });

    const REVERSAL_LABELS = Object.freeze({
      executing: "Processando operação",
      awaiting_webhook: "Aguardando confirmação do provedor",
      completed: "Reversão concluída",
      provider_rejected: "Operação rejeitada pelo provedor",
      needs_reconciliation: "Reconciliação manual necessária"
    });

    function safeText(value, fallback = "—") {
      const text = String(value ?? "").trim();
      return text || fallback;
    }

    function formatCurrency(amountCents, currency = "BRL") {
      const cents = Number(amountCents);
      if (!Number.isSafeInteger(cents) || cents < 0) return "Valor indisponível";
      try {
        return new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: String(currency || "BRL").toUpperCase()
        }).format(cents / 100);
      } catch (_) {
        return `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
      }
    }

    function toDate(value) {
      if (!value) return null;
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
      if (typeof value?.toDate === "function") {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
      }
      if (typeof value === "object" && Number.isFinite(Number(value.seconds))) {
        const date = new Date(Number(value.seconds) * 1000);
        return Number.isNaN(date.getTime()) ? null : date;
      }
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatDateTime(value) {
      const date = toDate(value);
      if (!date) return "—";
      return date.toLocaleString("pt-BR", {
        dateStyle: "short",
        timeStyle: "short"
      });
    }

    function reversalView(reversal) {
      if (!reversal) {
        return Object.freeze({
          status: null,
          label: "Sem reversão em andamento",
          tone: "neutral"
        });
      }
      const status = String(reversal.status || "").trim().toLowerCase();
      const tone = status === "needs_reconciliation" || status === "provider_rejected"
        ? "danger"
        : status === "completed"
          ? "success"
          : "warning";
      return Object.freeze({
        status,
        label: REVERSAL_LABELS[status] || "Estado de reversão desconhecido",
        tone,
        providerLifecycleStatus: safeText(reversal.providerLifecycleStatus, null),
        errorCode: safeText(reversal.errorCode, null)
      });
    }

    function operationView(item = {}) {
      const orderStatus = String(item.orderStatus || "").trim().toLowerCase();
      const transactionStatus = String(item.transactionStatus || "").trim().toLowerCase();
      const reversal = reversalView(item.reversal || null);
      const needsReconciliation = item.needsReconciliation === true;
      const reversalInProgress = item.reversalInProgress === true;
      const canCancel = item.canCancel === true && !needsReconciliation && !reversalInProgress;
      const canRefund = item.canRefund === true && !needsReconciliation && !reversalInProgress;

      return Object.freeze({
        orderId: safeText(item.orderId, ""),
        courseTitle: safeText(item.course?.title, "Curso"),
        buyerName: safeText(item.buyer?.name, "Aluno"),
        buyerEmail: safeText(item.buyer?.email, "—"),
        amountLabel: formatCurrency(item.amountCents, item.currency),
        orderStatus,
        transactionStatus,
        orderStatusLabel: STATUS_LABELS[orderStatus] || safeText(orderStatus, "Estado desconhecido"),
        enrollmentStatus: safeText(item.enrollmentStatus, "Sem acesso"),
        updatedAtLabel: formatDateTime(item.updatedAt || item.createdAt),
        reversal,
        canCancel,
        canRefund,
        needsReconciliation,
        reversalInProgress,
        action: canCancel
          ? ACTIONS.CANCEL
          : canRefund
            ? ACTIONS.REFUND
            : null
      });
    }

    function normalizeError(error) {
      const status = String(error?.callableStatus || "").toUpperCase();
      const httpStatus = Number(error?.httpStatus || 0);
      if (httpStatus === 401 || status === "UNAUTHENTICATED") {
        return { title: "Sessão expirada", message: "Entre novamente para operar o financeiro." };
      }
      if (httpStatus === 403 || status === "PERMISSION_DENIED") {
        return { title: "Acesso restrito", message: "Seu perfil não possui permissão financeira." };
      }
      return {
        title: "Operação indisponível",
        message: safeText(error?.message, "Não foi possível concluir a operação financeira agora.")
      };
    }

    function createController(options = {}) {
      const api = options.api;
      const document = options.document || root?.document;
      const getIdToken = options.getIdToken;
      const hostname = options.hostname ?? root?.location?.hostname ?? "";
      const confirmAction = options.confirmAction || (async () => true);
      const requestReason = options.requestReason || (async action => {
        const label = action === ACTIONS.REFUND ? "estorno" : "cancelamento";
        const reason = root?.prompt?.(`Informe a justificativa do ${label}:`) || "";
        return reason;
      });

      if (!api || typeof api.listAdminOperations !== "function") {
        throw new TypeError("Financial Ops UI exige course-purchase-api válido.");
      }
      if (!document || typeof document.createElement !== "function") {
        throw new TypeError("Financial Ops UI exige documento DOM válido.");
      }
      if (typeof getIdToken !== "function") {
        throw new TypeError("Financial Ops UI exige getIdToken autenticado.");
      }

      const state = {
        items: [],
        role: null,
        loading: false,
        pendingOrderIds: new Set()
      };

      function apiOptions() {
        return {
          hostname,
          getIdToken
        };
      }

      function clear(node) {
        while (node.firstChild) node.removeChild(node.firstChild);
      }

      function el(tag, text, className) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined && text !== null) node.textContent = String(text);
        return node;
      }

      function ensureSection() {
        let section = document.getElementById("bjj-financial-ops-v12");
        if (section) return section;

        const host = document.getElementById("financeiro");
        if (!host) throw new Error("Aba financeira administrativa não encontrada.");

        section = document.createElement("section");
        section.id = "bjj-financial-ops-v12";
        section.className = "mt-8 bg-cardbg border border-slate-700 rounded-3xl shadow-xl overflow-hidden";

        const header = document.createElement("div");
        header.className = "p-6 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4";
        const titleBox = document.createElement("div");
        titleBox.append(
          el("h3", "Operações financeiras de cursos", "text-lg font-black text-white uppercase"),
          el("p", "Visão sanitizada para cancelamento, estorno e reconciliação.", "text-xs text-slate-400 mt-1")
        );
        const refresh = el("button", "Atualizar", "px-4 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs font-black uppercase tracking-widest text-white hover:border-neon");
        refresh.type = "button";
        refresh.addEventListener("click", () => load().catch(() => undefined));
        header.append(titleBox, refresh);

        const banner = el("div", "AMBIENTE DE TESTES — STAGING / ASAAS SANDBOX", "mx-6 mt-6 px-4 py-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px] font-black uppercase tracking-widest");
        const body = document.createElement("div");
        body.id = "bjj-financial-ops-v12-body";
        body.className = "p-6";

        section.append(header, banner, body);
        host.appendChild(section);
        return section;
      }

      function renderMessage(title, message) {
        ensureSection();
        const body = document.getElementById("bjj-financial-ops-v12-body");
        clear(body);
        const box = document.createElement("div");
        box.className = "rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center";
        box.append(
          el("h4", title, "font-black text-white mb-2"),
          el("p", message, "text-sm text-slate-400")
        );
        body.appendChild(box);
      }

      function actionButton(view) {
        if (!view.action) return el("span", "Sem ação disponível", "text-[10px] text-slate-500 uppercase font-bold");
        const isRefund = view.action === ACTIONS.REFUND;
        const button = el(
          "button",
          isRefund ? "Solicitar estorno" : "Cancelar cobrança",
          isRefund
            ? "px-3 py-2 rounded-lg border border-rose-500/40 text-rose-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500/10"
            : "px-3 py-2 rounded-lg border border-amber-500/40 text-amber-400 text-[10px] font-black uppercase tracking-widest hover:bg-amber-500/10"
        );
        button.type = "button";
        button.disabled = state.pendingOrderIds.has(view.orderId);
        button.addEventListener("click", () => execute(view).catch(() => undefined));
        return button;
      }

      function render() {
        ensureSection();
        const body = document.getElementById("bjj-financial-ops-v12-body");
        clear(body);

        if (!state.items.length) {
          renderMessage("Nenhuma operação financeira", "Ainda não há pedidos de cursos para exibir.");
          return;
        }

        const stack = document.createElement("div");
        stack.className = "space-y-4";

        for (const item of state.items) {
          const view = operationView(item);
          const card = document.createElement("article");
          card.className = view.needsReconciliation
            ? "rounded-2xl border border-rose-500/50 bg-rose-500/5 p-5"
            : "rounded-2xl border border-slate-700 bg-slate-900 p-5";

          const top = document.createElement("div");
          top.className = "flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4";
          const identity = document.createElement("div");
          identity.className = "min-w-0";
          identity.append(
            el("h4", view.courseTitle, "font-black text-white truncate"),
            el("p", `${view.buyerName} • ${view.buyerEmail}`, "text-xs text-slate-400 mt-1 break-all"),
            el("p", view.updatedAtLabel, "text-[10px] text-slate-500 mt-2")
          );

          const value = document.createElement("div");
          value.className = "lg:text-right";
          value.append(
            el("p", view.amountLabel, "text-lg font-black text-emerald-400"),
            el("p", view.orderStatusLabel, "text-[10px] uppercase tracking-widest text-slate-400 mt-1")
          );
          top.append(identity, value);

          const meta = document.createElement("div");
          meta.className = "grid grid-cols-1 md:grid-cols-3 gap-3 mt-4";
          meta.append(
            el("div", `Transação: ${safeText(view.transactionStatus)}`, "rounded-xl bg-cardbg border border-slate-700 px-3 py-2 text-[10px] text-slate-400"),
            el("div", `Acesso: ${view.enrollmentStatus}`, "rounded-xl bg-cardbg border border-slate-700 px-3 py-2 text-[10px] text-slate-400"),
            el("div", view.reversal.label, "rounded-xl bg-cardbg border border-slate-700 px-3 py-2 text-[10px] text-slate-400")
          );

          const footer = document.createElement("div");
          footer.className = "mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3";
          const note = view.needsReconciliation
            ? "Ação manual necessária. Nenhuma nova reversão será disparada pela interface."
            : view.reversalInProgress
              ? "Operação solicitada. Aguardando confirmação assíncrona do provedor."
              : "Estado canônico atualizado pelo backend.";
          footer.append(
            el("p", note, view.needsReconciliation ? "text-xs text-rose-400" : "text-xs text-slate-500"),
            actionButton(view)
          );

          card.append(top, meta, footer);
          stack.appendChild(card);
        }

        body.appendChild(stack);
      }

      async function load() {
        if (state.loading) return state.items;
        state.loading = true;
        renderMessage("Carregando operações", "Consultando a visão financeira sanitizada.");
        try {
          const result = await api.listAdminOperations(50, apiOptions());
          state.role = result?.role || null;
          state.items = Array.isArray(result?.items) ? result.items : [];
          render();
          return state.items;
        } catch (error) {
          const uiError = normalizeError(error);
          renderMessage(uiError.title, uiError.message);
          throw error;
        } finally {
          state.loading = false;
        }
      }

      async function execute(view) {
        if (!view?.orderId || !view.action) return null;
        if (state.pendingOrderIds.has(view.orderId)) return null;

        const confirmed = await confirmAction(view);
        if (!confirmed) return null;
        const reason = String(await requestReason(view.action, view) || "").trim();
        if (reason.length < 5 || reason.length > 300) {
          throw new Error("Justificativa deve possuir entre 5 e 300 caracteres.");
        }

        state.pendingOrderIds.add(view.orderId);
        render();
        try {
          const result = view.action === ACTIONS.REFUND
            ? await api.requestFullRefund(view.orderId, reason, apiOptions())
            : await api.cancelPending(view.orderId, reason, apiOptions());
          await load();
          return result;
        } finally {
          state.pendingOrderIds.delete(view.orderId);
          render();
        }
      }

      function mount() {
        ensureSection();
        return load();
      }

      return Object.freeze({
        state,
        mount,
        load,
        render,
        execute,
        ensureSection
      });
    }

    return Object.freeze({
      ACTIONS,
      STATUS_LABELS,
      REVERSAL_LABELS,
      safeText,
      formatCurrency,
      toDate,
      formatDateTime,
      reversalView,
      operationView,
      normalizeError,
      createController
    });
  }
);
