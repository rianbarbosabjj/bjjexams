"use strict";

// Composition root da v1.2.
// O index.js permanece como camada de compatibilidade/exports existentes;
// novas superficies modulares podem ser adicionadas aqui sem reabrir o
// monolito legado a cada incremento.
const existingExports = require("./index");
const axios = require("axios");
const { getFirestore } = require("firebase-admin/firestore");
const { defineSecret } = require("firebase-functions/params");
const {
  createPublicCourseFunctions
} = require("./src/courses/course-public-functions");
const {
  createCourseModerationSubmissionFunctions
} = require("./src/courses/course-moderation-submission-functions");
const {
  createGeminiCourseModerationProvider
} = require("./src/courses/course-moderation-provider-gemini");
const {
  createCourseContentFunctions
} = require("./src/courses/course-content-functions");
const {
  createCourseEnrollmentFunctions
} = require("./src/courses/course-enrollment-functions");
const {
  createCourseConsumptionFunctions
} = require("./src/courses/course-consumption-functions");
const {
  createCourseProgressFunctions
} = require("./src/courses/course-progress-functions");
const {
  createExamSelectionFunctions
} = require("./src/exams/exam-selection-functions");
const {
  createExamReadFunctions
} = require("./src/exams/exam-read-functions");
const {
  createExamUiSupportFunctions
} = require("./src/exams/exam-ui-support-functions");
const {
  createExamAttemptFunctions
} = require("./src/exams/exam-attempt-functions");
const {
  createExamCertificateFunctions
} = require("./src/exams/exam-certificate-functions");
const {
  createAdminContextFunctions
} = require("./src/admin/admin-context-functions");
const {
  createAdminPeopleReadFunctions
} = require("./src/admin/admin-people-read-functions");
const {
  createAdminOrganizationsReadFunctions
} = require("./src/admin/admin-organizations-read-functions");
const {
  getFirebaseProjectId,
  isLocalEmulatorHost,
  resolveFinancialRuntimeEnvironment
} = require("./src/config/environment");
const {
  createFinancialAdminFunctions
} = require("./src/finance/financial-admin-functions");
const {
  createAsaasCheckoutProviderFactory
} = require("./src/finance/asaas-checkout-provider-factory");
const {
  createFinancialCheckoutFunctions
} = require("./src/finance/financial-checkout-functions");
const {
  createFinancialBeltExamCheckoutFunctions
} = require("./src/finance/financial-belt-exam-checkout-functions");
const {
  createFinancialBeltExamCheckoutResumeFunctions
} = require("./src/finance/financial-belt-exam-checkout-resume-functions");
const {
  createFinancialPurchaseReadFunctions
} = require("./src/finance/financial-purchase-read-functions");
const {
  createFinancialWebhookFunctions
} = require("./src/finance/financial-webhook-functions");
const {
  createFinancialReversalAdminFunctions
} = require("./src/finance/financial-reversal-admin-functions");

const REGION = "southamerica-east1";
const STAGING_PROJECT_ID = "bjj-exams-staging";

const firebaseProjectId = getFirebaseProjectId();
const financialEnvironment =
  resolveFinancialRuntimeEnvironment({
    projectId: firebaseProjectId
  });

const functionsEmulator =
  String(process.env.FUNCTIONS_EMULATOR || "")
    .trim()
    .toLowerCase() === "true";
const webhookDemoEmulatorAllowed = Boolean(
  firebaseProjectId &&
  firebaseProjectId.startsWith("demo-") &&
  functionsEmulator &&
  isLocalEmulatorHost(process.env.FIRESTORE_EMULATOR_HOST)
);
const webhookRuntimeAllowed =
  firebaseProjectId === STAGING_PROJECT_ID ||
  webhookDemoEmulatorAllowed;

// Marco 8 administrative surfaces remain staging/demo-emulator only.
// Production receives no administrative-context export until a later
// explicit production gate.
const adminRuntimeAllowed =
  firebaseProjectId === STAGING_PROJECT_ID ||
  webhookDemoEmulatorAllowed;

const adminRuntimeEnvironment =
  firebaseProjectId === STAGING_PROJECT_ID
    ? "staging"
    : webhookDemoEmulatorAllowed
      ? "demo-emulator"
      : null;

const GEMINI_COURSE_MODERATION_API_KEY = defineSecret(
  "GEMINI_COURSE_MODERATION_API_KEY"
);

