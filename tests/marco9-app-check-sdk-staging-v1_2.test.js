"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runtime = require("../js/firebase-runtime-v1_2");
const read = p => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

async function main() {
  const staging = { options: { projectId: "bjj-exams-staging", appId: "1:stage:web:valid" } };
  const production = { options: { projectId: "bjj-exams", appId: "1:prod:web:valid" } };
  assert.deepEqual(await runtime.initializeStagingAppCheck(staging, { hostname: "localhost" }),
    { status: "not_configured" });
  assert.deepEqual(await runtime.initializeStagingAppCheck(staging, { hostname: "bjj-exams.web.app", siteKey: "key" }),
    { status: "production_blocked" });
  assert.deepEqual(await runtime.initializeStagingAppCheck(production, { hostname: "localhost", siteKey: "key" }),
    { status: "wrong_firebase_app" });
  let initializeCalls = 0;
  let receivedApp = null;
  let receivedProviderKey = null;
  let refresh = null;
  class ReCaptchaEnterpriseProvider { constructor(key) { receivedProviderKey = key; } }
  const sdk = {
    ReCaptchaEnterpriseProvider,
    initializeAppCheck(app, settings) {
      initializeCalls += 1;
      receivedApp = app;
      refresh = settings.isTokenAutoRefreshEnabled;
      assert.ok(settings.provider instanceof ReCaptchaEnterpriseProvider);
      return { app };
    },
    async getToken(instance) {
      assert.equal(instance.app, staging);
      return { token: "valid-staging-appcheck-token" };
    }
  };
  const options = { hostname: "localhost", siteKey: "public-site-key", sdk };
  assert.deepEqual(await runtime.initializeStagingAppCheck(staging, options),
    { status: "sdk_initialized" });
  assert.equal(initializeCalls, 1);
  assert.equal(receivedApp, staging);
  assert.equal(receivedProviderKey, "public-site-key");
  assert.equal(refresh, true);
  assert.deepEqual(await runtime.getAppCheckHeaders({ hostname: "localhost" }),
    { "X-Firebase-AppCheck": "valid-staging-appcheck-token" });
  assert.deepEqual(await runtime.getAppCheckHeaders({ hostname: "bjj-exams.web.app" }), {});
  assert.deepEqual(await runtime.initializeStagingAppCheck(staging, options),
    { status: "sdk_initialized" });
  assert.equal(initializeCalls, 1, "SDK cannot be initialized twice for one app");

  const config = { projectId: "bjj-exams-staging", appId: "1:stage:web:valid",
    apiKey: "test-only-config", authDomain: "bjj-exams-staging.firebaseapp.com" };
  let unexpectedImports = 0;
  assert.deepEqual(await runtime.initializeStagingAppCheckFromConfig({ hostname: "localhost",
    firebaseSdk: { getApps() { unexpectedImports++; return []; }, initializeApp() {} } }),
    { status: "not_configured" });
  assert.equal(unexpectedImports, 0, "disabled bootstrap must not import or initialize Firebase");
  assert.deepEqual(await runtime.initializeStagingAppCheckFromConfig({
    hostname: "bjj-exams.web.app", siteKey: "key" }), { status: "production_blocked" });
  const configured = await runtime.initializeStagingAppCheckFromConfig({ hostname: "localhost",
    siteKey: "public-site-key", injectedConfig: config, sdk,
    firebaseSdk: { getApps() { return [staging]; }, initializeApp() {
      throw new Error("should reuse matching Firebase app"); } } });
  assert.deepEqual(configured, { status: "sdk_initialized" });
  assert.equal(initializeCalls, 1);

  for (const [file, required] of [
    ["login.html", "initializeStagingAppCheck(app)"],
    ["painel_aluno.html", "initializeStagingAppCheck(app)"],
    ["painel_professor.html", "initializeStagingAppCheck(app)"],
    ["cursos.html", "initializeStagingAppCheck(app)"],
    ["exame.html", "initializeStagingAppCheck(app)"],
    ["admin_shell_v1_2.html", "initializeStagingAppCheckFromConfig()"],
    ["catalogo.html", "initializeStagingAppCheckFromConfig()"]
  ]) { assert.ok(read(file).includes(required), `Missing App Check staging bootstrap in ${file}`); }
  assert.ok(read("catalogo.html").includes("js/firebase-runtime-v1_2.js"));
  // A course detail must not make its first callable before obtaining App Check.
  const detailSource = read("cursos.html");
  const detailBootstrap = detailSource.indexOf(
    "await window.BjjExamsFirebaseRuntime.initializeStagingAppCheckFromConfig();"
  );
  const detailRead = detailSource.indexOf("await publicApi.getCourse(courseId)");
  assert.ok(detailBootstrap >= 0 && detailRead > detailBootstrap,
    "Course details must initialize staging App Check before their first callable");
  assert.ok(!read("functions/main.js").includes("enforceAppCheck: true"));
  assert.ok(read("functions/src/finance/financial-webhook-functions.js").includes("webhookTokenResolver"));
  assert.ok(!read("js/firebase-runtime-v1_2.js").includes("RECAPTCHA_SECRET_KEY"));
  assert.ok(!Object.hasOwn(JSON.parse(read("firebase.json")), "hosting"));
  assert.equal(JSON.parse(read("firebase.staging-hosting.json")).hosting.site, "bjj-exams-staging");
  runtime.registerStagingAppCheckTokenProvider(null, { hostname: "localhost" });
  console.log("MARCO9_1B2_STAGING_SDK_BOOTSTRAP=PASSED");
  console.log("MARCO9_1B2_SDK_AUTO_REFRESH=TRUE");
  console.log("MARCO9_1B2_PAGES=7/7");
  console.log("MARCO9_1B2_SITE_KEY=NOT_CONFIGURED");
  console.log("MARCO9_1B2_ENFORCEMENT=NOT_ENABLED");
  console.log("MARCO9_1B2_PRODUCTION_ACCESS=NOT_RUN");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
