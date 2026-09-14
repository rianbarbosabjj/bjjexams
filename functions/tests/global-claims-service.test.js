'use strict';

const assert = require('assert');

const {
  createGlobalClaimsService
} = require('../src/auth/global-claims-service');

function fakeSnapshot(value) {
  return {
    exists: value !== undefined,
    data: () => value
  };
}

function makeDb({
  superAdmin,
  admin,
  user,
  failPath = null
} = {}) {
  const values = new Map([
    ['super_admins/user1', superAdmin],
    ['admins/user1', admin],
    ['usuarios/user1', user]
  ]);

  return {
    doc(path) {
      return {
        async get() {
          if (path === failPath) {
            throw new Error(`Firestore read failed: ${path}`);
          }

          return fakeSnapshot(values.get(path));
        }
      };
    }
  };
}

function makeAuth(initialClaims = {}) {
  const writes = [];

  return {
    writes,

    async getUser(uid) {
      return {
        uid,
        customClaims: initialClaims
      };
    },

    async setCustomUserClaims(uid, claims) {
      writes.push({
        uid,
        claims
      });
    }
  };
}

let passed = 0;

async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

async function main() {
  await test(
    'Super Admin sincroniza apenas super_admin e preserva outras claims',
    async () => {
      const db = makeDb({
        superAdmin: { ativo: true },
        admin: { ativo: true },
        user: { tipo_usuario: 'admin' }
      });

      const auth = makeAuth({
        platform_admin: true,
        finance_admin: true,
        external_claim: 'preservar'
      });

      const service = createGlobalClaimsService({
        db,
        auth
      });

      const result =
        await service.synchronizeUserGlobalClaims('user1');

      assert.strictEqual(result.updated, true);

      assert.deepStrictEqual(
        auth.writes[0],
        {
          uid: 'user1',
          claims: {
            finance_admin: true,
            external_claim: 'preservar',
            super_admin: true
          }
        }
      );
    }
  );

  await test(
    'Marker admins sincroniza platform_admin',
    async () => {
      const db = makeDb({
        admin: { ativo: true },
        user: { tipo_usuario: 'aluno' }
      });

      const auth = makeAuth({});

      const service = createGlobalClaimsService({
        db,
        auth
      });

      await service.synchronizeUserGlobalClaims('user1');

      assert.deepStrictEqual(
        auth.writes[0].claims,
        {
          platform_admin: true
        }
      );
    }
  );

  await test(
    'usuarios tipo admin sincroniza platform_admin sem marker',
    async () => {
      const db = makeDb({
        user: { tipo_usuario: 'admin' }
      });

      const auth = makeAuth({});

      const service = createGlobalClaimsService({
        db,
        auth
      });

      await service.synchronizeUserGlobalClaims('user1');

      assert.deepStrictEqual(
        auth.writes[0].claims,
        {
          platform_admin: true
        }
      );
    }
  );

  await test(
    'Usuario comum perde apenas claims sincronizadas obsoletas',
    async () => {
      const db = makeDb({
        user: { tipo_usuario: 'aluno' }
      });

      const auth = makeAuth({
        super_admin: true,
        platform_admin: true,
        finance_admin: true,
        support_admin: true,
        external_claim: {
          origem: 'outro-sistema'
        }
      });

      const service = createGlobalClaimsService({
        db,
        auth
      });

      await service.synchronizeUserGlobalClaims('user1');

      assert.deepStrictEqual(
        auth.writes[0].claims,
        {
          finance_admin: true,
          support_admin: true,
          external_claim: {
            origem: 'outro-sistema'
          }
        }
      );
    }
  );

  await test(
    'Sincronizacao idempotente nao grava quando claims ja estao corretas',
    async () => {
      const db = makeDb({
        admin: { ativo: true }
      });

      const auth = makeAuth({
        external_claim: 'ok',
        platform_admin: true
      });

      const service = createGlobalClaimsService({
        db,
        auth
      });

      const result =
        await service.synchronizeUserGlobalClaims('user1');

      assert.strictEqual(result.updated, false);
      assert.strictEqual(auth.writes.length, 0);
    }
  );

  await test(
    'Falha de leitura Firestore impede qualquer escrita no Auth',
    async () => {
      const db = makeDb({
        failPath: 'super_admins/user1'
      });

      const auth = makeAuth({
        platform_admin: true
      });

      const service = createGlobalClaimsService({
        db,
        auth
      });

      await assert.rejects(
        () =>
          service.synchronizeUserGlobalClaims('user1'),
        /Firestore read failed/
      );

      assert.strictEqual(auth.writes.length, 0);
    }
  );

  await test(
    'Resolve fontes autoritativas sem escrever claims',
    async () => {
      const db = makeDb({
        admin: { ativo: true },
        user: {
          papel_principal: 'aluno'
        }
      });

      const auth = makeAuth({});

      const service = createGlobalClaimsService({
        db,
        auth
      });

      const sources =
        await service.resolveAuthoritativeSources('user1');

      assert.deepStrictEqual(
        sources,
        {
          hasSuperAdminMarker: false,
          hasAdminMarker: true,
          userType: 'aluno'
        }
      );

      assert.strictEqual(auth.writes.length, 0);
    }
  );

  await test(
    'UID invalido e rejeitado antes da sincronizacao',
    async () => {
      const service = createGlobalClaimsService({
        db: makeDb(),
        auth: makeAuth({})
      });

      await assert.rejects(
        () =>
          service.synchronizeUserGlobalClaims(''),
        /valid uid/
      );
    }
  );

  console.log('');
  console.log(
    `RESULTADO_GLOBAL_CLAIMS_SERVICE=${passed}/8`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});