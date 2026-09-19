'use strict';

const {
  assertAsaasEnvironment
} = require('../config/environment');
const {
  createAsaasCheckoutAdapter
} = require('./asaas-checkout-adapter');
const {
  createAsaasReversalAdapter
} = require('./asaas-reversal-adapter');
const {
  createFakeAsaasCheckoutProvider
} = require('./fake-asaas-checkout-provider');

const ASAAS_SANDBOX_BASE_URL = 'https://api-sandbox.asaas.com/v3';

function fakeRequested(env = process.env) {
  return String(env.BJJ_EXAMS_CHECKOUT_PROVIDER_FAKE || '')
    .trim()
    .toLowerCase() === 'true';
}

function createAsaasCheckoutProviderFactory(options = {}) {
  const {
    environment,
    projectId,
    env = process.env,
    db = null,
    httpLibrary,
    apiKeyResolver
  } = options;

  const canonicalEnvironment = String(environment || '').trim().toLowerCase();

  return function providerFactory() {
    if (fakeRequested(env)) {
      return createFakeAsaasCheckoutProvider({
        projectId,
        env,
        db
      });
    }

    if (canonicalEnvironment !== 'sandbox') {
      throw new Error(
        'Checkout real do Marco 5.3/5.5 é sandbox-only; produção bloqueada.'
      );
    }

    if (!httpLibrary || typeof httpLibrary.create !== 'function') {
      throw new TypeError('Provider Asaas exige biblioteca HTTP com create().');
    }
    if (typeof apiKeyResolver !== 'function') {
      throw new TypeError('Provider Asaas exige apiKeyResolver().');
    }

    const apiKey = apiKeyResolver();
    assertAsaasEnvironment({
      projectId,
      asaasEnv: canonicalEnvironment,
      apiKey
    });

    const http = httpLibrary.create({
      baseURL: ASAAS_SANDBOX_BASE_URL,
      timeout: 20000,
      headers: {
        access_token: apiKey,
        'Content-Type': 'application/json',
        'User-Agent': 'BJJ-Exams/1.2'
      }
    });

    return {
      ...createAsaasCheckoutAdapter({
        http,
        environment: canonicalEnvironment
      }),
      ...createAsaasReversalAdapter({
        http,
        environment: canonicalEnvironment
      })
    };
  };
}

module.exports = {
  ASAAS_SANDBOX_BASE_URL,
  fakeRequested,
  createAsaasCheckoutProviderFactory
};
