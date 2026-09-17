'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI_PATH = path.join(ROOT, 'js', 'course-student-ui-v1_2.js');
const TEST_PATH = path.join(ROOT, 'tests', 'course-student-ui-v1_2.test.js');

function fail(message) {
  throw new Error(`4B.4 robustness patch bloqueado: ${message}`);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    fail(`${label}: esperado exatamente 1 marcador, encontrado ${count}.`);
  }
  return source.replace(before, after);
}

function patchUi(source) {
  source = replaceOnce(
    source,
    '      const status = String(error?.callableStatus || "").toUpperCase();',
    '      const status = String(error?.callableStatus || "").toUpperCase().replace(/-/g, "_");',
    'normalização callableStatus'
  );

  const textNodeBlock = `    function textNode(document, tag, text, className) {\n      const node = document.createElement(tag);\n      node.textContent = text == null ? "" : String(text);\n      if (className) node.className = className;\n      return node;\n    }`;

  const textNodeWithAsyncBinder = `${textNodeBlock}\n\n    function bindAsyncClick(node, action) {\n      node.addEventListener("click", () => {\n        Promise.resolve()\n          .then(action)\n          .catch(error => {\n            if (root?.console?.error) {\n              root.console.error(\n                "BJJ Exams: ação de curso não concluída.",\n                normalizeError(error)\n              );\n            }\n          });\n      });\n    }`;

  source = replaceOnce(
    source,
    textNodeBlock,
    textNodeWithAsyncBinder,
    'binder assíncrono'
  );

  const replacements = [
    [
      '          button.addEventListener("click", action);',
      '          bindAsyncClick(button, action);',
      'ação de retry'
    ],
    [
      '            button.addEventListener("click", () => openCourse(view.courseId));',
      '            bindAsyncClick(button, () => openCourse(view.courseId));',
      'abrir curso'
    ],
    [
      '        prev.addEventListener("click", () => navigateLesson(-1));',
      '        bindAsyncClick(prev, () => navigateLesson(-1));',
      'aula anterior'
    ],
    [
      '        complete.addEventListener("click", completeCurrentLesson);',
      '        bindAsyncClick(complete, completeCurrentLesson);',
      'concluir aula'
    ],
    [
      '        next.addEventListener("click", () => navigateLesson(1));',
      '        bindAsyncClick(next, () => navigateLesson(1));',
      'próxima aula'
    ],
    [
      '            button.addEventListener("click", () => selectLesson(lesson.id));',
      '            bindAsyncClick(button, () => selectLesson(lesson.id));',
      'selecionar aula'
    ]
  ];

  for (const [before, after, label] of replacements) {
    source = replaceOnce(source, before, after, label);
  }

  return source;
}

function patchTest(source) {
  const beforeErrorTest = `test('erros de autenticacao e acesso viram estados explicitos', () => {\n  assert.strictEqual(ui.normalizeError({ httpStatus: 401 }).kind, 'auth');\n  assert.strictEqual(ui.normalizeError({ callableStatus: 'PERMISSION_DENIED' }).kind, 'access');\n  assert.strictEqual(ui.normalizeError({ httpStatus: 500 }).kind, 'network');\n});`;

  const afterErrorTest = `test('erros de autenticacao e acesso viram estados explicitos', () => {\n  assert.strictEqual(ui.normalizeError({ httpStatus: 401 }).kind, 'auth');\n  assert.strictEqual(ui.normalizeError({ callableStatus: 'PERMISSION_DENIED' }).kind, 'access');\n  assert.strictEqual(ui.normalizeError({ callableStatus: 'permission-denied' }).kind, 'access');\n  assert.strictEqual(ui.normalizeError({ httpStatus: 500 }).kind, 'network');\n});`;

  source = replaceOnce(
    source,
    beforeErrorTest,
    afterErrorTest,
    'teste permission-denied'
  );

  const marker = `test('conteudo textual remoto nao e injetado via innerHTML', () => {`;
  const asyncTest = `test('eventos assincronos da UI nao deixam rejeicoes sem tratamento', () => {\n  assert.ok(source.includes('function bindAsyncClick(node, action)'));\n  assert.ok(source.includes('bindAsyncClick(button, () => openCourse(view.courseId))'));\n  assert.ok(source.includes('bindAsyncClick(complete, completeCurrentLesson)'));\n  assert.ok(source.includes('bindAsyncClick(button, () => selectLesson(lesson.id))'));\n  assert.ok(source.includes('BJJ Exams: ação de curso não concluída.'));\n  assert.strictEqual(source.includes('button.addEventListener("click", () => openCourse(view.courseId))'), false);\n  assert.strictEqual(source.includes('complete.addEventListener("click", completeCurrentLesson)'), false);\n  assert.strictEqual(source.includes('button.addEventListener("click", () => selectLesson(lesson.id))'), false);\n});\n\n${marker}`;

  source = replaceOnce(
    source,
    marker,
    asyncTest,
    'teste de eventos assíncronos'
  );

  return source;
}

function main() {
  let ui = fs.readFileSync(UI_PATH, 'utf8');
  let test = fs.readFileSync(TEST_PATH, 'utf8');

  if (
    ui.includes('function bindAsyncClick(node, action)') &&
    ui.includes('.toUpperCase().replace(/-/g, "_")')
  ) {
    console.log('COURSE_STUDENT_UI_ROBUSTNESS_PATCH=ALREADY_APPLIED');
    return;
  }

  ui = patchUi(ui);
  test = patchTest(test);

  fs.writeFileSync(UI_PATH, ui, 'utf8');
  fs.writeFileSync(TEST_PATH, test, 'utf8');

  console.log('COURSE_STUDENT_UI_ROBUSTNESS_PATCH=OK');
  console.log('PERMISSION_DENIED_NORMALIZED=True');
  console.log('ASYNC_EVENT_REJECTIONS_HANDLED=True');
  console.log('BACKEND_CONTRACT_CHANGED=False');
  console.log('PRODUCTION_ACCESS=NOT_RUN');
}

main();
