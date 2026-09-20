'use strict';

const { execFileSync } = require('node:child_process');

const EXPECTED_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5f-purchase-ui-ops';

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
    executableArgs = ['/d', '/s', '/c', ['gcloud.cmd', ...args.map(escapeCmdArgument)].join(' ')];
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
  if ('mapValue' in value) return decodeFields(value.mapValue.fields || {});
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(decodeValue);
  return null;
}

function decodeFields(fields = {}) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]));
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

function toMillis(value) {
  const millis = new Date(value || 0).getTime();
  return Number.isFinite(millis) ? millis : 0;
}

async function main() {
  if (EXPECTED_PROJECT === PRODUCTION_PROJECT) fail('Projeto alvo nao pode ser producao.');

  const branch = command('git', ['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) fail(`Branch invalida: ${branch}. Esperado ${EXPECTED_BRANCH}.`);
  if (command('git', ['status', '--short'])) fail('Worktree precisa estar limpa.');

  command('git', ['fetch', '--quiet', 'origin', EXPECTED_BRANCH]);
  const localHead = command('git', ['rev-parse', 'HEAD']);
  const remoteHead = command('git', ['rev-parse', `origin/${EXPECTED_BRANCH}`]);
  if (localHead !== remoteHead) fail('HEAD local precisa coincidir com o remoto.');

  const project = command('gcloud', ['projects', 'describe', EXPECTED_PROJECT, '--format=value(projectId)']);
  if (project !== EXPECTED_PROJECT || project === PRODUCTION_PROJECT) fail('Projeto staging nao confirmado.');

  const accessToken = command('gcloud', ['auth', 'print-access-token']);
  if (!accessToken) fail('Access token gcloud ausente.');

  const firestoreBase = `https://firestore.googleapis.com/v1/projects/${EXPECTED_PROJECT}/databases/(default)/documents`;
  const users = [];
  let pageToken = null;

  do {
    const url = new URL(`${firestoreBase}/usuarios`);
    url.searchParams.set('pageSize', '200');
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const response = await fetch(url, {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const body = await readJson(response, 'LIST Firestore usuarios');

    for (const document of body.documents || []) {
      users.push({
        id: String(document.name || '').split('/').pop(),
        data: decodeFields(document.fields || {})
      });
    }
    pageToken = body.nextPageToken || null;
  } while (pageToken);

  const matches = users
    .filter(entry => (
      entry.data?.smokeTest === true &&
      entry.data?.nome === 'BJJ Exams Smoke UI 5.6' &&
      /^bjjexams-marco5f-ui-.*@example\.test$/i.test(String(entry.data?.email || ''))
    ))
    .sort((left, right) => toMillis(right.data?.createdAt) - toMillis(left.data?.createdAt));

  if (!matches.length) fail('Aluno de smoke do Marco 5.6 nao encontrado.');

  const student = matches[0];
  console.log('MARCO5F_UI_STUDENT_LOOKUP=OK');
  console.log(`TARGET_PROJECT=${EXPECTED_PROJECT}`);
  console.log('PRODUCTION_ACCESS=NOT_RUN');
  console.log(`STUDENT_EMAIL=${student.data.email}`);
  console.log(`STUDENT_UID=${student.id}`);
  console.log('REMOTE_READ_ONLY=True');
  console.log('STAGING_WRITE_PERFORMED=False');
  console.log('PASSWORD_PRINTED=False');
  console.log('ACCESS_TOKEN_PRINTED=False');
}

main().catch(error => {
  console.error(`MARCO5F_UI_STUDENT_LOOKUP=FAILED | ${error.message}`);
  process.exitCode = 1;
});
