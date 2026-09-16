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
  createOpenAICourseModerationProvider
} = require("./src/courses/course-moderation-provider-openai");

const REGION = "southamerica-east1";
const OPENAI_COURSE_MODERATION_API_KEY = defineSecret(
  "OPENAI_COURSE_MODERATION_API_KEY"
);

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
    secrets: [OPENAI_COURSE_MODERATION_API_KEY],
    moderationProviderFactory: () =>
      createOpenAICourseModerationProvider({
        httpClient: axios,
        apiKey: OPENAI_COURSE_MODERATION_API_KEY.value()
      })
  });

module.exports = {
  ...existingExports,
  ...publicCourseFunctions,
  ...courseModerationFunctions
};
