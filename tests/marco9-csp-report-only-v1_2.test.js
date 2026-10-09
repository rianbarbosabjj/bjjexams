"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, ALLOWED_FILES } = require("../scripts/build-staging-hosting-v1_2");
const { inventory, hostingHeadersState } = require("../scripts/inventory-csp-staging-v1_2");

const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const hosting = JSON.parse(read("firebase.staging-hosting.json"));
const primary = JSON.parse(read("firebase.json"));
const rules = hosting.hosting.headers;
const reportKey = "Content-Security-Policy-Report-Only";

assert.equal(hosting.hosting.site, "bjj-exams-staging");
assert.equal(hosting.hosting.public, ".firebase-hosting-staging");
assert.equal(Object.hasOwn(primary, "hosting"), false);
assert.equal(ALLOWED_FILES.length, 52);
assert.equal(rules.length, 3, "only original Cache-Control rules plus index root");
assert.deepEqual(rules.map(x => x.source), ["**/*.html", "**/*.js", "/"]);
assert.deepEqual(rules[0].headers[0], {
  key: "Cache-Control", value: "no-store, max-age=0"
});
assert.deepEqual(rules[1].headers, [{
  key: "Cache-Control", value: "no-cache, max-age=0"
}]);
assert.equal(rules[0].headers[1].key, reportKey);
assert.equal(rules[2].headers.length, 1);
assert.equal(rules[2].headers[0].key, reportKey);
const header = rules[0].headers[1].value;
assert.equal(rules[2].headers[0].value, header, "root / and HTML must get same report-only policy");
assert.ok(header.length < 4096, "policy remains reasonably small");
assert.equal(header.includes("\r"), false);
assert.equal(header.includes("\n"), false);
assert.ok(!rules.some(rule => rule.headers.some(entry =>
  /^content-security-policy$/i.test(entry.key)
)), "NEVER enable CSP enforcement in Gate 9.3B");
assert.ok(!rules[1].headers.some(entry => /content-security-policy/i.test(entry.key)),
  "JS responses should retain original cache headers only");

const policy = Object.fromEntries(header.split(";").map(part => {
  const trimmed = part.trim();
  const i = trimmed.indexOf(" ");
  assert.ok(i > 0, "every CSP directive needs an explicit source value");
  return [trimmed.slice(0, i), trimmed.slice(i + 1)];
}));
const expected = [
  "default-src", "script-src", "style-src", "connect-src",
  "img-src", "font-src", "frame-src", "worker-src",
  "object-src", "base-uri", "form-action"
];
assert.deepEqual(Object.keys(policy), expected, "no accidental relaxation or missing directive");
assert.equal(header.split(";").length, expected.length);
assert.equal(policy["default-src"], "'self'");
assert.equal(policy["object-src"], "'none'");
assert.equal(policy["base-uri"], "'self'");
assert.equal(policy["form-action"], "'self'");
for (const name of expected) {
  assert.ok(!/\*(?:\s|$)/.test(policy[name]), "never use wildcard source: " + name);
}
for (const forbidden of [
  "'unsafe-inline'", "'unsafe-eval'", "report-uri", "report-to",
  "upgrade-insecure-requests", "block-all-mixed-content",
  "https://bjj-exams.web.app", "https://southamerica-east1-bjj-exams.cloudfunctions.net"
]) {
  assert.equal(header.includes(forbidden), false, "unsafe or unexpected policy value: " + forbidden);
}
for (const source of [
  "https://www.gstatic.com",
  "https://cdn.tailwindcss.com",
  "https://unpkg.com",
  "https://cdn.jsdelivr.net",
  "https://cdnjs.cloudflare.com"
]) assert.ok(policy["script-src"].split(" ").includes(source), "script source: " + source);
for (const source of [
  "https://identitytoolkit.googleapis.com",
  "https://securetoken.googleapis.com",
  "https://firestore.googleapis.com",
  "https://firebaseappcheck.googleapis.com",
  "https://southamerica-east1-bjj-exams-staging.cloudfunctions.net"
]) assert.ok(policy["connect-src"].split(" ").includes(source), "connect source: " + source);
assert.ok(policy["style-src"].includes("https://fonts.googleapis.com"));
assert.ok(policy["font-src"].includes("https://fonts.gstatic.com"));
assert.ok(policy["img-src"].includes("data: blob:"));
assert.ok(policy["frame-src"].includes("https://recaptcha.google.com"));

assert.equal(hostingHeadersState(hosting), "REPORT_ONLY_CONFIGURED_NOT_BROWSER_VERIFIED");
const scan = inventory();
assert.equal(scan.cspHeader, "REPORT_ONLY_CONFIGURED_NOT_BROWSER_VERIFIED");
assert.equal(scan.cspEnforcement, "NOT_ENABLED");
assert.equal(scan.nextGate, "9.3C_BROWSER_VALIDATION_PENDING");
assert.equal(scan.deployExecuted, false);
assert.equal(scan.realBrowserSmoke, "NOT_RUN");
assert.ok(scan.inlineScripts > 0 && scan.inlineStyles > 0,
  "expected diagnostic report-only warnings about legacy inline code");

const documentation = read("docs/architecture/MARCO_9_3B_CSP_REPORT_ONLY.md");
for (const key of [
  "Gate 9.3B", "bjj-exams-staging", "NO_DEPLOY", "NO_ENFORCEMENT",
  "Content-Security-Policy-Report-Only", "report-uri", "DevTools", "9.3C",
  "App Check", "Asaas Sandbox", "reCAPTCHA"
]) {
  assert.ok(documentation.includes(key), "missing rollout document contract: " + key);
}
const workflow = read(".github/workflows/marco8-rc-regression.yml");
assert.ok(workflow.includes("node tests/marco9-csp-report-only-v1_2.test.js"));
assert.ok(workflow.includes("node tests/marco9-csp-inventory-v1_2.test.js"));
assert.ok(workflow.includes("RC_CONSOLIDATED_REGRESSION=133/133"));
assert.ok(workflow.includes("  contents: read"));
assert.ok(!workflow.includes("firebase deploy"));
assert.ok(!workflow.includes("pull_request_target"));
assert.ok(!workflow.includes("secrets."));
console.log("MARCO9_3B_STAGING_HTML_ROOT_HEADERS=PASSED");
console.log("MARCO9_3B_POLICY_DIRECTIVES=11/11");
console.log("MARCO9_3B_CACHE_HEADERS_PRESERVED=PASSED");
console.log("MARCO9_3B_ENFORCEMENT=NOT_ENABLED");
console.log("MARCO9_3B_REPORT_ENDPOINT=NOT_CONFIGURED");
console.log("MARCO9_3B_REAL_STAGING_BROWSER_SMOKE=NOT_RUN");
console.log("MARCO9_GATE_9_3B_REPORT_ONLY_CONFIG=PASSED");
console.log("DEPLOY_EXECUTED=False");
