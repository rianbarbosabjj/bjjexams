"use strict";

const {
  FieldValue
} = require(
  "firebase-admin/firestore"
);

const {
  AdminCourseWorkflowDomainError,
  requiredWorkflowIdentifier,
  resolveAdminCourseWorkflowTransition,
  buildAdminCourseWorkflowAuditEvent
} = require(
  "./admin-course-workflow-domain"
);

class AdminCourseWorkflowServiceError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminCourseWorkflowServiceError";

    this.code =
      code;
  }
}

function createAdminCourseWorkflowService(
  dependencies = {}
) {
  const {
    db,

    serverTimestamp =
      () =>
        FieldValue.serverTimestamp()
  } = dependencies;

  if (
    !db ||
    typeof db.doc !==
      "function" ||
    typeof db.collection !==
      "function" ||
    typeof db.runTransaction !==
      "function"
  ) {
    throw new TypeError(
      "Admin course workflow service requires Firestore."
    );
  }

  if (
    typeof serverTimestamp !==
      "function"
  ) {
    throw new TypeError(
      "Admin course workflow service requires a server timestamp factory."
    );
  }

  async function mutateCourseWorkflow(
    input = {}
  ) {
    const courseId =
      requiredWorkflowIdentifier(
        input.courseId,
        "courseId"
      );

    const actorId =
      requiredWorkflowIdentifier(
        input.actorId,
        "actorId"
      );

    const actorRole =
      String(
        input.actorRole ||
        ""
      ).trim();

    if (
      !actorRole ||
      actorRole.length > 80
    ) {
      throw new AdminCourseWorkflowDomainError(
        "ADMIN_COURSE_WORKFLOW_INPUT_INVALID",
        "actorRole is invalid."
      );
    }

    const requestId =
      requiredWorkflowIdentifier(
        input.requestId,
        "requestId"
      );

    const courseRef =
      db.doc(
        `courses/${courseId}`
      );

    const auditRef =
      db
        .collection(
          "audit_logs"
        )
        .doc();

    return db.runTransaction(
      async transaction => {
        const snapshot =
          await transaction.get(
            courseRef
          );

        if (
          !snapshot ||
          snapshot.exists !==
            true
        ) {
          throw new AdminCourseWorkflowServiceError(
            "ADMIN_COURSE_WORKFLOW_TARGET_NOT_FOUND",
            "Operational course was not found."
          );
        }

        const course =
          snapshot.data() ||
          {};

        const transition =
          resolveAdminCourseWorkflowTransition({
            course,

            targetStatus:
              input.targetStatus
          });

        if (
          transition.idempotent ===
            true
        ) {
          return Object.freeze({
            changed:
              false,

            idempotent:
              true,

            courseId,

            status:
              transition.targetStatus,

            auditId:
              null
          });
        }

        const timestamp =
          serverTimestamp();

        if (
          timestamp ===
            undefined ||
          timestamp ===
            null
        ) {
          throw new AdminCourseWorkflowServiceError(
            "ADMIN_COURSE_WORKFLOW_TIMESTAMP_INVALID",
            "Server timestamp could not be created."
          );
        }

        const update = {
          status:
            transition.targetStatus,

          updatedAt:
            timestamp
        };

        if (
          transition.targetStatus ===
            "published" &&
          !course.publishedAt
        ) {
          update.publishedAt =
            timestamp;
        }

        const auditEvent =
          buildAdminCourseWorkflowAuditEvent({
            actorId,
            actorRole,
            requestId,
            courseId,
            transition,

            createdAt:
              timestamp
          });

        transaction.update(
          courseRef,
          update
        );

        transaction.create(
          auditRef,
          auditEvent
        );

        return Object.freeze({
          changed:
            true,

          idempotent:
            false,

          courseId,

          status:
            transition.targetStatus,

          auditId:
            auditRef.id
        });
      }
    );
  }

  return Object.freeze({
    mutateCourseWorkflow
  });
}

module.exports = {
  AdminCourseWorkflowServiceError,
  AdminCourseWorkflowDomainError,

  createAdminCourseWorkflowService
};
