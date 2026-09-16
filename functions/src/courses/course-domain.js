"use strict";

const COURSE_OWNER_TYPES =
  Object.freeze([
    "platform",
    "user",
    "organization"
  ]);

const COURSE_VISIBILITIES =
  Object.freeze([
    "platform",
    "organization",
    "private"
  ]);

const COURSE_STATUSES =
  Object.freeze([
    "draft",
    "review",
    "published",
    "suspended",
    "archived"
  ]);

const COURSE_CURRENCIES =
  Object.freeze([
    "BRL"
  ]);

const COURSE_STATUS_TRANSITIONS =
  Object.freeze({
    draft:
      Object.freeze([
        "draft",
        "review",
        "archived"
      ]),

    review:
      Object.freeze([
        "review",
        "draft",
        "published",
        "archived"
      ]),

    published:
      Object.freeze([
        "published",
        "suspended",
        "archived"
      ]),

    suspended:
      Object.freeze([
        "suspended",
        "published",
        "archived"
      ]),

    archived:
      Object.freeze([
        "archived"
      ])
  });

class CourseDomainError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "CourseDomainError";

    this.code =
      code;
  }
}

function text(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const result =
    String(value)
      .trim();

  return result || null;
}

function lowercase(value) {
  const valueText =
    text(value);

  return valueText
    ? valueText.toLowerCase()
    : null;
}

function uniqueStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [
    ...new Set(
      value
        .map(text)
        .filter(Boolean)
    )
  ];
}

function normalizePriceCents(value) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return 0;
  }

  const number =
    Number(value);

  return Number.isInteger(number)
    ? number
    : Number.NaN;
}

function normalizeCourseInput(
  input = {}
) {
  const isPaid =
    input.isPaid === true;

  return {
    title:
      text(input.title),

    description:
      text(input.description),

    ownerType:
      lowercase(input.ownerType),

    ownerId:
      text(input.ownerId),

    instructorIds:
      uniqueStringArray(
        input.instructorIds
      ),

    visibility:
      lowercase(
        input.visibility
      ) ||
      "platform",

    organizationId:
      text(
        input.organizationId
      ),

    status:
      lowercase(
        input.status
      ) ||
      "draft",

    isPaid,

    priceCents:
      normalizePriceCents(
        input.priceCents
      ),

    currency:
      (
        text(input.currency) ||
        "BRL"
      ).toUpperCase(),

    financialRuleId:
      text(
        input.financialRuleId
      ),

    publishedAt:
      input.publishedAt ??
      null
  };
}

function requireEnum(
  value,
  allowed,
  field
) {
  if (!allowed.includes(value)) {
    throw new CourseDomainError(
      "INVALID_ENUM",
      `${field} invalido.`
    );
  }
}

