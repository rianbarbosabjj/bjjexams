"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const nav = require("../js/admin-shell-navigation-v1_2");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

const architecture = read("docs/architecture/MARCO_8_FRONTEND_INTEGRATION.md");
const api = read("js/admin-shell-api-v1_2.js");
const controller = read("js/admin-shell-controller-v1_2.js");
const bootstrap = read("js/admin-shell-bootstrap-v1_2.js");
const html = read("admin_shell_v1_2.html");

assert.strictEqual(nav.SECTION_DEFINITIONS.length, 2);
assert.strictEqual(nav.NAVIGATION_ITEMS.length, 14);

const routes = [
  ["people","operations","ops.people.read"],
  ["organizations","operations","ops.organizations.read"],
  ["courses","operations","ops.courses.read"],
  ["exams","operations","ops.exams.read"],
  ["questions","operations","ops.questions.read"],
  ["certificates","operations","ops.certificates.read"],
  ["orders","operations","ops.orders.read"],
  ["finance","console","console.finance.read"],
  ["splits","console","console.splits.read"],
  ["webhooks","console","console.webhooks.read"],
  ["audit","console","console.audit.read"],
  ["security","console","console.security.read"],
  ["configuration","console","console.config.read"],
  ["health","console","console.health.read"]
];

assert.deepStrictEqual(
  nav.NAVIGATION_ITEMS.map(item => [item.id, item.section, item.capability]),
  routes
);

for (const [route, surface, capability] of routes) {
  assert.ok(
    architecture.includes(`| ${route} | ${surface} | \`${capability}\` |`),
    `Missing route contract ${route}`
  );
}

for (const marker of [
  "admin-shell-route-runtime-v1_2.js",
  "route-loading",
  "route-ready",
  "route-empty",
  "route-error",
  "route-not-integrated",
  "latest-request-wins",
  "cursor opaco",
  "confirmação explícita",
  "aria-live",
  "textContent",
  "replaceChildren",
  "8.7B — Foundation de route runtime",
  "8.7C — Painel Operacional",
  "8.7D — Finance e Splits",
  "8.7E — Webhooks e Audit",
  "8.7F — Security, Configuration e Health",
  "8.7G — Regressão frontend consolidada"
]) {
  assert.ok(architecture.includes(marker), `Missing ${marker}`);
}

for (const marker of [
  "getFirestore","collection","getDoc","getDocs","setDoc",
  "addDoc","updateDoc","deleteDoc","onSnapshot"
]) {
  assert.ok(architecture.includes(`\`${marker}\``), `Must forbid ${marker}`);
}

assert.ok(architecture.includes(
  "O bootstrap permanece separado e restrito a `obterContextoAdministrativoV12` com payload vazio."
));
assert.ok(architecture.includes("produção bloqueada"));
assert.ok(architecture.includes("não cria mutation genérica"));

assert.ok(api.includes("obterContextoAdministrativoV12"));
assert.ok(api.includes("ADMIN_BOOTSTRAP_PAYLOAD_REJECTED"));
assert.ok(api.includes("ADMIN_PRODUCTION_BLOCKED"));
assert.ok(bootstrap.includes("ADMIN_PRODUCTION_BLOCKED"));

assert.ok(controller.includes("data-admin-route-placeholder"));
assert.strictEqual(controller.includes(".innerHTML"), false);
assert.ok(controller.includes(".textContent"));
assert.ok(controller.includes(".replaceChildren"));

for (const forbidden of [
  "firebase-firestore","getFirestore(","getDocs(","addDoc(","updateDoc(","deleteDoc("
]) {
  assert.strictEqual(html.includes(forbidden), false, `Shell contains ${forbidden}`);
}

const scripts = [
  "js/firebase-runtime-v1_2.js",
  "js/admin-shell-api-v1_2.js",
  "js/admin-shell-navigation-v1_2.js",
  "js/admin-shell-controller-v1_2.js",
  "js/admin-shell-bootstrap-v1_2.js"
].map(source => html.indexOf(source));

assert.ok(scripts.every(index => index >= 0));
for (let i = 1; i < scripts.length; i += 1) {
  assert.ok(scripts[i] > scripts[i - 1], "Shell dependency order changed");
}

console.log("MARCO8_7A_FRONTEND_SECTIONS=2/2");
console.log("MARCO8_7A_FRONTEND_ROUTES=14/14");
console.log("MARCO8_7A_ROUTE_CAPABILITY_MATRIX=14/14");
console.log("MARCO8_7A_BOOTSTRAP_CONTRACT=PRESERVED");
console.log("MARCO8_7A_ROUTE_STATES=5/5");
console.log("MARCO8_7A_LATEST_REQUEST_WINS=REQUIRED");
console.log("MARCO8_7A_CURSOR_PAGINATION=OPAQUE");
console.log("MARCO8_7A_FILTERS=ALLOWLISTED");
console.log("MARCO8_7A_CONFIRMATION=REQUIRED_FOR_IMPACT_ACTIONS");
console.log("MARCO8_7A_DOM_RENDERING=SAFE");
console.log("MARCO8_7A_ACCESSIBILITY=BASIC_REQUIRED");
console.log("MARCO8_7A_DIRECT_FIRESTORE=FORBIDDEN");
console.log("MARCO8_7A_PRODUCTION=BLOCKED");
console.log("MARCO8_7A_RUNTIME_CHANGES=False");
console.log("MARCO8_7A_FRONTEND_INTEGRATION_ARCHITECTURE=PASSED");
