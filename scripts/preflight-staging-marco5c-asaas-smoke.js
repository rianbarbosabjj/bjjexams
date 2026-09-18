'use strict';

const { execFileSync } = require('child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5c-asaas-sandbox-checkout';
const REGION = 'southamerica-east1';
const FUNCTION_NAME = 'iniciarCheckoutCursoV12';
const WEB_APP_ID = '1:206338587822:web:d870ac4cf23b6a1b6f813f';
const SMOKE_MARKER_PATH = 'smoke_runs/marco5c-asaas-sandbox-v1';

function fail(message) {
  throw new Error(message);
}

function escapeCmdArgument(value) {
  return String(value).replace(/([&|<>^()])/g, '^$1');
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
    fail('Worktree precisa estar limpa.');
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

  const firestoreBase =
    `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)/documents`;

  function docUrl(path) {
    return `${firestoreBase}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }

  async function getDoc(path) {
    const response = await fetch(docUrl(path), {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 404) return null;
    const body = await readJson(response, `GET Firestore ${path}`);
    return decodeFields(body.fields || {});
  }

  const marker = await getDoc(SMOKE_MARKER_PATH);
  if (marker) {
    fail(`Smoke ja possui marcador com status ${marker.status || 'unknown'}.`);
  }

  const rule = await getDoc('financial_rules/platform-default');
  if (!rule) fail('Regra platform-default nao persistida em staging.');
  if (
    rule.status !== 'active' ||
    rule.scope !== 'platform_default' ||
    rule.recipientMode !== 'product_owner'
  ) {
    fail('Regra platform-default nao esta ativa/compativel.');
  }

  const feeBps = Number(rule.platformFeeBps);
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10000) {
    fail('platformFeeBps da regra default e invalido.');
  }

  const fn = JSON.parse(command('gcloud', [
    'functions', 'describe', FUNCTION_NAME,
    '--gen2',
    `--region=${REGION}`,
    `--project=${EXPECTED_PROJECT}`,
    '--format=json'
  ]));

  if (fn?.state !== 'ACTIVE' || fn?.buildConfig?.runtime !== 'nodejs22') {
    fail('Function staging nao esta ACTIVE em nodejs22.');
  }

  const uri = String(fn?.serviceConfig?.uri || '').trim();
  if (!uri || uri.includes(PRODUCTION_PROJECT)) fail('URI staging invalida.');

  const secrets = Array.isArray(fn?.serviceConfig?.secretEnvironmentVariables)
    ? fn.serviceConfig.secretEnvironmentVariables
    : [];
  const asaasSecret = secrets.find(item => item?.key === 'ASAAS_API_KEY');
  if (!asaasSecret || asaasSecret.projectId !== EXPECTED_PROJECT) {
    fail('ASAAS_API_KEY nao esta vinculada ao projeto staging.');
  }

  const configResponse = await fetch(
    `https://firebase.googleapis.com/v1beta1/projects/${EXPECTED_PROJECT}/webApps/${encodeURIComponent(WEB_APP_ID)}/config`,
    {
      headers: {
        authorization: `Bearer ${accessToken}`,
        'x-goog-user-project': EXPECTED_PROJECT
      }
    }
  );
  const webConfig = await readJson(configResponse, 'Firebase Web config');
  if (webConfig.projectId !== EXPECTED_PROJECT || !webConfig.apiKey) {
    fail('Firebase Web config staging invalida.');
  }

  console.log('MARCO5C_STAGING_ASAAS_SMOKE_PREFLIGHT=OK');
  console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
  console.log('PRODUCTION_ACCESS=NOT_RUN');
  console.log('DATA_WRITES_PERFORMED=False');
  console.log('ASAAS_CALLS_PERFORMED=False');
  console.log('SMOKE_MARKER_EXISTS=False');
  console.log('DEFAULT_RULE_ACTIVE=True');
  console.log(`DEFAULT_RULE_PLATFORM_FEE_BPS=${feeBps}`);
  console.log('FUNCTION_STATE=ACTIVE');
  console.log('FUNCTION_RUNTIME=nodejs22');
  console.log('ASAAS_SECRET_BOUND=True');
  console.log('FIREBASE_WEB_CONFIG_VALID=True');
  console.log('SECRET_VALUE_PRINTED=False');
}

main().catch(error => {
  console.error(`MARCO5C_STAGING_ASAAS_SMOKE_PREFLIGHT=FAILED | ${error.message}`);
  process.exitCode = 1;
});
