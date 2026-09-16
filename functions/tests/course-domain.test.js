"use strict";

const assert =
  require("node:assert/strict");

const {
  COURSE_OWNER_TYPES,
  COURSE_VISIBILITIES,
  COURSE_STATUSES,
  normalizeCourseInput,
  validateBasicCourse,
  validateCourseForStatus,
  canTransitionCourseStatus,
  assertCourseStatusTransition,
  toPublicCourseView
} =
  require("../src/courses/course-domain");

let passed =
  0;

function test(name, fn) {
  try {
    fn();

    passed++;

    console.log(
      `PASS | ${name}`
    );
  }
  catch (error) {
    console.error(
      `FAIL | ${name}`
    );

    throw error;
  }
}

function baseCourse(
  overrides = {}
) {
  return {
    title:
      "Fundamentos do Jiu-Jitsu",

    description:
      "Curso completo com fundamentos tecnicos para praticantes de Jiu-Jitsu.",

    ownerType:
      "platform",

    ownerId:
      null,

    instructorIds:
      ["prof1"],

    visibility:
      "platform",

    organizationId:
      null,

    status:
      "draft",

    isPaid:
      false,

    priceCents:
      0,

    currency:
      "BRL",

    financialRuleId:
      null,

    publishedAt:
      null,

    ...overrides
  };
}

test(
  "Enums canonicos de curso permanecem estaveis",
  () => {
    assert.deepEqual(
      COURSE_OWNER_TYPES,
      [
        "platform",
        "user",
        "organization"
      ]
    );

    assert.deepEqual(
      COURSE_VISIBILITIES,
      [
        "platform",
        "organization",
        "private"
      ]
    );

    assert.deepEqual(
      COURSE_STATUSES,
      [
        "draft",
        "review",
        "published",
        "suspended",
        "archived"
      ]
    );
  }
);

test(
  "Normalizacao elimina instrutores duplicados",
  () => {
    const result =
      normalizeCourseInput(
        baseCourse({
          instructorIds: [
            "prof1",
            "prof1",
            " prof2 "
          ]
        })
      );

    assert.deepEqual(
      result.instructorIds,
      [
        "prof1",
        "prof2"
      ]
    );
  }
);

test(
  "Curso gratuito de plataforma e valido",
  () => {
    assert.equal(
      validateBasicCourse(
        normalizeCourseInput(
          baseCourse()
        )
      ),
      true
    );
  }
);

test(
  "Curso pago exige preco positivo em centavos",
  () => {
    assert.throws(
      () =>
        validateBasicCourse(
          normalizeCourseInput(
            baseCourse({
              isPaid:
                true,
              priceCents:
                0
            })
          )
        ),
      /preco maior que zero/
    );
  }
);

test(
  "Curso gratuito nao aceita preco diferente de zero",
  () => {
    assert.throws(
      () =>
        validateBasicCourse(
          normalizeCourseInput(
            baseCourse({
              isPaid:
                false,
              priceCents:
                19900
            })
          )
        ),
      /priceCents igual a zero/
    );
  }
);

test(
  "Preco precisa ser inteiro",
  () => {
    assert.throws(
      () =>
        validateBasicCourse(
          normalizeCourseInput(
            baseCourse({
              isPaid:
                true,
              priceCents:
                199.99
            })
          )
        ),
      /inteiro nao negativo/
    );
  }
);

test(
  "Owner user exige ownerId",
  () => {
    assert.throws(
      () =>
        validateBasicCourse(
          normalizeCourseInput(
            baseCourse({
              ownerType:
                "user",
              ownerId:
                null
            })
          )
        ),
      /ownerId/
    );
  }
);

test(
  "Owner organization exige ownerId",
  () => {
    assert.throws(
      () =>
        validateBasicCourse(
          normalizeCourseInput(
            baseCourse({
              ownerType:
                "organization",
              ownerId:
                null
            })
          )
        ),
      /ownerId/
    );
  }
);

