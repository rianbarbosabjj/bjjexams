"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");

const MAX_RANKING_ROWS = 20;

function buildSanitizedRanking(docs, actorUid) {
  if (!Array.isArray(docs)) {
    return [];
  }

  return docs.slice(0, MAX_RANKING_ROWS).map((snapshot, index) => {
    const rawPoints = snapshot.data()?.pontos_rola;
    const numeric = Number(rawPoints);
    const points = Number.isFinite(numeric) && numeric > 0
      ? Math.min(1000000000, Math.floor(numeric))
      : 0;

    // Nunca retornar nome, e-mail, CPF, equipe, UID ou identificador do documento.
    return {
      position: index + 1,
      points,
      isSelf: snapshot.id === actorUid
    };
  });
}

function createStudentRankingFunctions(dependencies = {}) {
  const { REGION, db } = dependencies;
  if (!REGION || !db) {
    throw new Error("Ranking do aluno: infraestrutura obrigatoria ausente.");
  }

  const callFactory = dependencies.onCallFactory || onCall;

  const listarRankingAlunosV12 = callFactory(
    { region: REGION },
    async request => {
      const uid = request?.auth?.uid;
      if (typeof uid !== "string" || !uid.trim()) {
        throw new HttpsError("unauthenticated", "Faca login para consultar o ranking.");
      }

      const data = request.data;
      if (
        data !== undefined &&
        data !== null &&
        (typeof data !== "object" ||
          Array.isArray(data) ||
          Object.keys(data).length > 0)
      ) {
        throw new HttpsError("invalid-argument", "Consulta nao aceita filtros.");
      }

      try {
        const student = await db.doc(`alunos/${uid}`).get();
        if (!student.exists) {
          throw new HttpsError("permission-denied", "Perfil de aluno necessario.");
        }

        const ranking = await db.collection("alunos")
          .orderBy("pontos_rola", "desc")
          .limit(MAX_RANKING_ROWS)
          .select("pontos_rola")
          .get();

        return { items: buildSanitizedRanking(ranking.docs, uid) };
      } catch (error) {
        if (error instanceof HttpsError) throw error;
        throw new HttpsError("unavailable", "Ranking temporariamente indisponivel.");
      }
    }
  );

  return Object.freeze({ listarRankingAlunosV12 });
}

module.exports = {
  MAX_RANKING_ROWS,
  buildSanitizedRanking,
  createStudentRankingFunctions
};
