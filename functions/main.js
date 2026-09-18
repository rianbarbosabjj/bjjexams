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

const REGION = "southamerica-east1";
const GEMINI_COURSE_MODERATION_API_KEY = defineSecret(
  "GEMINI_COURSE_MODERATION_API_KEY"
);
const ASAAS_API_KEY = defineSecret("ASAAS_API_KEY");

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

const financialEnvironment =
  resolveFinancialRuntimeEnvironment();

const financialAdminFunctions =
  createFinancialAdminFunctions({
    REGION,
    db,
    environment: financialEnvironment
  });

const checkoutProviderFactory =
  createAsaasCheckoutProviderFactory({
    environment: financialEnvironment,
    projectId: getFirebaseProjectId(),
    env: process.env,
    httpLibrary: axios,
    apiKeyResolver: () => ASAAS_API_KEY.value()
  });

const financialCheckoutFunctions =
  createFinancialCheckoutFunctions({
    REGION,
    db,
    environment: financialEnvironment,
    providerFactory: checkoutProviderFactory,
    secrets: [ASAAS_API_KEY]
  });

module.exports = {
  ...existingExports,
  ...publicCourseFunctions,
  ...courseModerationFunctions,
  ...courseContentFunctions,
  ...courseEnrollmentFunctions,
  ...courseConsumptionFunctions,
  ...courseProgressFunctions,
  ...financialAdminFunctions,
  ...financialCheckoutFunctions
};