'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  FinancialAdminServiceError,
  createFinancialAdminService
} = require('../src/finance/financial-admin-service');

const {
  financialRecipientAccountId,
  productFinancialRuleId
} = require('../src/finance/financial-admin-domain');

let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS | ${name}`);
  } catch (error) {
    console.error(`FAIL | ${name}`);
    console.error(error.stack || error);
    process.exitCode = 1;
  }
}

function clone(value) {
  return value === undefined
    ? undefined
    : structuredClone(value);
}

function createFakeDb(seed = {}) {
  const store = new Map(
    Object.entries(seed).map(
      ([key, value]) => [key, clone(value)]
    )
  );

  const writes = [];
  let generated = 0;
  let transactionRuns = 0;

  function ref(pathValue) {
    const parts = pathValue.split('/');

    return {
      path: pathValue,
      id: parts[parts.length - 1],
      async get() {
        const value = store.get(pathValue);

        return {
          id: parts[parts.length - 1],
          exists: value !== undefined,
          data: () => clone(value)
        };
      }
    };
  }

  const db = {
    doc(pathValue) {
      return ref(pathValue);
    },

    collection(name) {
      return {
        doc(id = null) {
          let finalId = id;

          if (!finalId) {
            do {
              finalId = `auto-${++generated}`;
            } while (
              store.has(`${name}/${finalId}`)
            );
          }

          return ref(`${name}/${finalId}`);
        }
      };
    },

    async runTransaction(callback) {
      transactionRuns += 1;
      const pending = [];

      const tx = {
        async get(documentRef) {
          const value = store.get(documentRef.path);

          return {
            id: documentRef.id,
            exists: value !== undefined,
            data: () => clone(value)
          };
        },

        create(documentRef, data) {
          if (
            store.has(documentRef.path) ||
            pending.some(
              item => item.path === documentRef.path
            )
          ) {
            throw new Error(
              `Document already exists: ${documentRef.path}`
            );
          }

          pending.push({
            type: 'create',
            path: documentRef.path,
            data: clone(data)
          });
        },

        set(documentRef, data) {
          pending.push({
            type: 'set',
            path: documentRef.path,
            data: clone(data)
          });
        },

        update(documentRef, data) {
          if (!store.has(documentRef.path)) {
            throw new Error(
              `Document does not exist: ${documentRef.path}`
            );
          }

          pending.push({
            type: 'update',
            path: documentRef.path,
            data: clone(data)
          });
        }
      };

      const result = await callback(tx);

      for (const item of pending) {
        if (item.type === 'update') {
          store.set(
            item.path,
            {
              ...(store.get(item.path) || {}),
              ...clone(item.data)
            }
          );
        } else {
          store.set(
            item.path,
            clone(item.data)
          );
        }

        writes.push(clone(item));
      }

      return result;
    }
  };

  return {
    db,
    store,
    writes,
    get transactionRuns() {
      return transactionRuns;
    }
  };
}

const now1 = new Date('2026-09-17T22:00:00.000Z');
const now2 = new Date('2026-09-17T22:05:00.000Z');

function claims(role = 'platform_admin') {
  return {
    [role]: true
  };
}

function paidCourse(overrides = {}) {
  return {
    title: 'Curso pago',
    status: 'published',
    isPaid: true,
    priceCents: 10000,
    currency: 'BRL',
    ownerType: 'user',
    ownerId: 'owner-1',
    financialRuleId: null,
    updatedAt: now1,
    ...overrides
  };
}

function serviceFixture({
  seed = {},
  now = now1,
  environment = 'sandbox'
} = {}) {
  const fake = createFakeDb(seed);
  const service = createFinancialAdminService({
    db: fake.db,
    environment,
    clock: () => now
  });

  return {
    ...fake,
    service
  };
}

function adminInput(data = {}, role = 'platform_admin') {
  return {
    actorId: 'admin-1',
    claims: claims(role),
    data
  };
}

(async () => {
  await test(
    'serviço exige Firestore e environment válidos',
    async () => {
      assert.throws(
        () => createFinancialAdminService({
          environment: 'sandbox'
        }),
        /Firestore válido/
      );

      assert.throws(
        () => createFinancialAdminService({
          db: createFakeDb().db,
          environment: 'unknown'
        }),
        /sandbox ou production/
      );
    }
  );

  await test(
    'RBAC interno aceita super_admin e platform_admin',
    async () => {
      for (const role of [
        'super_admin',
        'platform_admin'
      ]) {
        const fixture = serviceFixture();

        const result =
          await fixture.service.getDefaultConfiguration({
            actorId: 'admin-1',
            claims: claims(role)
          });

        assert.equal(result.persisted, false);
      }
    }
  );

  await test(
    'RBAC interno bloqueia finance_admin isolado',
    async () => {
      const fixture = serviceFixture();

      await assert.rejects(
        fixture.service.getDefaultConfiguration({
          actorId: 'finance-1',
          claims: claims('finance_admin')
        }),
        error =>
          error instanceof FinancialAdminServiceError &&
          error.code ===
            'FINANCIAL_ADMIN_PERMISSION_REQUIRED'
      );
    }
  );

  await test(
    'consulta default ausente retorna 10 por cento sem fingir persistência',
    async () => {
      const fixture = serviceFixture();

      const result =
        await fixture.service.getDefaultConfiguration({
          actorId: 'admin-1',
          claims: claims()
        });

      assert.equal(result.persisted, false);
      assert.equal(result.active, false);
      assert.equal(
        result.defaultPlatformFeeBps,
        1000
      );
      assert.equal(result.rule, null);
    }
  );

  await test(
    'inicializa regra default e audit atomicamente',
    async () => {
      const fixture = serviceFixture();

      const result =
        await fixture.service.updateDefaultRule(
          adminInput({
            platformFeeBps: 1000
          })
        );

      assert.equal(result.changed, true);
      assert.equal(result.created, true);
      assert.equal(result.rule.version, 1);
      assert.equal(
        fixture.store.has(
          'financial_rules/platform-default'
        ),
        true
      );

      const audit = fixture.writes.find(
        item => item.path.startsWith(
          'audit_logs/'
        )
      );

      assert.ok(audit);
      assert.equal(
        audit.data.action,
        'financial.default_rule.updated'
      );
    }
  );

  await test(
    'default idêntico não grava nem audita',
    async () => {
      const initial = serviceFixture({
        now: now1
      });

      await initial.service.updateDefaultRule(
        adminInput({
          platformFeeBps: 1000
        })
      );

      const snapshot = Object.fromEntries(
        initial.store.entries()
      );

      const fixture = serviceFixture({
        seed: snapshot,
        now: now2
      });

      const result =
        await fixture.service.updateDefaultRule(
          adminInput({
            platformFeeBps: 1000
          })
        );

      assert.equal(result.changed, false);
      assert.equal(fixture.writes.length, 0);
      assert.equal(result.rule.version, 1);
    }
  );

  await test(
    'mudança do default incrementa version e audita',
    async () => {
      const first = serviceFixture({
        now: now1
      });

      await first.service.updateDefaultRule(
        adminInput({
          platformFeeBps: 1000
        })
      );

      const fixture = serviceFixture({
        seed: Object.fromEntries(
          first.store.entries()
        ),
        now: now2
      });

      const result =
        await fixture.service.updateDefaultRule(
          adminInput({
            platformFeeBps: 1250
          })
        );

      assert.equal(result.rule.version, 2);
      assert.equal(
        result.rule.platformFeeBps,
        1250
      );
      assert.equal(fixture.writes.length, 2);
    }
  );

  await test(
    'default rejeita campos extras',
    async () => {
      const fixture = serviceFixture();

      await assert.rejects(
        fixture.service.updateDefaultRule(
          adminInput({
            platformFeeBps: 1000,
            recipientMode: 'explicit'
          })
        ),
        error =>
          error instanceof FinancialAdminServiceError &&
          error.code ===
            'FINANCIAL_ADMIN_FIELDS_NOT_ALLOWED'
      );

      assert.equal(fixture.transactionRuns, 0);
    }
  );

  await test(
    'conta user exige usuario canônico existente',
    async () => {
      const fixture = serviceFixture();

      await assert.rejects(
        fixture.service.configureRecipientAccount(
          adminInput({
            recipientType: 'user',
            recipientId: 'user-1',
            walletId: 'wallet-1234',
            status: 'ready'
          })
        ),
        error =>
          error instanceof FinancialAdminServiceError &&
          error.code ===
            'RECIPIENT_IDENTITY_NOT_FOUND'
      );

      assert.equal(fixture.writes.length, 0);
    }
  );

  await test(
    'conta organization usa organizacoes e não equipes legado',
    async () => {
      const fixture = serviceFixture({
        seed: {
          'organizacoes/org-1': {
            nome: 'Academia canônica'
          }
        }
      });

      const result =
        await fixture.service.configureRecipientAccount(
          adminInput({
            recipientType: 'organization',
            recipientId: 'org-1',
            walletId: 'wallet-org-5678',
            status: 'ready'
          })
        );

      assert.equal(result.created, true);
      assert.equal(result.account.status, 'ready');
      assert.equal(
        result.account.walletMasked,
        '••••5678'
      );
      assert.equal(
        result.account.walletId,
        undefined
      );
    }
  );

  await test(
    'conta idêntica é idempotente sem audit',
    async () => {
      const seed = {
        'usuarios/user-1': {
          nome: 'Recebedor'
        }
      };

      const first = serviceFixture({
        seed,
        now: now1
      });

      await first.service.configureRecipientAccount(
        adminInput({
          recipientType: 'user',
          recipientId: 'user-1',
          walletId: 'wallet-1234',
          status: 'ready'
        })
      );

      const fixture = serviceFixture({
        seed: Object.fromEntries(
          first.store.entries()
        ),
        now: now2
      });

      const result =
        await fixture.service.configureRecipientAccount(
          adminInput({
            recipientType: 'user',
            recipientId: 'user-1',
            walletId: 'wallet-1234',
            status: 'ready'
          })
        );

      assert.equal(result.changed, false);
      assert.equal(result.account.version, 1);
      assert.equal(fixture.writes.length, 0);
    }
  );

  await test(
    'mudança de wallet incrementa version e audit não expõe wallet completa',
    async () => {
      const seed = {
        'usuarios/user-1': {
          nome: 'Recebedor'
        }
      };

      const first = serviceFixture({
        seed,
        now: now1
      });

      await first.service.configureRecipientAccount(
        adminInput({
          recipientType: 'user',
          recipientId: 'user-1',
          walletId: 'wallet-old-1111',
          status: 'ready'
        })
      );

      const fixture = serviceFixture({
        seed: Object.fromEntries(
          first.store.entries()
        ),
        now: now2
      });

      const result =
        await fixture.service.configureRecipientAccount(
          adminInput({
            recipientType: 'user',
            recipientId: 'user-1',
            walletId: 'wallet-new-9999',
            status: 'ready'
          })
        );

      assert.equal(result.account.version, 2);

      const audit = fixture.writes.find(
        item => item.path.startsWith(
          'audit_logs/'
        )
      );

      assert.ok(audit);
      assert.equal(
        JSON.stringify(audit.data).includes(
          'wallet-new-9999'
        ),
        false
      );
      assert.equal(
        audit.data.after.walletMasked,
        '••••9999'
      );
    }
  );

  await test(
    'getRecipientAccount respeita ambiente isolado',
    async () => {
      const accountId =
        financialRecipientAccountId({
          environment: 'sandbox',
          recipientType: 'user',
          recipientId: 'user-1'
        });

      const fixture = serviceFixture({
        seed: {
          [`financial_recipient_accounts/${accountId}`]:
            {
              recipientType: 'user',
              recipientId: 'user-1',
              provider: 'asaas',
              environment: 'sandbox',
              walletId: 'wallet-1234',
              status: 'ready',
              version: 1,
              createdBy: 'admin-1',
              updatedBy: 'admin-1',
              createdAt: now1,
              updatedAt: now1
            }
        }
      });

      const result =
        await fixture.service.getRecipientAccount({
          actorId: 'admin-1',
          claims: claims(),
          recipientType: 'user',
          recipientId: 'user-1'
        });

      assert.equal(result.readiness.ready, true);
      assert.equal(
        result.account.walletMasked,
        '••••1234'
      );
    }
  );

  await test(
    'override rejeita curso inexistente sem escrita',
    async () => {
      const fixture = serviceFixture();

      await assert.rejects(
        fixture.service.saveCourseRule(
          adminInput({
            courseId: 'course-1',
            status: 'active',
            platformFeeBps: 1000,
            recipientMode: 'product_owner',
            recipientShares: []
          })
        ),
        error =>
          error instanceof FinancialAdminServiceError &&
          error.code === 'COURSE_NOT_FOUND'
      );

      assert.equal(fixture.writes.length, 0);
    }
  );

  await test(
    'override product_owner cria regra, liga curso e audita atomicamente',
    async () => {
      const fixture = serviceFixture({
        seed: {
          'courses/course-1':
            paidCourse()
        }
      });

      const result =
        await fixture.service.saveCourseRule(
          adminInput({
            courseId: 'course-1',
            status: 'active',
            platformFeeBps: 1200,
            recipientMode: 'product_owner',
            recipientShares: []
          })
        );

      const ruleId =
        productFinancialRuleId({
          productType: 'course',
          productId: 'course-1'
        });

      assert.equal(result.changed, true);
      assert.equal(result.created, true);
      assert.equal(
        fixture.store.get(
          'courses/course-1'
        ).financialRuleId,
        ruleId
      );
      assert.equal(
        fixture.store.has(
          `financial_rules/${ruleId}`
        ),
        true
      );

      const audit = fixture.writes.find(
        item => item.path.startsWith(
          'audit_logs/'
        )
      );

      assert.ok(audit);
      assert.equal(
        audit.data.action,
        'financial.course_rule.created'
      );
    }
  );

  await test(
    'override explicit exige identidade e conta ready',
    async () => {
      const input = adminInput({
        courseId: 'course-1',
        status: 'active',
        platformFeeBps: 1000,
        recipientMode: 'explicit',
        recipientShares: [
          {
            recipientType: 'user',
            recipientId: 'user-1',
            shareBps: 10000
          }
        ]
      });

      const missingIdentity = serviceFixture({
        seed: {
          'courses/course-1':
            paidCourse()
        }
      });

      await assert.rejects(
        missingIdentity.service.saveCourseRule(
          input
        ),
        error =>
          error instanceof FinancialAdminServiceError &&
          error.code ===
            'RECIPIENT_IDENTITY_NOT_FOUND'
      );

      const accountId =
        financialRecipientAccountId({
          environment: 'sandbox',
          recipientType: 'user',
          recipientId: 'user-1'
        });

      const blocked = serviceFixture({
        seed: {
          'courses/course-1':
            paidCourse(),
          'usuarios/user-1': {
            nome: 'Recebedor'
          },
          [`financial_recipient_accounts/${accountId}`]:
            {
              recipientType: 'user',
              recipientId: 'user-1',
              provider: 'asaas',
              environment: 'sandbox',
              walletId: 'wallet-1234',
              status: 'blocked',
              version: 1,
              createdBy: 'admin-1',
              updatedBy: 'admin-1',
              createdAt: now1,
              updatedAt: now1
            }
        }
      });

      await assert.rejects(
        blocked.service.saveCourseRule(input),
        /não está pronto/
      );
    }
  );

  await test(
    'override explicit ativo com conta ready é aceito',
    async () => {
      const accountId =
        financialRecipientAccountId({
          environment: 'sandbox',
          recipientType: 'user',
          recipientId: 'user-1'
        });

      const fixture = serviceFixture({
        seed: {
          'courses/course-1':
            paidCourse(),
          'usuarios/user-1': {
            nome: 'Recebedor'
          },
          [`financial_recipient_accounts/${accountId}`]:
            {
              recipientType: 'user',
              recipientId: 'user-1',
              provider: 'asaas',
              environment: 'sandbox',
              walletId: 'wallet-1234',
              status: 'ready',
              version: 1,
              createdBy: 'admin-1',
              updatedBy: 'admin-1',
              createdAt: now1,
              updatedAt: now1
            }
        }
      });

      const result =
        await fixture.service.saveCourseRule(
          adminInput({
            courseId: 'course-1',
            status: 'active',
            platformFeeBps: 1000,
            recipientMode: 'explicit',
            recipientShares: [
              {
                recipientType: 'user',
                recipientId: 'user-1',
                shareBps: 10000
              }
            ]
          })
        );

      assert.equal(
        result.rule.recipientMode,
        'explicit'
      );
    }
  );

  await test(
    'override idêntico não grava nem audita',
    async () => {
      const first = serviceFixture({
        seed: {
          'courses/course-1':
            paidCourse()
        },
        now: now1
      });

      await first.service.saveCourseRule(
        adminInput({
          courseId: 'course-1',
          status: 'active',
          platformFeeBps: 1200,
          recipientMode: 'product_owner',
          recipientShares: []
        })
      );

      const fixture = serviceFixture({
        seed: Object.fromEntries(
          first.store.entries()
        ),
        now: now2
      });

      const result =
        await fixture.service.saveCourseRule(
          adminInput({
            courseId: 'course-1',
            status: 'active',
            platformFeeBps: 1200,
            recipientMode: 'product_owner',
            recipientShares: []
          })
        );

      assert.equal(result.changed, false);
      assert.equal(fixture.writes.length, 0);
    }
  );

  await test(
    'vínculo inconsistente é reparado sem incrementar versão da regra',
    async () => {
      const first = serviceFixture({
        seed: {
          'courses/course-1':
            paidCourse()
        },
        now: now1
      });

      const created =
        await first.service.saveCourseRule(
          adminInput({
            courseId: 'course-1',
            status: 'active',
            platformFeeBps: 1200,
            recipientMode: 'product_owner',
            recipientShares: []
          })
        );

      const seed = Object.fromEntries(
        first.store.entries()
      );

      seed['courses/course-1'] = {
        ...seed['courses/course-1'],
        financialRuleId: null
      };

      const fixture = serviceFixture({
        seed,
        now: now2
      });

      const repaired =
        await fixture.service.saveCourseRule(
          adminInput({
            courseId: 'course-1',
            status: 'active',
            platformFeeBps: 1200,
            recipientMode: 'product_owner',
            recipientShares: []
          })
        );

      assert.equal(repaired.linkRepaired, true);
      assert.equal(
        repaired.rule.version,
        created.rule.version
      );

      const ruleWrites = fixture.writes.filter(
        item => item.path.startsWith(
          'financial_rules/'
        )
      );

      assert.equal(ruleWrites.length, 0);
    }
  );

  await test(
    'inativação preserva regra e limpa vínculo do curso',
    async () => {
      const first = serviceFixture({
        seed: {
          'courses/course-1':
            paidCourse()
        },
        now: now1
      });

      await first.service.saveCourseRule(
        adminInput({
          courseId: 'course-1',
          status: 'active',
          platformFeeBps: 1200,
          recipientMode: 'product_owner',
          recipientShares: []
        })
      );

      const fixture = serviceFixture({
        seed: Object.fromEntries(
          first.store.entries()
        ),
        now: now2
      });

      const result =
        await fixture.service.saveCourseRule(
          adminInput({
            courseId: 'course-1',
            status: 'inactive',
            platformFeeBps: 1200,
            recipientMode: 'product_owner',
            recipientShares: []
          })
        );

      assert.equal(
        result.courseFinancialRuleId,
        null
      );
      assert.equal(
        fixture.store.get(
          'courses/course-1'
        ).financialRuleId,
        null
      );
      assert.equal(result.rule.version, 2);
    }
  );

  await test(
    'consulta de override retorna readiness sanitizada',
    async () => {
      const accountId =
        financialRecipientAccountId({
          environment: 'sandbox',
          recipientType: 'user',
          recipientId: 'user-1'
        });

      const ruleId =
        productFinancialRuleId({
          productType: 'course',
          productId: 'course-1'
        });

      const fixture = serviceFixture({
        seed: {
          'courses/course-1': paidCourse({
            financialRuleId: ruleId
          }),
          [`financial_rules/${ruleId}`]: {
            id: ruleId,
            name:
              'Override financeiro do curso course-1',
            status: 'active',
            scope: 'product_override',
            productType: 'course',
            productId: 'course-1',
            platformFeeBps: 1000,
            recipientMode: 'explicit',
            recipientShares: [
              {
                recipientType: 'user',
                recipientId: 'user-1',
                shareBps: 10000
              }
            ],
            version: 1,
            createdBy: 'admin-1',
            updatedBy: 'admin-1',
            createdAt: now1,
            updatedAt: now1
          },
          [`financial_recipient_accounts/${accountId}`]:
            {
              recipientType: 'user',
              recipientId: 'user-1',
              provider: 'asaas',
              environment: 'sandbox',
              walletId: 'wallet-secret-4321',
              status: 'ready',
              version: 1,
              createdBy: 'admin-1',
              updatedBy: 'admin-1',
              createdAt: now1,
              updatedAt: now1
            }
        }
      });

      const result =
        await fixture.service.getCourseRule({
          actorId: 'admin-1',
          claims: claims(),
          courseId: 'course-1'
        });

      assert.equal(
        result.recipientReadiness[0].ready,
        true
      );
      assert.equal(
        JSON.stringify(result).includes(
          'wallet-secret-4321'
        ),
        false
      );
    }
  );

  await test(
    'serviço não importa Asaas helper, secrets nem legado financeiro',
    async () => {
      const source = fs.readFileSync(
        path.join(
          __dirname,
          '../src/finance/financial-admin-service.js'
        ),
        'utf8'
      );

      for (const forbidden of [
        'asaas-helpers',
        'defineSecret',
        'ASAAS_API_KEY',
        "doc('equipes/",
        'config_financeira',
        'percentual_professor',
        'asaas_wallet_id',
        "collection('pedidos')",
        "collection('matriculas')"
      ]) {
        assert.equal(
          source.includes(forbidden),
          false,
          `Dependência proibida: ${forbidden}`
        );
      }
    }
  );

  console.log(
    `FINANCIAL_ADMIN_SERVICE_V1_2=${passed}/22`
  );

  if (passed !== 22) {
    process.exitCode = 1;
  }
})();
