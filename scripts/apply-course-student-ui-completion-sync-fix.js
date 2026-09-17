'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const UI_PATH = path.join(ROOT, 'js', 'course-student-ui-v1_2.js');
const TEST_PATH = path.join(ROOT, 'tests', 'course-student-ui-v1_2.test.js');

function fail(message) {
  throw new Error(`4B.4 completion-sync patch bloqueado: ${message}`);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) fail(`${label}: esperado exatamente 1 marcador, encontrado ${count}.`);
  return source.replace(before, after);
}

function patchUi(source) {
  const before = `          state.progress = result.progress || state.progress || {};
          renderProgress();
          renderLessonList();
          const lessonResponse = await api.getLesson(
            state.activeCourseId,
            state.activeLessonId,
            apiOptions()
          );
          renderLessonContent(lessonResponse.lesson || {});
          await loadMyCourses();
          return result;`;

  const after = `          const completedLessonIds = new Set(asArray(state.progress?.completedLessonIds));
          completedLessonIds.add(state.activeLessonId);
          state.progress = {
            ...(state.progress || {}),
            ...(result.progress || {}),
            completedLessonIds: [...completedLessonIds]
          };
          renderProgress();
          renderLessonList();

          if (button) {
            button.disabled = true;
            button.textContent = "Aula concluída";
          }

          try {
            const canonicalProgress = await api.getProgress(
              state.activeCourseId,
              apiOptions()
            );
            state.progress = canonicalProgress.progress || state.progress;
            renderProgress();
            renderLessonList();
            if (button) {
              const done = completedIds().has(state.activeLessonId);
              button.disabled = done;
              button.textContent = done ? "Aula concluída" : "Concluir aula";
            }
          } catch (_error) {
            // A conclusão já foi confirmada pelo backend. Mantém o estado seguro
            // derivado da resposta de concluirAulaCursoV12 se a reconciliação falhar.
          }

          loadMyCourses().catch(() => undefined);
          return result;`;

  return replaceOnce(source, before, after, 'sincronização pós-conclusão');
}

function patchTest(source) {
  const before = `test('UI conclui aula somente pelo cliente V12 e recarrega Meus Cursos', () => {
  assert.ok(source.includes('api.completeLesson('));
  assert.ok(source.includes('state.progress = result.progress'));
  assert.ok(source.includes('await loadMyCourses()'));
  assert.strictEqual(source.includes('arr.length / totalAulas'), false);
  assert.strictEqual(source.includes('Math.round((arr.length'), false);
});`;

  const after = `test('UI conclui aula pelo cliente V12 e preserva estado concluído', () => {
  assert.ok(source.includes('api.completeLesson('));
  assert.ok(source.includes('completedLessonIds.add(state.activeLessonId)'));
  assert.ok(source.includes('const canonicalProgress = await api.getProgress('));
  assert.ok(source.includes('button.textContent = "Aula concluída"'));
  assert.ok(source.includes('loadMyCourses().catch(() => undefined)'));
  const completionStart = source.indexOf('async function completeCurrentLesson()');
  const completionEnd = source.indexOf('async function navigateLesson', completionStart);
  const completionSection = source.slice(completionStart, completionEnd);
  assert.strictEqual(completionSection.includes('await api.getLesson('), false);
  assert.strictEqual(completionSection.includes('await loadMyCourses()'), false);
  assert.strictEqual(source.includes('arr.length / totalAulas'), false);
  assert.strictEqual(source.includes('Math.round((arr.length'), false);
});`;

  return replaceOnce(source, before, after, 'teste de conclusão V12');
}

function main() {
  const ui = fs.readFileSync(UI_PATH, 'utf8');
  const test = fs.readFileSync(TEST_PATH, 'utf8');

  if (ui.includes('completedLessonIds.add(state.activeLessonId)')) {
    console.log('COURSE_STUDENT_UI_COMPLETION_SYNC_PATCH=ALREADY_APPLIED');
    return;
  }

  fs.writeFileSync(UI_PATH, patchUi(ui), 'utf8');
  fs.writeFileSync(TEST_PATH, patchTest(test), 'utf8');

  console.log('COURSE_STUDENT_UI_COMPLETION_SYNC_PATCH=OK');
  console.log('BACKEND_CONTRACT_CHANGED=False');
  console.log('PRODUCTION_ACCESS=NOT_RUN');
}

main();