// O secret do checkout 5.3 só é materializado no projeto exato de staging.
// Em demo/emulator ele não existe, evitando qualquer consulta ao Secret Manager.
// Em produção ele também não é vinculado: o checkout 5.3 é sandbox-only.
const ASAAS_API_KEY =
  firebaseProjectId === STAGING_PROJECT_ID &&
  financialEnvironment === "sandbox"
    ? defineSecret("ASAAS_API_KEY")
    : null;

// Token dedicado do webhook 5.4. Não reutiliza a API Key do Asaas e só é
// materializado no projeto exato de staging. Em demo/emulator o token vem de
// variável local explicitamente fornecida ao processo do Emulator Suite.
const ASAAS_WEBHOOK_TOKEN =
  firebaseProjectId === STAGING_PROJECT_ID &&
  financialEnvironment === "sandbox"
    ? defineSecret("ASAAS_WEBHOOK_TOKEN")
    : null;

const db = getFirestore();

const publicCourseFunctions =
  createPublicCourseFunctions({
    REGION,
    db
  });

const courseModerationFunctions =
  createCourseModerationSubmissionFunctions({
    REGION,
    db,
    secrets: [GEMINI_COURSE_MODERATION_API_KEY],
    moderationProviderFactory: () =>
      createGeminiCourseModerationProvider({
        httpClient: axios,
        apiKey: GEMINI_COURSE_MODERATION_API_KEY.value()
      })
  });

const courseContentFunctions =
  createCourseContentFunctions({
    REGION,
    db
  });

const courseEnrollmentFunctions =
  createCourseEnrollmentFunctions({
    REGION,
    db
  });

const courseConsumptionFunctions =
  createCourseConsumptionFunctions({
    REGION,
    db
  });

const courseProgressFunctions =
  createCourseProgressFunctions({
    REGION,
    db
  });

// O Marco 5.7 permanece staging/demo-emulator only até o gate explícito de
// produção. Sessão e seleção não vinculam secrets do provedor financeiro.
const examSelectionFunctions = webhookRuntimeAllowed
  ? createExamSelectionFunctions({
      REGION,
      db
    })
  : {};

// Read models de exames do Marco 5.7 seguem a mesma barreira staging/demo.
// São Firestore-only e não vinculam secrets do provedor financeiro.
const examReadFunctions = webhookRuntimeAllowed
  ? createExamReadFunctions({
      REGION,
      db
    })
  : {};

// Suporte de UI do Gate 6B: descoberta sanitizada de candidatos elegíveis.
// Permanece sob a mesma barreira staging/demo e não lê dados financeiros.
const examUiSupportFunctions = webhookRuntimeAllowed
  ? createExamUiSupportFunctions({
      REGION,
      db
    })
  : {};

// Execução acadêmica oficial do Marco 6 permanece staging/demo-emulator only.
// Start/resume são Firestore-only e não vinculam secrets financeiros.
const examAttemptFunctions = webhookRuntimeAllowed
  ? createExamAttemptFunctions({
      REGION,
      db
    })
  : {};

// Certificação oficial do Marco 7 permanece sob a mesma barreira
// staging/demo-emulator. Não vincula secrets financeiros.
const examCertificateFunctions = webhookRuntimeAllowed
  ? createExamCertificateFunctions({
      REGION,
      db
    })
  : {};

// Administrative bootstrap for Marco 8.
// It is intentionally unavailable in production at this stage.
const adminContextFunctions =
  adminRuntimeAllowed
    ? createAdminContextFunctions({
        REGION,
        environment: adminRuntimeEnvironment
      })
    : {};

// Operational People read surface for Marco 8.
// Reuses the same staging/demo-emulator boundary as the administrative
// bootstrap and remains entirely unavailable in production.
const adminPeopleReadFunctions =
  adminRuntimeAllowed
    ? createAdminPeopleReadFunctions({
        REGION,
        db
      })
    : {};

// Operational Organizations read surface for Marco 8.
// Reuses the same staging/demo-emulator administrative boundary.
// Production receives no organization administrative exports.
const adminOrganizationsReadFunctions =
  adminRuntimeAllowed
    ? createAdminOrganizationsReadFunctions({
        REGION,
        db
      })
    : {};

const financialAdminFunctions =
  createFinancialAdminFunctions({
    REGION,
    db,
    environment: financialEnvironment
  });

