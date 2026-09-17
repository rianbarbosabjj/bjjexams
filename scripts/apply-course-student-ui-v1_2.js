'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PANEL_PATH = path.join(ROOT, 'painel_aluno.html');

function fail(message) {
  throw new Error(`4B.4 patch bloqueado: ${message}`);
}

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) {
    fail(`${label}: esperado exatamente 1 marcador, encontrado ${count}.`);
  }
  return source.replace(before, after);
}

function main() {
  let source = fs.readFileSync(PANEL_PATH, 'utf8');

  if (source.includes('BJJEXAMS_COURSE_STUDENT_UI_V12_INTEGRATED')) {
    console.log('COURSE_STUDENT_UI_V1_2_PATCH=ALREADY_APPLIED');
    return;
  }

  source = replaceOnce(
    source,
    '        <script type="module">',
    `        <!-- BJJEXAMS_COURSE_STUDENT_UI_V12_INTEGRATED -->\n        <script src="js/firebase-runtime-v1_2.js"></script>\n        <script src="js/course-student-api-v1_2.js"></script>\n        <script src="js/course-student-ui-v1_2.js"></script>\n        <script type="module">`,
    'scripts V12'
  );

  const legacyFirebaseConfig = `        const firebaseConfig = {\n          apiKey: "AIzaSyDMYhKseehy_V0bmotTo63WPJgcsz4sFwI",\n          authDomain: "bjj-exams.firebaseapp.com",\n          projectId: "bjj-exams",\n          storageBucket: "bjj-exams.firebasestorage.app",\n          messagingSenderId: "682125845998",\n          appId: "1:682125845998:web:bf58e915a2860bc79e5aff"\n        };\n        const app = initializeApp(firebaseConfig);`;

  source = replaceOnce(
    source,
    legacyFirebaseConfig,
    `        const firebaseConfig = await window.BjjExamsFirebaseRuntime.loadConfig();\n        const app = initializeApp(firebaseConfig);`,
    'Firebase runtime seguro'
  );

  source = replaceOnce(
    source,
    `            if(tabName === 'notificacoes') window.carregarNotificacoes();`,
    `            if(tabName === 'notificacoes') window.carregarNotificacoes();\n            if(tabName === 'academia-digital') window.__bjjStudentCourseControllerV12?.loadMyCourses().catch((error) => console.error('Erro Cursos V12:', error));`,
    'refresh Meus Cursos V12'
  );

  source = replaceOnce(
    source,
    `        window.mudarSubAbaCursos = (id) => {\n            document.getElementById('cursos-meus').classList.add('hidden');`,
    `        window.mudarSubAbaCursos = (id) => {\n            if (id === 'cursos-loja') { window.location.href = 'catalogo.html'; return; }\n            document.getElementById('cursos-meus').classList.add('hidden');`,
    'subaba catálogo'
  );

  const eadStart = `        // ============================================\n        // ACADEMIA DIGITAL (EAD)\n        // ============================================`;
  const eadEnd = `        window.abrirExameDoCurso = async () => {`;
  const startIndex = source.indexOf(eadStart);
  const endIndex = source.indexOf(eadEnd, startIndex);

  if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
    fail('bloco legado Academia Digital/LMS não localizado de forma segura.');
  }

  const v12Bridge = `        // ============================================\n        // ACADEMIA DIGITAL — BJJ EXAMS V1.2\n        // ============================================\n        window.inicializarCursosAlunoV12 = async (user) => {\n            if (!user) throw new Error('Usuário autenticado obrigatório.');\n            if (!window.BjjExamsCourseStudent || !window.BjjExamsCourseStudentUI) {\n                throw new Error('Módulos de cursos V12 indisponíveis.');\n            }\n\n            if (!window.__bjjStudentCourseControllerV12) {\n                window.__bjjStudentCourseControllerV12 = window.BjjExamsCourseStudentUI.createController({\n                    api: window.BjjExamsCourseStudent,\n                    document,\n                    hostname: window.location.hostname,\n                    getIdToken: () => user.getIdToken()\n                });\n            }\n\n            const courses = await window.__bjjStudentCourseControllerV12.mount();\n            const qtd = document.getElementById('dash-cursos-qtd');\n            if (qtd) qtd.textContent = String(courses.length);\n\n            const loja = document.getElementById('grid-loja-cursos');\n            if (loja) {\n                loja.replaceChildren();\n                const box = document.createElement('div');\n                box.className = 'col-span-full rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center';\n                const title = document.createElement('h3');\n                title.className = 'text-lg font-black text-white mb-2';\n                title.textContent = 'Catálogo de cursos';\n                const text = document.createElement('p');\n                text.className = 'text-sm text-slate-400 mb-5';\n                text.textContent = 'Explore os cursos disponíveis no catálogo oficial do BJJ Exams.';\n                const link = document.createElement('a');\n                link.href = 'catalogo.html';\n                link.className = 'inline-flex px-5 py-3 rounded-xl bg-neon text-slate-900 text-xs font-black uppercase tracking-widest';\n                link.textContent = 'Explorar catálogo';\n                box.append(title, text, link);\n                loja.appendChild(box);\n            }\n\n            const destaque = document.getElementById('grid-dashboard-loja');\n            if (destaque) {\n                destaque.replaceChildren();\n                const box = document.createElement('div');\n                box.className = 'col-span-full rounded-2xl border border-slate-700 bg-slate-900 p-6 flex flex-col sm:flex-row items-center justify-between gap-4';\n                const text = document.createElement('p');\n                text.className = 'text-sm text-slate-400';\n                text.textContent = 'Veja novos cursos no catálogo oficial.';\n                const link = document.createElement('a');\n                link.href = 'catalogo.html';\n                link.className = 'px-5 py-3 rounded-xl bg-neon text-slate-900 text-xs font-black uppercase tracking-widest';\n                link.textContent = 'Abrir catálogo';\n                box.append(text, link);\n                destaque.appendChild(box);\n            }\n\n            return courses;\n        };\n\n        window.carregarLojaEInscricoes = async () => {\n            const controller = window.__bjjStudentCourseControllerV12;\n            if (!controller) return [];\n            const courses = await controller.loadMyCourses();\n            const qtd = document.getElementById('dash-cursos-qtd');\n            if (qtd) qtd.textContent = String(courses.length);\n            return courses;\n        };\n\n        window.renderizarAcademiaDigital = () => {\n            window.__bjjStudentCourseControllerV12?.renderMyCourses();\n        };\n\n        window.abrirPlayerLMS = (courseId) => {\n            return window.__bjjStudentCourseControllerV12?.openCourse(courseId);\n        };\n\n        window.iniciarCheckout = () => { window.location.href = 'catalogo.html'; };\n        window.efetivarMatricula = () => {\n            throw new Error('Matrícula legada desativada na interface V1.2.');\n        };\n\n`;

  source = source.slice(0, startIndex) + v12Bridge + source.slice(endIndex);

  source = replaceOnce(
    source,
    `                            window.carregarLojaEInscricoes(); `,
    `                            window.inicializarCursosAlunoV12(user).catch((error) => console.error('Erro Cursos V12:', error));`,
    'inicialização autenticada V12'
  );

  const forbiddenAfterPatch = [
    'const firebaseConfig = {\\n          apiKey:',
    'collection(db, "matriculas")',
    'matriculaAssistindo.aulas_concluidas',
    'await updateDoc(doc(db, "matriculas"'
  ];

  const eadSectionStart = source.indexOf('// ACADEMIA DIGITAL — BJJ EXAMS V1.2');
  const examSectionStart = source.indexOf('window.abrirExameDoCurso = async', eadSectionStart);
  const eadSection = source.slice(eadSectionStart, examSectionStart);
  for (const token of forbiddenAfterPatch.slice(1)) {
    if (eadSection.includes(token)) fail(`token legado persistiu no bloco V12: ${token}`);
  }

  fs.writeFileSync(PANEL_PATH, source, 'utf8');
  console.log('COURSE_STUDENT_UI_V1_2_PATCH=OK');
  console.log('PANEL=painel_aluno.html');
  console.log('PRODUCTION_DIRECT_CONFIG_REMOVED=True');
  console.log('LEGACY_COURSE_PROGRESS_WRITE_REMOVED=True');
}

main();
