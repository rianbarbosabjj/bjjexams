"use strict";

(function initCoursePriceMask(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsCoursePriceMask = api;
    api.install(root.document);
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCoursePriceMask(root) {
    let installed = false;

    function normalizeDraft(value) {
      const raw = String(value ?? "")
        .replace(/R\$/gi, "")
        .replace(/\s+/g, "")
        .replace(/[^0-9,.]/g, "");

      if (!raw) return "";

      const lastComma = raw.lastIndexOf(",");
      const lastDot = raw.lastIndexOf(".");
      const separatorIndex = Math.max(lastComma, lastDot);

      if (separatorIndex < 0) {
        return raw.replace(/\D/g, "");
      }

      const integerPart = raw
        .slice(0, separatorIndex)
        .replace(/\D/g, "") || "0";
      const decimalPart = raw
        .slice(separatorIndex + 1)
        .replace(/\D/g, "")
        .slice(0, 2);

      return `${integerPart},${decimalPart}`;
    }

    function toCents(value) {
      const normalized = normalizeDraft(value);
      if (!normalized) return 0;

      const [integerPart, decimalPart = ""] = normalized.split(",");
      const whole = Number(integerPart || "0");
      const cents = Number((decimalPart + "00").slice(0, 2));

      if (!Number.isSafeInteger(whole) || whole < 0 || !Number.isInteger(cents)) {
        throw new Error("Preço inválido.");
      }

      const total = whole * 100 + cents;
      if (!Number.isSafeInteger(total)) {
        throw new Error("Preço fora do limite permitido.");
      }

      return total;
    }

    function formatValue(value) {
      const cents = toCents(value);
      return new Intl.NumberFormat("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(cents / 100);
    }

    function isPriceField(target) {
      return target?.id === "course-v12-price";
    }

    function install(documentRef = root?.document) {
      if (installed || !documentRef?.addEventListener) return;
      installed = true;

      documentRef.addEventListener(
        "input",
        event => {
          const target = event.target;
          if (!isPriceField(target) || target.disabled) return;
          const next = normalizeDraft(target.value);
          if (target.value !== next) target.value = next;
        },
        true
      );

      documentRef.addEventListener(
        "blur",
        event => {
          const target = event.target;
          if (!isPriceField(target) || target.disabled) return;
          try {
            target.value = formatValue(target.value || "0");
          } catch (_) {
            // A validação definitiva continua no formulário/callable.
          }
        },
        true
      );
    }

    return Object.freeze({
      normalizeDraft,
      toCents,
      formatValue,
      install
    });
  }
);
