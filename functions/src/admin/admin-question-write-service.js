"use strict";

const {
  FieldValue
} = require(
  "firebase-admin/firestore"
);

const {
  EXAM_QUESTION_BANK_COLLECTION
} = require(
  "../exams/exam-question-bank-domain"
);

const {
  ADMIN_QUESTION_IMPORT_MAX_ITEMS,
  AdminQuestionWriteDomainError,
  requiredWriteIdentifier,
  normalizeWriteActor,
  buildQuestionCreateDocument,
  buildQuestionUpdatePlan,
  buildQuestionModerationPlan,
  buildQuestionArchivePlan,
  buildQuestionAuditEvent,
  validateQuestionImportItems
} = require(
  "./admin-question-write-domain"
);

const ADMIN_QUESTION_AUDIT_COLLECTION =
  "audit_logs";

const ADMIN_QUESTION_CREATE_CHANGED_FIELDS =
  Object.freeze([
    "statement",
    "options",
    "difficulty",
    "category",
    "media",
    "lifecycleStatus"
  ]);

class AdminQuestionWriteServiceError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminQuestionWriteServiceError";

    this.code =
      code;
  }
}

function questionPath(
  questionId
) {
  return `${EXAM_QUESTION_BANK_COLLECTION}/${requiredWriteIdentifier(
    questionId,
    "questionId"
  )}`;
}

function assertServerTimestamp(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new AdminQuestionWriteServiceError(
      "ADMIN_QUESTION_WRITE_TIMESTAMP_INVALID",
      "Server timestamp could not be created."
    );
  }

  return value;
}

function buildMutationResult(
  input = {}
) {
  return Object.freeze({
    changed:
      input.changed === true,

    idempotent:
      input.idempotent === true,

    questionId:
      input.questionId,

    lifecycleStatus:
      input.lifecycleStatus,

    revision:
      input.revision,

    auditId:
      input.auditId || null
  });
}

