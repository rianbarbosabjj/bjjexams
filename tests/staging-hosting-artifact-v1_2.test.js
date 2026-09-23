"use strict";

const assert =
  require("node:assert/strict");

const crypto =
  require("crypto");

const fs =
  require("fs");

const path =
  require("path");

const {
  ROOT,
  OUT_DIR,
  ALLOWED_FILES
} =
  require(
    "../scripts/build-staging-hosting-v1_2"
  );

let passed =
  0;

function test(
  name,
  fn
) {
  fn();

  passed += 1;

  console.log(
    `PASS | ${name}`
  );
}

function normalizePath(
  value
) {
  return String(
    value || ""
  )
    .replace(
      /\\/g,
      "/"
    )
    .replace(
      /^\/+/,
      ""
    );
}

function walkFiles(
  directory
) {
  const result =
    [];

  function walk(
    current
  ) {
    for (
      const entry of
        fs.readdirSync(
          current,
          {
            withFileTypes:
              true
          }
        )
    ) {
      const absolute =
        path.join(
          current,
          entry.name
        );

      if (
        entry.isDirectory()
      ) {
        walk(
          absolute
        );
      } else if (
        entry.isFile()
      ) {
        result.push(
          normalizePath(
            path.relative(
              directory,
              absolute
            )
          )
        );
      }
    }
  }

  walk(
    directory
  );

  return result.sort();
}

function sha256(
  filePath
) {
  return crypto
    .createHash(
      "sha256"
    )
    .update(
      fs.readFileSync(
        filePath
      )
    )
    .digest(
      "hex"
    );
}

function localDependency(
  raw
) {
  const value =
    String(
      raw || ""
    ).trim();

  if (
    !value ||
    value.startsWith("#") ||
    value.includes("${") ||
    value.includes("{{") ||
    value.includes("<%") ||
    /^(?:https?:|data:|mailto:|tel:|javascript:|\/\/)/i.test(
      value
    ) ||
    value.startsWith(
      "/__/"
    )
  ) {
    return null;
  }

  const withoutQuery =
    value
      .split("#")[0]
      .split("?")[0]
      .trim();

  if (
    !withoutQuery
  ) {
    return null;
  }

  const normalized =
    normalizePath(
      withoutQuery.replace(
        /^\.\//,
        ""
      )
    );

  if (
    !path.extname(
      normalized
    )
  ) {
    return null;
  }

  return normalized;
}

test(
  "allow-list possui exatamente 38 arquivos unicos",
  () => {
    assert.equal(
      ALLOWED_FILES.length,
      38
    );

    assert.equal(
      new Set(
        ALLOWED_FILES
      ).size,
      38
    );
  }
);

test(
  "artefato possui exatamente a allow-list",
  () => {
    assert.deepEqual(
      walkFiles(
        OUT_DIR
      ),
      [
        ...ALLOWED_FILES
      ].sort()
    );
  }
);

test(
  "cada arquivo publicado e byte-identico ao source",
  () => {
    for (
      const relativePath of
        ALLOWED_FILES
    ) {
      assert.equal(
        sha256(
          path.join(
            OUT_DIR,
            relativePath
          )
        ),
        sha256(
          path.join(
            ROOT,
            relativePath
          )
        ),
        relativePath
      );
    }
  }
);

test(
  "config de hosting aponta exclusivamente para staging",
  () => {
    const config =
      JSON.parse(
        fs.readFileSync(
          path.join(
            ROOT,
            "firebase.staging-hosting.json"
          ),
          "utf8"
        )
      );

    assert.equal(
      config.hosting.site,
      "bjj-exams-staging"
    );

    assert.equal(
      config.hosting.public,
      ".firebase-hosting-staging"
    );

    assert.equal(
      config.hosting.trailingSlash,
      false
    );
  }
);

test(
  "firebase json principal continua sem hosting",
  () => {
    const config =
      JSON.parse(
        fs.readFileSync(
          path.join(
            ROOT,
            "firebase.json"
          ),
          "utf8"
        )
      );

    assert.equal(
      Object.hasOwn(
        config,
        "hosting"
      ),
      false
    );
  }
);

test(
  "diretorios internos nunca entram no artefato",
  () => {
    for (
      const forbidden of [
        "functions/",
        "tests/",
        "scripts/",
        "docs/",
        ".git/",
        ".github/"
      ]
    ) {
      assert.equal(
        ALLOWED_FILES.some(
          file =>
            normalizePath(file)
              .startsWith(
                forbidden
              )
        ),
        false,
        forbidden
      );
    }
  }
);

