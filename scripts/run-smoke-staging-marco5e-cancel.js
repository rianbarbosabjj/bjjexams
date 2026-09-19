'use strict';

const path = require('node:path');
const Module = require('node:module');
const { createRequire } = Module;

const functionsPackage = path.resolve(__dirname, '..', 'functions', 'package.json');
const functionsRequire = createRequire(functionsPackage);

let firebaseAdminApp;
let firebaseAdminAuth;
try {
  firebaseAdminApp = functionsRequire.resolve('firebase-admin/app');
  firebaseAdminAuth = functionsRequire.resolve('firebase-admin/auth');
} catch (error) {
  console.error(
    'MARCO5E_STAGING_CANCEL_SMOKE=FAILED | dependencias locais de functions ausentes. ' +
    'Execute npm ci --prefix functions e tente novamente.'
  );
  process.exitCode = 1;
  return;
}

const aliases = new Map([
  ['../functions/node_modules/firebase-admin/app', firebaseAdminApp],
  ['../functions/node_modules/firebase-admin/auth', firebaseAdminAuth]
]);

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function patchedResolveFilename(request, parent, isMain, options) {
  const alias = aliases.get(request);
  if (alias) return alias;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

try {
  require('./smoke-staging-marco5e-cancel');
} finally {
  Module._resolveFilename = originalResolveFilename;
}