const checkoutProviderFactory =
  createAsaasCheckoutProviderFactory({
    environment: financialEnvironment,
    projectId: firebaseProjectId,
    env: process.env,
    db,
    httpLibrary: axios,
    apiKeyResolver: () => {
      if (!ASAAS_API_KEY) {
        throw new Error(
          "ASAAS_API_KEY não está vinculada ao checkout neste projeto."
        );
      }
      return ASAAS_API_KEY.value();
    }
  });

const checkoutSecrets = ASAAS_API_KEY
  ? [ASAAS_API_KEY]
  : [];

const financialCheckoutFunctions =
  createFinancialCheckoutFunctions({
    REGION,
    db,
    environment: financialEnvironment,
    providerFactory: checkoutProviderFactory,
    secrets: checkoutSecrets
  });

// O checkout individual de exame do Marco 5.7 permanece staging/demo-emulator
// only. Em staging usa o mesmo secret Asaas Sandbox já homologado; em demo usa
// somente o fake provider quando explicitamente habilitado pelo teste local.
const financialBeltExamCheckoutFunctions = webhookRuntimeAllowed
  ? createFinancialBeltExamCheckoutFunctions({
      REGION,
      db,
      environment: financialEnvironment,
      providerFactory: checkoutProviderFactory,
      secrets: checkoutSecrets
    })
  : {};

// Retomada de PIX pendente resolve a idempotencyKey canônica exclusivamente no
// backend, evitando persistência desse detalhe operacional no navegador.
const financialBeltExamCheckoutResumeFunctions = webhookRuntimeAllowed
  ? createFinancialBeltExamCheckoutResumeFunctions({
      REGION,
      db,
      environment: financialEnvironment,
      providerFactory: checkoutProviderFactory,
      secrets: checkoutSecrets
    })
  : {};

// As views financeiras do Marco 5.6 permanecem staging/demo-emulator only
// até o gate explícito de produção. Elas são Firestore-only e não vinculam
// nenhum secret do Asaas.
const financialPurchaseReadFunctions = webhookRuntimeAllowed
  ? createFinancialPurchaseReadFunctions({
      REGION,
      db
    })
  : {};

const financialReversalAdminFunctions = webhookRuntimeAllowed
  ? createFinancialReversalAdminFunctions({
      REGION,
      db,
      environment: financialEnvironment,
      providerFactory: checkoutProviderFactory,
      secrets: checkoutSecrets
    })
  : {};

function resolveWebhookToken() {
  if (ASAAS_WEBHOOK_TOKEN) {
    return ASAAS_WEBHOOK_TOKEN.value();
  }

  if (webhookDemoEmulatorAllowed) {
    const localToken = String(
      process.env.BJJ_EXAMS_WEBHOOK_TOKEN || ""
    ).trim();
    if (!localToken) {
      throw new Error(
        "BJJ_EXAMS_WEBHOOK_TOKEN ausente no Functions Emulator."
      );
    }
    return localToken;
  }

  throw new Error(
    "Webhook financeiro 5.4 indisponível neste projeto."
  );
}

const financialWebhookFunctions = webhookRuntimeAllowed
  ? createFinancialWebhookFunctions({
      REGION,
      db,
      providerFactory: checkoutProviderFactory,
      webhookTokenResolver: resolveWebhookToken,
      ingressSecrets: ASAAS_WEBHOOK_TOKEN
        ? [ASAAS_WEBHOOK_TOKEN]
        : [],
      workerSecrets: ASAAS_API_KEY
        ? [ASAAS_API_KEY]
        : []
    })
  : {};

module.exports = {
  ...existingExports,
  ...publicCourseFunctions,
  ...courseModerationFunctions,
  ...courseContentFunctions,
  ...courseEnrollmentFunctions,
  ...courseConsumptionFunctions,
  ...courseProgressFunctions,
  ...examSelectionFunctions,
  ...examReadFunctions,
  ...examUiSupportFunctions,
  ...examAttemptFunctions,
  ...examCertificateFunctions,
  ...adminContextFunctions,
  ...adminPeopleReadFunctions,
  ...adminOrganizationsReadFunctions,
  ...financialAdminFunctions,
  ...financialCheckoutFunctions,
  ...financialBeltExamCheckoutFunctions,
  ...financialBeltExamCheckoutResumeFunctions,
  ...financialPurchaseReadFunctions,
  ...financialReversalAdminFunctions,
  ...financialWebhookFunctions
};
