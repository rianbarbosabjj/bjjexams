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
  createFinancialWebhookFunctions
} = require("./src/finance/financial-webhook-functions");

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
  ...financialAdminFunctions,
  ...financialCheckoutFunctions,
  ...financialWebhookFunctions
};