function validateBasicCourse(
  course
) {
  requireEnum(
    course.ownerType,
    COURSE_OWNER_TYPES,
    "ownerType"
  );

  requireEnum(
    course.visibility,
    COURSE_VISIBILITIES,
    "visibility"
  );

  requireEnum(
    course.status,
    COURSE_STATUSES,
    "status"
  );

  requireEnum(
    course.currency,
    COURSE_CURRENCIES,
    "currency"
  );

  if (
    !course.title ||
    course.title.length < 3
  ) {
    throw new CourseDomainError(
      "INVALID_TITLE",
      "O curso precisa de um titulo com pelo menos 3 caracteres."
    );
  }

  if (
    course.title.length > 160
  ) {
    throw new CourseDomainError(
      "INVALID_TITLE",
      "O titulo do curso excede 160 caracteres."
    );
  }

  if (
    course.description &&
    course.description.length >
      10000
  ) {
    throw new CourseDomainError(
      "INVALID_DESCRIPTION",
      "A descricao do curso excede 10000 caracteres."
    );
  }

  if (
    course.ownerType !==
      "platform" &&
    !course.ownerId
  ) {
    throw new CourseDomainError(
      "OWNER_REQUIRED",
      "Cursos de usuario ou organizacao exigem ownerId."
    );
  }

  if (
    course.visibility ===
      "organization" &&
    !course.organizationId
  ) {
    throw new CourseDomainError(
      "ORGANIZATION_REQUIRED",
      "Curso exclusivo de organizacao exige organizationId."
    );
  }

  if (
    course.visibility ===
      "platform" &&
    course.organizationId
  ) {
    throw new CourseDomainError(
      "INVALID_ORGANIZATION_SCOPE",
      "Curso de catalogo da plataforma nao pode possuir organizationId."
    );
  }

  if (
    !Number.isInteger(
      course.priceCents
    ) ||
    course.priceCents < 0
  ) {
    throw new CourseDomainError(
      "INVALID_PRICE",
      "priceCents deve ser um inteiro nao negativo."
    );
  }

  if (
    course.isPaid &&
    course.priceCents <= 0
  ) {
    throw new CourseDomainError(
      "INVALID_PRICE",
      "Curso pago precisa possuir preco maior que zero."
    );
  }

  if (
    !course.isPaid &&
    course.priceCents !== 0
  ) {
    throw new CourseDomainError(
      "INVALID_PRICE",
      "Curso gratuito precisa possuir priceCents igual a zero."
    );
  }

  return true;
}

function validateCourseForStatus(
  input,
  targetStatus = null
) {
  const course =
    normalizeCourseInput({
      ...input,

      status:
        targetStatus ||
        input?.status
    });

  validateBasicCourse(
    course
  );

  if (
    [
      "review",
      "published"
    ].includes(
      course.status
    )
  ) {
    if (
      !course.description ||
      course.description.length < 20
    ) {
      throw new CourseDomainError(
        "COURSE_INCOMPLETE",
        "Curso em revisao ou publicado precisa de descricao com pelo menos 20 caracteres."
      );
    }

    if (
      course.instructorIds.length <
      1
    ) {
      throw new CourseDomainError(
        "COURSE_INCOMPLETE",
        "Curso em revisao ou publicado precisa de pelo menos um instrutor."
      );
    }
  }

  return course;
}

function canTransitionCourseStatus(
  fromStatus,
  toStatus
) {
  const from =
    lowercase(fromStatus);

  const to =
    lowercase(toStatus);

  if (
    !COURSE_STATUSES.includes(
      from
    ) ||
    !COURSE_STATUSES.includes(
      to
    )
  ) {
    return false;
  }

  return Boolean(
    COURSE_STATUS_TRANSITIONS[
      from
    ]?.includes(to)
  );
}

function assertCourseStatusTransition(
  fromStatus,
  toStatus
) {
  if (
    !canTransitionCourseStatus(
      fromStatus,
      toStatus
    )
  ) {
    throw new CourseDomainError(
      "INVALID_STATUS_TRANSITION",
      `Transicao de ${fromStatus} para ${toStatus} nao permitida.`
    );
  }

  return true;
}

function isPublicCatalogCourse(
  course
) {
  return (
    course?.status ===
      "published" &&
    course?.visibility ===
      "platform"
  );
}

function toPublicCourseView(
  courseId,
  input
) {
  const course =
    normalizeCourseInput(
      input
    );

  if (
    !isPublicCatalogCourse(
      course
    )
  ) {
    return null;
  }

  return {
    id:
      String(courseId),

    title:
      course.title,

    description:
      course.description,

    isPaid:
      course.isPaid,

    priceCents:
      course.priceCents,

    currency:
      course.currency,

    publishedAt:
      course.publishedAt
  };
}

module.exports = {
  COURSE_OWNER_TYPES,
  COURSE_VISIBILITIES,
  COURSE_STATUSES,
  COURSE_CURRENCIES,
  COURSE_STATUS_TRANSITIONS,
  CourseDomainError,
  normalizeCourseInput,
  validateBasicCourse,
  validateCourseForStatus,
  canTransitionCourseStatus,
  assertCourseStatusTransition,
  isPublicCatalogCourse,
  toPublicCourseView
};