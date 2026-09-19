'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const target = path.resolve(__dirname, 'smoke-staging-marco5e-refund-v2.js');
const original = fs.readFileSync(target, 'utf8');
const needle = 'const asaasApiKey = readSecret(ASAAS_API_SECRET);';
const replacement = 'let asaasApiKey = readSecret(ASAAS_API_SECRET);';

const matches = original.split(needle).length - 1;
if (matches !== 1) {
  throw new Error(
    `Runner de smoke esperava exatamente 1 declaracao imutavel de asaasApiKey; encontrou ${matches}.`
  );
}

const source = original.replace(needle, replacement);
const compiled = new Module(target, module);
compiled.filename = target;
compiled.paths = Module._nodeModulePaths(path.dirname(target));
compiled._compile(source, target);
