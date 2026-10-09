"use strict";

// Gate 9.1A — read-only static inventory; no Firebase/provider access or deploy.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const FUNCTION_ROOT = path.join(ROOT, "functions");
const CLIENT_FILES = Object.freeze([
  "js/course-public-api-v1_2.js",
  "js/course-purchase-api-v1_2.js",
  "js/belt-exam-api-v1_2.js",
  "js/admin-shell-route-api-v1_2.js",
  "js/admin-shell-api-v1_2.js"
]);

const INGRESS_EXCEPTIONS = Object.freeze([
  Object.freeze({
    file: "functions/index.js",
    endpoint: "asaasWebhook",
    transport: "onRequest",
    reason: "Legacy external Asaas callback; validate provider webhook token, not browser App Check."
  }),
  Object.freeze({
    file: "functions/src/finance/financial-webhook-functions.js",
    endpoint: "webhookAsaasPagamentosV12",
    transport: "onRequest",
    reason: "Canonical Asaas webhook ingress; retain independent webhook token verification."
  })
]);

function walk(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") found.push(...walk(absolute));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      found.push(absolute);
    }
  }
  return found;
}

function getSourceFiles() {
  return [path.join(FUNCTION_ROOT, "index.js"), ...walk(path.join(FUNCTION_ROOT, "src"))]
    .sort();
}

function extractEntrypoints(relativePath, source) {
  const result = [];
  const pattern = /\bon(Call|Request)\s*\(/g;
  for (const match of source.matchAll(pattern)) {
    const prefix = source.slice(0, match.index);
    const line = prefix.split("\n").length;
    const context = prefix.slice(-240);
    const assigned = context.match(/(?:exports\.)?([A-Za-z_$][\w$]*)\s*(?:=|:)\s*$/);
    result.push(Object.freeze({
      file: relativePath,
      line,
      transport: match[1] === "Call" ? "onCall" : "onRequest",
      candidateName: assigned ? assigned[1] : null,
      authClassification: "requires-manual-verification"
    }));
  }
  return result;
}

function inventory() {
  const sources = getSourceFiles();
  const candidates = [];
  for (const file of sources) {
    const relative = path.relative(ROOT, file).replace(/\\/g, "/");
    const text = fs.readFileSync(file, "utf8");
    candidates.push(...extractEntrypoints(relative, text));
  }
  const clients = CLIENT_FILES.map(file => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    return Object.freeze({
      file,
      rawHttpCallable: /fetchImpl\s*\(|await\s+fetch\s*\(/.test(text),
      bearerAuth: /Bearer\s*\$\{idToken\}/.test(text),
      appCheckHeaderPresent: text.includes("X-Firebase-AppCheck"),
      appCheckBridgeReady: text.includes("...appCheckHeaders") && text.includes("getAppCheckHeaders")
    });
  });
  return Object.freeze({
    filesScanned: sources.length,
    candidates: Object.freeze(candidates),
    callables: candidates.filter(x => x.transport === "onCall").length,
    httpIngresses: candidates.filter(x => x.transport === "onRequest").length,
    clients: Object.freeze(clients),
    ingressExceptions: INGRESS_EXCEPTIONS
  });
}

if (require.main === module) {
  const result = inventory();
  console.log(`APP_CHECK_SOURCE_FILES=${result.filesScanned}`);
  console.log(`APP_CHECK_CALLABLE_CANDIDATES=${result.callables}`);
  console.log(`APP_CHECK_HTTP_INGRESS_CANDIDATES=${result.httpIngresses}`);
  console.log(`APP_CHECK_RAW_HTTP_CLIENTS=${result.clients.filter(x => x.rawHttpCallable).length}`);
  console.log("APP_CHECK_ENFORCEMENT=NOT_ENABLED");
  console.log("PRODUCTION_ACCESS=NOT_RUN");
}

module.exports = Object.freeze({ ROOT, CLIENT_FILES, INGRESS_EXCEPTIONS, extractEntrypoints, getSourceFiles, inventory });
