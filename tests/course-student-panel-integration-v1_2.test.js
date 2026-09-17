'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.join(__dirname, '..');
const panelPath = path.join(root, 'painel_aluno.html');
const patcherPath = path.join(root, 'scripts', 'apply-course-student-ui-v1_2.js');
const panel = fs.readFileSync(panelPath, 'utf8');
const patcher = fs.readFileSync(patcherPath, 'utf8');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('patcher usa marcadores determinísticos e falha fechado', () => {
  assert.ok(patcher.includes('replaceOnce('));
  assert.ok(patcher.includes('esperado exatamente 1 marcador'));
  assert.ok(patcher.includes('bloco legado Academia Digital/LMS não localizado de forma segura'));
});

test('painel carrega runtime, api privada e ui v12', () => {
  assert.ok(panel.includes('BJJEXAMS_COURSE_STUDENT_UI_V12_INTEGRATED'));
  assert.ok(panel.includes('js/firebase-runtime-v1_2.js'));
  assert.ok(panel.includes('js/course-student-api-v1_2.js'));
  assert.ok(panel.includes('js/course-student-ui-v1_2.js'));
});

test('painel resolve Firebase pelo runtime seguro', () => {
  assert.ok(panel.includes('await window.BjjExamsFirebaseRuntime.loadConfig()'));
  assert.strictEqual(panel.includes('const firebaseConfig = {\n          apiKey: "AIzaSyDMYhKseehy_V0bmotTo63WPJgcsz4sFwI"'), false);
});

test('auth inicializa cursos v12 com o usuario autenticado', () => {
  assert.ok(panel.includes('window.inicializarCursosAlunoV12(user)'));
  assert.ok(panel.includes('getIdToken: () => user.getIdToken()'));
  assert.strictEqual(panel.includes('window.carregarLojaEInscricoes(); '), false);
});

test('Academia Digital integrada usa somente controller v12', () => {
  const start = panel.indexOf('// ACADEMIA DIGITAL — BJJ EXAMS V1.2');
  const end = panel.indexOf('window.abrirExameDoCurso = async', start);
  assert.ok(start >= 0 && end > start);
  const section = panel.slice(start, end);
  assert.ok(section.includes('BjjExamsCourseStudentUI.createController'));
  assert.ok(section.includes('__bjjStudentCourseControllerV12.loadMyCourses()'));
  assert.ok(section.includes('__bjjStudentCourseControllerV12?.openCourse(courseId)'));
  for (const forbidden of [
    'collection(db, "matriculas")',
    'aulas_concluidas',
    'updateDoc(doc(db, "matriculas"',
    'getDocs(query(collection(db, "cursos_teoricos")',
    'matriculaAssistindo.progresso'
  ]) {
    assert.strictEqual(section.includes(forbidden), false, `Token legado no bloco V12: ${forbidden}`);
  }
});

test('player e conclusão legados deixam de definir a superfície principal', () => {
  assert.strictEqual(panel.includes('window.marcarAulaConcluida = async'), false);
  assert.strictEqual(panel.includes('window.baixarAulaPDF = async'), false);
  assert.ok(panel.includes('window.abrirPlayerLMS = (courseId) =>'));
  assert.ok(panel.includes('__bjjStudentCourseControllerV12?.openCourse(courseId)'));
});

test('Explore Loja sai do fluxo legado e aponta para catálogo oficial', () => {
  assert.ok(panel.includes("if (id === 'cursos-loja') { window.location.href = 'catalogo.html'; return; }"));
  assert.ok(panel.includes("window.iniciarCheckout = () => { window.location.href = 'catalogo.html'; };"));
});

test('navegação para Meus Cursos atualiza dados pela api v12', () => {
  assert.ok(panel.includes("if(tabName === 'academia-digital') window.__bjjStudentCourseControllerV12?.loadMyCourses()"));
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
  }
}

console.log(`COURSE_STUDENT_PANEL_INTEGRATION_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
