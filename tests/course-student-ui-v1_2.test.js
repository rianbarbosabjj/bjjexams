'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const uiPath = path.join(__dirname, '..', 'js', 'course-student-ui-v1_2.js');
const source = fs.readFileSync(uiPath, 'utf8');
const ui = require(uiPath);

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

test('flattenLessons preserva ordem canonica recebida', () => {
  const result = ui.flattenLessons({
    modules: [
      { id: 'm1', title: 'Modulo 1', lessons: [{ id: 'l1', title: 'Aula 1' }, { id: 'l2', title: 'Aula 2' }] },
      { id: 'm2', title: 'Modulo 2', lessons: [{ id: 'l3', title: 'Aula 3' }] }
    ]
  });
  assert.deepStrictEqual(result.map(item => item.id), ['l1', 'l2', 'l3']);
  assert.strictEqual(result[2].moduleTitle, 'Modulo 2');
});

test('pickInitialLesson escolhe primeira aula ainda nao concluida', () => {
  const structure = {
    modules: [{ id: 'm1', title: 'M', lessons: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] }]
  };
  assert.strictEqual(
    ui.pickInitialLesson(structure, { completedLessonIds: ['l1'] }).id,
    'l2'
  );
});

test('pickInitialLesson volta a primeira aula quando curso esta completo', () => {
  const structure = {
    modules: [{ id: 'm1', title: 'M', lessons: [{ id: 'l1' }, { id: 'l2' }] }]
  };
  assert.strictEqual(
    ui.pickInitialLesson(structure, { completedLessonIds: ['l1', 'l2'] }).id,
    'l1'
  );
});

test('pickInitialLesson retorna null para curso sem aulas', () => {
  assert.strictEqual(ui.pickInitialLesson({ modules: [] }, {}), null);
});

test('courseCardView usa progresso e entitlement recebidos do backend', () => {
  const view = ui.courseCardView({
    course: { id: 'c1', title: 'Fundamentos', description: 'Curso base' },
    enrollment: { courseId: 'c1', status: 'active', progressPercent: 47.25 },
    entitlement: { granted: true, reason: 'ENTITLED' }
  });
  assert.strictEqual(view.courseId, 'c1');
  assert.strictEqual(view.progressPercent, 47.25);
  assert.strictEqual(view.accessGranted, true);
});

test('percentual visual fica limitado entre zero e cem', () => {
  assert.strictEqual(ui.clampPercent(-20), 0);
  assert.strictEqual(ui.clampPercent(150), 100);
  assert.strictEqual(ui.clampPercent('12.345'), 12.35);
});

test('valor financeiro e formatado sem expor estrutura interna', () => {
  assert.ok(ui.formatCurrency(5000, 'BRL').includes('50'));
  assert.strictEqual(ui.formatCurrency(-1, 'BRL'), 'Valor indisponível');
});

test('historico pending oferece somente retomada do pagamento', () => {
  const view = ui.purchaseHistoryView({
    course: { courseId: 'course-1', title: 'Curso pago' },
    purchaseState: 'payment_pending',
    amountCents: 5000,
    currency: 'BRL',
    entitled: false,
    canResumeCheckout: true,
    canOpenCourse: false
  });
  assert.strictEqual(view.courseId, 'course-1');
  assert.strictEqual(view.statusLabel, 'Aguardando PIX');
  assert.strictEqual(view.action, 'resume_payment');
  assert.strictEqual(view.entitled, false);
});

test('historico pago libera abertura e refund preserva somente historico', () => {
  const paid = ui.purchaseHistoryView({
    course: { courseId: 'course-1', title: 'Curso pago' },
    purchaseState: 'paid_entitled',
    amountCents: 5000,
    currency: 'BRL',
    entitled: true,
    canOpenCourse: true
  });
  const refunded = ui.purchaseHistoryView({
    course: { courseId: 'course-1', title: 'Curso pago' },
    purchaseState: 'refunded',
    amountCents: 5000,
    currency: 'BRL',
    entitled: false,
    canStartCheckout: true
  });
  assert.strictEqual(paid.action, 'open_course');
  assert.strictEqual(refunded.statusLabel, 'Estornado');
  assert.strictEqual(refunded.action, null);
});

