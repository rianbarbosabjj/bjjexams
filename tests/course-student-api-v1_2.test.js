'use strict';

const assert = require('assert');
const api = require('../js/course-student-api-v1_2.js');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

function response(status, body, contentType = 'application/json') {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name || '').toLowerCase() === 'content-type'
          ? contentType
          : null;
      }
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    }
  };
}

test('host desconhecido falha seguro para staging', () => {
  assert.strictEqual(
    api.inferEnvironment({ hostname: 'preview.exemplo.invalid' }),
    'staging'
  );
  assert.ok(
    api.functionUrl('listarMeusCursosV12', { hostname: 'preview.exemplo.invalid' })
      .includes('bjj-exams-staging')
  );
});

test('hosts oficiais resolvem os ambientes corretos', () => {
  assert.strictEqual(
    api.inferEnvironment({ hostname: 'bjj-exams-staging.web.app' }),
    'staging'
  );
  assert.strictEqual(
    api.inferEnvironment({ hostname: 'bjj-exams.web.app' }),
    'production'
  );
  assert.ok(
    api.functionUrl('listarMeusCursosV12', { hostname: 'bjj-exams.web.app' })
      .includes('southamerica-east1-bjj-exams.cloudfunctions.net')
  );
});

test('producao privada fica bloqueada fora de host oficial', () => {
  assert.throws(
    () => api.functionUrl('concluirAulaCursoV12', {
      hostname: 'localhost',
      explicitEnvironment: 'production'
    }),
    /Produção bloqueada/
  );
});

test('cliente rejeita callable fora do contrato', async () => {
  assert.throws(
    () => api.functionUrl('funcaoQualquer', { hostname: 'localhost' }),
    /fora do contrato/
  );

  await assert.rejects(
    () => api.callPrivateCallable('funcaoQualquer', {}, {
      hostname: 'localhost',
      idToken: 'token-teste',
      fetchImpl: async () => response(200, { result: {} })
    }),
    /fora do contrato/
  );
});

test('chamada privada exige token antes de acessar rede', async () => {
  let fetchCalled = false;
  await assert.rejects(
    () => api.listMyCourses({
      hostname: 'localhost',
      fetchImpl: async () => {
        fetchCalled = true;
        return response(200, { result: { courses: [] } });
      }
    }),
    /Sessão autenticada obrigatória/
  );
  assert.strictEqual(fetchCalled, false);
});

test('listar meus cursos envia bearer token e envelope callable', async () => {
  let request = null;
  const courses = await api.listMyCourses({
    hostname: 'localhost',
    getIdToken: async () => 'firebase-id-token-test',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return response(200, {
        result: {
          courses: [{ course: { id: 'course-1', title: 'Curso 1' } }]
        }
      });
    }
  });

  assert.strictEqual(courses.length, 1);
  assert.ok(request.url.includes('bjj-exams-staging'));
  assert.ok(request.url.endsWith('/listarMeusCursosV12'));
  assert.strictEqual(
    request.options.headers.Authorization,
    'Bearer firebase-id-token-test'
  );
  assert.deepStrictEqual(JSON.parse(request.options.body), { data: {} });
});

test('wrappers enviam apenas courseId e lessonId necessarios', async () => {
  const requests = [];
  const options = {
    hostname: 'localhost',
    idToken: 'token-test',
    fetchImpl: async (url, requestOptions) => {
      requests.push({ url, body: JSON.parse(requestOptions.body) });
      return response(200, { result: { ok: true } });
    }
  };

  await api.getCourseStructure('course-1', options);
  await api.getLesson('course-1', 'lesson-1', options);
  await api.getProgress('course-1', options);
  await api.completeLesson('course-1', 'lesson-1', options);

  assert.deepStrictEqual(requests.map(item => item.body), [
    { data: { courseId: 'course-1' } },
    { data: { courseId: 'course-1', lessonId: 'lesson-1' } },
    { data: { courseId: 'course-1' } },
    { data: { courseId: 'course-1', lessonId: 'lesson-1' } }
  ]);
  assert.ok(requests[0].url.endsWith('/obterEstruturaConsumoCursoV12'));
  assert.ok(requests[1].url.endsWith('/obterAulaConsumoCursoV12'));
  assert.ok(requests[2].url.endsWith('/obterProgressoCursoV12'));
  assert.ok(requests[3].url.endsWith('/concluirAulaCursoV12'));
});

test('erro callable preserva status e domainCode sem expor corpo bruto', async () => {
  await assert.rejects(
    async () => {
      try {
        await api.getProgress('course-1', {
          hostname: 'localhost',
          idToken: 'token-test',
          fetchImpl: async () => response(403, {
            error: {
              status: 'PERMISSION_DENIED',
              message: 'Acesso negado.',
              details: { domainCode: 'COURSE_NOT_PUBLISHED' }
            }
          })
        });
      } catch (error) {
        assert.strictEqual(error.httpStatus, 403);
        assert.strictEqual(error.callableStatus, 'PERMISSION_DENIED');
        assert.strictEqual(error.domainCode, 'COURSE_NOT_PUBLISHED');
        assert.strictEqual(error.message, 'Acesso negado.');
        throw error;
      }
    },
    /Acesso negado/
  );
});

(async () => {
  let passed = 0;

  for (const item of cases) {
    try {
      await item.fn();
      passed += 1;
      console.log(`PASS | ${item.name}`);
    } catch (error) {
      console.error(`FAIL | ${item.name}`);
      console.error(error);
      process.exitCode = 1;
    }
  }

  console.log(`COURSE_STUDENT_API_V1_2=${passed}/${cases.length}`);
})();
