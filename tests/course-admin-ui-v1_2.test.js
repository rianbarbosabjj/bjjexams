"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const api = require("../js/course-admin-api-v1_2.js");
const runtime = require("../js/firebase-runtime-v1_2.js");

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

  await test("runtime Firebase local resolve para staging", () => {
    assert.equal(runtime.inferEnvironment({ hostname: "127.0.0.1" }), "staging");
    assert.equal(runtime.expectedProjectId({ hostname: "127.0.0.1" }), "bjj-exams-staging");
  });

  await test("runtime aceita config staging injetada somente se projeto confere", async () => {
    const config = await runtime.loadConfig({
      hostname: "localhost",
      injectedConfig: {
        apiKey: "public-web-key",
        authDomain: "bjj-exams-staging.firebaseapp.com",
        projectId: "bjj-exams-staging",
        appId: "1:test:web:test"
      }
    });
    assert.equal(config.projectId, "bjj-exams-staging");
  });

  await test("runtime rejeita config de producao em localhost", async () => {
    await assert.rejects(
      runtime.loadConfig({
        hostname: "localhost",
        injectedConfig: {
          apiKey: "public-web-key",
          authDomain: "bjj-exams.firebaseapp.com",
          projectId: "bjj-exams",
          appId: "1:test:web:test"
        }
      }),
      /esperado bjj-exams-staging/
    );
  });

  await test("runtime local sem config staging falha fechado", async () => {
    await assert.rejects(
      runtime.loadConfig({
        hostname: "localhost",
        fetchImpl: async () => ({ ok: false, status: 404 })
      }),
      /Configuração local de staging ausente/
    );
  });

  const uiSource = read("js/course-instructor-ui-v1_2.js");
  const patchSource = read("scripts/apply-marco4a4b-professor-ui.ps1");
  const professorPanel = read("painel_professor.html");
  const gitignore = read(".gitignore");

  await test("config local de staging nao pode ser versionada", () => {
    assert.match(gitignore, /js\/firebase-config\.local\.json/);
  });

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

  await test("painel usa runtime Firebase fail-safe", () => {
    assert.match(professorPanel, /js\/firebase-runtime-v1_2\.js/);
    assert.match(professorPanel, /await window\.BjjExamsFirebaseRuntime\.loadConfig/);
    assert.equal(professorPanel.includes("const firebaseConfig = {"), false);
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