function createAdminQuestionWriteService(
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
    typeof db.doc !== "function" ||
    typeof db.collection !== "function" ||
    typeof db.runTransaction !== "function" ||
    typeof db.batch !== "function"
  ) {
    throw new TypeError(
      "Admin question write service requires Firestore."
    );
  }

  if (
    typeof serverTimestamp !==
    "function"
  ) {
    throw new TypeError(
      "Admin question write service requires a server timestamp factory."
    );
  }

  function newQuestionRef() {
    return db
      .collection(
        EXAM_QUESTION_BANK_COLLECTION
      )
      .doc();
  }

  function newAuditRef() {
    return db
      .collection(
        ADMIN_QUESTION_AUDIT_COLLECTION
      )
      .doc();
  }

  async function createQuestion(
    input = {}
  ) {
    const actor =
      normalizeWriteActor(
        input
      );

    const questionRef =
      newQuestionRef();

    const auditRef =
      newAuditRef();

    return db.runTransaction(
      async transaction => {
        const timestamp =
          assertServerTimestamp(
            serverTimestamp()
          );

        const document =
          buildQuestionCreateDocument({
            content:
              input.content,

            actorId:
              actor.actorId,

            timestamp
          });

        const auditEvent =
          buildQuestionAuditEvent({
            ...actor,

            questionId:
              questionRef.id,

            operation:
              "create",

            before:
              null,

            after:
              document,

            changedFields:
              ADMIN_QUESTION_CREATE_CHANGED_FIELDS,

            createdAt:
              timestamp
          });

        transaction.create(
          questionRef,
          document
        );

        transaction.create(
          auditRef,
          auditEvent
        );

        return buildMutationResult({
          changed:
            true,

          idempotent:
            false,

          questionId:
            questionRef.id,

          lifecycleStatus:
            document.lifecycleStatus,

          revision:
            document.revision,

          auditId:
            auditRef.id
        });
      }
    );
  }

  async function mutateExistingQuestion(
    input,
    planFactory
  ) {
    const actor =
      normalizeWriteActor(
        input
      );

    const questionId =
      requiredWriteIdentifier(
        input.questionId,
        "questionId"
      );

    const targetRef =
      db.doc(
        questionPath(
          questionId
        )
      );

    return db.runTransaction(
      async transaction => {
        const snapshot =
          await transaction.get(
            targetRef
          );

        if (
          !snapshot ||
          snapshot.exists !== true
        ) {
          throw new AdminQuestionWriteServiceError(
            "ADMIN_QUESTION_WRITE_NOT_FOUND",
            "Question was not found."
          );
        }

        const current =
          snapshot.data() || {};

        const timestamp =
          assertServerTimestamp(
            serverTimestamp()
          );

        const plan =
          planFactory({
            currentQuestion:
              current,

            expectedRevision:
              input.expectedRevision,

            actorId:
              actor.actorId,

            timestamp
          });

        if (
          plan.changed !== true
        ) {
          return buildMutationResult({
            changed:
              false,

            idempotent:
              plan.idempotent === true,

            questionId,

            lifecycleStatus:
              plan.nextDocument.lifecycleStatus,

            revision:
              plan.nextDocument.revision,

            auditId:
              null
          });
        }

        const auditRef =
          newAuditRef();

        const auditEvent =
          buildQuestionAuditEvent({
            ...actor,

            questionId,

            operation:
              plan.operation,

            before:
              plan.currentDocument,

            after:
              plan.nextDocument,

            changedFields:
              plan.changedFields,

            createdAt:
              timestamp
          });

        transaction.update(
          targetRef,
          plan.nextDocument
        );

        transaction.create(
          auditRef,
          auditEvent
        );

        return buildMutationResult({
          changed:
            true,

          idempotent:
            false,

          questionId,

          lifecycleStatus:
            plan.nextDocument.lifecycleStatus,

          revision:
            plan.nextDocument.revision,

          auditId:
            auditRef.id
        });
      }
    );
  }

  async function updateQuestion(
    input = {}
  ) {
    return mutateExistingQuestion(
      input,
      base =>
        buildQuestionUpdatePlan({
          ...base,

          patch:
            input.patch,

          submitForReview:
            input.submitForReview
        })
    );
  }

  async function moderateQuestion(
    input = {}
  ) {
    return mutateExistingQuestion(
      input,
      base =>
        buildQuestionModerationPlan({
          ...base,

          decision:
            input.decision,

          reason:
            input.reason
        })
    );
  }

  async function archiveQuestion(
    input = {}
  ) {
    return mutateExistingQuestion(
      input,
      base =>
        buildQuestionArchivePlan(
          base
        )
    );
  }

  async function importQuestions(
    input = {}
  ) {
    const actor =
      normalizeWriteActor(
        input
      );

    const timestamp =
      assertServerTimestamp(
        serverTimestamp()
      );

    const validation =
      validateQuestionImportItems({
        items:
          input.items,

        actorId:
          actor.actorId,

        timestamp
      });

    if (
      validation.validItems.length === 0
    ) {
      return Object.freeze({
        total:
          validation.total,

        created:
          0,

        failed:
          validation.errors.length,

        items:
          Object.freeze([]),

        errors:
          validation.errors
      });
    }

    if (
      validation.validItems.length >
      ADMIN_QUESTION_IMPORT_MAX_ITEMS
    ) {
      throw new AdminQuestionWriteServiceError(
        "ADMIN_QUESTION_IMPORT_BATCH_INVALID",
        "Question import batch is too large."
      );
    }

    const batch =
      db.batch();

    const created = [];

    for (
      const item
      of validation.validItems
    ) {
      const questionRef =
        newQuestionRef();

      const auditRef =
        newAuditRef();

      const auditEvent =
        buildQuestionAuditEvent({
          ...actor,

          questionId:
            questionRef.id,

          operation:
            "import",

          before:
            null,

          after:
            item.document,

          changedFields:
            ADMIN_QUESTION_CREATE_CHANGED_FIELDS,

          importIndex:
            item.index,

          createdAt:
            timestamp
        });

      batch.create(
        questionRef,
        item.document
      );

      batch.create(
        auditRef,
        auditEvent
      );

      created.push(
        Object.freeze({
          index:
            item.index,

          ok:
            true,

          questionId:
            questionRef.id,

          lifecycleStatus:
            item.document.lifecycleStatus,

          revision:
            item.document.revision,

          auditId:
            auditRef.id
        })
      );
    }

    await batch.commit();

    return Object.freeze({
      total:
        validation.total,

      created:
        created.length,

      failed:
        validation.errors.length,

      items:
        Object.freeze(
          created
        ),

      errors:
        validation.errors
    });
  }

  return Object.freeze({
    createQuestion,
    updateQuestion,
    moderateQuestion,
    archiveQuestion,
    importQuestions
  });
}

module.exports = {
  ADMIN_QUESTION_AUDIT_COLLECTION,
  ADMIN_QUESTION_CREATE_CHANGED_FIELDS,

  AdminQuestionWriteServiceError,
  AdminQuestionWriteDomainError,

  questionPath,
  assertServerTimestamp,
  buildMutationResult,

  createAdminQuestionWriteService
};
