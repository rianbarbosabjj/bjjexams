"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ALLOWED_FILES, ROOT } = require("../scripts/build-staging-hosting-v1_2");
const {
  analyzeAsset, remoteOriginCandidates, hostingHeadersState, inventory
} = require("../scripts/inventory-csp-staging-v1_2");

const report = inventory();
assert.equal(ALLOWED_FILES.length, 52);
assert.equal(report.allowedFiles, 52);
assert.equal(report.htmlFiles, 16);
assert.equal(report.jsFiles, 35);
assert.equal(report.project, "bjj-exams-staging");
assert.equal(report.hostingSite, "bjj-exams-staging");
assert.equal(report.cspHeader, "NOT_CONFIGURED");
assert.equal(report.cspEnforcement, "NOT_ENABLED");
assert.equal(report.deployExecuted, false);
assert.equal(report.runtimeRequestsVerified, false);
assert.equal(report.realBrowserSmoke, "NOT_RUN");
assert.equal(report.originListIsStaticCandidatesOnly, true);
assert.equal(report.nextGate, "9.3B_REPORT_ONLY_STAGING");

for (const domain of [
  "https://cdn.tailwindcss.com",
  "https://unpkg.com",
  "https://www.gstatic.com",
  "https://fonts.googleapis.com"
]) {
  assert.ok(report.candidateOrigins.includes(domain),
    "missing observed static CDN/library origin " + domain);
}
assert.ok(report.inlineScripts > 0, "legacy pages have inline script tags");
assert.ok(report.externalScripts > 0, "pages load local/remote script tags");
assert.ok(report.inlineStyles > 0, "legacy HTML includes inline style blocks");
assert.ok(report.styleAttributes > 0, "legacy HTML includes inline style attributes");
assert.ok(report.pagesWithInlineScripts.includes("painel_aluno.html"));
assert.ok(report.pagesWithInlineScripts.includes("catalogo.html"));
assert.ok(report.pagesWithInlineStyles.includes("painel_aluno.html"));
assert.ok(report.candidateOrigins.every(origin => {
  const parsed = new URL(origin);
  return parsed.origin === origin && !origin.includes("?") && !origin.includes("#");
}), "never expose URL paths, query tokens or fragments");

const unsafeFixture = [
  "<script src=\"https://cdn.example.invalid/app.js?token=PRIVATE_TOKEN_123\"></script>",
  "<script>var item = 'PRIVATE_EMAIL_ABC@example.invalid';</script>",
  "<style>h1{background:red}</style>",
  "<a style=\"color: red\" onclick=\"test()\">X</a>",
  "fetch('https://api.example.invalid/user/PRIVATE_CUSTOMER_ID?cpf=PRIVATE_CPF')"
].join("\n");
const fixture = analyzeAsset("fake.html", unsafeFixture);
assert.equal(fixture.externalScripts, 1);
assert.equal(fixture.inlineScripts, 1);
assert.equal(fixture.inlineStyles, 1);
assert.equal(fixture.styleAttributes, 1);
assert.equal(fixture.inlineHandlers, 1);
assert.deepEqual(fixture.candidateOrigins, [
  "https://api.example.invalid", "https://cdn.example.invalid"
]);
const serialized = JSON.stringify(fixture);
for (const privateValue of [
  "PRIVATE_TOKEN_123", "PRIVATE_EMAIL_ABC", "PRIVATE_CUSTOMER_ID", "PRIVATE_CPF"
]) assert.equal(serialized.includes(privateValue), false);
assert.deepEqual(remoteOriginCandidates("https://cdn.example.invalid/a?token=private"), [
  "https://cdn.example.invalid"
]);
assert.throws(() => analyzeAsset("../secrets.json", "abc"), /CSP_INVENTORY_INVALID_ASSET/);
assert.throws(() => hostingHeadersState({
  hosting: { site: "bjj-exams", public: ".firebase-hosting-staging", headers: [] }
}), /CSP_STAGING_BOUNDARY_INVALID/);
assert.throws(() => hostingHeadersState({
  hosting: { site: "bjj-exams-staging", public: ".firebase-hosting-staging",
    headers: [{ source: "**/*.html", headers: [
      { key: "Content-Security-Policy", value: "default-src 'none'" }
    ] }] }
}), /CSP_ENFORCEMENT_FORBIDDEN_GATE_9_3A/);
assert.equal(hostingHeadersState({
  hosting: { site: "bjj-exams-staging", public: ".firebase-hosting-staging",
    headers: [{ source: "**/*.html", headers: [
      { key: "Content-Security-Policy-Report-Only", value: "default-src 'self'" }
    ] }] }
}), "REPORT_ONLY_CONFIGURED_NOT_BROWSER_VERIFIED");

const stagingHosting = JSON.parse(fs.readFileSync(path.join(ROOT,
  "firebase.staging-hosting.json"), "utf8"));
const primary = JSON.parse(fs.readFileSync(path.join(ROOT,
  "firebase.json"), "utf8"));
assert.equal(stagingHosting.hosting.site, "bjj-exams-staging");
assert.equal(Object.hasOwn(primary, "hosting"), false);
assert.ok(stagingHosting.hosting.headers.every(rule =>
  rule.headers.every(h => !/^content-security-policy/i.test(h.key))
), "no CSP header may be accidentally enforced by this PR");

const documentation = fs.readFileSync(path.join(ROOT,
  "docs/architecture/MARCO_9_3_CSP_INVENTORY.md"), "utf8");
for (const word of [
  "9.3A", "9.3B", "52", "bjj-exams-staging",
  "Content-Security-Policy-Report-Only", "unsafe-inline",
  "reCAPTCHA", "NO_ENFORCEMENT", "NO_DEPLOY"
]) assert.ok(documentation.includes(word), "missing CSP planning contract: " + word);
const workflow = fs.readFileSync(path.join(ROOT,
  ".github/workflows/marco8-rc-regression.yml"), "utf8");
assert.ok(workflow.includes("node tests/marco9-csp-inventory-v1_2.test.js"));
assert.ok(workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(workflow.includes("  contents: read"));
assert.ok(!workflow.includes("firebase deploy"));
assert.ok(!workflow.includes("secrets."));

console.log("MARCO9_3A_CSP_ASSETS=52/52");
console.log("MARCO9_3A_CSP_REMOTE_ORIGIN_CANDIDATES=SANITIZED");
console.log("MARCO9_3A_INLINE_SCRIPT_AND_STYLE_RISKS=INVENTORIED");
console.log("MARCO9_3A_REAL_BROWSER_OBSERVABILITY=NOT_RUN");
console.log("MARCO9_3A_CSP_ENFORCEMENT=NOT_ENABLED");
console.log("MARCO9_GATE_9_3A_CSP_INVENTORY=PASSED");
console.log("PRODUCTION_ACCESS=NOT_RUN");
console.log("DEPLOY_EXECUTED=False");
