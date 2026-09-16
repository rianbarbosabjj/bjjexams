"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../js/course-admin-api-v1_2.js");

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

function read(relativePath) {
  return fs.readFileSync(
    path.join(__dirname, "..", relativePath),
    "utf8"
  );
}

async function main() {
  await test("localhost administrativo usa staging", () => {
    assert.equal(api.inferEnvironment({ hostname: "localhost" }), "staging");
  });

  await test("host de producao reconhecido usa producao", () => {
    assert.equal(
      api.inferEnvironment({ hostname: "bjj-exams.web.app" }),
      "production"
    );
  });

  await test("host desconhecido falha para staging", () => {
    assert.equal(
      api.inferEnvironment({ hostname: "preview.example.invalid" }),
      "staging"
    );
  });

  await test("endpoint administrativo de staging e resolvido", () => {
    assert.equal(
      api.functionUrl("listarCursosAdministraveisV12", {
        explicitEnvironment: "staging"
      }),
      "https://southamerica-east1-bjj-exams-staging.cloudfunctions.net/listarCursosAdministraveisV12"
    );
  });

  await test("endpoint fora do contrato administrativo e bloqueado", () => {
    assert.throws(
      () => api.functionUrl("listarCatalogoCursosV12", {
        explicitEnvironment: "staging"
      }),
      /fora do contrato/
    );
  });

  await test("callable administrativa exige ID token", async () => {
    await assert.rejects(
      api.callAuthenticated("listarCursosAdministraveisV12", {}, {
        explicitEnvironment: "staging",
        fetchImpl: async () => {
          throw new Error("nao deveria chamar fetch");
        }
      }),
      /Token autenticado obrigatório/
    );
  });

  await test("callable envia Authorization Bearer", async () => {
    let request = null;
    const result = await api.callAuthenticated(
      "listarCursosAdministraveisV12",
      {},
      {
        explicitEnvironment: "staging",
        idToken: "token-teste",
        fetchImpl: async (url, options) => {
          request = { url, options };
          return {
            ok: true,
            status: 200,
            json: async () => ({ result: { courses: [] } })
          };
        }
      }
    );

    assert.deepEqual(result, { courses: [] });
    assert.equal(request.options.headers.Authorization, "Bearer token-teste");
    assert.match(request.url, /bjj-exams-staging/);
  });

  await test("conversao de preco brasileiro preserva centavos", () => {
    assert.equal(api.normalizeMoneyToCents("129,90"), 12990);
    assert.equal(api.normalizeMoneyToCents("1.299,90"), 129990);
  });

  await test("curso gratuito e formatado", () => {
    assert.equal(api.formatPrice({ isPaid: false, priceCents: 0 }), "GRÁTIS");
  });

  await test("acoes do instrutor respeitam workflow", () => {
    assert.deepEqual(
      api.instructorActions({ status: "draft" }),
      ["edit", "review", "archive"]
    );
    assert.deepEqual(
      api.instructorActions({ status: "review" }),
      ["archive"]
    );
    assert.deepEqual(
      api.instructorActions({ status: "published" }),
      ["view-public"]
    );
  });

  const uiSource = read("js/course-instructor-ui-v1_2.js");
  const patchSource = read("scripts/apply-marco4a4b-professor-ui.ps1");
  const professorPanel = read("painel_professor.html");

  await test("UI nova nao acessa Firestore diretamente", () => {
    assert.equal(uiSource.includes("getFirestore"), false);
    assert.equal(uiSource.includes("addDoc("), false);
    assert.equal(uiSource.includes("updateDoc("), false);
    assert.equal(uiSource.includes("cursos_teoricos"), false);
  });

  await test("UI do instrutor envia para review e nao autopublica", () => {
    assert.match(uiSource, /changeStatus\(courseId, "review"/);
    assert.equal(
      uiSource.includes('changeStatus(courseId, "published"'),
      false
    );
  });

  await test("UI possui bloqueio por divergencia de ambiente Auth", () => {
    assert.match(uiSource, /ENVIRONMENT_MISMATCH/);
    assert.match(uiSource, /auth\.app\?\.options\?\.projectId/);
  });

  await test("patch e restrito a branch de trabalho", () => {
    assert.match(
      patchSource,
      /feature\/marco4a4-authenticated-ui/
    );
  });

  await test("painel conecta cliente administrativo v1.2", () => {
    assert.match(professorPanel, /js\/course-admin-api-v1_2\.js/);
    assert.match(professorPanel, /js\/course-instructor-ui-v1_2\.js/);
    assert.match(professorPanel, /window\.__BJJ_EXAMS_AUTH__ = auth/);
  });

  await test("aba Cursos usa handler dinamico v1.2", () => {
    assert.match(
      professorPanel,
      /if\(tabName === 'cursos'\) window\.carregarCursosProf\(\);/
    );
  });

  await test("carregamento inicial legado de cursos foi desativado", () => {
    assert.equal(
      professorPanel.includes(
        "carregarEquipesPerfil(); carregarMinhasQuestoes(); carregarCursosProf();"
      ),
      false
    );
  });

  console.log(`COURSE_ADMIN_UI_V1_2=${passed}/${passed}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
