"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const api = require(path.resolve(__dirname, "..", "js", "course-content-api-v1_2.js"));

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test("localhost resolve para staging", () => {
  assert.equal(api.inferEnvironment({ hostname: "localhost" }), "staging");
});

test("host oficial de producao resolve para producao", () => {
  assert.equal(api.inferEnvironment({ hostname: "bjj-exams.web.app" }), "production");
});

test("host desconhecido falha seguro para staging", () => {
  assert.equal(api.inferEnvironment({ hostname: "preview.example.invalid" }), "staging");
});

test("contrato expoe exatamente sete callables de conteudo", () => {
  assert.equal(api.ALLOWED_FUNCTIONS.size, 7);
  for (const name of [
    "listarConteudoCursoV12",
    "criarModuloCursoV12",
    "atualizarModuloCursoV12",
    "excluirModuloCursoV12",
    "criarAulaCursoV12",
    "atualizarAulaCursoV12",
    "excluirAulaCursoV12"
  ]) {
    assert.equal(api.ALLOWED_FUNCTIONS.has(name), true);
  }
});

test("endpoint staging usa regiao e projeto canonicos", () => {
  assert.equal(
    api.functionUrl("listarConteudoCursoV12", { hostname: "localhost" }),
    "https://southamerica-east1-bjj-exams-staging.cloudfunctions.net/listarConteudoCursoV12"
  );
});

test("endpoint fora do contrato e bloqueado", () => {
  assert.throws(
    () => api.functionUrl("qualquerFuncao", { hostname: "localhost" }),
    /fora do contrato/
  );
});

test("callable exige token autenticado", async () => {
  await assert.rejects(
    api.callAuthenticated("listarConteudoCursoV12", {}, { hostname: "localhost" }),
    /Token autenticado obrigat/
  );
});

test("callable envia Authorization Bearer", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      json: async () => ({ result: { ok: true } })
    };
  };

  const result = await api.callAuthenticated(
    "listarConteudoCursoV12",
    { courseId: "course-1" },
    { hostname: "localhost", idToken: "token-123", fetchImpl }
  );

  assert.equal(result.ok, true);
  assert.equal(request.options.headers.Authorization, "Bearer token-123");
  assert.deepEqual(JSON.parse(request.options.body), { data: { courseId: "course-1" } });
});

test("listContent envia somente courseId", async () => {
  let payload = null;
  const fetchImpl = async (_url, options) => {
    payload = JSON.parse(options.body).data;
    return { ok: true, status: 200, json: async () => ({ result: { modules: [], lessons: [] } }) };
  };
  await api.listContent("course-1", { hostname: "localhost", idToken: "t", fetchImpl });
  assert.deepEqual(payload, { courseId: "course-1" });
});

test("createModule usa callable canonica", async () => {
  let url = "";
  const fetchImpl = async (value) => {
    url = value;
    return { ok: true, status: 200, json: async () => ({ result: { ok: true } }) };
  };
  await api.createModule("course-1", { title: "Modulo", position: 10 }, { hostname: "localhost", idToken: "t", fetchImpl });
  assert.match(url, /criarModuloCursoV12$/);
});

test("updateModule exige modulo valido", async () => {
  await assert.rejects(
    api.updateModule("course-1", "", {}, { hostname: "localhost", idToken: "t", fetchImpl: async () => null }),
    /Módulo obrigatório/
  );
});

test("createLesson preserva contrato de tipos canonicos", async () => {
  let payload = null;
  const fetchImpl = async (_url, options) => {
    payload = JSON.parse(options.body).data;
    return { ok: true, status: 200, json: async () => ({ result: { ok: true } }) };
  };
  await api.createLesson("course-1", {
    moduleId: "module-1",
    title: "Aula",
    contentType: "video",
    durationMinutes: 12,
    videoUrl: "https://example.com/video"
  }, { hostname: "localhost", idToken: "t", fetchImpl });
  assert.equal(payload.courseId, "course-1");
  assert.equal(payload.moduleId, "module-1");
  assert.equal(payload.contentType, "video");
  assert.equal(payload.durationMinutes, 12);
});

test("deleteLesson usa callable canonica", async () => {
  let url = "";
  const fetchImpl = async (value) => {
    url = value;
    return { ok: true, status: 200, json: async () => ({ result: { ok: true } }) };
  };
  await api.deleteLesson("course-1", "lesson-1", { hostname: "localhost", idToken: "t", fetchImpl });
  assert.match(url, /excluirAulaCursoV12$/);
});

let passed = 0;
(async () => {
  for (const item of cases) {
    try {
      await item.fn();
      passed += 1;
      console.log(`PASS | ${item.name}`);
    } catch (error) {
      console.error(`FAIL | ${item.name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
  console.log(`COURSE_CONTENT_API_V1_2=${passed}/${cases.length}`);
})();
