'use strict';

const assert =
  require('node:assert/strict');

const {
  initializeApp,
  deleteApp
} = require(
  'firebase-admin/app'
);

const {
  getFirestore
} = require(
  'firebase-admin/firestore'
);

function assertLocal(
  name,
  value
) {
  if (
    !value ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(
      value
    )
  ) {
    throw new Error(
      `${name} nao e local: ${value || '<EMPTY>'}`
    );
  }
}

assertLocal(
  'FIRESTORE_EMULATOR_HOST',
  process.env.FIRESTORE_EMULATOR_HOST
);

const projectId =
  'demo-bjj-exams-certificate-rules';

const app =
  initializeApp(
    { projectId },
    `certificate-rules-${process.pid}-${Date.now()}`
  );

const db =
  getFirestore(app);

const host =
  process.env.FIRESTORE_EMULATOR_HOST;

const base =
  `http://${host}/v1/projects/${projectId}/databases/(default)/documents`;

let passed = 0;

async function test(
  name,
  fn
) {
  await fn();

  passed += 1;

  console.log(
    `PASS | ${name}`
  );
}

async function request(
  relativePath,
  options = {}
) {
  return fetch(
    `${base}/${relativePath}`,
    {
      redirect:
        'manual',
      ...options
    }
  );
}

async function cleanup() {
  try {
    const canonical =
      await db.collection(
        'exam_certificates'
      ).get();

    for (
      const doc of canonical.docs
    ) {
      await doc.ref.delete();
    }

    const legacy =
      await db.collection(
        'certificados'
      ).get();

    for (
      const doc of legacy.docs
    ) {
      await doc.ref.delete();
    }
  } finally {
    await deleteApp(app)
      .catch(() => {});
  }
}

async function main() {
  try {
    await db.doc(
      'exam_certificates/canonical_rules_test'
    ).set({
      status:
        'valid',
      sentinel:
        true
    });

    await db.doc(
      'certificados/legacy_rules_test'
    ).set({
      aluno_nome:
        'Aluno Legado',
      tipo:
        'curso'
    });

    await test(
      'cliente anonimo nao faz get direto no certificado canonico',
      async () => {
        const response =
          await request(
            'exam_certificates/canonical_rules_test'
          );

        assert.equal(
          response.status,
          403
        );
      }
    );

    await test(
      'cliente anonimo nao lista certificados canonicos',
      async () => {
        const response =
          await request(
            'exam_certificates?pageSize=10'
          );

        assert.equal(
          response.status,
          403
        );
      }
    );

    await test(
      'cliente anonimo nao cria certificado canonico',
      async () => {
        const response =
          await request(
            'exam_certificates/direct_write_test',
            {
              method:
                'PATCH',
              headers: {
                'content-type':
                  'application/json'
              },
              body:
                JSON.stringify({
                  fields: {
                    status: {
                      stringValue:
                        'valid'
                    }
                  }
                })
            }
          );

        assert.equal(
          response.status,
          403
        );
      }
    );

    await test(
      'cliente anonimo nao apaga certificado canonico',
      async () => {
        const response =
          await request(
            'exam_certificates/canonical_rules_test',
            {
              method:
                'DELETE'
            }
          );

        assert.equal(
          response.status,
          403
        );
      }
    );

    await test(
      'get publico legado por id continua compativel',
      async () => {
        const response =
          await request(
            'certificados/legacy_rules_test'
          );

        assert.equal(
          response.status,
          200
        );
      }
    );

    console.log(
      `EXAM_CERTIFICATE_RULES_EMULATOR_V1_2=${passed}/5`
    );

    if (passed !== 5) {
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

main().catch(
  async error => {
    console.error(error);
    process.exitCode = 1;

    try {
      await cleanup();
    } catch (_) {}
  }
);