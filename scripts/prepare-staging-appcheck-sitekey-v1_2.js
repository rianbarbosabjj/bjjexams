"use strict";

// Gate 9.1C2A: inject an explicitly supplied PUBLIC reCAPTCHA Enterprise
// staging site key into the GENERATED Hosting artifact only. No deploy.
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, OUT_DIR, ALLOWED_FILES } = require("./build-staging-hosting-v1_2");

const PROJECT_ID = "bjj-exams-staging";
const ENV_NAME = "BJJ_EXAMS_STAGING_APPCHECK_SITE_KEY";
const PUBLIC_PAGES = Object.freeze([
  "admin_shell_v1_2.html",
  "catalogo.html",
  "cursos.html",
  "exame.html",
  "login.html",
  "painel_aluno.html",
  "painel_professor.html"
]);
const BOOTSTRAP_TAG = '<script src="js/firebase-runtime-v1_2.js"></script>';

function validatePublicSiteKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{20,160}$/.test(value)) {
    throw new Error("APP_CHECK_SITE_KEY_MISSING_OR_INVALID");
  }
  return value;
}

function assertRegularFile(file) {
  const st = fs.lstatSync(file);
  if (!st.isFile() || st.isSymbolicLink()) {
    throw new Error("APP_CHECK_UNSAFE_ARTIFACT_FILE");
  }
}

function assertStagingArtifact() {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.staging-hosting.json"), "utf8"));
  const primaryConfig = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
  if (config.hosting?.site !== PROJECT_ID ||
      config.hosting?.public !== ".firebase-hosting-staging" ||
      Object.hasOwn(primaryConfig, "hosting")) {
    throw new Error("APP_CHECK_STAGING_ARTIFACT_GUARD_FAILED");
  }
  if (ALLOWED_FILES.length !== 52 || PUBLIC_PAGES.some(p => !ALLOWED_FILES.includes(p))) {
    throw new Error("APP_CHECK_ALLOW_LIST_GUARD_FAILED");
  }
  const out = fs.lstatSync(OUT_DIR);
  if (!out.isDirectory() || out.isSymbolicLink()) {
    throw new Error("APP_CHECK_UNSAFE_ARTIFACT_DIR");
  }
}

function prepareStagingAppCheckArtifact(options = {}) {
  const siteKey = validatePublicSiteKey(options.siteKey);
  assertStagingArtifact();
  const pending = [];
  for (const page of PUBLIC_PAGES) {
    const src = path.join(ROOT, page);
    const dst = path.join(OUT_DIR, page);
    assertRegularFile(src);
    assertRegularFile(dst);
    const source = fs.readFileSync(src, "utf8");
    const artifact = fs.readFileSync(dst, "utf8");
    if (artifact !== source) throw new Error("APP_CHECK_ARTIFACT_NOT_PRISTINE");
    if (source.split(BOOTSTRAP_TAG).length !== 2 ||
        source.includes("__BJJ_EXAMS_APP_CHECK_SITE_KEY__")) {
      throw new Error("APP_CHECK_HTML_BOOTSTRAP_GUARD_FAILED");
    }
    const injected = '<script>window.__BJJ_EXAMS_APP_CHECK_SITE_KEY__ = ' +
      JSON.stringify(siteKey) + ';</script>\n' + BOOTSTRAP_TAG;
    pending.push({ file: dst, html: artifact.replace(BOOTSTRAP_TAG, injected) });
  }
  // Validate every page first. Never overwrite repository source files.
  for (const item of pending) fs.writeFileSync(item.file, item.html, "utf8");
  return Object.freeze({ project: PROJECT_ID, pages: pending.length,
    output: "GENERATED_STAGING_HOSTING_ONLY", deployExecuted: false });
}

if (require.main === module) {
  try {
    const result = prepareStagingAppCheckArtifact({ siteKey: process.env[ENV_NAME] });
    console.log("APP_CHECK_STAGING_KEY_INJECTION=" + result.pages + "/7");
    console.log("APP_CHECK_STAGING_ARTIFACT=PREPARED_NOT_DEPLOYED");
    console.log("APP_CHECK_ENFORCEMENT=NOT_ENABLED");
    console.log("PRODUCTION_ACCESS=NOT_RUN");
  } catch (_) {
    // Do not include a site key, paths, HTML or underlying exception in logs.
    console.error("APP_CHECK_STAGING_ARTIFACT_PREPARATION=BLOCKED");
    process.exitCode = 2;
  }
}

module.exports = Object.freeze({
  PROJECT_ID, ENV_NAME, PUBLIC_PAGES, BOOTSTRAP_TAG,
  validatePublicSiteKey, prepareStagingAppCheckArtifact
});
