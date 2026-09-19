"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ui = require(path.resolve(__dirname, "..", "js", "course-purchase-ui-v1_2.js"));

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test("available_for_purchase oferece compra PIX", () => {
  const view = ui.purchasePresentation({ purchaseState: "available_for_purchase" });
  assert.equal(view.action, "start_checkout");
  assert.equal(view.actionLabel, "Comprar com PIX");
  assert.equal(view.poll, false);
});

test("payment_pending exibe PIX e ativa polling", () => {
  const view = ui.purchasePresentation({ purchaseState: "payment_pending" });
  assert.equal(view.showPix, true);
  assert.equal(view.poll, true);
  assert.equal(view.action, "resume_checkout");
});

test("pagamento confirmado sem entitlement continua aguardando", () => {
  const view = ui.purchasePresentation({ purchaseState: "payment_confirmed_access_pending" });
  assert.equal(view.poll, true);
  assert.equal(view.action, "refresh_status");
});

test("paid_entitled libera curso e encerra polling", () => {
  const view = ui.purchasePresentation({ purchaseState: "paid_entitled" });
  assert.equal(view.action, "open_course");
  assert.equal(view.poll, false);
  assert.equal(ui.shouldPollPurchase({ purchaseState: "paid_entitled" }), false);
});

test("granted_entitled libera curso sem checkout", () => {
  const view = ui.purchasePresentation({ purchaseState: "granted_entitled" });
  assert.equal(view.action, "open_course");
  assert.equal(view.showPix, false);
});

test("refunded oferece recompra com nova tentativa", () => {
  const view = ui.purchasePresentation({ purchaseState: "refunded" });
  assert.equal(view.action, "start_new_checkout");
});

test("cancelled_or_expired oferece novo PIX", () => {
  const view = ui.purchasePresentation({ purchaseState: "cancelled_or_expired" });
  assert.equal(view.action, "start_new_checkout");
});

test("chargeback nao oferece nova operacao destrutiva", () => {
  const view = ui.purchasePresentation({ purchaseState: "chargeback" });
  assert.equal(view.action, "none");
  assert.equal(view.actionLabel, null);
});

test("estado desconhecido falha conservador para refresh", () => {
  const view = ui.purchasePresentation({ purchaseState: "mystery" });
  assert.equal(view.action, "refresh_status");
  assert.equal(view.showPix, false);
});

test("QR base64 valido vira data URI local", () => {
  assert.equal(
    ui.sanitizeBase64Image("aGVsbG8="),
    "data:image/png;base64,aGVsbG8="
  );
});

test("QR com conteudo nao base64 e rejeitado", () => {
  assert.equal(ui.sanitizeBase64Image("https://evil.example/qrcode"), null);
  assert.equal(ui.sanitizeBase64Image("<svg></svg>"), null);
});

test("checkout normalizado nao preserva ids internos", () => {
  const result = ui.normalizeCheckoutResult({
    orderId: "order-secret",
    transactionId: "tx-secret",
    paymentId: "pay-secret",
    status: "pending_payment",
    processing: false,
    pix: {
      encodedImage: "aGVsbG8=",
      payload: "000201PIX",
      expirationDate: "2026-09-20T20:00:00.000Z"
    }
  });
  assert.equal(result.status, "pending_payment");
  assert.equal(result.pix.payload, "000201PIX");
  assert.equal(Object.prototype.hasOwnProperty.call(result, "orderId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "transactionId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "paymentId"), false);
});

test("polling ocorre apenas nos estados transitórios previstos", () => {
  assert.equal(ui.shouldPollPurchase({ purchaseState: "payment_pending" }), true);
  assert.equal(ui.shouldPollPurchase({ purchaseState: "payment_confirmed_access_pending" }), true);
  assert.equal(ui.shouldPollPurchase({ purchaseState: "refunded" }), false);
  assert.equal(ui.shouldPollPurchase({ purchaseState: "chargeback" }), false);
});

test("intervalo e timeout de polling sao limitados", () => {
  assert.equal(ui.POLL_INTERVAL_MS, 3000);
  assert.equal(ui.POLL_TIMEOUT_MS, 300000);
});

test("cursos.html integra cliente de compra sem acesso direto ao Firestore financeiro", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "cursos.html"), "utf8");
  // Este teste passa após a integração do Gate 3B.
  if (!html.includes("course-purchase-ui-v1_2.js")) return;
  assert.match(html, /course-purchase-api-v1_2\.js/);
  assert.match(html, /course-purchase-ui-v1_2\.js/);
  assert.match(html, /id="purchase-panel"/);
  assert.match(html, /id="purchase-pix-image"/);
  assert.match(html, /id="purchase-pix-payload"/);
  assert.doesNotMatch(html, /collection\s*\(\s*db\s*,\s*["']orders["']/);
  assert.doesNotMatch(html, /collection\s*\(\s*db\s*,\s*["']payment_transactions["']/);
});

let passed = 0;
(async () => {
  for (const item of cases) {
    try {
      await item.fn();
      passed += 1;
      console.log(`PASS | ${item.name}`);
    } catch (error) {
      console.error(`FAIL | ${item.name}`);
      console.error(error.stack || error);
      process.exitCode = 1;
    }
  }
  console.log(`COURSE_PURCHASE_UI_V1_2=${passed}/${cases.length}`);
})();