test(
  "Visibilidade organization exige organizationId",
  () => {
    assert.throws(
      () =>
        validateBasicCourse(
          normalizeCourseInput(
            baseCourse({
              visibility:
                "organization",
              organizationId:
                null
            })
          )
        ),
      /organizationId/
    );
  }
);

test(
  "Catalogo platform nao aceita organizationId",
  () => {
    assert.throws(
      () =>
        validateBasicCourse(
          normalizeCourseInput(
            baseCourse({
              visibility:
                "platform",
              organizationId:
                "org1"
            })
          )
        ),
      /nao pode possuir organizationId/
    );
  }
);

test(
  "Draft pode existir sem instrutor",
  () => {
    const result =
      validateCourseForStatus(
        baseCourse({
          instructorIds:
            [],
          description:
            null,
          status:
            "draft"
        })
      );

    assert.equal(
      result.status,
      "draft"
    );
  }
);

test(
  "Review exige descricao completa",
  () => {
    assert.throws(
      () =>
        validateCourseForStatus(
          baseCourse({
            description:
              "Curta",
            status:
              "review"
          })
        ),
      /descricao/
    );
  }
);

test(
  "Review exige instrutor",
  () => {
    assert.throws(
      () =>
        validateCourseForStatus(
          baseCourse({
            instructorIds:
              [],
            status:
              "review"
          })
        ),
      /instrutor/
    );
  }
);

test(
  "Published completo e valido",
  () => {
    const result =
      validateCourseForStatus(
        baseCourse({
          status:
            "published"
        })
      );

    assert.equal(
      result.status,
      "published"
    );
  }
);

test(
  "Draft pode seguir para review",
  () => {
    assert.equal(
      canTransitionCourseStatus(
        "draft",
        "review"
      ),
      true
    );
  }
);

test(
  "Draft nao publica diretamente",
  () => {
    assert.equal(
      canTransitionCourseStatus(
        "draft",
        "published"
      ),
      false
    );

    assert.throws(
      () =>
        assertCourseStatusTransition(
          "draft",
          "published"
        ),
      /nao permitida/
    );
  }
);

test(
  "Curso suspenso pode ser republicado",
  () => {
    assert.equal(
      canTransitionCourseStatus(
        "suspended",
        "published"
      ),
      true
    );
  }
);

test(
  "Curso arquivado nao pode ser reativado",
  () => {
    assert.equal(
      canTransitionCourseStatus(
        "archived",
        "published"
      ),
      false
    );
  }
);

test(
  "Catalogo publico recebe apenas curso published platform",
  () => {
    const result =
      toPublicCourseView(
        "curso1",
        baseCourse({
          status:
            "published",
          ownerId:
            "internal-owner",
          financialRuleId:
            "finance-rule-secret"
        })
      );

    assert.equal(
      result.id,
      "curso1"
    );

    assert.equal(
      result.title,
      "Fundamentos do Jiu-Jitsu"
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty
        .call(
          result,
          "ownerId"
        ),
      false
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty
        .call(
          result,
          "financialRuleId"
        ),
      false
    );

    assert.equal(
      Object.prototype
        .hasOwnProperty
        .call(
          result,
          "instructorIds"
        ),
      false
    );
  }
);

test(
  "Draft nao aparece no catalogo publico",
  () => {
    assert.equal(
      toPublicCourseView(
        "curso1",
        baseCourse({
          status:
            "draft"
        })
      ),
      null
    );
  }
);

test(
  "Curso organization nao aparece no catalogo publico",
  () => {
    assert.equal(
      toPublicCourseView(
        "curso1",
        baseCourse({
          status:
            "published",
          visibility:
            "organization",
          organizationId:
            "org1"
        })
      ),
      null
    );
  }
);

console.log("");
console.log(
  `RESULTADO_COURSE_DOMAIN=${passed}/21`
);

if (passed !== 21) {
  process.exit(1);
}