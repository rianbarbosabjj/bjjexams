"use strict";

// Gate 9.3A: static inspection ONLY; no CSP header or cloud access.
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, ALLOWED_FILES } = require("./build-staging-hosting-v1_2");
const STAGING_SITE = "bjj-exams-staging";

function remoteOriginCandidates(source) {
  const origins = new Set();
  // URLs may contain private query strings; return scheme+host ONLY.
  for (const match of source.matchAll(/https?:\/\/[^\s"'<>\\{}|]+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.protocol === "https:" || url.protocol === "http:") origins.add(url.origin);
    } catch (_) { /* templates and fragments are not confirmed origins */ }
  }
  return [...origins].sort();
}

function analyzeAsset(relativePath, source) {
  if (typeof relativePath !== "string" || typeof source !== "string" ||
      !/^(?:js\/[\w.-]+\.js|[\w.-]+\.html)$/.test(relativePath)) {
    throw new Error("CSP_INVENTORY_INVALID_ASSET");
  }
  const html = relativePath.endsWith(".html");
  const scripts = html ?
    [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)] : [];
  const inlineScripts = scripts.filter(m =>
    !/\bsrc\s*=/i.test(m[1]) && m[2].trim().length > 0).length;
  const externalScripts = scripts.filter(m => /\bsrc\s*=\s*["'][^"']+["']/i.test(m[1])).length;
  const moduleScripts = scripts.filter(m => /\btype\s*=\s*["']module["']/i.test(m[1])).length;
  const inlineStyles = html ? [...source.matchAll(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi)].length : 0;
  const styleAttributes = html ? [...source.matchAll(/\sstyle\s*=\s*["']/gi)].length : 0;
  const inlineHandlers = html ? [...source.matchAll(/\son[a-z]+\s*=\s*["']/gi)].length : 0;
  const frames = html ? [...source.matchAll(/<iframe\b/gi)].length : 0;
  const dynamicEvaluations = [...source.matchAll(/\b(?:eval\s*\(|new\s+Function\s*\()/g)].length;
  return Object.freeze({
    file: relativePath,
    inlineScripts, externalScripts, moduleScripts,
    inlineStyles, styleAttributes, inlineHandlers, frames, dynamicEvaluations,
    candidateOrigins: remoteOriginCandidates(source)
  });
}

function hostingHeadersState(config) {
  const h = config?.hosting;
  if (h?.site !== STAGING_SITE || h?.public !== ".firebase-hosting-staging" ||
      !Array.isArray(h?.headers)) throw new Error("CSP_STAGING_BOUNDARY_INVALID");
  const headers = h.headers.flatMap(x => Array.isArray(x.headers) ? x.headers : []);
  const enforcing = headers.some(x => /^content-security-policy$/i.test(x.key));
  if (enforcing) throw new Error("CSP_ENFORCEMENT_FORBIDDEN_GATE_9_3A");
  return headers.some(x => /^content-security-policy-report-only$/i.test(x.key))
    ? "REPORT_ONLY_CONFIGURED_NOT_BROWSER_VERIFIED" : "NOT_CONFIGURED";
}

function inventory() {
  if (ALLOWED_FILES.length !== 52 || new Set(ALLOWED_FILES).size !== 52) {
    throw new Error("CSP_ALLOWLIST_NOT_52");
  }
  const primary = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
  if (Object.hasOwn(primary, "hosting")) throw new Error("CSP_PRIMARY_HOSTING_FORBIDDEN");
  const config = JSON.parse(fs.readFileSync(
    path.join(ROOT, "firebase.staging-hosting.json"), "utf8"));
  const header = hostingHeadersState(config);
  const assets = [];
  for (const relative of ALLOWED_FILES) {
    if (!relative.endsWith(".html") && !relative.endsWith(".js")) continue;
    const candidate = path.resolve(ROOT, relative);
    if (!candidate.startsWith(ROOT + path.sep)) throw new Error("CSP_PATH_OUTSIDE_ROOT");
    const stat = fs.lstatSync(candidate);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("CSP_UNSAFE_ASSET");
    assets.push(analyzeAsset(relative, fs.readFileSync(candidate, "utf8")));
  }
  const htmlPages = assets.filter(x => x.file.endsWith(".html"));
  const scriptFiles = assets.filter(x => x.file.endsWith(".js"));
  const counts = {};
  for (const key of [
    "inlineScripts","externalScripts","moduleScripts",
    "inlineStyles","styleAttributes","inlineHandlers","frames","dynamicEvaluations"
  ]) counts[key] = assets.reduce((n, a) => n + a[key], 0);
  return Object.freeze({
    project: "bjj-exams-staging",
    hostingSite: STAGING_SITE,
    allowedFiles: ALLOWED_FILES.length,
    htmlFiles: htmlPages.length,
    jsFiles: scriptFiles.length,
    ...counts,
    candidateOrigins: [...new Set(assets.flatMap(a => a.candidateOrigins))].sort(),
    pagesWithInlineScripts: htmlPages.filter(a => a.inlineScripts).map(a => a.file),
    pagesWithInlineStyles: htmlPages.filter(a => a.inlineStyles || a.styleAttributes).map(a => a.file),
    pagesWithInlineHandlers: htmlPages.filter(a => a.inlineHandlers).map(a => a.file),
    originListIsStaticCandidatesOnly: true,
    runtimeRequestsVerified: false,
    cspHeader: header,
    cspEnforcement: "NOT_ENABLED",
    realBrowserSmoke: "NOT_RUN",
    nextGate: "9.3B_REPORT_ONLY_STAGING",
    deployExecuted: false
  });
}

if (require.main === module) {
  try { process.stdout.write(JSON.stringify(inventory(), null, 2) + "\n"); }
  catch (_) {
    process.stderr.write("MARCO9_3A_CSP_INVENTORY=BLOCKED\n");
    process.exitCode = 2;
  }
}
module.exports = Object.freeze({
  STAGING_SITE, remoteOriginCandidates, analyzeAsset, hostingHeadersState, inventory
});
