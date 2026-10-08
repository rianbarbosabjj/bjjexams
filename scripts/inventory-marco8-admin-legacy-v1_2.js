"use strict";

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const ROOT = process.cwd();
const OUT = path.join(
  ROOT,
  "docs",
  "architecture",
  "MARCO_8_LEGACY_ADMIN_INVENTORY.md"
);

const DIRECT_READ_OPS = [
  "getDoc",
  "getDocs",
  "getCountFromServer",
  "onSnapshot"
];

const DIRECT_MUTATION_OPS = [
  "addDoc",
  "setDoc",
  "updateDoc",
  "deleteDoc",
  "writeBatch",
  "runTransaction"
];

const QUERY_OPS = [
  "collection",
  "doc",
  "query",
  "where",
  "orderBy",
  "limit",
  "startAfter",
  "startAt",
  "endAt",
  "endBefore"
];

const ALL_FIRESTORE_OPS = [
  ...DIRECT_READ_OPS,
  ...DIRECT_MUTATION_OPS,
  ...QUERY_OPS
];

const ADMIN_NAME_PATTERN =
  /(admin|superadmin|painel_admin|painel_superadmin)/i;

const ADMIN_CONTENT_PATTERN =
  /\b(super[_ -]?admin|administrador|adminGlobal|tipo_usuario\s*={2,3}\s*["']admin["'])\b/i;

function normalizePath(filePath) {
  return path
    .relative(ROOT, filePath)
    .split(path.sep)
    .join("/");
}

function walk(dir, predicate, output = []) {
  if (!fs.existsSync(dir)) {
    return output;
  }

  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === ".git" ||
        entry.name === ".firebase" ||
        entry.name === ".firebase-hosting-staging"
      ) {
        continue;
      }

      walk(full, predicate, output);
      continue;
    }

    if (entry.isFile() && predicate(full)) {
      output.push(full);
    }
  }

  return output;
}

function frontendFiles() {
  const rootHtml = fs
    .readdirSync(ROOT, { withFileTypes: true })
    .filter(
      entry =>
        entry.isFile() &&
        entry.name.endsWith(".html")
    )
    .map(entry => path.join(ROOT, entry.name));

  const jsDir = path.join(ROOT, "js");
  const jsFiles = walk(
    jsDir,
    full => full.endsWith(".js")
  );

  return [...rootHtml, ...jsFiles]
    .sort((a, b) =>
      normalizePath(a).localeCompare(
        normalizePath(b)
      )
    );
}

function backendFiles() {
  const files = [];

  for (const candidate of [
    path.join(ROOT, "functions", "index.js"),
    path.join(ROOT, "functions", "main.js")
  ]) {
    if (fs.existsSync(candidate)) {
      files.push(candidate);
    }
  }

  const src = path.join(ROOT, "functions", "src");

  files.push(
    ...walk(
      src,
      full => full.endsWith(".js")
    )
  );

  return [...new Set(files)]
    .sort((a, b) =>
      normalizePath(a).localeCompare(
        normalizePath(b)
      )
    );
}

function lineNumberAt(text, index) {
  return text
    .slice(0, index)
    .split(/\r?\n/).length;
}

