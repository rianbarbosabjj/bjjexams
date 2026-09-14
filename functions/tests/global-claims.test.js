'use strict';

const assert = require('assert');

const {
  GLOBAL_ROLE_CLAIMS,
  SYNCHRONIZED_GLOBAL_CLAIMS,
  deriveGlobalClaims,
  mergeSynchronizedGlobalClaims,
  hasGlobalRole
} = require('../src/auth/global-claims');

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS | ${name}`);
}

test('Super Admin recebe apenas super_admin', () => {
  assert.deepStrictEqual(
    deriveGlobalClaims({
      hasSuperAdminMarker: true,
      hasAdminMarker: true,
      userType: 'admin'
    }),
    { super_admin: true }
  );
});

test('Marker admins gera platform_admin', () => {
  assert.deepStrictEqual(
    deriveGlobalClaims({
      hasAdminMarker: true
    }),
    { platform_admin: true }
  );
});

test('usuarios.tipo_usuario admin gera platform_admin', () => {
  assert.deepStrictEqual(
    deriveGlobalClaims({
      userType: 'admin'
    }),
    { platform_admin: true }
  );
});

test('administrador legado gera platform_admin', () => {
  assert.deepStrictEqual(
    deriveGlobalClaims({
      userType: 'administrador'
    }),
    { platform_admin: true }
  );
});

test('Aluno nao recebe claim global', () => {
  assert.deepStrictEqual(
    deriveGlobalClaims({
      userType: 'aluno'
    }),
    {}
  );
});

test('Professor nao recebe claim global', () => {
  assert.deepStrictEqual(
    deriveGlobalClaims({
      userType: 'professor'
    }),
    {}
  );
});

test('Merge remove claims sincronizadas antigas', () => {
  assert.deepStrictEqual(
    mergeSynchronizedGlobalClaims(
      {
        super_admin: true,
        platform_admin: true
      },
      {
        platform_admin: true
      }
    ),
    {
      platform_admin: true
    }
  );
});

test('Merge preserva papeis globais ainda nao sincronizados', () => {
  assert.deepStrictEqual(
    mergeSynchronizedGlobalClaims(
      {
        finance_admin: true,
        content_admin: true,
        support_admin: true,
        external_claim: 'preservar'
      },
      {
        platform_admin: true
      }
    ),
    {
      finance_admin: true,
      content_admin: true,
      support_admin: true,
      external_claim: 'preservar',
      platform_admin: true
    }
  );
});

test('Sincronizador rejeita claim sem fonte autoritativa', () => {
  assert.throws(
    () =>
      mergeSynchronizedGlobalClaims(
        {},
        { finance_admin: true }
      ),
    /Unsupported synchronized global claim/
  );
});

test('Super Admin satisfaz qualquer papel global conhecido', () => {
  assert.strictEqual(
    hasGlobalRole(
      { super_admin: true },
      'finance_admin'
    ),
    true
  );

  assert.strictEqual(
    hasGlobalRole(
      { platform_admin: true },
      'finance_admin'
    ),
    false
  );
});

test('Listas de claims permanecem explicitas', () => {
  assert.deepStrictEqual(
    [...GLOBAL_ROLE_CLAIMS],
    [
      'super_admin',
      'platform_admin',
      'finance_admin',
      'content_admin',
      'support_admin'
    ]
  );

  assert.deepStrictEqual(
    [...SYNCHRONIZED_GLOBAL_CLAIMS],
    [
      'super_admin',
      'platform_admin'
    ]
  );
});

console.log('');
console.log(`RESULTADO_GLOBAL_CLAIMS=${passed}/11`);