test(
  "configuracoes internas e secrets nao sao publicados",
  () => {
    const forbiddenNames =
      new Set([
        ".firebaserc",
        ".gitignore",
        "firebase.json",
        "firebase.staging-hosting.json",
        "firestore.rules",
        "firestore.indexes.json",
        "package.json",
        "package-lock.json",
        ".env",
        ".env.local",
        "js/firebase-config.local.json"
      ]);

    for (
      const file of
        walkFiles(
          OUT_DIR
        )
    ) {
      assert.equal(
        forbiddenNames.has(
          file
        ),
        false,
        file
      );
    }
  }
);

test(
  "firebase config local nao existe no artefato",
  () => {
    assert.equal(
      fs.existsSync(
        path.join(
          OUT_DIR,
          "js",
          "firebase-config.local.json"
        )
      ),
      false
    );
  }
);

test(
  "dependencias locais declaradas nos html estao presentes",
  () => {
    const artifactFiles =
      new Set(
        walkFiles(
          OUT_DIR
        )
      );

    const htmlFiles =
      ALLOWED_FILES.filter(
        file =>
          file.endsWith(
            ".html"
          )
      );

    const attributePattern =
      /(?:src|href)\s*=\s*["']([^"']+)["']/gi;

    for (
      const htmlFile of
        htmlFiles
    ) {
      const html =
        fs.readFileSync(
          path.join(
            ROOT,
            htmlFile
          ),
          "utf8"
        );

      let match;

      while (
        (
          match =
            attributePattern.exec(
              html
            )
        )
      ) {
        const dependency =
          localDependency(
            match[1]
          );

        if (
          !dependency
        ) {
          continue;
        }

        assert.equal(
          artifactFiles.has(
            dependency
          ),
          true,
          `${htmlFile} -> ${dependency}`
        );
      }
    }
  }
);

test(
  "rotas html literais dos javascript apontam para paginas publicadas",
  () => {
    const artifactFiles =
      new Set(
        walkFiles(
          OUT_DIR
        )
      );

    const jsFiles =
      ALLOWED_FILES.filter(
        file =>
          file.endsWith(
            ".js"
          )
      );

    const pagePattern =
      /["'`](?:\.\/)?([A-Za-z0-9_-]+\.html)(?:\?[^"'`]*)?["'`]/g;

    for (
      const jsFile of
        jsFiles
    ) {
      const source =
        fs.readFileSync(
          path.join(
            ROOT,
            jsFile
          ),
          "utf8"
        );

      let match;

      while (
        (
          match =
            pagePattern.exec(
              source
            )
        )
      ) {
        assert.equal(
          artifactFiles.has(
            match[1]
          ),
          true,
          `${jsFile} -> ${match[1]}`
        );
      }
    }
  }
);

test(
  "superficies criticas do Marco 7 estao no artefato",
  () => {
    for (
      const required of [
        "painel_aluno.html",
        "painel_professor.html",
        "exame.html",
        "validar.html",
        "js/firebase-runtime-v1_2.js",
        "js/belt-exam-api-v1_2.js",
        "js/belt-exam-student-ui-v1_2.js",
        "js/belt-exam-instructor-ui-v1_2.js",
        "js/belt-exam-execution-ui-v1_2.js",
        "js/exam-certificate-public-api-v1_2.js"
      ]
    ) {
      assert.equal(
        ALLOWED_FILES.includes(
          required
        ),
        true,
        required
      );
    }
  }
);

test(
  "site possui entrypoint e pagina 404 mas nao publica index legado alternativo",
  () => {
    assert.equal(
      fs.existsSync(
        path.join(
          OUT_DIR,
          "index.html"
        )
      ),
      true
    );

    assert.equal(
      fs.existsSync(
        path.join(
          OUT_DIR,
          "404.html"
        )
      ),
      true
    );

    assert.equal(
      fs.existsSync(
        path.join(
          OUT_DIR,
          "index_2.html"
        )
      ),
      false
    );
  }
);

console.log(
  `STAGING_HOSTING_ARTIFACT_CONTRACT_V1_2=${passed}/12`
);

if (
  passed !==
    12
) {
  process.exitCode =
    1;
}