function trimSnippet(line) {
  return line
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function findOperationOccurrences(
  file,
  text,
  operations
) {
  const findings = [];

  for (const op of operations) {
    const regex = new RegExp(
      `\\b${op}\\s*\\(`,
      "g"
    );

    let match;

    while ((match = regex.exec(text))) {
      const line =
        lineNumberAt(text, match.index);

      const rawLine =
        text.split(/\r?\n/)[line - 1] || "";

      findings.push({
        file,
        operation: op,
        line,
        snippet: trimSnippet(rawLine)
      });
    }
  }

  return findings.sort((a, b) => {
    if (a.line !== b.line) {
      return a.line - b.line;
    }
    return a.operation.localeCompare(b.operation);
  });
}

function literalCollectionNames(text) {
  const names = new Set();

  const patterns = [
    /\bcollection\s*\(\s*db\s*,\s*["'`]([^"'`]+)["'`]/g,
    /\bdoc\s*\(\s*db\s*,\s*["'`]([^"'`]+)["'`]/g
  ];

  for (const regex of patterns) {
    let match;

    while ((match = regex.exec(text))) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  }

  return [...names].sort();
}

function callableReferences(text) {
  const refs = new Set();

  const patterns = [
    /\bhttpsCallable\s*\([^,]+,\s*["'`]([^"'`]+)["'`]/g,
    /\bfunctionUrl\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\bcallPrivateCallable\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\bcallPublicCallable\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\bcallCallable\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /\binvokeCallable\s*\(\s*["'`]([^"'`]+)["'`]/g,
    /cloudfunctions\.net\/([A-Za-z0-9_-]+)/g
  ];

  for (const regex of patterns) {
    let match;

    while ((match = regex.exec(text))) {
      if (match[1]) {
        refs.add(match[1]);
      }
    }
  }

  return [...refs].sort();
}

function detectImportedFirestoreOps(text) {
  const found = [];

  for (const op of ALL_FIRESTORE_OPS) {
    if (
      new RegExp(
        `\\b${op}\\b`
      ).test(text)
    ) {
      found.push(op);
    }
  }

  return found.sort();
}

function classifyRisk(record) {
  if (record.mutationFindings.length > 0) {
    return "HIGH";
  }

  if (
    record.adminLike &&
    record.readFindings.length > 0
  ) {
    return "MEDIUM";
  }

  if (
    record.readFindings.length > 0 ||
    record.firestoreOps.length > 0
  ) {
    return "LOW";
  }

  return "NONE";
}

function backendCallableSymbols(file, text) {
  const symbols = new Set();

  const patterns = [
    /\bexports\.([A-Za-z0-9_]+)\s*=/g,
    /\b([A-Za-z0-9_]+)\s*:\s*onCall\s*\(/g,
    /\b([A-Za-z0-9_]+)\s*:\s*onRequest\s*\(/g,
    /\bconst\s+([A-Za-z0-9_]+)\s*=\s*onCall\s*\(/g,
    /\bconst\s+([A-Za-z0-9_]+)\s*=\s*onRequest\s*\(/g
  ];

  for (const regex of patterns) {
    let match;

    while ((match = regex.exec(text))) {
      if (match[1]) {
        symbols.add(match[1]);
      }
    }
  }

  const factories = new Set();
  const factoryRegex =
    /\bfunction\s+(create[A-Za-z0-9_]*Functions)\s*\(|\bconst\s+(create[A-Za-z0-9_]*Functions)\s*=/g;

  let factoryMatch;

  while ((factoryMatch = factoryRegex.exec(text))) {
    const factory =
      factoryMatch[1] ||
      factoryMatch[2];

    if (factory) {
      factories.add(factory);
    }
  }

  const functionSurface =
    /\bonCall\s*\(|\bonRequest\s*\(|create[A-Za-z0-9_]*Functions/.test(
      text
    );

  return {
    file,
    functionSurface,
    symbols: [...symbols].sort(),
    factories: [...factories].sort()
  };
}

function markdownEscape(value) {
  return String(value)
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function code(value) {
  return "`" +
    String(value).replace(/`/g, "\\`") +
    "`";
}

function shortSha(value) {
  return String(value).slice(0, 7);
}

function git(command) {
  return childProcess
    .execFileSync(
      "git",
      command,
      {
        cwd: ROOT,
        encoding: "utf8"
      }
    )
    .trim();
}

function main() {
  const baselineSha =
    git(["rev-parse", "HEAD"]);

  const branch =
    git(["branch", "--show-current"]);

  const frontend =
    frontendFiles();

  const records = [];

  const allMutationFindings = [];
  const allReadFindings = [];
  const collectionUsage = new Map();
  const allCallableRefs = new Map();

  for (const absolute of frontend) {
    const file =
      normalizePath(absolute);

    const text =
      fs.readFileSync(
        absolute,
        "utf8"
      );

    const readFindings =
      findOperationOccurrences(
        file,
        text,
        DIRECT_READ_OPS
      );

    const mutationFindings =
      findOperationOccurrences(
        file,
        text,
        DIRECT_MUTATION_OPS
      );

    const firestoreOps =
      detectImportedFirestoreOps(text);

    const collections =
      literalCollectionNames(text);

    const callableRefs =
      callableReferences(text);

    const adminLike =
      ADMIN_NAME_PATTERN.test(file) ||
      ADMIN_CONTENT_PATTERN.test(text);

    const record = {
      file,
      adminLike,
      readFindings,
      mutationFindings,
      firestoreOps,
      collections,
      callableRefs
    };

    record.risk =
      classifyRisk(record);

    records.push(record);

    allReadFindings.push(
      ...readFindings
    );

    allMutationFindings.push(
      ...mutationFindings
    );

    for (const name of collections) {
      if (!collectionUsage.has(name)) {
        collectionUsage.set(
          name,
          new Set()
        );
      }

      collectionUsage
        .get(name)
        .add(file);
    }

    for (const ref of callableRefs) {
      if (!allCallableRefs.has(ref)) {
        allCallableRefs.set(
          ref,
          new Set()
        );
      }

      allCallableRefs
        .get(ref)
        .add(file);
    }
  }

  const backendInventory =
    backendFiles()
      .map(absolute => {
        const file =
          normalizePath(absolute);

        const text =
          fs.readFileSync(
            absolute,
            "utf8"
          );

        return backendCallableSymbols(
          file,
          text
        );
      })
      .filter(
        record =>
          record.functionSurface
      );

  const adminRecords =
    records.filter(
      record => record.adminLike
    );

  const directReadFiles =
    records.filter(
      record =>
        record.readFindings.length > 0
    );

  const directMutationFiles =
    records.filter(
      record =>
        record.mutationFindings.length > 0
    );

  const adminMutationFiles =
    records.filter(
      record =>
        record.adminLike &&
        record.mutationFindings.length > 0
    );

  if (
    !records.some(
      record =>
        record.file ===
        "painel_superadmin.html"
    )
  ) {
    throw new Error(
      "painel_superadmin.html nao entrou no inventario."
    );
  }

  const superAdmin =
    records.find(
      record =>
        record.file ===
        "painel_superadmin.html"
    );

  if (
    !superAdmin ||
    superAdmin.mutationFindings.length === 0
  ) {
    throw new Error(
      "Scanner nao detectou mutations Firestore em painel_superadmin.html."
    );
  }

  for (const requiredOp of [
    "addDoc",
    "updateDoc",
    "deleteDoc"
  ]) {
    if (
      !superAdmin.mutationFindings.some(
        finding =>
          finding.operation ===
          requiredOp
      )
    ) {
      throw new Error(
        `Scanner nao detectou ${requiredOp} em painel_superadmin.html.`
      );
    }
  }

  const lines = [];

  lines.push(
    "# Marco 8 â€” InventÃ¡rio do legado administrativo"
  );
  lines.push("");
  lines.push(
    "> RelatÃ³rio gerado automaticamente por " +
    code("scripts/inventory-marco8-admin-legacy-v1_2.js") +
    "."
  );
  lines.push("");
  lines.push(
    "Este inventÃ¡rio Ã© estÃ¡tico e serve para orientar a migraÃ§Ã£o gradual do Marco 8. " +
    "Ele nÃ£o altera Firestore, Auth, Functions, Hosting ou dados."
  );
  lines.push("");

  lines.push("## 1. Baseline");
  lines.push("");
  lines.push(
    `- Branch analisada: ${code(branch)}`
  );
  lines.push(
    `- Commit analisado: ${code(baselineSha)}`
  );
  lines.push(
    `- Commit curto: ${code(shortSha(baselineSha))}`
  );
  lines.push(
    "- Escopo frontend: pÃ¡ginas HTML na raiz + mÃ³dulos JavaScript em `js/`."
  );
  lines.push(
    "- Escopo backend: `functions/index.js`, `functions/main.js` e mÃ³dulos JavaScript em `functions/src/`."
  );
  lines.push("");

  lines.push("## 2. Resumo");
  lines.push("");
  lines.push(
    `- Arquivos frontend analisados: **${records.length}**`
  );
  lines.push(
    `- Arquivos classificados como superfÃ­cie administrativa: **${adminRecords.length}**`
  );
  lines.push(
    `- Arquivos com leitura Firestore direta detectada: **${directReadFiles.length}**`
  );
  lines.push(
    `- Arquivos com mutation Firestore direta detectada: **${directMutationFiles.length}**`
  );
  lines.push(
    `- SuperfÃ­cies administrativas com mutation direta: **${adminMutationFiles.length}**`
  );
  lines.push(
    `- OcorrÃªncias de leitura direta detectadas: **${allReadFindings.length}**`
  );
  lines.push(
    `- OcorrÃªncias de mutation direta detectadas: **${allMutationFindings.length}**`
  );
  lines.push(
    `- Collections literais detectadas no frontend: **${collectionUsage.size}**`
  );
  lines.push(
    `- Callables/endpoints literais referenciados pelo frontend: **${allCallableRefs.size}**`
  );
  lines.push(
    `- MÃ³dulos backend com superfÃ­cie de Functions detectada: **${backendInventory.length}**`
  );
  lines.push("");

  lines.push("## 3. SuperfÃ­cies administrativas");
  lines.push("");
  lines.push(
    "| Risco | Arquivo | Reads diretos | Mutations diretas | Collections literais | Callables literais |"
  );
  lines.push(
    "| --- | --- | ---: | ---: | --- | --- |"
  );

  for (
    const record of
      adminRecords.sort((a, b) => {
        const weights = {
          HIGH: 0,
          MEDIUM: 1,
          LOW: 2,
          NONE: 3
        };

        const riskDiff =
          weights[a.risk] -
          weights[b.risk];

        if (riskDiff !== 0) {
          return riskDiff;
        }

        return a.file.localeCompare(
          b.file
        );
      })
  ) {
    lines.push(
      `| ${record.risk} | ${code(record.file)} | ` +
      `${record.readFindings.length} | ` +
      `${record.mutationFindings.length} | ` +
      `${record.collections.length ? record.collections.map(code).join(", ") : "â€”"} | ` +
      `${record.callableRefs.length ? record.callableRefs.map(code).join(", ") : "â€”"} |`
    );
  }

  if (adminRecords.length === 0) {
    lines.push(
      "| â€” | Nenhuma superfÃ­cie administrativa detectada | 0 | 0 | â€” | â€” |"
    );
  }

  lines.push("");

  lines.push(
    "## 4. Mutations Firestore diretas no frontend"
  );
  lines.push("");
  lines.push(
    "Esses pontos sÃ£o candidatos prioritÃ¡rios para encapsulamento por commands server-side."
  );
  lines.push("");

  lines.push(
    "| Arquivo | Linha | OperaÃ§Ã£o | Trecho |"
  );
  lines.push(
    "| --- | ---: | --- | --- |"
  );

  for (
    const finding of
      allMutationFindings.sort((a, b) => {
        const fileDiff =
          a.file.localeCompare(b.file);

        if (fileDiff !== 0) {
          return fileDiff;
        }

        return a.line - b.line;
      })
  ) {
    lines.push(
      `| ${code(finding.file)} | ${finding.line} | ` +
      `${code(finding.operation)} | ` +
      `${code(markdownEscape(finding.snippet))} |`
    );
  }

  if (allMutationFindings.length === 0) {
    lines.push(
      "| â€” | â€” | â€” | Nenhuma mutation direta detectada |"
    );
  }

  lines.push("");

  lines.push(
    "## 5. Leituras Firestore diretas no frontend"
  );
  lines.push("");
  lines.push(
    "| Arquivo | Reads | OperaÃ§Ãµes detectadas |"
  );
  lines.push(
    "| --- | ---: | --- |"
  );

  for (
    const record of
      directReadFiles.sort(
        (a, b) =>
          a.file.localeCompare(b.file)
      )
  ) {
    const ops = [
      ...new Set(
        record.readFindings.map(
          finding =>
            finding.operation
        )
      )
    ].sort();

    lines.push(
      `| ${code(record.file)} | ${record.readFindings.length} | ` +
      `${ops.map(code).join(", ")} |`
    );
  }

  if (directReadFiles.length === 0) {
    lines.push(
      "| â€” | 0 | Nenhuma leitura direta detectada |"
    );
  }

  lines.push("");

  lines.push(
    "## 6. Collections literais referenciadas no frontend"
  );
  lines.push("");
  lines.push(
    "| Collection / primeiro segmento | Arquivos |"
  );
  lines.push(
    "| --- | --- |"
  );

  for (
    const [
      name,
      files
    ] of
      [...collectionUsage.entries()]
        .sort(
          ([a], [b]) =>
            a.localeCompare(b)
        )
  ) {
    lines.push(
      `| ${code(name)} | ` +
      `${[...files].sort().map(code).join(", ")} |`
    );
  }

  if (collectionUsage.size === 0) {
    lines.push(
      "| â€” | Nenhuma collection literal detectada |"
    );
  }

  lines.push("");

  lines.push(
    "## 7. ReferÃªncias literais a Functions no frontend"
  );
  lines.push("");
  lines.push(
    "| Callable / endpoint | Arquivos |"
  );
  lines.push(
    "| --- | --- |"
  );

  for (
    const [
      name,
      files
    ] of
      [...allCallableRefs.entries()]
        .sort(
          ([a], [b]) =>
            a.localeCompare(b)
        )
  ) {
    lines.push(
      `| ${code(name)} | ` +
      `${[...files].sort().map(code).join(", ")} |`
    );
  }

  if (allCallableRefs.size === 0) {
    lines.push(
      "| â€” | Nenhuma referÃªncia literal detectada |"
    );
  }

  lines.push("");

  lines.push(
    "## 8. MÃ³dulos backend com superfÃ­cie de Functions"
  );
  lines.push("");
  lines.push(
    "Este bloco identifica superfÃ­cies existentes potencialmente reutilizÃ¡veis. " +
    "A presenÃ§a no inventÃ¡rio nÃ£o significa que o contrato jÃ¡ seja adequado ao Painel Operacional ou Console."
  );
  lines.push("");
  lines.push(
    "| Arquivo | Factories detectadas | SÃ­mbolos callable/request detectados |"
  );
  lines.push(
    "| --- | --- | --- |"
  );

  for (const record of backendInventory) {
    lines.push(
      `| ${code(record.file)} | ` +
      `${record.factories.length ? record.factories.map(code).join(", ") : "â€”"} | ` +
      `${record.symbols.length ? record.symbols.map(code).join(", ") : "â€”"} |`
    );
  }

  if (backendInventory.length === 0) {
    lines.push(
      "| â€” | â€” | Nenhuma superfÃ­cie detectada |"
    );
  }

  lines.push("");

  lines.push(
    "## 9. Prioridade de migraÃ§Ã£o"
  );
  lines.push("");
  lines.push(
    "### P0 â€” Remover autoridade privilegiada do browser"
  );
  lines.push("");
  lines.push(
    "Todos os arquivos administrativos classificados como `HIGH` devem ser tratados antes que a nova interface replique ou amplie sua funcionalidade."
  );
  lines.push("");

  for (const record of adminMutationFiles) {
    lines.push(
      `- ${code(record.file)} â€” ${record.mutationFindings.length} mutation(s) direta(s).`
    );
  }

  if (adminMutationFiles.length === 0) {
    lines.push(
      "- Nenhum arquivo administrativo com mutation direta foi detectado."
    );
  }

  lines.push("");
  lines.push(
    "### P1 â€” Substituir leituras administrativas cruas por read models"
  );
  lines.push("");
  lines.push(
    "SuperfÃ­cies administrativas com Firestore direto devem migrar para read models sanitizados, paginados e autorizados no backend."
  );
  lines.push("");

  for (
    const record of
      adminRecords.filter(
        item =>
          item.readFindings.length > 0 ||
          item.firestoreOps.length > 0
      )
  ) {
    lines.push(
      `- ${code(record.file)}`
    );
  }

  lines.push("");
  lines.push(
    "### P2 â€” Reutilizar contratos canÃ´nicos existentes"
  );
  lines.push("");
  lines.push(
    "Antes de criar novas Functions, o Gate 8.0C deve confrontar cada necessidade administrativa com os mÃ³dulos backend inventariados acima, evitando duplicaÃ§Ã£o de regras de cursos, financeiro, exames e certificados."
  );
  lines.push("");

  lines.push(
    "## 10. LimitaÃ§Ãµes desta anÃ¡lise"
  );
  lines.push("");
  lines.push(
    "- Ã‰ uma anÃ¡lise estÃ¡tica baseada em padrÃµes de cÃ³digo."
  );
  lines.push(
    "- Collections montadas dinamicamente podem nÃ£o ser identificadas."
  );
  lines.push(
    "- Callables cujo nome Ã© construÃ­do dinamicamente podem nÃ£o aparecer."
  );
  lines.push(
    "- Um arquivo listado como administrativo pode conter tambÃ©m comportamento legado nÃ£o administrativo."
  );
  lines.push(
    "- A anÃ¡lise nÃ£o executa o frontend nem valida autorizaÃ§Ã£o em runtime."
  );
  lines.push(
    "- O Gate 8.0C deverÃ¡ transformar este inventÃ¡rio em matriz RBAC e contratos formais."
  );
  lines.push("");

  lines.push(
    "## 11. CritÃ©rio para o prÃ³ximo gate"
  );
  lines.push("");
  lines.push(
    "O Gate 8.0C sÃ³ deve iniciar depois que este inventÃ¡rio estiver versionado e revisado. " +
    "O prÃ³ximo gate definirÃ¡ capacidades RBAC, read models, commands e boundaries com base nos pontos concretos encontrados aqui."
  );
  lines.push("");

  fs.writeFileSync(
    OUT,
    lines.join("\n").replace(/\n+$/, "") + "\n",
    "utf8"
  );

  console.log(
    `INVENTORY_BASELINE_SHA=${baselineSha}`
  );
  console.log(
    `FRONTEND_FILES_SCANNED=${records.length}`
  );
  console.log(
    `ADMIN_SURFACES=${adminRecords.length}`
  );
  console.log(
    `DIRECT_FIRESTORE_READ_FILES=${directReadFiles.length}`
  );
  console.log(
    `DIRECT_FIRESTORE_MUTATION_FILES=${directMutationFiles.length}`
  );
  console.log(
    `ADMIN_MUTATION_FILES=${adminMutationFiles.length}`
  );
  console.log(
    `DIRECT_FIRESTORE_READ_OCCURRENCES=${allReadFindings.length}`
  );
  console.log(
    `DIRECT_FIRESTORE_MUTATION_OCCURRENCES=${allMutationFindings.length}`
  );
  console.log(
    `FRONTEND_LITERAL_COLLECTIONS=${collectionUsage.size}`
  );
  console.log(
    `FRONTEND_LITERAL_CALLABLE_REFS=${allCallableRefs.size}`
  );
  console.log(
    `BACKEND_FUNCTION_SURFACES=${backendInventory.length}`
  );
  console.log(
    "PANEL_SUPERADMIN_MUTATION_BASELINE=CONFIRMED"
  );
  console.log(
    "MARCO8_LEGACY_ADMIN_INVENTORY=GENERATED"
  );
}

main();