'use strict';

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const {
  buildDefaultRuleMutation
} = require('../functions/src/finance/financial-admin-domain');
const {
  DEFAULT_PLATFORM_FEE_BPS
} = require('../functions/src/finance/financial-domain');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5c-asaas-sandbox-checkout';
const DEFAULT_RULE_PATH = 'financial_rules/platform-default';
const BOOTSTRAP_ACTOR = 'system:staging-bootstrap-marco5c';

function fail(message) {
  throw new Error(message);
}

function escapeCmdArgument(value) {
  return String(value)
    .replace(/([&|<>^()])/g, '^$1');
}

function command(name, args) {
  let executable = name;
  let executableArgs = args;

  if (process.platform === 'win32' && name === 'gcloud') {
    executable = process.env.ComSpec || 'cmd.exe';
    const commandLine = [
      'gcloud.cmd',
      ...args.map(escapeCmdArgument)
    ].join(' ');
    executableArgs = ['/d', '/s', '/c', commandLine];
  }

  try {
    return execFileSync(executable, executableArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const stderr = String(error?.stderr || '').trim();
    fail(`${name} falhou: ${stderr || error.message}`);
  }
}

function firestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(firestoreValue) } };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('Valor numerico invalido para Firestore.');
    if (Number.isInteger(value)) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: firestoreFields(value)
      }
    };
  }
  fail('Tipo nao suportado para Firestore.');
}

function firestoreFields(value) {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, firestoreValue(item)])
  );
}

function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)])
  );
}

async function readJson(response, label) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) {
    const message = body?.error?.message || body?.error?.status || '';
    fail(`${label} falhou HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }
  return body;
}

async function main() {
  const branch = command('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  }

  if (command('git', ['status', '--short'])) {
    fail('Worktree precisa estar limpa antes do bootstrap.');
  }

  const project = command('gcloud', [
    'projects', 'describe', EXPECTED_PROJECT,
    '--format=value(projectId)'
  ]);
  if (project !== EXPECTED_PROJECT || project === PRODUCTION_PROJECT) {
    fail('Projeto staging nao confirmado.');
  }

  const accessToken = command('gcloud', ['auth', 'print-access-token']);
  if (!accessToken) fail('Access token gcloud ausente.');

  const base =
    `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)`;
  const documentsBase = `${base}/documents`;
  const authHeaders = {
    authorization: `Bearer ${accessToken}`,
    'content-type': 'application/json'
  };

  const defaultRuleUrl = `${documentsBase}/financial_rules/platform-default`;
  const existingResponse = await fetch(defaultRuleUrl, {
    headers: { authorization: `Bearer ${accessToken}` }
  });

  if (existingResponse.ok) {
    const existingBody = await existingResponse.json();
    const existing = decodeFields(existingBody.fields || {});
    if (
      existing.status !== 'active' ||
      existing.scope !== 'platform_default' ||
      existing.recipientMode !== 'product_owner'
    ) {
      fail('Regra platform-default existente possui formato incompatível; bootstrap não altera dados existentes.');
    }

    console.log('MARCO5C_STAGING_FINANCIAL_DEFAULT_BOOTSTRAP=ALREADY_READY');
    console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
    console.log(`PLATFORM_FEE_BPS=${existing.platformFeeBps}`);
    console.log('DATA_WRITES_PERFORMED=False');
    console.log('ASAAS_CALLS_PERFORMED=False');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    return;
  }

  if (existingResponse.status !== 404) {
    await readJson(existingResponse, 'GET financial_rules/platform-default');
  }

  if (process.env.BJJ_EXAMS_ALLOW_STAGING_FINANCIAL_BOOTSTRAP !== 'true') {
    fail('Regra default ausente. Para criar somente em staging, defina BJJ_EXAMS_ALLOW_STAGING_FINANCIAL_BOOTSTRAP=true.');
  }

  const now = new Date();
  const mutation = buildDefaultRuleMutation({
    existingRule: null,
    platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
    actorId: BOOTSTRAP_ACTOR,
    timestamp: now
  });

  if (!mutation.created || !mutation.changed) {
    fail('Domínio financeiro não gerou criação da regra default como esperado.');
  }

  const rule = mutation.rule;
  const auditId = `marco5c-default-${crypto.randomUUID()}`;
  const audit = {
    actorId: BOOTSTRAP_ACTOR,
    actorRole: 'system',
    action: 'financial.default_rule.bootstrapped',
    entityType: 'financial_rule',
    entityId: 'platform-default',
    before: null,
    after: {
      status: rule.status,
      scope: rule.scope,
      platformFeeBps: rule.platformFeeBps,
      recipientMode: rule.recipientMode,
      version: rule.version
    },
    source: 'staging_bootstrap',
    requestId: null,
    createdAt: now
  };

  const documentName = path =>
    `projects/${EXPECTED_PROJECT}/databases/(default)/documents/${path}`;

  const commitResponse = await fetch(`${base}/documents:commit`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: documentName(DEFAULT_RULE_PATH),
            fields: firestoreFields(rule)
          },
          currentDocument: { exists: false }
        },
        {
          update: {
            name: documentName(`audit_logs/${auditId}`),
            fields: firestoreFields(audit)
          },
          currentDocument: { exists: false }
        }
      ]
    })
  });

  await readJson(commitResponse, 'Firestore atomic bootstrap commit');

  const verifyResponse = await fetch(defaultRuleUrl, {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const verifyBody = await readJson(verifyResponse, 'Verificacao da regra default');
  const persisted = decodeFields(verifyBody.fields || {});

  if (
    persisted.status !== 'active' ||
    persisted.scope !== 'platform_default' ||
    persisted.recipientMode !== 'product_owner' ||
    persisted.platformFeeBps !== DEFAULT_PLATFORM_FEE_BPS ||
    persisted.version !== 1
  ) {
    fail('Regra default persistida diverge do contrato canônico.');
  }

  console.log('MARCO5C_STAGING_FINANCIAL_DEFAULT_BOOTSTRAP=OK');
  console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
  console.log(`PLATFORM_FEE_BPS=${persisted.platformFeeBps}`);
  console.log(`RULE_VERSION=${persisted.version}`);
  console.log('AUDIT_CREATED=True');
  console.log('DATA_WRITES_PERFORMED=True');
  console.log('ASAAS_CALLS_PERFORMED=False');
  console.log('PRODUCTION_ACCESS=NOT_RUN');
}

main().catch(error => {
  console.error(`MARCO5C_STAGING_FINANCIAL_DEFAULT_BOOTSTRAP=FAILED | ${error.message}`);
  process.exitCode = 1;
});
