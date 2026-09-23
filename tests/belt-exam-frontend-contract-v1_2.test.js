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
    assert.equal(api.ALLOWED_FUNCTIONS.has("emitirMeuCertificadoExameV12"), true);
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

  await test("authorized sem gate academico permanece bloqueado", () => {
    const view = studentUi.examCardView({
      registrationId: "registration-1",
      sessionId: "session-1",
      state: "authorized",
      examState: "not_started",
      canStartCheckout: false,
      canResumePayment: false,
      canStartExam: false,
      canResumeExam: false,
      organization: { name: "Academia" },
      currentBelt: "Branca",
      targetBelt: "Azul",
      price: { amountCents: 15000, currency: "BRL" }
    });
    assert.equal(view.action, "authorized_wait");
    assert.equal(view.canStartExam, false);
    assert.equal(view.canResumeExam, false);
    assert.match(view.description, /ainda não está liberada/i);
  });

  await test("authorized com canStartExam abre somente pagina canonica", () => {
    const view = studentUi.examCardView({
      registrationId: "registration-start",
      sessionId: "session-start",
      state: "authorized",
      examState: "not_started",
      canStartCheckout: false,
      canResumePayment: false,
      canStartExam: true,
      canResumeExam: false,
      result: null,
      organization: { name: "Academia" },
      currentBelt: "Branca",
      targetBelt: "Azul",
      price: { amountCents: 15000, currency: "BRL" }
    });

    assert.equal(view.action, "start_exam");
    assert.equal(view.canStartExam, true);
    assert.equal(view.canResumeExam, false);
    assert.equal(
      view.examUrl,
      "exame.html?registrationId=registration-start"
    );
  });

  await test("started in progress abre retomada canonica", () => {
    const view = studentUi.examCardView({
      registrationId: "registration-resume",
      sessionId: "session-resume",
      state: "started_or_later",
      examState: "in_progress",
      canStartCheckout: false,
      canResumePayment: false,
      canStartExam: false,
      canResumeExam: true,
      result: null,
      organization: { name: "Academia" },
      currentBelt: "Branca",
      targetBelt: "Azul",
      price: { amountCents: 15000, currency: "BRL" }
    });

    assert.equal(view.action, "resume_exam");
    assert.equal(view.canStartExam, false);
    assert.equal(view.canResumeExam, true);
    assert.equal(
      view.examUrl,
      "exame.html?registrationId=registration-resume"
    );
  });

  await test("resultado passed elegivel prioriza emissao do certificado", () => {
    const view = studentUi.examCardView({
      registrationId: "registration-result",
      sessionId: "session-result",
      state: "started_or_later",
      examState: "passed",
      canStartCheckout: false,
      canResumePayment: false,
      canStartExam: false,
      canResumeExam: false,
      result: {
        status: "passed",
        scoreBps: 10000,
        correctCount: 2,
        totalQuestions: 2,
        certificateEligible: true
      },
      certificate: null,
      organization: { name: "Academia" },
      currentBelt: "Branca",
      targetBelt: "Azul",
      price: { amountCents: 15000, currency: "BRL" }
    });

    assert.equal(
      view.action,
      "issue_certificate"
    );
    assert.equal(
      view.canIssueCertificate,
      true
    );
    assert.equal(
      view.hasResult,
      true
    );
    assert.equal(
      view.resultStatus,
      "passed"
    );
    assert.equal(
      view.certificateId,
      null
    );
    assert.equal(
      view.examUrl,
      "exame.html?registrationId=registration-result"
    );
  });

  await test("resultado failed continua disponivel para consulta", () => {
    const view = studentUi.examCardView({
      registrationId: "registration-failed",
      sessionId: "session-failed",
      state: "started_or_later",
      examState: "failed",
      canStartCheckout: false,
      canResumePayment: false,
      canStartExam: false,
      canResumeExam: false,
      result: {
        status: "failed",
        scoreBps: 5000,
        correctCount: 1,
        totalQuestions: 2,
        certificateEligible: false
      },
      certificate: null,
      organization: { name: "Academia" },
      currentBelt: "Branca",
      targetBelt: "Azul",
      price: { amountCents: 15000, currency: "BRL" }
    });

    assert.equal(
      view.action,
      "view_result"
    );
    assert.equal(
      view.canIssueCertificate,
      false
    );
    assert.equal(
      view.hasResult,
      true
    );
    assert.equal(
      view.resultStatus,
      "failed"
    );
  });

  await test("certified abre validacao pelo certificateId canonico", () => {
    const certificateId =
      "a".repeat(64);

    const view =
      studentUi.examCardView({
        registrationId:
          "registration-certified",
        sessionId:
          "session-certified",
        state:
          "started_or_later",
        examState:
          "certified",
        canStartCheckout:
          false,
        canResumePayment:
          false,
        canStartExam:
          false,
        canResumeExam:
          false,
        result: {
          status:
            "passed",
          scoreBps:
            10000,
          correctCount:
            2,
          totalQuestions:
            2,
          certificateEligible:
            true
        },
        certificate: {
          certificateId,
          status:
            "valid",
          studentName:
            "Aluno",
          targetBelt:
            "Azul"
        },
        organization: {
          name:
            "Academia"
        },
        currentBelt:
          "Branca",
        targetBelt:
          "Azul",
        price: {
          amountCents:
            15000,
          currency:
            "BRL"
        }
      });

    assert.equal(
      view.action,
      "view_certificate"
    );

    assert.equal(
      view.certificateId,
      certificateId
    );

    assert.equal(
      view.certificateStatus,
      "valid"
    );

    assert.equal(
      view.certificateUrl,
      `validar.html?cert=${certificateId}`
    );

    assert.equal(
      view.hasResult,
      true
    );
  });

  await test("registrationId invalido falha fechado no portal", () => {
    const view = studentUi.examCardView({
      registrationId: "registration/invalida",
      sessionId: "session-invalid",
      state: "authorized",
      examState: "not_started",
      canStartCheckout: false,
      canResumePayment: false,
      canStartExam: true,
      canResumeExam: false,
      result: null,
      organization: { name: "Academia" },
      currentBelt: "Branca",
      targetBelt: "Azul",
      price: { amountCents: 15000, currency: "BRL" }
    });

    assert.equal(view.action, "academic_unavailable");
    assert.equal(view.examUrl, null);
    assert.equal(view.canStartExam, false);
    assert.equal(view.canResumeExam, false);
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

  await test("frontend emite certificado somente por registrationId", async () => {
    let captured =
      null;

    const result =
      await api.issueCertificate(
        "registration-certificate",
        {
          explicitEnvironment:
            "staging",
          idToken:
            "student-token",
          fetchImpl:
            async (
              url,
              fetchOptions
            ) => {
              captured = {
                url,
                body:
                  JSON.parse(
                    fetchOptions.body
                  ),
                authorization:
                  fetchOptions
                    .headers
                    .Authorization
              };

              return {
                ok:
                  true,
                status:
                  200,
                headers: {
                  get:
                    () =>
                      "application/json"
                },
                text:
                  async () =>
                    JSON.stringify({
                      result: {
                        ok:
                          true,
                        created:
                          true,
                        certificate: {
                          certificateId:
                            "a".repeat(64),
                          status:
                            "valid"
                        }
                      }
                    })
              };
            }
        }
      );

    assert.equal(
      result.created,
      true
    );

    assert.deepEqual(
      captured.body,
      {
        data: {
          registrationId:
            "registration-certificate"
        }
      }
    );

    assert.equal(
      captured.authorization,
      "Bearer student-token"
    );

    assert.match(
      captured.url,
      /emitirMeuCertificadoExameV12$/
    );
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
      "exam_certificates/",
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
    assert.match(studentSource, /exame\.html\?registrationId=/);
    assert.equal(studentSource.includes("startOfficialExam("), false);
    assert.equal(studentSource.includes("resumeOfficialExam("), false);
    assert.equal(studentSource.includes("finalizeOfficialExam("), false);
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

  console.log(`BELT_EXAM_FRONTEND_CONTRACT_V1_2=${passed}/20`);
  if (passed !== 20) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
