"use strict";

(function initBeltExamApi(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsBeltExam = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildBeltExamApi(root) {
    const REGION = "southamerica-east1";
    const PROJECTS = Object.freeze({
      staging: "bjj-exams-staging",
      production: "bjj-exams"
    });

    const ALLOWED_FUNCTIONS = new Set([
      "listarMinhasOrganizacoes",
      "criarSessaoExameFaixaV12",
      "selecionarAlunoExameFaixaV12",
      "listarSessoesExameFaixaV12",
      "obterSessaoExameFaixaV12",
      "listarAlunosElegiveisExameFaixaV12",
      "listarMeusExamesFaixaV12",
      "emitirMeuCertificadoExameV12",
      "iniciarExameOficialV12",
      "obterTentativaExameOficialV12",
      "finalizarExameOficialV12",
      "iniciarCheckoutExameFaixaV12",
      "retomarCheckoutExameFaixaV12"
    ]);

    function runtime(options = {}) {
      return options.runtime || root?.BjjExamsFirebaseRuntime || null;
    }

    function inferEnvironment(options = {}) {
      const resolvedRuntime = runtime(options);
      if (resolvedRuntime && typeof resolvedRuntime.inferEnvironment === "function") {
        return resolvedRuntime.inferEnvironment(options);
      }
      return "staging";
    }

    function projectIdForEnvironment(environment, options = {}) {
      const resolvedRuntime = runtime(options);
      if (resolvedRuntime && typeof resolvedRuntime.expectedProjectId === "function") {
        return resolvedRuntime.expectedProjectId({
          ...options,
          explicitEnvironment: environment
        });
      }
      const projectId = PROJECTS[environment];
      if (!projectId) throw new Error("Ambiente BJJ Exams inválido.");
      return projectId;
    }

    function assertStagingOnly(options = {}) {
      const environment = inferEnvironment(options);
      if (environment !== "staging") {
        const error = new Error(
          "Exames de faixa v1.2 estão disponíveis somente em staging neste marco."
        );
        error.code = "BELT_EXAM_STAGING_ONLY";
        throw error;
      }
      return environment;
    }

    function functionUrl(functionName, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function de exame fora do contrato: ${functionName}.`);
      }
      const environment = assertStagingOnly(options);
      const projectId = projectIdForEnvironment(environment, options);
      return `https://${REGION}-${projectId}.cloudfunctions.net/${functionName}`;
    }

    async function resolveIdToken(options = {}) {
      const direct = String(options.idToken || "").trim();
      if (direct) return direct;
      if (typeof options.getIdToken === "function") {
        const token = String(await options.getIdToken() || "").trim();
        if (token) return token;
      }
      throw new Error("Sessão autenticada obrigatória para acessar exames de faixa.");
    }

    async function callPrivateCallable(functionName, data = {}, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function de exame fora do contrato: ${functionName}.`);
      }
      const fetchImpl = options.fetchImpl || root?.fetch;
      if (typeof fetchImpl !== "function") {
        throw new Error("Fetch indisponível neste ambiente.");
      }

      const idToken = await resolveIdToken(options);
      const timeoutMs = Number(options.timeoutMs || 20000);
      const controller = typeof AbortController === "function"
        ? new AbortController()
        : null;
      const timeout = controller
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

      try {
        const response = await fetchImpl(
          functionUrl(functionName, options),
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({ data }),
            signal: controller?.signal
          }
        );

        const rawBody = await response.text();
        let body = {};
        if (rawBody) {
          try { body = JSON.parse(rawBody); } catch (_) { body = {}; }
        }

        if (response.ok && Object.prototype.hasOwnProperty.call(body, "result")) {
          return body.result;
        }

        const error = new Error(
          body?.error?.message ||
          (response.status === 401 || response.status === 403
            ? "Sua sessão não possui acesso a este recurso."
            : "Não foi possível concluir a operação de exame.")
        );
        error.httpStatus = response.status;
        error.callableStatus = body?.error?.status || null;
        error.domainCode = body?.error?.details?.domainCode || null;
        throw error;
      } catch (error) {
        if (error?.name === "AbortError") {
          const timeoutError = new Error("A operação de exame demorou mais do que o esperado.");
          timeoutError.code = "BELT_EXAM_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    function requireId(value, label) {
      const id = String(value || "").trim();
      if (!id || id.includes("/") || id.length > 200) {
        throw new Error(`${label} inválido.`);
      }
      return id;
    }

    function requireLimit(value, fallback = 50) {
      if (value === undefined || value === null || value === "") return fallback;
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
        throw new Error("Limite inválido para consulta de exames.");
      }
      return parsed;
    }

    function requirePriceCents(value) {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        throw new Error("Preço do exame deve ser um inteiro positivo em centavos.");
      }
      return parsed;
    }

    function requireIdempotencyKey(value) {
      const key = String(value || "").trim();
      if (!key || key.length > 200) {
        throw new Error("Identidade da tentativa de pagamento inválida.");
      }
      return key;
    }

    async function listOrganizations(options = {}) {
      const result = await callPrivateCallable(
        "listarMinhasOrganizacoes",
        {},
        options
      );
      return Array.isArray(result?.organizacoes) ? result.organizacoes : [];
    }

    async function createSession(input = {}, options = {}) {
      const organizationId = requireId(input.organizationId, "Organização");
      const targetBelt = String(input.targetBelt || "").trim();
      if (!targetBelt) throw new Error("Faixa alvo obrigatória.");
      const priceCents = requirePriceCents(input.priceCents);
      const scheduledAt = input.scheduledAt == null || input.scheduledAt === ""
        ? null
        : String(input.scheduledAt);
      return callPrivateCallable(
        "criarSessaoExameFaixaV12",
        { organizationId, targetBelt, priceCents, scheduledAt },
        options
      );
    }

    async function selectStudent(sessionId, studentId, options = {}) {
      return callPrivateCallable(
        "selecionarAlunoExameFaixaV12",
        {
          sessionId: requireId(sessionId, "Sessão"),
          studentId: requireId(studentId, "Aluno")
        },
        options
      );
    }

    async function listInstructorSessions(organizationId, limit = 50, options = {}) {
      const result = await callPrivateCallable(
        "listarSessoesExameFaixaV12",
        {
          organizationId: requireId(organizationId, "Organização"),
          limit: requireLimit(limit, 50)
        },
        options
      );
      return Array.isArray(result?.items) ? result.items : [];
    }

    async function getInstructorSession(sessionId, options = {}) {
      return callPrivateCallable(
        "obterSessaoExameFaixaV12",
        { sessionId: requireId(sessionId, "Sessão") },
        options
      );
    }

    async function listEligibleStudents(organizationId, limit = 100, options = {}) {
      const result = await callPrivateCallable(
        "listarAlunosElegiveisExameFaixaV12",
        {
          organizationId: requireId(organizationId, "Organização"),
          limit: requireLimit(limit, 100)
        },
        options
      );
      return Array.isArray(result?.items) ? result.items : [];
    }

    async function listMyExams(limit = 50, options = {}) {
      const result = await callPrivateCallable(
        "listarMeusExamesFaixaV12",
        { limit: requireLimit(limit, 50) },
        options
      );
      return Array.isArray(result?.items) ? result.items : [];
    }

    async function issueCertificate(
      registrationId,
      options = {}
    ) {
      return callPrivateCallable(
        "emitirMeuCertificadoExameV12",
        {
          registrationId:
            requireId(
              registrationId,
              "Registration"
            )
        },
        options
      );
    }
    function normalizeAnswers(input = {}) {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
      ) {
        throw new Error("Respostas precisam ser um objeto.");
      }

      const entries =
        Object.entries(input);

      if (entries.length > 500) {
        throw new Error("Quantidade de respostas excede o limite permitido.");
      }

      const normalized = {};

      for (
        const [
          questionIdInput,
          answerInput
        ] of entries
      ) {
        const questionId =
          requireId(
            questionIdInput,
            "Questão"
          );

        if (
          answerInput === null ||
          answerInput === undefined ||
          String(answerInput).trim() === ""
        ) {
          continue;
        }

        const answer =
          String(answerInput)
            .trim()
            .toUpperCase();

        if (!/^[A-D]$/.test(answer)) {
          throw new Error(
            `Resposta inválida para ${questionId}.`
          );
        }

        normalized[questionId] =
          answer;
      }

      return normalized;
    }

    async function startOfficialExam(
      registrationId,
      options = {}
    ) {
      return callPrivateCallable(
        "iniciarExameOficialV12",
        {
          registrationId:
            requireId(
              registrationId,
              "Registration"
            )
        },
        options
      );
    }

    async function resumeOfficialExam(
      registrationId,
      options = {}
    ) {
      return callPrivateCallable(
        "obterTentativaExameOficialV12",
        {
          registrationId:
            requireId(
              registrationId,
              "Registration"
            )
        },
        options
      );
    }

    async function finalizeOfficialExam(
      attemptId,
      answers,
      options = {}
    ) {
      return callPrivateCallable(
        "finalizarExameOficialV12",
        {
          attemptId:
            requireId(
              attemptId,
              "Tentativa"
            ),
          answers:
            normalizeAnswers(
              answers
            )
        },
        options
      );
    }

    async function startCheckout(sessionId, idempotencyKey, options = {}) {
      return callPrivateCallable(
        "iniciarCheckoutExameFaixaV12",
        {
          sessionId: requireId(sessionId, "Sessão"),
          idempotencyKey: requireIdempotencyKey(idempotencyKey)
        },
        options
      );
    }

    async function resumeCheckout(sessionId, options = {}) {
      return callPrivateCallable(
        "retomarCheckoutExameFaixaV12",
        { sessionId: requireId(sessionId, "Sessão") },
        options
      );
    }

    return Object.freeze({
      REGION,
      PROJECTS,
      ALLOWED_FUNCTIONS,
      inferEnvironment,
      projectIdForEnvironment,
      assertStagingOnly,
      functionUrl,
      resolveIdToken,
      callPrivateCallable,
      requireId,
      requireLimit,
      requirePriceCents,
      requireIdempotencyKey,
      listOrganizations,
      createSession,
      selectStudent,
      listInstructorSessions,
      getInstructorSession,
      listEligibleStudents,
      listMyExams,
      issueCertificate,
      normalizeAnswers,
      startOfficialExam,
      resumeOfficialExam,
      finalizeOfficialExam,
      startCheckout,
      resumeCheckout
    });
  }
);
