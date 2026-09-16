"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const expectedBranch = "feature/marco4a5b-course-content-ui";

function fail(message) {
  throw new Error(message);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function write(relative, value) {
  fs.writeFileSync(path.join(root, relative), value, { encoding: "utf8" });
}

function replaceOnce(source, oldValue, newValue, label) {
  const first = source.indexOf(oldValue);
  if (first < 0) fail(`${label}: anchor not found`);
  if (source.indexOf(oldValue, first + oldValue.length) >= 0) {
    fail(`${label}: anchor is not unique`);
  }
  return source.slice(0, first) + newValue + source.slice(first + oldValue.length);
}

const branch = execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], {
  encoding: "utf8"
}).trim();
if (branch !== expectedBranch) {
  fail(`Execution blocked on branch '${branch}'. Expected '${expectedBranch}'.`);
}

// Backend: add one transactionally atomic reorder callable and export it.
{
  const file = "functions/src/courses/course-content-functions.js";
  let source = read(file);
  if (!source.includes("const reordenarConteudoCursoV12 = onCall(")) {
    const marker = "\n  return {\n    listarConteudoCursoV12,";
    const callable = `
  const reordenarConteudoCursoV12 = onCall(
    { region: REGION },
    async request => {
      const actor = contentActor(request);
      const courseId = requireId(request.data?.courseId, "Curso");
      const entityType = String(request.data?.entityType || "").trim();
      if (entityType !== "module" && entityType !== "lesson") {
        throw new HttpsError("invalid-argument", "Tipo de conteudo invalido para reordenacao.");
      }

      const firstId = requireId(request.data?.firstId, "Primeiro item");
      const secondId = requireId(request.data?.secondId, "Segundo item");
      if (firstId === secondId) {
        throw new HttpsError("invalid-argument", "Os itens de reordenacao devem ser diferentes.");
      }

      const courseRef = db.doc(\`courses/\${courseId}\`);
      const collectionName = entityType === "module" ? "modules" : "lessons";
      const firstRef = courseRef.collection(collectionName).doc(firstId);
      const secondRef = courseRef.collection(collectionName).doc(secondId);
      const auditRef = db.collection("audit_logs").doc();
      let revision = null;
      let firstPosition = null;
      let secondPosition = null;

      await db.runTransaction(async tx => {
        const [courseSnap, firstSnap, secondSnap] = await Promise.all([
          tx.get(courseRef),
          tx.get(firstRef),
          tx.get(secondRef)
        ]);

        if (!courseSnap.exists) throw new HttpsError("not-found", "Curso nao encontrado.");
        if (!firstSnap.exists || !secondSnap.exists) {
          throw new HttpsError("not-found", "Item de conteudo nao encontrado.");
        }

        const course = courseSnap.data();
        const first = firstSnap.data();
        const second = secondSnap.data();
        assertCanEditCourse(actor, course);

        if (entityType === "lesson" && first.moduleId !== second.moduleId) {
          throw new HttpsError(
            "failed-precondition",
            "Aulas so podem ser reordenadas atomicamente dentro do mesmo modulo."
          );
        }

        firstPosition = Number(first.position);
        secondPosition = Number(second.position);
        const positionsAreValid = [firstPosition, secondPosition].every(
          value => Number.isInteger(value) && value >= 0 && value <= 9999
        );
        if (!positionsAreValid || firstPosition === secondPosition) {
          throw new HttpsError(
            "failed-precondition",
            "As posicoes atuais nao permitem uma troca atomica segura."
          );
        }

        revision = nextContentRevision(course);
        tx.update(firstRef, {
          position: secondPosition,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.update(secondRef, {
          position: firstPosition,
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.update(courseRef, {
          contentRevision: revision,
          contentUpdatedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        });
        tx.create(auditRef, auditPayload({
          actor,
          action: \`course.content.\${entityType}.reordered\`,
          entityId: \`\${courseId}/\${collectionName}/\${firstId}<->\${secondId}\`,
          before: {
            first: { id: firstId, position: firstPosition },
            second: { id: secondId, position: secondPosition }
          },
          after: {
            first: { id: firstId, position: secondPosition },
            second: { id: secondId, position: firstPosition }
          },
          revision
        }));
      });

      return {
        ok: true,
        contentRevision: revision,
        entityType,
        first: { id: firstId, position: secondPosition },
        second: { id: secondId, position: firstPosition }
      };
    }
  );
`;
    source = replaceOnce(source, marker, `${callable}${marker}`, "backend callable insertion");
    source = replaceOnce(
      source,
      "  return {\n    listarConteudoCursoV12,\n",
      "  return {\n    listarConteudoCursoV12,\n    reordenarConteudoCursoV12,\n",
      "backend export"
    );
    write(file, source);
    console.log("ATOMIC_REORDER_BACKEND=APPLIED");
  } else {
    console.log("ATOMIC_REORDER_BACKEND=ALREADY_APPLIED");
  }
}

