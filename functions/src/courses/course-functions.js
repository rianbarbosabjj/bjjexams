"use strict";

const {
  onCall,
  HttpsError
} =
  require(
    "firebase-functions/v2/https"
  );

const {
  FieldValue
} =
  require(
    "firebase-admin/firestore"
  );

const {
  hasGlobalRole
} =
  require(
    "../auth/global-claims"
  );

const {
  CourseDomainError,
  normalizeCourseInput,
  validateCourseForStatus,
  assertCourseStatusTransition
} =
  require(
    "./course-domain"
  );

function createCourseFunctions(
  dependencies = {}
) {
  const {
    REGION,
    db
  } =
    dependencies;

  if (
    !REGION ||
    !db
  ) {
    throw new Error(
      "Courses v1.2: infraestrutura obrigatoria ausente."
    );
  }

  function requireAuth(
    request
  ) {
    const uid =
      request.auth?.uid;

    if (!uid) {
      throw new HttpsError(
        "unauthenticated",
        "Faça login para continuar."
      );
    }

    return uid;
  }

  function isCourseModerator(
    request
  ) {
    const claims =
      request.auth?.token ||
      {};

    return (
      hasGlobalRole(
        claims,
        "platform_admin"
      ) ||
      hasGlobalRole(
        claims,
        "content_admin"
      )
    );
  }

  function moderatorRole(
    request
  ) {
    const claims =
      request.auth?.token ||
      {};

    if (
      claims.super_admin ===
      true
    ) {
      return "super_admin";
    }

    if (
      claims.platform_admin ===
      true
    ) {
      return "platform_admin";
    }

    if (
      claims.content_admin ===
      true
    ) {
      return "content_admin";
    }

    return null;
  }

  function canonicalLegacyRole(
    data = {}
  ) {
    return String(
      data.tipo_usuario ||
      data.tipoUsuario ||
      data.papel_principal ||
      ""
    )
      .trim()
      .toLowerCase();
  }

  async function resolveCourseActor(
    request
  ) {
    const uid =
      requireAuth(
        request
      );

    const [
      userSnap,
      professorSnap
    ] =
      await db.getAll(
        db.doc(
          `usuarios/${uid}`
        ),
        db.doc(
          `professores/${uid}`
        )
      );

    const moderator =
      isCourseModerator(
        request
      );

    const legacyRole =
      userSnap.exists
        ? canonicalLegacyRole(
            userSnap.data()
          )
        : null;

    // Compatibilidade temporaria:
    // a identidade de instrutor ainda e derivada do perfil legado.
    // Academia NAO e requisito para criacao de curso.
    const instructor =
      (
        legacyRole ===
          "professor" ||
        legacyRole ===
          "instrutor" ||
        professorSnap.exists
      );

    return {
      uid,
      moderator,
      moderatorRole:
        moderatorRole(
          request
        ),
      instructor
    };
  }

  function domainError(
    error
  ) {
    if (
      error instanceof
      CourseDomainError
    ) {
      const code =
        error.code ===
        "INVALID_STATUS_TRANSITION"
          ? "failed-precondition"
          : "invalid-argument";

      throw new HttpsError(
        code,
        error.message,
        {
          domainCode:
            error.code
        }
      );
    }

    throw error;
  }

  function managedCourseView(
    id,
    data
  ) {
    return {
      id,

      title:
        data.title ||
        null,

      description:
        data.description ||
        null,

      ownerType:
        data.ownerType ||
        null,

      ownerId:
        data.ownerId ||
        null,

      instructorIds:
        Array.isArray(
          data.instructorIds
        )
          ? data.instructorIds
          : [],

      visibility:
        data.visibility ||
        null,

      organizationId:
        data.organizationId ||
        null,

      status:
        data.status ||
        null,

      isPaid:
        data.isPaid ===
        true,

      priceCents:
        Number(
          data.priceCents ||
          0
        ),

      currency:
        data.currency ||
        "BRL",

      publishedAt:
        data.publishedAt ||
        null,

      createdAt:
        data.createdAt ||
        null,

      updatedAt:
        data.updatedAt ||
        null,

      createdBy:
        data.createdBy ||
        null
    };
  }

  function assertNoOrganizationCourseYet(
    course
  ) {
    if (
      course.ownerType ===
        "organization" ||
      course.visibility ===
        "organization"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Cursos institucionais serão habilitados após a camada canônica de organizações."
      );
    }
  }

  function assertEditableFields(
    data
  ) {
    const allowed =
      new Set([
        "courseId",
        "title",
        "description",
        "instructorIds",
        "visibility",
        "organizationId",
        "isPaid",
        "priceCents",
        "currency"
      ]);

    const forbidden =
      Object.keys(
        data || {}
      )
        .filter(
          key =>
            !allowed.has(key)
        );

    if (
      forbidden.length >
      0
    ) {
      throw new HttpsError(
        "invalid-argument",
        "A atualização contém campos não permitidos.",
        {
          forbiddenFields:
            forbidden
        }
      );
    }
  }

  function isOwnerActor(
    actor,
    course
  ) {
    return (
      actor.instructor ===
        true &&
      course.ownerType ===
        "user" &&
      course.ownerId ===
        actor.uid
    );
  }

  function auditPayload({
    actor,
    action,
    entityId,
    before,
    after
  }) {
    return {
      actorId:
        actor.uid,

      actorRole:
        actor.moderatorRole ||
        (
          actor.instructor
            ? "instructor"
            : "user"
        ),

      action,

      entityType:
        "course",

      entityId,

      before:
        before ||
        null,

      after:
        after ||
        null,

      source:
        "function",

      requestId:
        null,

      createdAt:
        FieldValue
          .serverTimestamp()
    };
  }

  // ============================================================
  // CREATE
  // ============================================================

  const criarCursoV12 =
    onCall(
      {
        region:
          REGION
      },
      async request => {
        const actor =
          await resolveCourseActor(
            request
          );

        const data =
          request.data ||
          {};

        let ownerType =
          String(
            data.ownerType ||
            (
              actor.moderator
                ? "platform"
                : "user"
            )
          )
            .trim()
            .toLowerCase();

        let ownerId =
          null;

        let instructorIds =
          Array.isArray(
            data.instructorIds
          )
            ? data.instructorIds
            : [];

        if (
          ownerType ===
          "platform"
        ) {
          if (
            !actor.moderator
          ) {
            throw new HttpsError(
              "permission-denied",
              "Somente a administração da plataforma pode criar cursos da plataforma."
            );
          }

          ownerId =
            null;
        }
        else if (
          ownerType ===
          "user"
        ) {
          if (
            !actor.instructor
          ) {
            throw new HttpsError(
              "permission-denied",
              "Somente instrutores podem criar cursos próprios."
            );
          }

          ownerId =
            actor.uid;

          instructorIds =
            [
              ...new Set([
                actor.uid,
                ...instructorIds
              ])
            ];
        }
        else if (
          ownerType ===
          "organization"
        ) {
          throw new HttpsError(
            "failed-precondition",
            "Cursos pertencentes a organizações ainda não estão habilitados nesta etapa."
          );
        }
        else {
          throw new HttpsError(
            "invalid-argument",
            "Tipo de proprietário inválido."
          );
        }

        let course;

        try {
          course =
            validateCourseForStatus({
              title:
                data.title,

              description:
                data.description,

              ownerType,

              ownerId,

              instructorIds,

              visibility:
                data.visibility ||
                "platform",

              organizationId:
                data.organizationId ||
                null,

              status:
                "draft",

              isPaid:
                data.isPaid ===
                true,

              priceCents:
                data.priceCents,

              currency:
                data.currency ||
                "BRL",

              financialRuleId:
                null,

              publishedAt:
                null
            });
        }
        catch (error) {
          domainError(
            error
          );
        }

        assertNoOrganizationCourseYet(
          course
        );

        const courseRef =
          db.collection(
            "courses"
          ).doc();

        const auditRef =
          db.collection(
            "audit_logs"
          ).doc();

        const persisted = {
          ...course,

          financialRuleId:
            null,

          createdBy:
            actor.uid,

          createdAt:
            FieldValue
              .serverTimestamp(),

          updatedAt:
            FieldValue
              .serverTimestamp()
        };

        const batch =
          db.batch();

        batch.create(
          courseRef,
          persisted
        );

        batch.create(
          auditRef,
          auditPayload({
            actor,
            action:
              "course.create",
            entityId:
              courseRef.id,
            before:
              null,
            after:
              course
          })
        );

        await batch.commit();

        const created =
          await courseRef.get();

        return {
          ok:
            true,

          course:
            managedCourseView(
              courseRef.id,
              created.data()
            )
        };
      }
    );

  // ============================================================
  // UPDATE
  // ============================================================

  const atualizarCursoV12 =
    onCall(
      {
        region:
          REGION
      },
      async request => {
        const actor =
          await resolveCourseActor(
            request
          );

        const data =
          request.data ||
          {};

        assertEditableFields(
          data
        );

        const courseId =
          String(
            data.courseId ||
            ""
          ).trim();

        if (!courseId) {
          throw new HttpsError(
            "invalid-argument",
            "Curso inválido."
          );
        }

        const courseRef =
          db.doc(
            `courses/${courseId}`
          );

        const auditRef =
          db.collection(
            "audit_logs"
          ).doc();

        let result =
          null;

        await db.runTransaction(
          async tx => {
            const snap =
              await tx.get(
                courseRef
              );

            if (!snap.exists) {
              throw new HttpsError(
                "not-found",
                "Curso não encontrado."
              );
            }

            const existing =
              snap.data();

            const owner =
              isOwnerActor(
                actor,
                existing
              );

            if (
              !actor.moderator &&
              !owner
            ) {
              throw new HttpsError(
                "permission-denied",
                "Você não pode editar este curso."
              );
            }

            if (
              existing.status ===
              "archived"
            ) {
              throw new HttpsError(
                "failed-precondition",
                "Curso arquivado não pode ser editado."
              );
            }

            if (
              !actor.moderator &&
              existing.status !==
                "draft"
            ) {
              throw new HttpsError(
                "failed-precondition",
                "O instrutor só pode editar o curso enquanto ele estiver em rascunho."
              );
            }

            const mergedInput = {
              ...existing
            };

            for (
              const field
              of [
                "title",
                "description",
                "instructorIds",
                "visibility",
                "organizationId",
                "isPaid",
                "priceCents",
                "currency"
              ]
            ) {
              if (
                Object.prototype
                  .hasOwnProperty
                  .call(
                    data,
                    field
                  )
              ) {
                mergedInput[field] =
                  data[field];
              }
            }

            if (
              existing.ownerType ===
                "user"
            ) {
              mergedInput.ownerId =
                existing.ownerId;

              mergedInput.instructorIds =
                [
                  ...new Set([
                    existing.ownerId,
                    ...(
                      Array.isArray(
                        mergedInput
                          .instructorIds
                      )
                        ? mergedInput
                            .instructorIds
                        : []
                    )
                  ])
                ];
            }

            mergedInput.ownerType =
              existing.ownerType;

            mergedInput.status =
              existing.status;

            mergedInput.financialRuleId =
              existing.financialRuleId ||
              null;

            mergedInput.publishedAt =
              existing.publishedAt ||
              null;

            let normalized;

            try {
              normalized =
                validateCourseForStatus(
                  mergedInput,
                  existing.status
                );
            }
            catch (error) {
              domainError(
                error
              );
            }

            assertNoOrganizationCourseYet(
              normalized
            );

            const update = {
              title:
                normalized.title,

              description:
                normalized.description,

              instructorIds:
                normalized.instructorIds,

              visibility:
                normalized.visibility,

              organizationId:
                normalized.organizationId,

              isPaid:
                normalized.isPaid,

              priceCents:
                normalized.priceCents,

              currency:
                normalized.currency,

              updatedAt:
                FieldValue
                  .serverTimestamp()
            };

            tx.update(
              courseRef,
              update
            );

            tx.create(
              auditRef,
              auditPayload({
                actor,
                action:
                  "course.update",
                entityId:
                  courseId,
                before:
                  normalizeCourseInput(
                    existing
                  ),
                after:
                  normalized
              })
            );

            result = {
              ...existing,
              ...update
            };
          }
        );

        const refreshed =
          await courseRef.get();

        return {
          ok:
            true,

          course:
            managedCourseView(
              courseId,
              refreshed.data()
            )
        };
      }
    );

  // ============================================================
  // STATUS WORKFLOW
  // ============================================================

  const alterarStatusCursoV12 =
    onCall(
      {
        region:
          REGION
      },
      async request => {
        const actor =
          await resolveCourseActor(
            request
          );

        const courseId =
          String(
            request.data
              ?.courseId ||
            ""
          ).trim();

        const targetStatus =
          String(
            request.data
              ?.status ||
            ""
          )
            .trim()
            .toLowerCase();

        if (
          !courseId ||
          !targetStatus
        ) {
          throw new HttpsError(
            "invalid-argument",
            "Curso e status são obrigatórios."
          );
        }

        const courseRef =
          db.doc(
            `courses/${courseId}`
          );

        const auditRef =
          db.collection(
            "audit_logs"
          ).doc();

        await db.runTransaction(
          async tx => {
            const snap =
              await tx.get(
                courseRef
              );

            if (!snap.exists) {
              throw new HttpsError(
                "not-found",
                "Curso não encontrado."
              );
            }

            const existing =
              snap.data();

            const owner =
              isOwnerActor(
                actor,
                existing
              );

            try {
              assertCourseStatusTransition(
                existing.status,
                targetStatus
              );
            }
            catch (error) {
              domainError(
                error
              );
            }

            if (
              targetStatus ===
              "review"
            ) {
              if (
                !actor.moderator &&
                !owner
              ) {
                throw new HttpsError(
                  "permission-denied",
                  "Você não pode enviar este curso para revisão."
                );
              }
            }
            else if (
              targetStatus ===
              "draft"
            ) {
              if (
                !actor.moderator &&
                !owner
              ) {
                throw new HttpsError(
                  "permission-denied",
                  "Você não pode devolver este curso para rascunho."
                );
              }
            }
            else if (
              targetStatus ===
                "published" ||
              targetStatus ===
                "suspended"
            ) {
              if (
                !actor.moderator
              ) {
                throw new HttpsError(
                  "permission-denied",
                  "Somente a moderação da plataforma pode publicar ou suspender cursos."
                );
              }
            }
            else if (
              targetStatus ===
              "archived"
            ) {
              const ownerMayArchive =
                owner &&
                (
                  existing.status ===
                    "draft" ||
                  existing.status ===
                    "review"
                );

              if (
                !actor.moderator &&
                !ownerMayArchive
              ) {
                throw new HttpsError(
                  "permission-denied",
                  "Você não pode arquivar este curso."
                );
              }
            }

            let normalized;

            try {
              normalized =
                validateCourseForStatus(
                  {
                    ...existing,
                    status:
                      targetStatus
                  },
                  targetStatus
                );
            }
            catch (error) {
              domainError(
                error
              );
            }

            const update = {
              status:
                targetStatus,

              updatedAt:
                FieldValue
                  .serverTimestamp()
            };

            if (
              targetStatus ===
                "published" &&
              !existing.publishedAt
            ) {
              update.publishedAt =
                FieldValue
                  .serverTimestamp();
            }

            tx.update(
              courseRef,
              update
            );

            tx.create(
              auditRef,
              auditPayload({
                actor,
                action:
                  `course.status.${targetStatus}`,
                entityId:
                  courseId,
                before:
                  normalizeCourseInput(
                    existing
                  ),
                after:
                  normalized
              })
            );
          }
        );

        const refreshed =
          await courseRef.get();

        return {
          ok:
            true,

          course:
            managedCourseView(
              courseId,
              refreshed.data()
            )
        };
      }
    );

  // ============================================================
  // LIST ADMINISTRABLE
  // ============================================================

  const listarCursosAdministraveisV12 =
    onCall(
      {
        region:
          REGION
      },
      async request => {
        const actor =
          await resolveCourseActor(
            request
          );

        let snap;

        if (
          actor.moderator
        ) {
          snap =
            await db
              .collection(
                "courses"
              )
              .orderBy(
                "updatedAt",
                "desc"
              )
              .limit(100)
              .get();
        }
        else if (
          actor.instructor
        ) {
          snap =
            await db
              .collection(
                "courses"
              )
              .where(
                "ownerId",
                "==",
                actor.uid
              )
              .limit(100)
              .get();
        }
        else {
          throw new HttpsError(
            "permission-denied",
            "Você não possui cursos administráveis."
          );
        }

        const courses =
          snap.docs
            .map(
              doc =>
                managedCourseView(
                  doc.id,
                  doc.data()
                )
            )
            .filter(
              course =>
                actor.moderator ||
                (
                  course.ownerType ===
                    "user" &&
                  course.ownerId ===
                    actor.uid
                )
            );

        return {
          courses
        };
      }
    );

  return {
    criarCursoV12,
    atualizarCursoV12,
    alterarStatusCursoV12,
    listarCursosAdministraveisV12
  };
}

module.exports = {
  createCourseFunctions
};