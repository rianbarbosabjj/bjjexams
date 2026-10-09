"use strict";

// Gate 9.4B: package-lock + CI trust-boundary inspection, OFFLINE only.
// Does not execute npm audit, install dependencies or access GitHub/npm.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const EXPECTED_DIRECT = Object.freeze({
  axios: "1.20.0",
  "firebase-admin": "14.4.0",
  "firebase-functions": "7.3.2",
  "form-data": "4.0.6"
});

function inspectSupplyChain({ pkg, lock, workflow } = {}) {
  if (!pkg || !lock || typeof workflow !== "string") {
    throw new Error("SUPPLY_CHAIN_INPUT_REQUIRED");
  }
  if (pkg.name !== "bjj-exams-functions" ||
      pkg.private !== true ||
      pkg.engines?.node !== "22" ||
      lock.lockfileVersion !== 3 ||
      lock.name !== pkg.name ||
      lock.version !== pkg.version ||
      !lock.packages || !lock.packages[""]) {
    throw new Error("SUPPLY_CHAIN_ROOT_CONTRACT_INVALID");
  }
  const direct = pkg.dependencies;
  const lockDirect = lock.packages[""].dependencies;
  if (!direct || !lockDirect ||
      JSON.stringify(Object.keys(direct).sort()) !==
        JSON.stringify(Object.keys(EXPECTED_DIRECT).sort())) {
    throw new Error("SUPPLY_CHAIN_DIRECT_DEPENDENCIES_CHANGED_REVIEW_REQUIRED");
  }
  for (const [name, expected] of Object.entries(EXPECTED_DIRECT)) {
    if (direct[name] !== expected || lockDirect[name] !== expected ||
        lock.packages["node_modules/" + name]?.version !== expected ||
        !/^\d+\.\d+\.\d+$/.test(expected)) {
      throw new Error("SUPPLY_CHAIN_DEPENDENCY_DRIFT_REVIEW_REQUIRED");
    }
  }
  let checkedPackages = 0;
  let verifiedIntegrity = 0;
  for (const [location, item] of Object.entries(lock.packages)) {
    if (location === "" || item.link === true) continue;
    if (!location.startsWith("node_modules/")) {
      throw new Error("SUPPLY_CHAIN_LOCKFILE_LOCATION_INVALID");
    }
    checkedPackages++;
    if (typeof item.version !== "string" ||
        !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(item.version)) {
      throw new Error("SUPPLY_CHAIN_UNEXPECTED_TRANSITIVE_VERSION");
    }
    if (item.resolved) {
      if (typeof item.resolved !== "string" ||
          !item.resolved.startsWith("https://registry.npmjs.org/") ||
          !/^sha(?:512|384|256)-[A-Za-z0-9+/=]+$/.test(item.integrity || "")) {
        throw new Error("SUPPLY_CHAIN_REGISTRY_OR_INTEGRITY_INVALID");
      }
      verifiedIntegrity++;
    } else if (item.integrity && !/^sha(?:512|384|256)-[A-Za-z0-9+/=]+$/.test(item.integrity)) {
      throw new Error("SUPPLY_CHAIN_INTEGRITY_INVALID");
    }
  }
  const pinnedActions = Object.freeze({
    "actions/checkout": "11bd71901bbe5b1630ceea73d27597364c9af683",
    "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
    "actions/setup-java": "c5195efecf7bdfc987ee8bae7a71cb8b11521c00"
  });
  const actionUses = [...workflow.matchAll(/^\s*uses:\s*(actions\/[\w-]+)@([a-f0-9]{40})\s*(?:#.*)?$/gm)];
  if (actionUses.length !== 3 || actionUses.some((match) =>
      pinnedActions[match[1]] !== match[2]) ||
      /^\s*uses:\s*[^#\n]+@v\d+/m.test(workflow)) {
    throw new Error("SUPPLY_CHAIN_ACTION_SHA_PIN_REQUIRED");
  }
  const required = [
    "pull_request:", "      - develop-v1.2",
    "  contents: read", "node-version: '22.23.2'",
    "persist-credentials: false",
    "npm ci --prefix functions --ignore-scripts --no-audit --no-fund",
    "RC_CONSOLIDATED_REGRESSION=133/133"
  ];
  if (required.some(t => !workflow.includes(t)) ||
      workflow.includes("pull_request_target") ||
      workflow.includes("firebase deploy") ||
      workflow.includes("contents: write") ||
      workflow.includes("secrets.") ||
      workflow.includes("curl | sh") ||
      workflow.includes("npm install --force")) {
    throw new Error("SUPPLY_CHAIN_CI_BOUNDARY_INVALID");
  }
  return Object.freeze({
    lockfileVersion: 3, nodeCi: "22.23.2",
    directDependencyCount: Object.keys(direct).length,
    lockedPackageCount: checkedPackages, registryIntegrityEntries: verifiedIntegrity,
    minimumPermissions: "CONTENTS_READ_ONLY",
    installationScripts: "DISABLED_IN_CI",
    actionReferences: "SHA_PINNED_V4",
    liveVulnerabilityAuditPerformed: false,
    realRegistryVerificationPerformed: false,
    decision: "OFFLINE_LOCK_INTEGRITY_CHECK_ONLY_MANUAL_AUDIT_PENDING",
    productionAccess: "NOT_RUN"
  });
}
function inspectRepository() {
  const read = p => fs.readFileSync(path.join(ROOT,p),"utf8");
  return inspectSupplyChain({
    pkg: JSON.parse(read("functions/package.json")),
    lock: JSON.parse(read("functions/package-lock.json")),
    workflow: read(".github/workflows/marco8-rc-regression.yml")
  });
}
if (require.main === module) {
  try { process.stdout.write(JSON.stringify(inspectRepository(), null, 2) + "\n"); }
  catch (_) { process.stderr.write("MARCO9_SUPPLY_CHAIN_PREFLIGHT=BLOCKED\n"); process.exitCode = 2; }
}
module.exports = Object.freeze({ EXPECTED_DIRECT, inspectSupplyChain, inspectRepository });
