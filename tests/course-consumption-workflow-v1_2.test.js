'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const functionsSource = fs.readFileSync(
  path.join(root, 'functions', 'src', 'courses', 'course-consumption-functions.js'),
  'utf8'
);
const domainSource = fs.readFileSync(
  path.join(root, 'functions', 'src', 'courses', 'course-consumption-domain.js'),
  'utf8'
);
const mainSource = fs.readFileSync(path.join(root, 'functions', 'main.js'), 'utf8');
const rulesSource = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const roadmapSource = fs.readFileSync(
  path.join(root, 'docs', 'architecture', 'COURSES_MVP_V1_2.md'),
  'utf8'
);

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function contains(source, value) {
  assert.ok(source.includes(value), `Esperado encontrar: ${value}`);
}

test('estrutura protegida exige autenticacao', () => {
  contains(functionsSource, 'const uid = requireAuth(request);');
  contains(functionsSource, 'obterEstruturaConsumoCursoV12');
});

test('entitlement e recalculado com curso e usuario autenticados', () => {
  contains(functionsSource, 'resolveCourseEntitlement({');
  contains(functionsSource, 'courseId,');
  contains(functionsSource, 'userId: uid,');
  contains(functionsSource, 'enrollmentDocumentId(courseId, uid)');
});

test('estrutura le caminho canonico plano de aulas e nao payload integral', () => {
  contains(functionsSource, "courseRef.collection('lessons').get()");
  contains(functionsSource, 'buildStudentCourseStructure({');
  assert.ok(!domainSource.includes('lessons: lessons.map(lesson => lessonContentView'));
});

test('leitura individual de aula usa caminho canonico plano', () => {
  contains(functionsSource, "courseRef.collection('lessons').doc(lessonId)");
  contains(functionsSource, 'lessonContentView(lessonSnap.id, persistedLesson)');
});

test('preview anonimo nao exige identidade e segue politica explicita', () => {
  contains(functionsSource, 'const uid = optionalAuthUid(request);');
  contains(functionsSource, "accessMode: 'preview'");
  contains(domainSource, "course.status === 'published'");
  contains(domainSource, "course.visibility === 'platform'");
  contains(domainSource, 'normalizedLesson.isPreview === true');
});

test('curso de organizacao ou privado nao usa preview publico', () => {
  contains(domainSource, "course.visibility === 'platform'");
  assert.ok(!domainSource.includes("course.visibility === 'organization' && normalizedLesson.isPreview"));
  assert.ok(!domainSource.includes("course.visibility === 'private' && normalizedLesson.isPreview"));
});

test('aula protegida sem entitlement falha sem revelar conteudo', () => {
  contains(functionsSource, "throw new HttpsError('not-found', 'Aula não disponível.');");
  contains(functionsSource, 'if (entitlement.granted)');
});

test('aula orfa de modulo nao e entregue', () => {
  contains(functionsSource, "courseRef.collection('modules').doc(lesson.moduleId).get()");
  contains(functionsSource, "if (!moduleSnap.exists)");
});

test('firestore permanece fechado para modulos e aulas canonicos', () => {
  contains(rulesSource, 'match /courses/{courseId}');
  contains(rulesSource, 'match /modules/{moduleId}');
  contains(rulesSource, 'match /lessons/{lessonId}');
  contains(rulesSource, 'allow read, write: if false;');
});

test('composition root exporta as callables de consumo', () => {
  contains(mainSource, 'createCourseConsumptionFunctions');
  contains(mainSource, '...courseConsumptionFunctions');
});

test('roadmap documenta caminho canonico plano de aulas', () => {
  contains(roadmapSource, 'courses/{courseId}/lessons/{lessonId}');
});

let passed = 0;
for (const item of cases) {
  try {
    item.fn();
    passed += 1;
    console.log(`PASS | ${item.name}`);
  } catch (error) {
    console.error(`FAIL | ${item.name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log(`COURSE_CONSUMPTION_WORKFLOW_V1_2=${passed}/${cases.length}`);
