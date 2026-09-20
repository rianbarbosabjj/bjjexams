"use strict";

(function initCoursePurchaseUi(root, factory) {
  const ui = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = ui;
  }

  if (root) {
    root.BjjExamsCoursePurchaseUI = ui;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCoursePurchaseUi(root) {
    const POLL_INTERVAL_MS = 3000;
    const POLL_TIMEOUT_MS = 5 * 60 * 1000;

    const TERMINAL_STATES = new Set([
      "paid_entitled",
      "granted_entitled",
      "refunded",
      "chargeback",
      "cancelled_or_expired"
    ]);

    function normalizeState(value) {
      return String(value || "").trim().toLowerCase();
    }

    function purchasePresentation(purchase = null) {
      if (!purchase) {
        return Object.freeze({
          state: "unknown",
          title: "Status indisponível",
          message: "Não foi possível consultar sua compra agora.",
          action: "retry_status",
          actionLabel: "Tentar novamente",
          tone: "neutral",
          showPix: false,
          poll: false
        });
      }

      const state = normalizeState(purchase.purchaseState);
      const table = {
        available_for_purchase: {
          title: "Inscrição disponível",
          message: "Finalize o pagamento por PIX para liberar o acesso ao curso.",
          action: "start_checkout",
          actionLabel: "Comprar com PIX",
          tone: "available",
          showPix: false,
          poll: false
        },
        payment_pending: {
          title: "Aguardando pagamento",
          message: "Use o QR Code ou o código PIX copia e cola. A confirmação é automática.",
          action: "resume_checkout",
          actionLabel: "Exibir PIX",
          tone: "pending",
          showPix: true,
          poll: true
        },
        payment_confirmed_access_pending: {
          title: "Pagamento confirmado",
          message: "Seu pagamento foi confirmado e o acesso está sendo liberado.",
          action: "refresh_status",
          actionLabel: "Atualizar status",
          tone: "pending",
          showPix: false,
          poll: true
        },
        paid_entitled: {
          title: "Acesso liberado",
          message: "Seu pagamento foi confirmado e o curso já está disponível.",
          action: "open_course",
          actionLabel: "Acessar curso",
          tone: "success",
          showPix: false,
          poll: false
        },
        granted_entitled: {
          title: "Acesso liberado",
          message: "Você possui acesso administrativo a este curso.",
          action: "open_course",
          actionLabel: "Acessar curso",
          tone: "success",
          showPix: false,
          poll: false
        },
        refunded: {
          title: "Compra estornada",
          message: "Esta compra foi estornada e o acesso pago não está ativo.",
          action: "start_new_checkout",
          actionLabel: "Comprar novamente",
          tone: "warning",
          showPix: false,
          poll: false
        },
        chargeback: {
          title: "Pagamento contestado",
          message: "O acesso está suspenso enquanto a contestação financeira permanece ativa.",
          action: "none",
          actionLabel: null,
          tone: "danger",
          showPix: false,
          poll: false
        },
        cancelled_or_expired: {
          title: "Cobrança encerrada",
          message: "A cobrança anterior foi cancelada ou expirou. Você pode iniciar uma nova compra.",
          action: "start_new_checkout",
          actionLabel: "Gerar novo PIX",
          tone: "neutral",
          showPix: false,
          poll: false
        }
      };

      return Object.freeze({
        state,
        ...(table[state] || {
          title: "Status em análise",
          message: "A situação desta compra precisa ser atualizada antes de uma nova operação.",
          action: "refresh_status",
          actionLabel: "Atualizar status",
          tone: "neutral",
          showPix: false,
          poll: false
        })
      });
    }

    function sanitizeBase64Image(value) {
      const raw = String(value || "").trim();
      if (!raw) return null;
      const withoutPrefix = raw.replace(/^data:image\/(png|jpeg);base64,/i, "");
      if (!/^[A-Za-z0-9+/=\r\n]+$/.test(withoutPrefix)) return null;
      return `data:image/png;base64,${withoutPrefix.replace(/\s+/g, "")}`;
    }

    function normalizeCheckoutResult(result = {}) {
      const pix = result?.pix || {};
      return Object.freeze({
        status: normalizeState(result?.status),
        processing: result?.processing === true,
        pix: Object.freeze({
          imageSrc: sanitizeBase64Image(pix.encodedImage),
          payload: pix.payload ? String(pix.payload) : null,
          expirationDate: pix.expirationDate ? String(pix.expirationDate) : null
        })
      });
    }

    function shouldPollPurchase(purchase = {}) {
      const state = normalizeState(purchase.purchaseState);
      if (TERMINAL_STATES.has(state)) return false;
      return state === "payment_pending" || state === "payment_confirmed_access_pending";
    }

    function formatExpiration(value) {
      const raw = String(value || "").trim();
      if (!raw) return null;
      const date = new Date(raw);
      if (Number.isNaN(date.getTime())) return raw;
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(date);
    }

    function text(document, id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value == null ? "" : String(value);
      return node;
    }

    function toggle(document, id, visible) {
      const node = document.getElementById(id);
      if (!node) return null;
      node.classList.toggle("hidden", !visible);
      return node;
    }

    function setButton(document, presentation, disabled = false) {
      const button = document.getElementById("purchase-action");
      if (!button) return;
      const visible = Boolean(presentation.actionLabel && presentation.action !== "none");
      button.classList.toggle("hidden", !visible);
      button.disabled = disabled;
      if (visible) {
        button.textContent = presentation.actionLabel;
        button.dataset.action = presentation.action;
      } else {
        delete button.dataset.action;
      }
    }

    function createController(options = {}) {
      const api = options.api || root?.BjjExamsCoursePurchase;
      const document = options.document || root?.document;
      const courseId = String(options.courseId || "").trim();
      const getSession = options.getSession;
      const onOpenCourse = options.onOpenCourse || (() => {
        if (root?.location) root.location.href = "painel_aluno.html";
      });
      const clipboard = options.clipboard || root?.navigator?.clipboard;
      const setTimer = options.setTimeout || root?.setTimeout?.bind(root);
      const clearTimer = options.clearTimeout || root?.clearTimeout?.bind(root);
      const now = options.now || (() => Date.now());

      if (!api) throw new Error("API de compra do curso não configurada.");
      if (!document) throw new Error("Documento indisponível para compra do curso.");
      if (!courseId) throw new Error("Curso obrigatório para a compra.");
      if (typeof getSession !== "function") {
        throw new Error("getSession é obrigatório para a compra autenticada.");
      }

      const state = {
        purchase: null,
        checkout: null,
        busy: false,
        pollTimer: null,
        pollStartedAt: null,
        stopped: false
      };

      function renderSignedOut() {
        toggle(document, "purchase-panel", true);
        toggle(document, "purchase-auth-required", true);
        toggle(document, "purchase-authenticated", false);
        toggle(document, "purchase-pix", false);
      }

      function renderCheckout(checkout) {
        const pix = checkout?.pix || {};
        const hasPix = Boolean(pix.payload || pix.imageSrc);
        toggle(document, "purchase-pix", hasPix);
        const image = document.getElementById("purchase-pix-image");
        if (image) {
          if (pix.imageSrc) {
            image.src = pix.imageSrc;
            image.classList.remove("hidden");
          } else {
            image.removeAttribute("src");
            image.classList.add("hidden");
          }
        }
        const payload = document.getElementById("purchase-pix-payload");
        if (payload) payload.value = pix.payload || "";
        const expiration = formatExpiration(pix.expirationDate);
        text(document, "purchase-pix-expiration", expiration ? `Válido até ${expiration}` : "");
      }

      function renderPurchase(purchase) {
        const presentation = purchasePresentation(purchase);
        toggle(document, "purchase-panel", true);
        toggle(document, "purchase-auth-required", false);
        toggle(document, "purchase-authenticated", true);
        text(document, "purchase-status-title", presentation.title);
        text(document, "purchase-status-message", presentation.message);
        const status = document.getElementById("purchase-status");
        if (status) status.dataset.tone = presentation.tone;
        setButton(document, presentation, state.busy);
        if (!presentation.showPix && presentation.state !== "payment_pending") {
          toggle(document, "purchase-pix", false);
        }
        return presentation;
      }

      async function sessionOptions(extra = {}) {
        const session = await getSession();
        if (!session?.userId || typeof session.getIdToken !== "function") {
          throw new Error("Sessão autenticada obrigatória para comprar este curso.");
        }
        return {
          userId: session.userId,
          getIdToken: session.getIdToken,
          hostname: options.hostname ?? root?.location?.hostname ?? "",
          storage: options.storage || root?.localStorage,
          ...extra
        };
      }

      async function refreshStatus({ resumePix = true } = {}) {
        const apiOptions = await sessionOptions();
        const purchase = await api.getPurchaseStatus(courseId, apiOptions);
        state.purchase = purchase;
        const presentation = renderPurchase(purchase);

        if (
          resumePix &&
          presentation.state === "payment_pending" &&
          purchase?.payment?.ready === true
        ) {
          const result = await api.resumeCheckout(courseId, apiOptions);
          state.checkout = normalizeCheckoutResult(result);
          renderCheckout(state.checkout);
        }

        if (shouldPollPurchase(purchase)) schedulePoll();
        else stopPolling();
        return purchase;
      }

      async function startCheckout(forceNewIntent = false) {
        if (state.busy) return null;
        state.busy = true;
        if (state.purchase) setButton(document, purchasePresentation(state.purchase), true);
        try {
          const apiOptions = await sessionOptions({ forceNewIntent });
          const result = await api.startCheckout(courseId, apiOptions);
          state.checkout = normalizeCheckoutResult(result);
          renderCheckout(state.checkout);
          return await refreshStatus({ resumePix: false });
        } finally {
          state.busy = false;
          if (state.purchase) setButton(document, purchasePresentation(state.purchase), false);
        }
      }

      async function copyPix() {
        const payload = String(state.checkout?.pix?.payload || "").trim();
        if (!payload) throw new Error("Código PIX indisponível.");
        if (!clipboard || typeof clipboard.writeText !== "function") {
          throw new Error("Área de transferência indisponível.");
        }
        await clipboard.writeText(payload);
        text(document, "purchase-copy-feedback", "Código PIX copiado.");
        if (setTimer) setTimer(() => text(document, "purchase-copy-feedback", ""), 2500);
        return true;
      }

      function stopPolling() {
        if (state.pollTimer && clearTimer) clearTimer(state.pollTimer);
        state.pollTimer = null;
        state.pollStartedAt = null;
      }

      function schedulePoll() {
        if (!setTimer || state.stopped || state.pollTimer) return;
        if (state.pollStartedAt == null) state.pollStartedAt = now();
        if (now() - state.pollStartedAt >= POLL_TIMEOUT_MS) {
          stopPolling();
          return;
        }
        state.pollTimer = setTimer(async () => {
          state.pollTimer = null;
          try {
            await refreshStatus({ resumePix: false });
          } catch (error) {
            if (root?.console?.warn) root.console.warn("BJJ Exams: falha ao atualizar status da compra.", error);
            schedulePoll();
          }
        }, POLL_INTERVAL_MS);
      }

      async function handleAction(action) {
        const name = String(action || "");
        if (name === "start_checkout") return startCheckout(false);
        if (name === "start_new_checkout") return startCheckout(true);
        if (name === "resume_checkout") {
          const apiOptions = await sessionOptions();
          const result = await api.resumeCheckout(courseId, apiOptions);
          state.checkout = normalizeCheckoutResult(result);
          renderCheckout(state.checkout);
          schedulePoll();
          return result;
        }
        if (name === "refresh_status" || name === "retry_status") {
          return refreshStatus();
        }
        if (name === "open_course") return onOpenCourse(courseId);
        return null;
      }

      function bind() {
        const action = document.getElementById("purchase-action");
        if (action) {
          action.addEventListener("click", async () => {
            const selected = action.dataset.action;
            try {
              await handleAction(selected);
            } catch (error) {
              text(document, "purchase-error", error?.message || "Não foi possível concluir a operação agora.");
              toggle(document, "purchase-error", true);
            }
          });
        }

        const copy = document.getElementById("purchase-copy");
        if (copy) {
          copy.addEventListener("click", async () => {
            try {
              await copyPix();
            } catch (error) {
              text(document, "purchase-copy-feedback", error?.message || "Não foi possível copiar o PIX.");
            }
          });
        }
      }

      async function start() {
        state.stopped = false;
        bind();
        const session = await getSession();
        if (!session?.userId) {
          renderSignedOut();
          return null;
        }
        try {
          return await refreshStatus();
        } catch (error) {
          const fallback = purchasePresentation(null);
          toggle(document, "purchase-panel", true);
          toggle(document, "purchase-auth-required", false);
          toggle(document, "purchase-authenticated", true);
          text(document, "purchase-status-title", fallback.title);
          text(document, "purchase-status-message", fallback.message);
          setButton(document, fallback, false);
          throw error;
        }
      }

      function destroy() {
        state.stopped = true;
        stopPolling();
      }

      return Object.freeze({
        state,
        start,
        destroy,
        refreshStatus,
        startCheckout,
        handleAction,
        copyPix,
        renderPurchase,
        renderCheckout
      });
    }

    return Object.freeze({
      POLL_INTERVAL_MS,
      POLL_TIMEOUT_MS,
      TERMINAL_STATES,
      normalizeState,
      purchasePresentation,
      sanitizeBase64Image,
      normalizeCheckoutResult,
      shouldPollPurchase,
      formatExpiration,
      createController
    });
  }
);
