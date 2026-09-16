"use strict";

// Composition root da v1.2.
// O index.js permanece como camada de compatibilidade/exports existentes;
// novas superficies modulares podem ser adicionadas aqui sem reabrir o
// monolito legado a cada incremento.
const existingExports = require("./index");
const { getFirestore } = require("firebase-admin/firestore");
const {
  createPublicCourseFunctions
} = require("./src/courses/course-public-functions");

const REGION = "southamerica-east1";

const publicCourseFunctions =
  createPublicCourseFunctions({
    REGION,
    db: getFirestore()
  });

module.exports = {
  ...existingExports,
  ...publicCourseFunctions
};
