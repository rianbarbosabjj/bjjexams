"use strict";

(function initCoursePurchaseApi(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsCoursePurchase = api;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCoursePurchaseApi(root) {
    const REGION = "southamerica-east1";
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

    const ALLOWED_FUNCTIONS = new Set([
      "iniciarCheckoutCursoV12",
      "obterStatusCompraCursoV12",
      "listarOperacoesFinanceirasCursosV12",
      "cancelarCobrancaPendenteV12",
      "solicitarEstornoIntegralV12"
    ]);

    const INTENT_STORAGE_PREFIX = "bjjex:v1.2:purchase-intent";
    const INTENT_VERSION = 1;

    function normalizeEnvironment(value) {
      const env = String(value || "").trim().toLowerCase();
      return Object.prototype.hasOwnProperty.call(PROJECTS, env)
        ? env
        : null;
    }

    function currentHostname(options = {}) {
      return String(
        options.hostname ?? root?.location?.hostname ?? ""
      ).trim().toLowerCase();
    }

    function inferEnvironment(options = {}) {
      const runtime = options.runtime || root?.BjjExamsFirebaseRuntime;
      if (runtime && typeof runtime.inferEnvironment === "function") {
        return runtime.inferEnvironment(options);
      }

      const explicit = normalizeEnvironment(
        options.explicitEnvironment ?? root?.__BJJ_EXAMS_ENV__
      );
      if (explicit) return explicit;

      const hostname = currentHostname(options);
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

    function projectIdForEnvironment(environment, options = {}) {
      const runtime = options.runtime || root?.BjjExamsFirebaseRuntime;
      if (runtime && typeof runtime.projectIdForEnvironment === "function") {
        return runtime.projectIdForEnvironment(environment);
      }

      const env = normalizeEnvironment(environment);
      if (!env) throw new Error("Ambiente BJJ Exams inválido.");
      return PROJECTS[env];
    }

    function assertEnvironmentSafe(environment) {
      const env = normalizeEnvironment(environment);
      if (!env) throw new Error("Ambiente financeiro inválido.");
      if (env === "production") {
        throw new Error(
          "Produção bloqueada: compra financeira do Marco 5.6 está disponível somente em staging."
        );
      }
      return env;
    }

    function functionUrl(functionName, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function financeira fora do contrato: ${functionName}.`);
      }
      const environment = assertEnvironmentSafe(inferEnvironment(options));
      const projectId = projectIdForEnvironment(environment, options);
      return `https://${REGION}-${projectId}.cloudfunctions.net/${functionName}`;
    }

    async function resolveIdToken(options = {}) {
      const direct = String(options.idToken || "").trim();
      if (direct) return direct;

      if (typeof options.getIdToken === "function") {
        const value = String(await options.getIdToken() || "").trim();
        if (value) return value;
      }

      throw new Error("Sessão autenticada obrigatória para operações financeiras.");
    }

    async function callPrivateCallable(functionName, data = {}, options = {}) {
      if (!ALLOWED_FUNCTIONS.has(functionName)) {
        throw new Error(`Function financeira fora do contrato: ${functionName}.`);
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
          try {
            body = JSON.parse(rawBody);
          } catch (_) {
            body = {};
          }
        }

        if (
          response.ok &&
          Object.prototype.hasOwnProperty.call(body, "result")
        ) {
          return body.result;
        }

        const error = new Error(
          body?.error?.message ||
          (response.status === 401 || response.status === 403
            ? "Sua sessão não possui acesso a esta operação financeira."
            : "Não foi possível concluir a operação financeira agora.")
        );
        error.httpStatus = response.status;
        error.callableStatus = body?.error?.status || null;
        error.domainCode = body?.error?.details?.domainCode || null;
        throw error;
      } catch (error) {
        if (error?.name === "AbortError") {
          const timeoutError = new Error(
            "A operação financeira demorou mais do que o esperado."
          );
          timeoutError.code = "COURSE_PURCHASE_TIMEOUT";
          throw timeoutError;
        }
        throw error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }

    function requireId(value, label) {
      const id = String(value || "").trim();
      if (!id || id.length > 200 || id.includes("/")) {
        throw new Error(`${label} inválido.`);
      }
      return id;
    }

    async function resolveUserId(options = {}) {
      const direct = String(options.userId || "").trim();
      if (direct) return requireId(direct, "Usuário");

      if (typeof options.getUserId === "function") {
        const value = String(await options.getUserId() || "").trim();
        if (value) return requireId(value, "Usuário");
      }

      const current = String(options.currentUser?.uid || "").trim();
      if (current) return requireId(current, "Usuário");

      throw new Error(
        "Identidade do usuário obrigatória para controlar a tentativa de compra."
      );
    }

    function requireReason(value) {
      const reason = String(value || "").trim();
      if (reason.length < 5 || reason.length > 300) {
        throw new Error(
          "Justificativa deve possuir entre 5 e 300 caracteres."
        );
      }
      return reason;
    }

    function requireAdminLimit(value) {
      if (value === undefined || value === null || value === "") return 25;
      const limit = Number(value);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
        throw new Error("Limite administrativo deve estar entre 1 e 50.");
      }
      return limit;
    }

    function resolveStorage(options = {}) {
      const storage = options.storage || root?.localStorage;
      if (
        !storage ||
        typeof storage.getItem !== "function" ||
        typeof storage.setItem !== "function" ||
        typeof storage.removeItem !== "function"
      ) {
        throw new Error(
          "Armazenamento persistente indisponível para retomar a compra."
        );
      }
      return storage;
    }

    function intentStorageKey({ environment, userId, courseId } = {}) {
      const env = assertEnvironmentSafe(environment);
      const user = requireId(userId, "Usuário");
      const course = requireId(courseId, "Curso");
      return [
        INTENT_STORAGE_PREFIX,
        env,
        encodeURIComponent(user),
        encodeURIComponent(course)
      ].join(":");
    }

    function generateIntentKey(options = {}) {
      if (typeof options.randomUUID === "function") {
        const injected = String(options.randomUUID() || "").trim();
        if (injected) return `bjjex-v12-${injected}`.slice(0, 200);
      }

      const cryptoApi = options.crypto || root?.crypto;
      if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
        return `bjjex-v12-${cryptoApi.randomUUID()}`;
      }

      if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        const token = Array.from(bytes)
          .map(value => value.toString(16).padStart(2, "0"))
          .join("");
        return `bjjex-v12-${token}`;
      }

      throw new Error(
        "Gerador criptográfico indisponível para criar tentativa de compra."
      );
    }

    function parseStoredIntent(raw, expected = {}) {
      if (!raw) return null;
      try {
        const value = JSON.parse(raw);
        const key = String(value?.idempotencyKey || "").trim();
        if (
          value?.version !== INTENT_VERSION ||
          value?.environment !== expected.environment ||
          value?.userId !== expected.userId ||
          value?.courseId !== expected.courseId ||
          !key ||
          key.length > 200
        ) {
          return null;
        }
        return {
          version: INTENT_VERSION,
          environment: expected.environment,
          userId: expected.userId,
          courseId: expected.courseId,
          idempotencyKey: key,
          createdAt: value.createdAt || null
        };
      } catch (_) {
        return null;
      }
    }

    async function getOrCreateCheckoutIntent(courseId, options = {}) {
      const course = requireId(courseId, "Curso");
      const environment = assertEnvironmentSafe(inferEnvironment(options));
      const userId = await resolveUserId(options);
      const storage = resolveStorage(options);
      const storageKey = intentStorageKey({ environment, userId, courseId: course });
      const expected = { environment, userId, courseId: course };
      const existing = parseStoredIntent(storage.getItem(storageKey), expected);

      if (existing) {
        return Object.freeze({ ...existing, reused: true });
      }

      const now = typeof options.now === "function"
        ? options.now()
        : new Date();
      const createdAt = now instanceof Date
        ? now.toISOString()
        : new Date(now).toISOString();
      const next = {
        version: INTENT_VERSION,
        environment,
        userId,
        courseId: course,
        idempotencyKey: generateIntentKey(options),
        createdAt
      };
      storage.setItem(storageKey, JSON.stringify(next));
      return Object.freeze({ ...next, reused: false });
    }

    async function clearCheckoutIntent(courseId, options = {}) {
      const course = requireId(courseId, "Curso");
      const environment = assertEnvironmentSafe(inferEnvironment(options));
      const userId = await resolveUserId(options);
      const storage = resolveStorage(options);
      storage.removeItem(
        intentStorageKey({ environment, userId, courseId: course })
      );
      return true;
    }

    async function rotateCheckoutIntent(courseId, options = {}) {
      await clearCheckoutIntent(courseId, options);
      return getOrCreateCheckoutIntent(courseId, options);
    }

    async function startCheckout(courseId, options = {}) {
      const course = requireId(courseId, "Curso");
      const intent = options.forceNewIntent === true
        ? await rotateCheckoutIntent(course, options)
        : await getOrCreateCheckoutIntent(course, options);

      const result = await callPrivateCallable(
        "iniciarCheckoutCursoV12",
        {
          courseId: course,
          idempotencyKey: intent.idempotencyKey
        },
        options
      );

      return Object.freeze({
        ...result,
        intentReused: intent.reused
      });
    }

    async function resumeCheckout(courseId, options = {}) {
      return startCheckout(courseId, {
        ...options,
        forceNewIntent: false
      });
    }

    async function getPurchaseStatus(courseId, options = {}) {
      const course = requireId(courseId, "Curso");
      const result = await callPrivateCallable(
        "obterStatusCompraCursoV12",
        { courseId: course },
        options
      );
      return result?.purchase || null;
    }

    async function listAdminOperations(limit = 25, options = {}) {
      const result = await callPrivateCallable(
        "listarOperacoesFinanceirasCursosV12",
        { limit: requireAdminLimit(limit) },
        options
      );
      return Object.freeze({
        role: result?.role || null,
        limit: Number(result?.limit || requireAdminLimit(limit)),
        items: Object.freeze(Array.isArray(result?.items) ? result.items : [])
      });
    }

    async function cancelPending(orderId, reason, options = {}) {
      return callPrivateCallable(
        "cancelarCobrancaPendenteV12",
        {
          orderId: requireId(orderId, "Pedido"),
          reason: requireReason(reason)
        },
        options
      );
    }

    async function requestFullRefund(orderId, reason, options = {}) {
      return callPrivateCallable(
        "solicitarEstornoIntegralV12",
        {
          orderId: requireId(orderId, "Pedido"),
          reason: requireReason(reason)
        },
        options
      );
    }

    return Object.freeze({
      REGION,
      PROJECTS,
      PRODUCTION_HOSTS,
      STAGING_HOSTS,
      ALLOWED_FUNCTIONS,
      INTENT_STORAGE_PREFIX,
      INTENT_VERSION,
      inferEnvironment,
      projectIdForEnvironment,
      assertEnvironmentSafe,
      functionUrl,
      resolveIdToken,
      callPrivateCallable,
      requireId,
      resolveUserId,
      requireReason,
      requireAdminLimit,
      intentStorageKey,
      generateIntentKey,
      parseStoredIntent,
      getOrCreateCheckoutIntent,
      clearCheckoutIntent,
      rotateCheckoutIntent,
      startCheckout,
      resumeCheckout,
      getPurchaseStatus,
      listAdminOperations,
      cancelPending,
      requestFullRefund
    });
  }
);
