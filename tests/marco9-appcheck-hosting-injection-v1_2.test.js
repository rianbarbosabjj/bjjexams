"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, OUT_DIR, ALLOWED_FILES, build } =
  require("../scripts/build-staging-hosting-v1_2");
const { PUBLIC_PAGES, PROJECT_ID, validatePublicSiteKey,
  prepareStagingAppCheckArtifact } = require("../scripts/prepare-staging-appcheck-sitekey-v1_2");

const fakePublicKey = "6Le_STAGING_FAKE_PUBLIC_KEY_ONLY_2026";
const read = file => fs.readFileSync(file, "utf8");

function main() {
  assert.equal(PROJECT_ID, "bjj-exams-staging");
  assert.equal(PUBLIC_PAGES.length, 7);
  assert.equal(ALLOWED_FILES.length, 52);
  assert.equal(validatePublicSiteKey(fakePublicKey), fakePublicKey);
  for (const value of ["", undefined, 3, "x".repeat(200),
    "malformed<script>alert(1)</script>", "fake\nINJECTION", "bad key"]) {
    assert.throws(() => validatePublicSiteKey(value), /APP_CHECK_SITE_KEY_MISSING_OR_INVALID/);
  }

  // Test uses synthetic credentials only, and only local generated files.
  build();
  const original = new Map(PUBLIC_PAGES.map(page => [page, read(path.join(ROOT, page))]));
  try {
    assert.throws(() => prepareStagingAppCheckArtifact({ siteKey: "" }),
      /APP_CHECK_SITE_KEY_MISSING_OR_INVALID/);
    for (const page of PUBLIC_PAGES) {
      assert.equal(read(path.join(OUT_DIR, page)), original.get(page));
      assert.equal(original.get(page).split('<script src="js/firebase-runtime-v1_2.js"></script>').length, 2,
        "one runtime entry required: " + page);
    }

    const result = prepareStagingAppCheckArtifact({ siteKey: fakePublicKey });
    assert.deepEqual(result, {
      project: "bjj-exams-staging", pages: 7,
      output: "GENERATED_STAGING_HOSTING_ONLY", deployExecuted: false
    });
    for (const page of PUBLIC_PAGES) {
      const source = original.get(page);
      const artifact = read(path.join(OUT_DIR, page));
      assert.equal(read(path.join(ROOT, page)), source, "repository source untouched: " + page);
      assert.equal(artifact.split(fakePublicKey).length - 1, 1, "site key once: " + page);
      assert.ok(artifact.includes('<script>window.__BJJ_EXAMS_APP_CHECK_SITE_KEY__ = "' +
        fakePublicKey + '";</script>\n<script src="js/firebase-runtime-v1_2.js"></script>'));
      assert.ok(artifact.length > source.length);
      assert.equal(artifact.includes("enforceAppCheck: true"), false);
      assert.equal(artifact.includes("BJJ_EXAMS_STAGING_APPCHECK_SITE_KEY"), false,
        "runtime must not read operator environment variable");
    }
    assert.throws(() => prepareStagingAppCheckArtifact({ siteKey: fakePublicKey }),
      /APP_CHECK_ARTIFACT_NOT_PRISTINE/, "must rebuild before re-injecting");
    for (const page of ALLOWED_FILES.filter(name => name.endsWith(".html") &&
      !PUBLIC_PAGES.includes(name))) {
      assert.equal(read(path.join(OUT_DIR, page)), read(path.join(ROOT, page)),
        "unrelated page untouched: " + page);
    }
  } finally {
    // Restore the normal 52/52 byte-identical staging artifact for CI.
    build();
  }

  for (const page of PUBLIC_PAGES) {
    assert.equal(read(path.join(OUT_DIR, page)), read(path.join(ROOT, page)));
    assert.equal(read(path.join(OUT_DIR, page)).includes(fakePublicKey), false);
  }
  const firebase = JSON.parse(read(path.join(ROOT, "firebase.json")));
  const hosting = JSON.parse(read(path.join(ROOT, "firebase.staging-hosting.json")));
  assert.equal(Object.hasOwn(firebase, "hosting"), false);
  assert.equal(hosting.hosting.site, "bjj-exams-staging");
  assert.equal(hosting.hosting.public, ".firebase-hosting-staging");
  const ci = read(path.join(ROOT, ".github/workflows/marco8-rc-regression.yml"));
  assert.ok(ci.includes("node tests/marco9-appcheck-hosting-injection-v1_2.test.js"));
  assert.ok(!ci.includes("firebase deploy"));
  assert.ok(!ci.includes("pull_request_target"));
  assert.ok(!ci.includes("secrets."));

  console.log("MARCO9_1C2A_STAGING_INJECTION=7/7");
  console.log("MARCO9_1C2A_ARTIFACT_RESTORED=52/52");
  console.log("MARCO9_1C2A_REAL_SITE_KEY=NOT_REGISTERED");
  console.log("MARCO9_1C2A_FIREBASE_DEPLOY=NOT_RUN");
  console.log("MARCO9_1C2A_PRODUCTION_ACCESS=NOT_RUN");
  console.log("MARCO9_GATE_9_1C2A_PREFLIGHT=PASSED");
}

try { main(); } catch (error) {
  // Tests use synthetic values, never operator keys.
  console.error(error); process.exitCode = 1;
}