// Browser API: expose the atomic reorder callable.
{
  const file = "js/course-content-api-v1_2.js";
  let source = read(file);
  if (!source.includes('"reordenarConteudoCursoV12"')) {
    source = replaceOnce(
      source,
      '      "listarConteudoCursoV12",\n',
      '      "listarConteudoCursoV12",\n      "reordenarConteudoCursoV12",\n',
      "api allowlist"
    );

    const marker = "\n    return Object.freeze({\n";
    const method = `
    async function reorderPair(courseId, entityType, firstId, secondId, options = {}) {
      const type = String(entityType || "").trim();
      if (type !== "module" && type !== "lesson") {
        throw new Error("Tipo de conteudo invalido para reordenacao.");
      }
      return callAuthenticated(
        "reordenarConteudoCursoV12",
        {
          courseId: requireId(courseId, "Curso"),
          entityType: type,
          firstId: requireId(firstId, "Primeiro item"),
          secondId: requireId(secondId, "Segundo item")
        },
        options
      );
    }
`;
    source = replaceOnce(source, marker, `${method}${marker}`, "api method insertion");
    source = replaceOnce(
      source,
      "      callAuthenticated,\n      listContent,\n",
      "      callAuthenticated,\n      listContent,\n      reorderPair,\n",
      "api export"
    );
    write(file, source);
    console.log("ATOMIC_REORDER_API=APPLIED");
  } else {
    console.log("ATOMIC_REORDER_API=ALREADY_APPLIED");
  }
}

// UI: replace the two-call swaps with the single atomic callable.
{
  const file = "js/course-content-ui-v1_2.js";
  let source = read(file);

  const oldModule = `  async function reorderModule(index, direction) {
    const modules = sortedModules();
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= modules.length) return;
    const current = modules[index];
    const other = modules[otherIndex];
    const currentPosition = Number(current.position || 0);
    const otherPosition = Number(other.position || 0);
    await runMutation(async options => {
      await api.updateModule(currentCourse.id, current.id, { position: otherPosition }, options);
      await api.updateModule(currentCourse.id, other.id, { position: currentPosition }, options);
    });
  }`;

  const newModule = `  async function reorderModule(index, direction) {
    const modules = sortedModules();
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= modules.length) return;
    const current = modules[index];
    const other = modules[otherIndex];
    await runMutation(options => api.reorderPair(
      currentCourse.id,
      "module",
      current.id,
      other.id,
      options
    ));
  }`;

  const oldLesson = `  async function reorderLesson(moduleId, index, direction) {
    const lessons = lessonsFor(moduleId);
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= lessons.length) return;
    const current = lessons[index];
    const other = lessons[otherIndex];
    const currentPosition = Number(current.position || 0);
    const otherPosition = Number(other.position || 0);
    await runMutation(async options => {
      await api.updateLesson(currentCourse.id, current.id, { ...current, position: otherPosition }, options);
      await api.updateLesson(currentCourse.id, other.id, { ...other, position: currentPosition }, options);
    });
  }`;

  const newLesson = `  async function reorderLesson(moduleId, index, direction) {
    const lessons = lessonsFor(moduleId);
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= lessons.length) return;
    const current = lessons[index];
    const other = lessons[otherIndex];
    await runMutation(options => api.reorderPair(
      currentCourse.id,
      "lesson",
      current.id,
      other.id,
      options
    ));
  }`;

  if (source.includes(oldModule)) {
    source = replaceOnce(source, oldModule, newModule, "module reorder UI");
  } else if (!source.includes('"module",\n      current.id,\n      other.id,')) {
    fail("module reorder UI: expected implementation not found");
  }

  if (source.includes(oldLesson)) {
    source = replaceOnce(source, oldLesson, newLesson, "lesson reorder UI");
  } else if (!source.includes('"lesson",\n      current.id,\n      other.id,')) {
    fail("lesson reorder UI: expected implementation not found");
  }

  write(file, source);
  console.log("ATOMIC_REORDER_UI=APPLIED");
}

