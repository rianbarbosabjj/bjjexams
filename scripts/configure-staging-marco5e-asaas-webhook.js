'use strict';

const { execFileSync } = require('node:child_process');

const TARGET_PROJECT = 'bjj-exams-staging';
const PRODUCTION_PROJECT = 'bjj-exams';
const EXPECTED_BRANCH = 'feature/marco5e-refund-chargeback';
const ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
const ASAAS_API_SECRET = 'ASAAS_API_KEY';
const ASAAS_WEBHOOK_SECRET = 'ASAAS_WEBHOOK_TOKEN';
const EXPECTED_API_KEY_PREFIX = '$aact_hmlg_';
const WEBHOOK_ID = 'a771d6d6-a928-4dfe-bcf6-0ba3c34b32bc';
const WEBHOOK_NAME = 'BJJ Exams Staging';
const WEBHOOK_URL = 'https://webhookasaaspagamentosv12-vn3is4vifq-rj.a.run.app';

const DESIRED_EVENTS = Object.freeze([
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_DELETED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_REFUND_IN_PROGRESS',
  'PAYMENT_REFUND_DENIED',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL'
]);

function fail(message) {
  throw new Error(message);
}

function run(command, args) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function runGit(args) {
  return run('git', args);
}

function readSecret(name) {
  return run('gcloud.cmd', [
    'secrets', 'versions', 'access', 'latest',
    `--secret=${name}`,
    `--project=${TARGET_PROJECT}`
  ]);
}

function canonicalEvents(events) {
  return [...new Set(Array.isArray(events) ? events.map(String) : [])].sort();
}

function sameEvents(left, right) {
  const a = canonicalEvents(left);
  const b = canonicalEvents(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function asaas(apiKey, path, options = {}) {
  const response = await fetch(`${ASAAS_BASE_URL}${path}`, {
    ...options,
    headers: {
      accept: 'application/json',
      access_token: apiKey,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      fail(`Asaas retornou JSON inválido em ${options.method || 'GET'} ${path}.`);
    }
  }

  if (!response.ok) {
    const errorSummary = data?.errors?.map(item => item?.description || item?.code).filter(Boolean).join('; ')
      || data?.message
      || `HTTP ${response.status}`;
    fail(`Asaas rejeitou ${options.method || 'GET'} ${path}: ${errorSummary}`);
  }

  return data;
}

function assertTargetWebhook(webhook) {
  if (!webhook || typeof webhook !== 'object') fail('Webhook dedicado de staging não foi encontrado.');
  if (webhook.id !== WEBHOOK_ID) fail(`Webhook ID inesperado: ${webhook.id || '<EMPTY>'}.`);
  if (webhook.name !== WEBHOOK_NAME) fail(`Webhook name inesperado: ${webhook.name || '<EMPTY>'}.`);
  if (webhook.url !== WEBHOOK_URL) fail(`Webhook URL inesperada: ${webhook.url || '<EMPTY>'}.`);
  if (webhook.enabled !== true) fail('Webhook dedicado de staging precisa permanecer enabled=true.');
  if (webhook.interrupted !== false) {
    fail('Webhook dedicado está interrupted=true. Não reativar automaticamente; investigar a fila antes.');
  }
  if (webhook.sendType !== 'SEQUENTIALLY') {
    fail(`Webhook sendType inesperado: ${webhook.sendType || '<EMPTY>'}.`);
  }
}

async function main() {
  if (TARGET_PROJECT === PRODUCTION_PROJECT) fail('Projeto alvo não pode ser produção.');

  const branch = runGit(['branch', '--show-current']);
  if (branch !== EXPECTED_BRANCH) {
    fail(`Branch incorreta. Esperado: ${EXPECTED_BRANCH}; atual: ${branch}.`);
  }

  const status = runGit(['status', '--porcelain']);
  if (status) fail('Working tree precisa estar limpa antes de alterar o Webhook Sandbox.');

  runGit(['fetch', 'origin', EXPECTED_BRANCH]);
  const localHead = runGit(['rev-parse', 'HEAD']);
  const remoteHead = runGit(['rev-parse', `origin/${EXPECTED_BRANCH}`]);
  if (localHead !== remoteHead) {
    fail(`HEAD local diverge do remoto. Local: ${localHead}; remoto: ${remoteHead}.`);
  }

  let apiKey = null;
  let webhookToken = null;

  try {
    apiKey = readSecret(ASAAS_API_SECRET);
    webhookToken = readSecret(ASAAS_WEBHOOK_SECRET);

    if (!apiKey.startsWith(EXPECTED_API_KEY_PREFIX)) {
      fail('ASAAS_API_KEY não possui prefixo Sandbox esperado.');
    }
    if (!webhookToken || webhookToken.length < 32 || webhookToken.length > 255) {
      fail('ASAAS_WEBHOOK_TOKEN precisa ter entre 32 e 255 caracteres.');
    }

    const before = await asaas(apiKey, `/webhooks/${encodeURIComponent(WEBHOOK_ID)}`);
    assertTargetWebhook(before);

    const previousEvents = canonicalEvents(before.events);
    const alreadyConfigured = sameEvents(previousEvents, DESIRED_EVENTS);

    if (!alreadyConfigured) {
      await asaas(apiKey, `/webhooks/${encodeURIComponent(WEBHOOK_ID)}`, {
        method: 'PUT',
        body: JSON.stringify({
          authToken: webhookToken,
          events: DESIRED_EVENTS
        })
      });
    }

    const after = await asaas(apiKey, `/webhooks/${encodeURIComponent(WEBHOOK_ID)}`);
    assertTargetWebhook(after);
    if (!sameEvents(after.events, DESIRED_EVENTS)) {
      fail(`Eventos finais do webhook não correspondem ao contrato Marco 5.5. Atual: ${canonicalEvents(after.events).join(',')}`);
    }

    console.log('MARCO5E_ASAAS_SANDBOX_WEBHOOK_UPDATE=OK');
    console.log(`TARGET_PROJECT=${TARGET_PROJECT}`);
    console.log('ASAAS_ENVIRONMENT=sandbox');
    console.log('PRODUCTION_ACCESS=NOT_RUN');
    console.log(`WEBHOOK_ID=${WEBHOOK_ID}`);
    console.log(`WEBHOOK_NAME=${WEBHOOK_NAME}`);
    console.log(`WEBHOOK_URL=${WEBHOOK_URL}`);
    console.log('WEBHOOK_ENABLED=True');
    console.log('WEBHOOK_INTERRUPTED=False');
    console.log('WEBHOOK_SEND_TYPE=SEQUENTIALLY');
    console.log(`WEBHOOK_EVENTS=${canonicalEvents(after.events).join(',')}`);
    console.log(`WEBHOOK_EVENT_COUNT=${canonicalEvents(after.events).length}`);
    console.log(`WEBHOOK_CONFIG_CHANGED=${alreadyConfigured ? 'False' : 'True'}`);
    console.log('OTHER_WEBHOOKS_MUTATED=False');
    console.log('FIRESTORE_WRITE_PERFORMED=False');
    console.log('PAYMENT_MUTATION_PERFORMED=False');
    console.log('API_KEY_PRINTED=False');
    console.log('WEBHOOK_TOKEN_PRINTED=False');
  } finally {
    apiKey = null;
    webhookToken = null;
  }
}

main().catch(error => {
  console.error(`MARCO5E_ASAAS_SANDBOX_WEBHOOK_UPDATE=FAILED | ${error.message}`);
  process.exitCode = 1;
});
