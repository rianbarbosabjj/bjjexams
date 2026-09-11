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

  if (expectedEnvironment === 'sandbox' && apiKey.includes('_prod_')) {
    throw new Error('Chave Asaas de produção bloqueada no ambiente de staging.');
  }

  if (expectedEnvironment === 'production' && apiKey.includes('_hmlg_')) {
    throw new Error('Chave Asaas Sandbox bloqueada no ambiente de produção.');
  }

  return {
    projectId,
    asaasEnvironment: expectedEnvironment
  };
}

module.exports = {
  PROJECT_ENVIRONMENTS,
  getFirebaseProjectId,
  assertAsaasEnvironment
};
