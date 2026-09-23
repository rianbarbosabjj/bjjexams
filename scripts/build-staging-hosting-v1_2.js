"use strict";

const fs =
  require("fs");

const path =
  require("path");

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

const OUT_DIR =
  path.join(
    ROOT,
    ".firebase-hosting-staging"
  );

const ALLOWED_FILES =
  Object.freeze([
    "404.html",
    "catalogo.html",
    "contato.html",
    "cursos.html",
    "exame.html",
    "index.html",
    "login.html",
    "painel_admin.html",
    "painel_aluno.html",
    "painel_professor.html",
    "painel_superadmin.html",
    "privacidade.html",
    "sala_aula.html",
    "termos.html",
    "validar.html",

    "logo_bjj_exams_ofc.png",

    "js/admin-financial-ops-entry-v1_2.js",
    "js/belt-exam-api-v1_2.js",
    "js/belt-exam-execution-ui-v1_2.js",
    "js/belt-exam-instructor-ui-v1_2.js",
    "js/belt-exam-student-ui-v1_2.js",
    "js/course-admin-api-v1_2.js",
    "js/course-content-api-v1_2.js",
    "js/course-content-ui-v1_2.js",
    "js/course-exception-review-ui-v1_2.js",
    "js/course-hybrid-moderation-api-v1_2.js",
    "js/course-instructor-ui-v1_2.js",
    "js/course-moderation-ui-v1_2.js",
    "js/course-price-mask-v1_2.js",
    "js/course-public-api-v1_2.js",
    "js/course-purchase-api-v1_2.js",
    "js/course-purchase-ui-v1_2.js",
    "js/course-student-api-v1_2.js",
    "js/course-student-ui-v1_2.js",
    "js/exam-certificate-public-api-v1_2.js",
    "js/financial-ops-admin-bootstrap-v1_2.js",
    "js/financial-ops-ui-v1_2.js",
    "js/firebase-runtime-v1_2.js"
  ]);

function assertInside(
  candidate,
  parent,
  label
) {
  const resolvedCandidate =
    path.resolve(
      candidate
    );

  const resolvedParent =
    path.resolve(
      parent
    );

  if (
    resolvedCandidate !==
      resolvedParent &&
    !resolvedCandidate.startsWith(
      `${resolvedParent}${path.sep}`
    )
  ) {
    throw new Error(
      `${label} escapou do diretório permitido.`
    );
  }

  return resolvedCandidate;
}

function build() {
  if (
    new Set(
      ALLOWED_FILES
    ).size !==
      ALLOWED_FILES.length
  ) {
    throw new Error(
      "Allow-list contém arquivos duplicados."
    );
  }

  if (
    ALLOWED_FILES.length !==
      38
  ) {
    throw new Error(
      `Allow-list inesperada: ${ALLOWED_FILES.length}/38.`
    );
  }

  fs.rmSync(
    OUT_DIR,
    {
      recursive:
        true,
      force:
        true
    }
  );

  fs.mkdirSync(
    OUT_DIR,
    {
      recursive:
        true
    }
  );

  for (
    const relativePath of
      ALLOWED_FILES
  ) {
    const source =
      assertInside(
        path.join(
          ROOT,
          relativePath
        ),
        ROOT,
        "Source"
      );

    const destination =
      assertInside(
        path.join(
          OUT_DIR,
          relativePath
        ),
        OUT_DIR,
        "Destination"
      );

    if (
      !fs.existsSync(
        source
      )
    ) {
      throw new Error(
        `Arquivo público ausente: ${relativePath}`
      );
    }

    const stat =
      fs.statSync(
        source
      );

    if (
      !stat.isFile()
    ) {
      throw new Error(
        `Entrada pública não é arquivo: ${relativePath}`
      );
    }

    fs.mkdirSync(
      path.dirname(
        destination
      ),
      {
        recursive:
          true
      }
    );

    fs.copyFileSync(
      source,
      destination
    );
  }

  return Object.freeze({
    outputDirectory:
      OUT_DIR,
    files:
      ALLOWED_FILES.length
  });
}

if (
  require.main ===
    module
) {
  const result =
    build();

  console.log(
    `STAGING_HOSTING_ARTIFACT=${result.files}/38`
  );

  console.log(
    `STAGING_HOSTING_OUTPUT=${result.outputDirectory}`
  );
}

module.exports = Object.freeze({
  ROOT,
  OUT_DIR,
  ALLOWED_FILES,
  build
});