"use strict";

(function initExamCertificatePublicApi(
  root,
  factory
) {
  const api =
    factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports =
      api;
  }

  if (root) {
    root.BjjExamsCertificatePublicApi =
      api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,
  function buildExamCertificatePublicApi(
    root
  ) {
    const REGION =
      "southamerica-east1";

    const PROJECTS =
      Object.freeze({
        staging:
          "bjj-exams-staging",
        production:
          "bjj-exams"
      });

    const PRODUCTION_HOSTS =
      new Set([
        "bjj-exams.web.app",
        "bjj-exams.firebaseapp.com"
      ]);

    const STAGING_HOSTS =
      new Set([
        "bjj-exams-staging.web.app",
        "bjj-exams-staging.firebaseapp.com"
      ]);

    const FUNCTION_NAME =
      "validarCertificadoExamePublicoV12";

    function hostname(
      options = {}
    ) {
      return String(
        options.hostname ??
        root?.location?.hostname ??
        ""
      )
        .trim()
        .toLowerCase();
    }

    function inferEnvironment(
      options = {}
    ) {
      const host =
        hostname(
          options
        );

      if (
        PRODUCTION_HOSTS.has(
          host
        )
      ) {
        return "production";
      }

      if (
        STAGING_HOSTS.has(host) ||
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "::1" ||
        host.endsWith(
          ".localhost"
        )
      ) {
        return "staging";
      }

      return "staging";
    }

    function canonicalVerificationEnabled(
      options = {}
    ) {
      return (
        inferEnvironment(
          options
        ) === "staging"
      );
    }

    function legacyExamFirestoreAllowed(
      options = {}
    ) {
      return PRODUCTION_HOSTS.has(
        hostname(
          options
        )
      );
    }

    function normalizeCertificateId(
      value
    ) {
      const id =
        String(
          value ||
          ""
        )
          .trim()
          .toLowerCase();

      return /^[a-f0-9]{64}$/.test(
        id
      )
        ? id
        : null;
    }

    function functionUrl(
      options = {}
    ) {
      if (
        !canonicalVerificationEnabled(
          options
        )
      ) {
        const error =
          new Error(
            "Validação canônica v1.2 permanece bloqueada em produção neste marco."
          );

        error.code =
          "CERTIFICATE_CANONICAL_PRODUCTION_BLOCKED";

        throw error;
      }

      const projectId =
        PROJECTS.staging;

      return (
        `https://${REGION}-${projectId}.cloudfunctions.net/${FUNCTION_NAME}`
      );
    }

    function normalizeInteger(
      value,
      min,
      max,
      label
    ) {
      const number =
        Number(value);

      if (
        !Number.isSafeInteger(
          number
        ) ||
        number < min ||
        number > max
      ) {
        throw new Error(
          `${label} inválido na resposta pública.`
        );
      }

      return number;
    }

    function requiredText(
      value,
      label
    ) {
      const text =
        String(
          value ||
          ""
        ).trim();

      if (!text) {
        throw new Error(
          `${label} ausente na resposta pública.`
        );
      }

      return text;
    }

    function normalizePublicCertificate(
      input,
      expectedCertificateId
    ) {
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input)
      ) {
        throw new Error(
          "Resposta pública de certificado inválida."
        );
      }

      const expected =
        normalizeCertificateId(
          expectedCertificateId
        );

      const certificateId =
        normalizeCertificateId(
          input.certificateId
        );

      if (
        !expected ||
        !certificateId ||
        certificateId !==
          expected
      ) {
        const error =
          new Error(
            "Identidade do certificado público divergente."
          );

        error.code =
          "CERTIFICATE_PUBLIC_ID_MISMATCH";

        throw error;
      }

      const status =
        String(
          input.status ||
          ""
        )
          .trim()
          .toLowerCase();

      if (
        ![
          "valid",
          "revoked"
        ].includes(
          status
        )
      ) {
        throw new Error(
          "Status público do certificado inválido."
        );
      }

      const totalQuestions =
        normalizeInteger(
          input.totalQuestions,
          1,
          500,
          "totalQuestions"
        );

      const correctCount =
        normalizeInteger(
          input.correctCount,
          0,
          totalQuestions,
          "correctCount"
        );

      const scoreBps =
        normalizeInteger(
          input.scoreBps,
          0,
          10000,
          "scoreBps"
        );

      return Object.freeze({
        certificateId,
        status,
        studentName:
          requiredText(
            input.studentName,
            "studentName"
          ),
        targetBelt:
          requiredText(
            input.targetBelt,
            "targetBelt"
          ),
        organizationName:
          requiredText(
            input.organizationName,
            "organizationName"
          ),
        instructorName:
          requiredText(
            input.instructorName,
            "instructorName"
          ),
        scoreBps,
        correctCount,
        totalQuestions,
        issuedAt:
          input.issuedAt ??
          null,
        revokedAt:
          status === "revoked"
            ? (
                input.revokedAt ??
                null
              )
            : null
      });
    }

    async function verifyCertificate(
      certificateIdInput,
      options = {}
    ) {
      const certificateId =
        normalizeCertificateId(
          certificateIdInput
        );

      if (!certificateId) {
        const error =
          new Error(
            "Código canônico de certificado inválido."
          );

        error.code =
          "INVALID_CANONICAL_CERTIFICATE_ID";

        throw error;
      }

      const fetchImpl =
        options.fetchImpl ||
        root?.fetch;

      if (
        typeof fetchImpl !==
          "function"
      ) {
        throw new Error(
          "Fetch indisponível para validação pública."
        );
      }

      const timeoutMs =
        Number(
          options.timeoutMs ||
          15000
        );

      const controller =
        typeof AbortController ===
          "function"
          ? new AbortController()
          : null;

      const timeout =
        controller
          ? setTimeout(
              () =>
                controller.abort(),
              timeoutMs
            )
          : null;

      try {
        const response =
          await fetchImpl(
            functionUrl(
              options
            ),
            {
              method:
                "POST",
              headers: {
                "Content-Type":
                  "application/json"
              },
              body:
                JSON.stringify({
                  data: {
                    certificateId
                  }
                }),
              signal:
                controller?.signal
            }
          );

        const rawBody =
          await response.text();

        let body =
          {};

        if (rawBody) {
          try {
            body =
              JSON.parse(
                rawBody
              );
          } catch (_) {
            body =
              {};
          }
        }

        if (
          response.ok &&
          body?.result?.ok ===
            true &&
          body?.result?.certificate
        ) {
          return normalizePublicCertificate(
            body.result.certificate,
            certificateId
          );
        }

        const error =
          new Error(
            body?.error?.message ||
            "Não foi possível validar o certificado oficial."
          );

        error.httpStatus =
          response.status;

        error.callableStatus =
          body?.error?.status ||
          null;

        error.domainCode =
          body?.error?.details
            ?.domainCode ||
          null;

        throw error;
      } catch (error) {
        if (
          error?.name ===
            "AbortError"
        ) {
          const timeoutError =
            new Error(
              "A validação do certificado demorou mais do que o esperado."
            );

          timeoutError.code =
            "CERTIFICATE_PUBLIC_TIMEOUT";

          throw timeoutError;
        }

        throw error;
      } finally {
        if (timeout) {
          clearTimeout(
            timeout
          );
        }
      }
    }

    function isNotFoundError(
      error
    ) {
      const status =
        String(
          error?.callableStatus ||
          ""
        )
          .trim()
          .toUpperCase()
          .replace(
            /-/g,
            "_"
          );

      const domainCode =
        String(
          error?.domainCode ||
          ""
        )
          .trim()
          .toUpperCase();

      return (
        status ===
          "NOT_FOUND" ||
        Number(
          error?.httpStatus
        ) === 404 ||
        domainCode ===
          "EXAM_CERTIFICATE_NOT_FOUND"
      );
    }

    return Object.freeze({
      REGION,
      PROJECTS,
      PRODUCTION_HOSTS,
      STAGING_HOSTS,
      FUNCTION_NAME,
      inferEnvironment,
      canonicalVerificationEnabled,
      legacyExamFirestoreAllowed,
      normalizeCertificateId,
      functionUrl,
      normalizePublicCertificate,
      verifyCertificate,
      isNotFoundError
    });
  }
);