test('chargeback nunca oferece acao de acesso ou nova compra na area do aluno', () => {
  const view = ui.purchaseHistoryView({
    course: { courseId: 'course-1', title: 'Curso pago' },
    purchaseState: 'chargeback',
    amountCents: 5000,
    currency: 'BRL',
    entitled: false,
    canOpenCourse: false,
    canStartCheckout: false
  });
  assert.strictEqual(view.statusLabel, 'Contestação financeira');
  assert.strictEqual(view.action, null);
});

test('erros de autenticacao e acesso viram estados explicitos', () => {
  assert.strictEqual(ui.normalizeError({ httpStatus: 401 }).kind, 'auth');
  assert.strictEqual(ui.normalizeError({ callableStatus: 'PERMISSION_DENIED' }).kind, 'access');
  assert.strictEqual(ui.normalizeError({ callableStatus: 'permission-denied' }).kind, 'access');
  assert.strictEqual(ui.normalizeError({ httpStatus: 500 }).kind, 'network');
});

test('controller exige api, documento e getIdToken', () => {
  assert.throws(() => ui.createController({ document: {}, getIdToken: async () => 'x' }), /Cliente de cursos/);
  assert.throws(() => ui.createController({ api: {}, getIdToken: async () => 'x' }), /Documento indisponível/);
  assert.throws(() => ui.createController({ api: {}, document: {} }), /getIdToken/);
});

test('UI V12 nao usa fonte legada nem Firestore direto para cursos', () => {
  const forbidden = [
    'matriculasAluno',
    'aulas_concluidas',
    'collection(db, "matriculas")',
    "collection(db, 'matriculas')",
    'getDoc(',
    'getDocs(',
    'addDoc(',
    'setDoc(',
    'updateDoc('
  ];
  for (const token of forbidden) {
    assert.strictEqual(source.includes(token), false, `Token proibido encontrado: ${token}`);
  }
});

test('area de compras usa somente callable sanitizada e fica separada dos cursos liberados', () => {
  assert.ok(source.includes('"Compras e pagamentos"'));
  assert.ok(source.includes('api.listMyPurchases(25, apiOptions())'));
  assert.ok(source.includes('id = "bjj-student-v12-purchases"'));
  assert.ok(source.includes('state.purchases ='));
  assert.strictEqual(source.includes('providerPaymentId'), false);
  assert.strictEqual(source.includes('financialSnapshot'), false);
  assert.strictEqual(source.includes('payment_transactions'), false);
  assert.strictEqual(source.includes('collection("orders")'), false);
});

test('mount carrega cursos e historico sem transformar falha financeira em bloqueio academico', () => {
  assert.ok(source.includes('const coursesPromise = loadMyCourses();'));
  assert.ok(source.includes('const purchasesPromise = loadPurchaseHistory().catch(error => {'));
  assert.ok(source.includes('const courses = await coursesPromise;'));
  assert.ok(source.includes('await purchasesPromise;'));
  assert.ok(source.includes('return courses;'));
});

test('UI conclui aula pelo cliente V12 e preserva estado concluído', () => {
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
});

test('eventos assincronos da UI nao deixam rejeicoes sem tratamento', () => {
  assert.ok(source.includes('function bindAsyncClick(node, action)'));
  assert.ok(source.includes('bindAsyncClick(button, () => openCourse(view.courseId))'));
  assert.ok(source.includes('bindAsyncClick(complete, completeCurrentLesson)'));
  assert.ok(source.includes('bindAsyncClick(button, () => selectLesson(lesson.id))'));
  assert.ok(source.includes('BJJ Exams: ação de curso não concluída.'));
  assert.strictEqual(source.includes('button.addEventListener("click", () => openCourse(view.courseId))'), false);
  assert.strictEqual(source.includes('complete.addEventListener("click", completeCurrentLesson)'), false);
  assert.strictEqual(source.includes('button.addEventListener("click", () => selectLesson(lesson.id))'), false);
});

test('conteudo textual remoto nao e injetado via innerHTML', () => {
  assert.ok(source.includes('textContent ='));
  assert.strictEqual(source.includes('innerHTML = lesson.body'), false);
  assert.strictEqual(source.includes('insertAdjacentHTML'), false);
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

console.log(`COURSE_STUDENT_UI_V1_2=${passed}/${cases.length}`);
if (passed !== cases.length) process.exitCode = 1;
