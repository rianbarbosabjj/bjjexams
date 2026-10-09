"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  MAX_RANKING_ROWS,
  buildSanitizedRanking,
  createStudentRankingFunctions
} = require("../functions/src/students/student-ranking-functions");

const root = path.resolve(__dirname, "..");

function snapshot(id, points, extras = {}) {
  return { id, data: () => ({ pontos_rola: points, ...extras }) };
}

function mockBackend({ exists = true, docs = [] } = {}) {
  const calls = [];
  const query = {
    orderBy(...args) {
      calls.push(["orderBy", ...args]);
      return this;
    },
    limit(value) {
      calls.push(["limit", value]);
      return this;
    },
    select(...args) {
      calls.push(["select", ...args]);
      return this;
    },
    async get() {
      calls.push(["query.get"]);
      return { docs };
    }
  };
  const db = {
    doc(key) {
      calls.push(["doc", key]);
      return { get: async () => ({ exists }) };
    },
    collection(key) {
      calls.push(["collection", key]);
      return query;
    }
  };
  const callable = createStudentRankingFunctions({
    REGION: "southamerica-east1",
    db,
    onCallFactory: (_settings, handler) => handler
  }).listarRankingAlunosV12;
  return { callable, calls };
}

async function run() {
  assert.equal(MAX_RANKING_ROWS, 20);

  const source = [
    snapshot("user-1", 90, { nome: "NOME PRIVADO", cpf: "CPF_PRIVADO", email: "SEGREDO" }),
    snapshot("user-2", 50, { nome: "OUTRO NOME", equipe_origem: "EQUIPE PRIVADA" }),
    snapshot("user-3", -9)
  ];

  const projected = buildSanitizedRanking(source, "user-2");
  assert.deepEqual(projected, [
    { position: 1, points: 90, isSelf: false },
    { position: 2, points: 50, isSelf: true },
    { position: 3, points: 0, isSelf: false }
  ]);
  assert.ok(!JSON.stringify(projected).includes("PRIVAD"));
  assert.ok(!JSON.stringify(projected).includes("user-1"));
  assert.equal(buildSanitizedRanking(Array.from({length:30},(_,i)=>snapshot(String(i),10)), "other").length,20);

  const { callable, calls } = mockBackend({ docs: source });
  const result = await callable({ auth: { uid: "user-2" }, data: {} });
  assert.deepEqual(result, { items: projected });
  assert.deepEqual(calls, [
    ["doc", "alunos/user-2"],
    ["collection", "alunos"],
    ["orderBy", "pontos_rola", "desc"],
    ["limit", 20],
    ["select", "pontos_rola"],
    ["query.get"]
  ]);

  const denied = mockBackend({ exists: false });
  await assert.rejects(
    denied.callable({ auth: { uid: "outsider" }, data: {} }),
    error => error.code === "permission-denied"
  );
  assert.equal(denied.calls.some(call => call[0] === "collection"), false);

  const unauthed = mockBackend({ docs: source });
  await assert.rejects(
    unauthed.callable({ data: {} }),
    error => error.code === "unauthenticated"
  );
  assert.equal(unauthed.calls.length, 0);

  await assert.rejects(
    mockBackend().callable({ auth: { uid: "user-2" }, data: { limit: 1000 } }),
    error => error.code === "invalid-argument"
  );

  const failDb = {
    doc() { return { async get(){ throw new Error("token=PRIVATE"); } }; }
  };
  const failure = createStudentRankingFunctions({
    REGION: "southamerica-east1", db: failDb,
    onCallFactory: (_settings, handler) => handler
  }).listarRankingAlunosV12;
  await assert.rejects(
    failure({ auth: { uid: "user-2" }, data: {} }),
    error => error.code === "unavailable" && !error.message.includes("PRIVATE")
  );

  const panel = fs.readFileSync(path.join(root, "painel_aluno.html"), "utf8");
  const main = fs.readFileSync(path.join(root, "functions/main.js"), "utf8");
  const rankBegin = panel.indexOf("window.carregarRanking = async () => {");
  const rankEnd = panel.indexOf("// ACADEMIA DIGITAL", rankBegin);
  assert.ok(rankBegin > 0 && rankEnd > rankBegin);
  const rankPanel = panel.slice(rankBegin, rankEnd);
  assert.ok(panel.includes('firebase-functions.js'));
  assert.ok(panel.includes('getFunctions(app, "southamerica-east1")'));
  assert.ok(rankPanel.includes("httpsCallable(rankingFunctionsStaging, 'listarRankingAlunosV12')"));
  assert.equal(rankPanel.includes('collection(db, "alunos")'), false);
  assert.equal(rankPanel.includes("a.nome"), false);
  assert.equal(rankPanel.includes("a.equipe_origem"), false);
  assert.ok(rankPanel.includes("textContent"));
  assert.ok(main.includes("const studentRankingFunctions = adminRuntimeAllowed"));
  assert.ok(main.includes("...studentRankingFunctions,"));

  console.log("MARCO9_STAGING_RANKING_PRIVACY=PASS");
  console.log("PRODUCTION_EXPORT=DISABLED_BY_STAGING_GATE");
  console.log("FIRESTORE_RULES=UNMODIFIED");
  console.log("CLOUD_DEPLOY=NOT_RUN");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
