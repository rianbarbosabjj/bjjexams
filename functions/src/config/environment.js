'use strict';

const PROJECT_ENVIRONMENTS = Object.freeze({
  'bjj-exams-staging': 'sandbox',
  'bjj-exams': 'production'
});

function getFirebaseProjectId(env = process.env) {
  if (env.GCLOUD_PROJECT) return env.GCLOUD_PROJECT;
  if (env.GOOGLE_CLOUD_PROJECT) return env.GOOGLE_CLOUD_PROJECT;

  if (env.FIREBASE_CONFIG) {
    try {
      const firebaseConfig = JSON.parse(env.FIREBASE_CONFIG);
      if (firebaseConfig.projectId) return firebaseConfig.projectId;
    } catch {
      throw new Error('FIREBASE_CONFIG inválido: não foi possível identificar o projeto Firebase.');
    }
  }

  return null;
}

function isLocalEmulatorHost(value) {
  return (
    typeof value === 'string' &&
    /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(value)
  );
}

function resolveFinancialRuntimeEnvironment({
  projectId = getFirebaseProjectId(),
  env = process.env
} = {}) {
  if (!projectId) {
    throw new Error(
      'Projeto Firebase não identificado. Ambiente financeiro bloqueado por segurança.'
    );
  }

  const expectedEnvironment =
    PROJECT_ENVIRONMENTS[projectId];

  if (expectedEnvironment) {
    return expectedEnvironment;
  }

  const functionsEmulator =
    String(env.FUNCTIONS_EMULATOR || '')
      .trim()
      .toLowerCase() === 'true';

  const firestoreEmulatorLocal =
    isLocalEmulatorHost(
      env.FIRESTORE_EMULATOR_HOST
    );

  if (
    projectId.startsWith('demo-') &&
    functionsEmulator &&
    firestoreEmulatorLocal
  ) {
    return 'sandbox';
  }

  throw new Error(
    `Projeto Firebase não autorizado para ambiente financeiro: ${projectId}.`
  );
}

function assertAsaasEnvironment({
  projectId = getFirebaseProjectId(),
  asaasEnv,
  apiKey
}) {
  if (!projectId) {
    throw new Error('Projeto Firebase não identificado. Integração Asaas bloqueada por segurança.');
  }

  const expectedEnvironment = PROJECT_ENVIRONMENTS[projectId];

  if (!expectedEnvironment) {
    throw new Error(
      `Projeto Firebase não autorizado para integração Asaas: ${projectId}.`
    );
  }

  const normalizedEnvironment = String(asaasEnv || '').trim().toLowerCase();

  if (normalizedEnvironment !== expectedEnvironment) {
    throw new Error(
      `Ambiente Asaas incompatível com o projeto ${projectId}. ` +
      `Esperado: ${expectedEnvironment}; recebido: ${normalizedEnvironment || 'não informado'}.`
    );
  }

  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('Chave Asaas ausente. Integração bloqueada por segurança.');
  }

  const expectedKeyPrefix =
    expectedEnvironment === 'sandbox'
      ? '$aact_hmlg_'
      : '$aact_prod_';

  if (!apiKey.startsWith(expectedKeyPrefix)) {
    throw new Error(
      `Chave Asaas incompatível com o ambiente ${expectedEnvironment}.`
    );
  }

  return {
    projectId,
    asaasEnvironment: expectedEnvironment
  };
}

module.exports = {
  PROJECT_ENVIRONMENTS,
  getFirebaseProjectId,
  isLocalEmulatorHost,
  resolveFinancialRuntimeEnvironment,
  assertAsaasEnvironment
};
