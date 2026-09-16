"use strict";

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  toPublicCourseView
} = require("./course-domain");

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 50;

function createPublicCourseFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;

  if (!REGION || !db) {
    throw new Error(
      "Courses v1.2 public catalog: infraestrutura obrigatoria ausente."
    );
  }

  function pageSize(value) {
    if (
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return DEFAULT_PAGE_SIZE;
    }

    const parsed = Number(value);

    if (
      !Number.isInteger(parsed) ||
      parsed < 1 ||
      parsed > MAX_PAGE_SIZE
    ) {
      throw new HttpsError(
        "invalid-argument",
        `limit deve ser um inteiro entre 1 e ${MAX_PAGE_SIZE}.`
      );
    }

    return parsed;
  }

  function courseId(value) {
    const id = String(value || "").trim();

    if (
      !id ||
      id.length > 200 ||
      id.includes("/")
    ) {
      throw new HttpsError(
        "invalid-argument",
        "Curso invalido."
      );
    }

    return id;
  }

  const listarCatalogoCursosV12 = onCall(
    { region: REGION },
    async request => {
      const limit = pageSize(
        request.data?.limit
      );

      const snap = await db
        .collection("courses")
        .where("status", "==", "published")
        .where("visibility", "==", "platform")
        .orderBy("publishedAt", "desc")
        .limit(limit)
        .get();

      const courses = snap.docs
        .map(doc =>
          toPublicCourseView(
            doc.id,
            doc.data()
          )
        )
        .filter(Boolean);

      return {
        courses,
        pageSize: limit
      };
    }
  );

  const obterCursoPublicoV12 = onCall(
    { region: REGION },
    async request => {
      const id = courseId(
        request.data?.courseId
      );

      const snap = await db
        .doc(`courses/${id}`)
        .get();

      const course = snap.exists
        ? toPublicCourseView(
            snap.id,
            snap.data()
          )
        : null;

      if (!course) {
        // Resposta unica evita revelar se existe um curso nao publico
        // com o identificador consultado.
        throw new HttpsError(
          "not-found",
          "Curso publico nao encontrado."
        );
      }

      return { course };
    }
  );

  return {
    listarCatalogoCursosV12,
    obterCursoPublicoV12
  };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  createPublicCourseFunctions
};