// Tests: update callable count and add atomicity guardrails.
{
  const file = "tests/course-content-api-v1_2.test.js";
  let source = read(file);
  if (source.includes("exatamente sete callables")) {
    source = source.replace("exatamente sete callables", "exatamente oito callables");
    source = source.replace("api.ALLOWED_FUNCTIONS.size, 7", "api.ALLOWED_FUNCTIONS.size, 8");
    source = source.replace(
      '    "listarConteudoCursoV12",\n',
      '    "listarConteudoCursoV12",\n    "reordenarConteudoCursoV12",\n'
    );

    const marker = '\ntest("endpoint staging usa regiao e projeto canonicos", () => {';
    const testCase = `
test("reorderPair usa callable atomica canonica", async () => {
  let request = null;
  const fetchImpl = async (url, options) => {
    request = { url, payload: JSON.parse(options.body).data };
    return { ok: true, status: 200, json: async () => ({ result: { ok: true } }) };
  };
  await api.reorderPair(
    "course-1",
    "lesson",
    "lesson-1",
    "lesson-2",
    { hostname: "localhost", idToken: "t", fetchImpl }
  );
  assert.match(request.url, /reordenarConteudoCursoV12$/);
  assert.deepEqual(request.payload, {
    courseId: "course-1",
    entityType: "lesson",
    firstId: "lesson-1",
    secondId: "lesson-2"
  });
});
`;
    source = replaceOnce(source, marker, `${testCase}${marker}`, "api atomic test insertion");
    write(file, source);
    console.log("ATOMIC_REORDER_API_TEST=APPLIED");
  } else {
    console.log("ATOMIC_REORDER_API_TEST=ALREADY_APPLIED");
  }
}

{
  const file = "tests/course-content-functions-v1_2.test.js";
  let source = read(file);
  if (source.includes("assert.equal(occurrences, 6);")) {
    source = source.replace("assert.equal(occurrences, 6);", "assert.equal(occurrences, 7);");
    source = source.replace(
      '    "listarConteudoCursoV12",\n',
      '    "listarConteudoCursoV12",\n    "reordenarConteudoCursoV12",\n'
    );
    const marker = '\ntest("duracao total e mantida no curso", () => {';
    const testCase = `
test("reordenacao troca duas posicoes em uma unica transacao", () => {
  assert.match(source, /const reordenarConteudoCursoV12 = onCall/);
  assert.match(source, /tx\\.update\\(firstRef/);
  assert.match(source, /tx\\.update\\(secondRef/);
  assert.match(source, /course\\.content\\.\\$\\{entityType\\}\\.reordered/);
  assert.match(source, /first\\.moduleId !== second\\.moduleId/);
});
`;
    source = replaceOnce(source, marker, `${testCase}${marker}`, "backend atomic test insertion");
    write(file, source);
    console.log("ATOMIC_REORDER_BACKEND_TEST=APPLIED");
  } else {
    console.log("ATOMIC_REORDER_BACKEND_TEST=ALREADY_APPLIED");
  }
}

{
  const file = "tests/course-content-ui-v1_2.test.js";
  let source = read(file);
  if (!source.includes("studio reordena por callable atomica")) {
    const marker = '\ntest("studio cobre video texto e documento", () => {';
    const testCase = `
test("studio reordena por callable atomica", () => {
  assert.match(ui, /api\\.reorderPair\\(/);
  assert.match(ui, /currentCourse\\.id,\\n      "module"/);
  assert.match(ui, /currentCourse\\.id,\\n      "lesson"/);
  assert.equal(/reorderModule[\\s\\S]*api\\.updateModule/.test(ui), false);
  assert.equal(/reorderLesson[\\s\\S]*api\\.updateLesson/.test(ui), false);
});
`;
    source = replaceOnce(source, marker, `${testCase}${marker}`, "ui atomic test insertion");
    write(file, source);
    console.log("ATOMIC_REORDER_UI_TEST=APPLIED");
  } else {
    console.log("ATOMIC_REORDER_UI_TEST=ALREADY_APPLIED");
  }
}

execFileSync("git", ["-C", root, "diff", "--check"], { stdio: "inherit" });
console.log("MARCO4A5B_ATOMIC_REORDER_PATCH=OK");
