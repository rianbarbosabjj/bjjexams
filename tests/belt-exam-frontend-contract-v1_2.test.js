"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const api = require("../js/belt-exam-api-v1_2.js");
const studentUi = require("../js/belt-exam-student-ui-v1_2.js");
const instructorUi = require("../js/belt-exam-instructor-ui-v1_2.js");
const runtime = require("../js/firebase-runtime-v1_2.js");

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

async function main() {
  await test("API de exame resolve somente staging", () => {
    assert.equal(api.inferEnvironment({ hostname: "localhost" }), "staging");
    assert.throws(
      () => api.functionUrl("listarMeusExamesFaixaV12", {
        explicitEnvironment: "production",
        hostname: "bjj-exams.web.app"
      }),
      /somente em staging/
    );
  });

  await test("API limita funcoes ao contrato belt_exam", () => {
    assert.equal(api.ALLOWED_FUNCTIONS.has("listarMeusExamesFaixaV12"), true);
    assert.equal(api.ALLOWED_FUNCTIONS.has("retomarCheckoutExameFaixaV12"), true);
    assert.equal(api.ALLOWED_FUNCTIONS.has("iniciarExameSeguro"), false);
    assert.throws(
      () => api.functionUrl("iniciarExameSeguro", { explicitEnvironment: "staging" }),
      /fora do contrato/
    );
  });

  await test("callable do frontend envia bearer e envelope Firebase", async () => {
    let captured = null;
    const result = await api.callPrivateCallable(
      "listarMeusExamesFaixaV12",
      { limit: 10 },
      {
        explicitEnvironment: "staging",
        idToken: "token-gate-6b",
        fetchImpl: async (url, options) => {
          captured = { url, options };
          return {
            ok: true,
            status: 200,
            headers: { get: () => "application/json" },
            text: async () => JSON.stringify({ result: { ok: true, items: [] } })
          };
        }
      }
    );
    assert.equal(result.ok, true);
    assert.equal(captured.options.headers.Authorization, "Bearer token-gate-6b");
    assert.deepEqual(JSON.parse(captured.options.body), { data: { limit: 10 } });
    assert.match(captured.url, /bjj-exams-staging/);
  });

  await test("runtime carrega modulos belt_exam apenas nas paginas alvo", () => {
    assert.deepEqual(runtime.BELT_EXAM_PAGE_MODULES["painel_professor.html"], [
      "js/belt-exam-api-v1_2.js",
      "js/belt-exam-instructor-ui-v1_2.js"
    ]);
    assert.deepEqual(runtime.BELT_EXAM_PAGE_MODULES["painel_aluno.html"], [
      "js/belt-exam-api-v1_2.js",
      "js/belt-exam-student-ui-v1_2.js"
    ]);
    assert.equal(runtime.BELT_EXAM_PAGE_MODULES["index.html"], undefined);
  });

  await test("runtime bloqueia bootstrap belt_exam em producao", async () => {
    const result = await runtime.bootstrapPageModules({
      hostname: "bjj-exams.web.app",
      pathname: "/painel_aluno.html",
      document: {}
    });
    assert.deepEqual(result, { loaded: false, reason: "production_blocked" });
  });

  await test("view do aluno nunca transforma authorized em inicio de prova", () => {
    const view = studentUi.examCardView({
      sessionId: "session-1",
      state: "authorized",
      canStartCheckout: false,
      canResumePayment: false,
      canStartExam: false,
      organization: { name: "Academia" },
      currentBelt: "Branca",
      targetBelt: "Azul",
      price: { amountCents: 15000, currency: "BRL" }
    });
    assert.equal(view.action, "authorized_wait");
    assert.equal(view.canStartExam, false);
    assert.match(view.description, /Marco 6/);
  });

  await test("frontend inicia e retoma checkout por contratos distintos", async () => {
    const requests = [];
    const options = {
      explicitEnvironment: "staging",
      idToken: "token",
      fetchImpl: async (url, fetchOptions) => {
        requests.push({ url, body: JSON.parse(fetchOptions.body) });
        return {
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          text: async () => JSON.stringify({ result: { ok: true, pix: {} } })
        };
      }
    };
    await api.startCheckout("session-1", "intent-1", options);
    await api.resumeCheckout("session-1", options);
    assert.deepEqual(requests[0].body.data, {
      sessionId: "session-1",
      idempotencyKey: "intent-1"
    });
    assert.deepEqual(requests[1].body.data, { sessionId: "session-1" });
    assert.match(requests[1].url, /retomarCheckoutExameFaixaV12$/);
  });

  const apiSource = read("js/belt-exam-api-v1_2.js");
  const instructorSource = read("js/belt-exam-instructor-ui-v1_2.js");
  const studentSource = read("js/belt-exam-student-ui-v1_2.js");
  const runtimeSource = read("js/firebase-runtime-v1_2.js");
  const mainSource = read("functions/main.js");
  const resumeFunctionSource = read("functions/src/finance/financial-belt-exam-checkout-resume-functions.js");

  await test("nova UI nao acessa colecoes Firestore canonicas ou legadas diretamente", () => {
    const uiCombined = `${apiSource}\n${instructorSource}\n${studentSource}`;
    for (const forbidden of [
      "creditos_professor",
      "config_exames",
      "exam_sessions/",
      "exam_registrations/",
      "payment_transactions/",
      "orders/",
      "getFirestore(",
      "updateDoc(",
      "setDoc("
    ]) {
      assert.equal(uiCombined.includes(forbidden), false, forbidden);
    }
  });

  await test("instrutor intercepta aba canonica sem chamar tracking legado", () => {
    assert.match(instructorSource, /tabName === \"acompanhamento\"/);
    assert.match(instructorSource, /activateTab\(evt\)/);
    assert.equal(instructorSource.includes("iniciarTrackingExamesAoVivo"), false);
    assert.equal(instructorSource.includes("verificarSaldoCreditos"), false);
  });

  await test("aluno oculta jornada legada quando registration canonica existe", () => {
    assert.match(studentSource, /setCanonicalMode\(true\)/);
    assert.match(studentSource, /node\.style\.display = \"none\"/);
    assert.equal(studentSource.includes("iniciarProvaReal("), false);
    assert.equal(studentSource.includes("buscarConfigExamePrevia("), false);
  });

  await test("resume callable permanece sanitizada", () => {
    assert.match(resumeFunctionSource, /sessionId/);
    assert.equal(resumeFunctionSource.includes("paymentId: result.paymentId"), false);
    assert.equal(resumeFunctionSource.includes("providerPaymentId"), false);
    assert.equal(resumeFunctionSource.includes("financialSnapshot"), false);
  });

  await test("composition root mantem suporte 6B staging demo only", () => {
    assert.match(mainSource, /const examUiSupportFunctions = webhookRuntimeAllowed/);
    assert.match(mainSource, /const financialBeltExamCheckoutResumeFunctions = webhookRuntimeAllowed/);
    assert.match(mainSource, /\.\.\.examUiSupportFunctions/);
    assert.match(mainSource, /\.\.\.financialBeltExamCheckoutResumeFunctions/);
    assert.match(runtimeSource, /environment !== \"staging\"/);
  });

  await test("copy do professor explicita ausencia de credito na jornada canonica", () => {
    assert.match(instructorSource, /Nenhum crédito do professor é consumido nesta jornada/);
  });

  console.log(`BELT_EXAM_FRONTEND_CONTRACT_V1_2=${passed}/13`);
  if (passed !== 13) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
