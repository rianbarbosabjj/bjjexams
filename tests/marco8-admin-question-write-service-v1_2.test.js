"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const {
  ADMIN_QUESTION_AUDIT_COLLECTION,
  ADMIN_QUESTION_CREATE_CHANGED_FIELDS,
  AdminQuestionWriteServiceError,
  AdminQuestionWriteDomainError,
  questionPath,
  createAdminQuestionWriteService
} = require(
  "../functions/src/admin/admin-question-write-service"
);

function questionContent(
  overrides = {}
) {
  return {
    statement:
      "Qual e o objetivo da guarda fechada?",

    options: {
      A:
        "Controlar o adversario entre as pernas.",

      B:
        "Ficar obrigatoriamente em pe."
    },

    correctAnswer:
      "A",

    difficulty:
      2,

    category:
      "Fundamentos",

    media: {
      imageUrl:
        null,

      videoUrl:
        null
    },

    ...overrides
  };
}

class FakeSnapshot {
  constructor(
    ref,
    data
  ) {
    this.ref =
      ref;

    this.id =
      ref.id;

    this._data =
      data;

    this.exists =
      data !== undefined;
  }

  data() {
    return this._data;
  }
}

class FakeRef {
  constructor(
    fake,
    refPath
  ) {
    this.fake =
      fake;

    this.path =
      refPath;

    this.id =
      refPath.split("/").pop();
  }

  async get() {
    return new FakeSnapshot(
      this,
      this.fake.store.get(
        this.path
      )
    );
  }
}

class FakeCollection {
  constructor(
    fake,
    name
  ) {
    this.fake =
      fake;

    this.name =
      name;
  }

  doc(
    id
  ) {
    const documentId =
      id ||
      this.fake.nextId(
        this.name
      );

    return new FakeRef(
      this.fake,
      `${this.name}/${documentId}`
    );
  }
}

class FakeTransaction {
  constructor(
    fake
  ) {
    this.fake =
      fake;

    this.ops = [];
  }

  async get(
    ref
  ) {
    this.fake.stats.transactionGets.push(
      ref.path
    );

    return new FakeSnapshot(
      ref,
      this.fake.store.get(
        ref.path
      )
    );
  }

  create(
    ref,
    data
  ) {
    this.ops.push({
      type:
        "create",
      ref,
      data
    });
  }

  update(
    ref,
    data
  ) {
    this.ops.push({
      type:
        "update",
      ref,
      data
    });
  }
}

class FakeBatch {
  constructor(
    fake
  ) {
    this.fake =
      fake;

    this.ops = [];
  }

  create(
    ref,
    data
  ) {
    this.ops.push({
      type:
        "create",
      ref,
      data
    });

    return this;
  }

  async commit() {
    this.fake.stats.batchCommits += 1;
    this.fake.stats.batchWrites.push(
      this.ops.map(
        operation => ({
          type:
            operation.type,
          path:
            operation.ref.path
        })
      )
    );

    this.fake.applyOperations(
      this.ops
    );

    return [];
  }
}

class FakeFirestore {
  constructor() {
    this.store =
      new Map();

    this.counters =
      new Map();

    this.stats = {
      transactionRuns:
        0,
      transactionGets:
        [],
      transactionWrites:
        [],
      batchCommits:
        0,
      batchWrites:
        [],
      collections:
        []
    };
  }

  nextId(
    collection
  ) {
    const next =
      (this.counters.get(
        collection
      ) || 0) + 1;

    this.counters.set(
      collection,
      next
    );

    const prefix =
      collection ===
        "audit_logs"
        ? "audit"
        : "question";

    return `${prefix}-${next}`;
  }

  collection(
    name
  ) {
    this.stats.collections.push(
      name
    );

    if (
      ![
        "exam_question_bank",
        "audit_logs"
      ].includes(name)
    ) {
      throw new Error(
        `Unexpected collection: ${name}`
      );
    }

    return new FakeCollection(
      this,
      name
    );
  }

  doc(
    refPath
  ) {
    return new FakeRef(
      this,
      refPath
    );
  }

  batch() {
    return new FakeBatch(
      this
    );
  }

  applyOperations(
    operations
  ) {
    for (
      const operation
      of operations
    ) {
      if (
        operation.type ===
        "create"
      ) {
        if (
          this.store.has(
            operation.ref.path
          )
        ) {
          throw new Error(
            `Already exists: ${operation.ref.path}`
          );
        }

        this.store.set(
          operation.ref.path,
          operation.data
        );
      }
      else if (
        operation.type ===
        "update"
      ) {
        if (
          !this.store.has(
            operation.ref.path
          )
        ) {
          throw new Error(
            `Missing update target: ${operation.ref.path}`
          );
        }

        this.store.set(
          operation.ref.path,
          operation.data
        );
      }
      else {
        throw new Error(
          `Unexpected operation: ${operation.type}`
        );
      }
    }
  }

  async runTransaction(
    callback
  ) {
    this.stats.transactionRuns += 1;

    const transaction =
      new FakeTransaction(
        this
      );

    const result =
      await callback(
        transaction
      );

    this.stats.transactionWrites.push(
      transaction.ops.map(
        operation => ({
          type:
            operation.type,
          path:
            operation.ref.path
        })
      )
    );

    this.applyOperations(
      transaction.ops
    );

    return result;
  }
}

function auditDocuments(
  db
) {
  return Array.from(
    db.store.entries()
  )
    .filter(
      ([key]) =>
        key.startsWith(
          "audit_logs/"
        )
    )
    .map(
      ([pathValue, value]) => ({
        path:
          pathValue,
        value
      })
    );
}

function questionDocuments(
  db
) {
  return Array.from(
    db.store.entries()
  )
    .filter(
      ([key]) =>
        key.startsWith(
          "exam_question_bank/"
        )
    )
    .map(
      ([pathValue, value]) => ({
        path:
          pathValue,
        value
      })
    );
}

async function expectError(
  operation,
  ErrorType,
  code
) {
  let caught = null;

  try {
    await operation();
  }
  catch (error) {
    caught =
      error;
  }

  assert.ok(
    caught,
    `Expected ${code}`
  );

  assert.ok(
    caught instanceof ErrorType,
    `Expected ${ErrorType.name}, received ${caught?.constructor?.name}`
  );

  assert.strictEqual(
    caught.code,
    code
  );
}

async function main() {
  assert.strictEqual(
    ADMIN_QUESTION_AUDIT_COLLECTION,
    "audit_logs"
  );

  assert.deepStrictEqual(
    ADMIN_QUESTION_CREATE_CHANGED_FIELDS,
    [
      "statement",
      "options",
      "difficulty",
      "category",
      "media",
      "lifecycleStatus"
    ]
  );

  assert.strictEqual(
    questionPath(
      "question-abc"
    ),
    "exam_question_bank/question-abc"
  );

  await expectError(
    () =>
      Promise.resolve(
        questionPath(
          "bad/id"
        )
      ),
    AdminQuestionWriteDomainError,
    "ADMIN_QUESTION_WRITE_IDENTIFIER_INVALID"
  );

  const db =
    new FakeFirestore();

  const service =
    createAdminQuestionWriteService({
      db,
      serverTimestamp:
        () =>
          "SERVER_TIMESTAMP"
    });

  const created =
    await service.createQuestion({
      actorId:
        "admin-1",
      actorRole:
        "content_admin",
      requestId:
        "request-create-1",
      content:
        questionContent()
    });

  assert.deepStrictEqual(
    created,
    {
      changed:
        true,
      idempotent:
        false,
      questionId:
        "question-1",
      lifecycleStatus:
        "draft",
      revision:
        1,
      auditId:
        "audit-1"
    }
  );

  const createdStored =
    db.store.get(
      "exam_question_bank/question-1"
    );

  assert.strictEqual(
    createdStored.correctAnswer,
    "A"
  );

  assert.strictEqual(
    createdStored.lifecycleStatus,
    "draft"
  );

  assert.strictEqual(
    createdStored.revision,
    1
  );

  const createAudit =
    db.store.get(
      "audit_logs/audit-1"
    );

  assert.strictEqual(
    createAudit.action,
    "admin.question.created"
  );

  assert.strictEqual(
    createAudit.requestId,
    "request-create-1"
  );

  assert.strictEqual(
    createAudit.before,
    null
  );

  assert.deepStrictEqual(
    createAudit.after,
    {
      lifecycleStatus:
        "draft",
      revision:
        1
    }
  );

  assert.strictEqual(
    JSON.stringify(
      createAudit
    ).includes(
      "correctAnswer"
    ),
    false
  );

  assert.strictEqual(
    JSON.stringify(
      createAudit
    ).includes(
      "Controlar o adversario"
    ),
    false
  );

  const updated =
    await service.updateQuestion({
      actorId:
        "admin-1",
      actorRole:
        "content_admin",
      requestId:
        "request-update-1",
      questionId:
        "question-1",
      expectedRevision:
        1,
      patch: {
        statement:
          "Questao atualizada"
      }
    });

  assert.strictEqual(
    updated.lifecycleStatus,
    "draft"
  );

  assert.strictEqual(
    updated.revision,
    2
  );

  assert.strictEqual(
    db.store.get(
      "exam_question_bank/question-1"
    ).statement,
    "Questao atualizada"
  );

  const submitted =
    await service.updateQuestion({
      actorId:
        "admin-1",
      actorRole:
        "content_admin",
      requestId:
        "request-submit-1",
      questionId:
        "question-1",
      expectedRevision:
        2,
      submitForReview:
        true
    });

  assert.strictEqual(
    submitted.lifecycleStatus,
    "pending_review"
  );

  assert.strictEqual(
    submitted.revision,
    3
  );

  const auditCountBeforeReplay =
    auditDocuments(
      db
    ).length;

  const transactionWritesBeforeReplay =
    db.stats.transactionWrites.length;

  const replay =
    await service.updateQuestion({
      actorId:
        "admin-1",
      actorRole:
        "content_admin",
      requestId:
        "request-submit-replay",
      questionId:
        "question-1",
      expectedRevision:
        3,
      submitForReview:
        true
    });

  assert.strictEqual(
    replay.changed,
    false
  );

  assert.strictEqual(
    replay.idempotent,
    true
  );

  assert.strictEqual(
    replay.auditId,
    null
  );

  assert.strictEqual(
    auditDocuments(
      db
    ).length,
    auditCountBeforeReplay
  );

  assert.strictEqual(
    db.stats.transactionWrites.length,
    transactionWritesBeforeReplay + 1
  );

  assert.deepStrictEqual(
    db.stats.transactionWrites.at(-1),
    []
  );

  const approved =
    await service.moderateQuestion({
      actorId:
        "moderator-1",
      actorRole:
        "content_admin",
      requestId:
        "request-approve-1",
      questionId:
        "question-1",
      expectedRevision:
        3,
      decision:
        "approve",
      reason:
        "Conteudo revisado."
    });

  assert.strictEqual(
    approved.lifecycleStatus,
    "approved"
  );

  assert.strictEqual(
    approved.revision,
    4
  );

  const approvedStored =
    db.store.get(
      "exam_question_bank/question-1"
    );

  assert.strictEqual(
    approvedStored.moderatedBy,
    "moderator-1"
  );

  const editedApproved =
    await service.updateQuestion({
      actorId:
        "admin-1",
      actorRole:
        "content_admin",
      requestId:
        "request-edit-approved",
      questionId:
        "question-1",
      expectedRevision:
        4,
      patch: {
        difficulty:
          3
      }
    });

  assert.strictEqual(
    editedApproved.lifecycleStatus,
    "pending_review"
  );

  assert.strictEqual(
    editedApproved.revision,
    5
  );

  const editedStored =
    db.store.get(
      "exam_question_bank/question-1"
    );

  assert.strictEqual(
    editedStored.moderatedAt,
    null
  );

  assert.strictEqual(
    editedStored.moderatedBy,
    null
  );

  assert.strictEqual(
    editedStored.moderationReason,
    null
  );

  const requestedChanges =
    await service.moderateQuestion({
      actorId:
        "moderator-1",
      actorRole:
        "content_admin",
      requestId:
        "request-changes-1",
      questionId:
        "question-1",
      expectedRevision:
        5,
      decision:
        "request_changes",
      reason:
        "Revisar dificuldade."
    });

  assert.strictEqual(
    requestedChanges.lifecycleStatus,
    "changes_requested"
  );

  assert.strictEqual(
    requestedChanges.revision,
    6
  );

  await expectError(
    () =>
      service.updateQuestion({
        actorId:
          "admin-1",
        actorRole:
          "content_admin",
        requestId:
          "request-conflict",
        questionId:
          "question-1",
        expectedRevision:
          5,
        patch: {
          category:
            "Nova categoria"
        }
      }),
    AdminQuestionWriteDomainError,
    "ADMIN_QUESTION_WRITE_REVISION_CONFLICT"
  );

  const archived =
    await service.archiveQuestion({
      actorId:
        "admin-1",
      actorRole:
        "content_admin",
      requestId:
        "request-archive-1",
      questionId:
        "question-1",
      expectedRevision:
        6
    });

  assert.strictEqual(
    archived.lifecycleStatus,
    "archived"
  );

  assert.strictEqual(
    archived.revision,
    7
  );

  const auditsBeforeArchiveReplay =
    auditDocuments(
      db
    ).length;

  const archiveReplay =
    await service.archiveQuestion({
      actorId:
        "admin-1",
      actorRole:
        "content_admin",
      requestId:
        "request-archive-replay",
      questionId:
        "question-1",
      expectedRevision:
        7
    });

  assert.strictEqual(
    archiveReplay.changed,
    false
  );

  assert.strictEqual(
    archiveReplay.idempotent,
    true
  );

  assert.strictEqual(
    auditDocuments(
      db
    ).length,
    auditsBeforeArchiveReplay
  );

  await expectError(
    () =>
      service.updateQuestion({
        actorId:
          "admin-1",
        actorRole:
          "content_admin",
        requestId:
          "request-edit-archived",
        questionId:
          "question-1",
        expectedRevision:
          7,
        patch: {
          statement:
            "Nao pode editar"
        }
      }),
    AdminQuestionWriteDomainError,
    "ADMIN_QUESTION_WRITE_CONTENT_EDIT_ARCHIVED"
  );


  await expectError(
    () =>
      service.updateQuestion({
        actorId:
          "admin-1",
        actorRole:
          "content_admin",
        requestId:
          "request-missing",
        questionId:
          "missing-question",
        expectedRevision:
          1,
        patch: {
          statement:
            "X"
        }
      }),
    AdminQuestionWriteServiceError,
    "ADMIN_QUESTION_WRITE_NOT_FOUND"
  );

  const auditCountBeforeImport =
    auditDocuments(
      db
    ).length;

  const questionCountBeforeImport =
    questionDocuments(
      db
    ).length;

  const imported =
    await service.importQuestions({
      actorId:
        "admin-2",
      actorRole:
        "platform_admin",
      requestId:
        "request-import-1",
      items: [
        questionContent({
          statement:
            "Importada valida"
        }),
        {
          ...questionContent({
            statement:
              "Importada invalida"
          }),
          lifecycleStatus:
            "approved"
        }
      ]
    });

  assert.strictEqual(
    imported.total,
    2
  );

  assert.strictEqual(
    imported.created,
    1
  );

  assert.strictEqual(
    imported.failed,
    1
  );

  assert.strictEqual(
    imported.items.length,
    1
  );

  assert.strictEqual(
    imported.items[0].lifecycleStatus,
    "draft"
  );

  assert.strictEqual(
    imported.errors.length,
    1
  );

  assert.strictEqual(
    imported.errors[0].index,
    1
  );

  assert.strictEqual(
    imported.errors[0].ok,
    false
  );

  assert.strictEqual(
    Object.prototype.hasOwnProperty.call(
      imported.errors[0],
      "message"
    ),
    false
  );

  assert.strictEqual(
    auditDocuments(
      db
    ).length,
    auditCountBeforeImport + 1
  );

  assert.strictEqual(
    questionDocuments(
      db
    ).length,
    questionCountBeforeImport + 1
  );

  const importAudit =
    auditDocuments(
      db
    )
      .map(
        item =>
          item.value
      )
      .find(
        item =>
          item.action ===
          "admin.question.imported"
      );

  assert.ok(
    importAudit
  );

  assert.strictEqual(
    importAudit.metadata.importIndex,
    0
  );

  assert.strictEqual(
    JSON.stringify(
      importAudit
    ).includes(
      "correctAnswer"
    ),
    false
  );

  assert.strictEqual(
    db.stats.batchCommits,
    1
  );

  assert.strictEqual(
    db.stats.batchWrites[0].length,
    2
  );

  const allInvalidBatchCount =
    db.stats.batchCommits;

  const allInvalid =
    await service.importQuestions({
      actorId:
        "admin-2",
      actorRole:
        "platform_admin",
      requestId:
        "request-import-invalid",
      items: [
        {
          ...questionContent(),
          collection:
            "other_collection"
        }
      ]
    });

  assert.strictEqual(
    allInvalid.created,
    0
  );

  assert.strictEqual(
    allInvalid.failed,
    1
  );

  assert.strictEqual(
    db.stats.batchCommits,
    allInvalidBatchCount
  );

  await expectError(
    () =>
      service.importQuestions({
        actorId:
          "admin-2",
        actorRole:
          "platform_admin",
        requestId:
          "request-import-too-large",
        items:
          Array.from(
            { length: 26 },
            () =>
              questionContent()
          )
      }),
    AdminQuestionWriteDomainError,
    "ADMIN_QUESTION_IMPORT_SIZE_INVALID"
  );

  const serviceSource =
    fs.readFileSync(
      path.join(
        __dirname,
        "../functions/src/admin/admin-question-write-service.js"
      ),
      "utf8"
    );

  assert.strictEqual(
    serviceSource.includes(
      ".delete("
    ),
    false
  );

  assert.strictEqual(
    serviceSource.includes(
      "transaction.delete"
    ),
    false
  );

  assert.strictEqual(
    serviceSource.includes(
      "batch.delete"
    ),
    false
  );

  assert.strictEqual(
    serviceSource.includes(
      "input.collection"
    ),
    false
  );

  assert.strictEqual(
    serviceSource.includes(
      "EXAM_QUESTION_BANK_COLLECTION"
    ),
    true
  );

  assert.strictEqual(
    serviceSource.includes(
      "audit_logs"
    ),
    true
  );

  assert.ok(
    db.stats.collections.every(
      name =>
        [
          "exam_question_bank",
          "audit_logs"
        ].includes(name)
    )
  );

  const maximumWritesPerImport =
    25 * 2;

  assert.strictEqual(
    maximumWritesPerImport,
    50
  );

  console.log(
    "MARCO8_QUESTION_WRITE_SERVICE_COLLECTION=exam_question_bank"
  );
  console.log(
    "MARCO8_QUESTION_WRITE_AUDIT_COLLECTION=audit_logs"
  );
  console.log(
    "MARCO8_QUESTION_WRITE_SINGLE_MUTATION=TRANSACTIONAL"
  );
  console.log(
    "MARCO8_QUESTION_WRITE_ATOMIC_AUDIT=PASSED"
  );
  console.log(
    "MARCO8_QUESTION_WRITE_IDEMPOTENT_REPLAY=NO_WRITE_NO_AUDIT"
  );
  console.log(
    "MARCO8_QUESTION_WRITE_REVISION_CONFLICT=BLOCKED"
  );
  console.log(
    "MARCO8_QUESTION_WRITE_APPROVED_EDIT=pending_review"
  );
  console.log(
    "MARCO8_QUESTION_WRITE_ARCHIVED_EDIT=BLOCKED"
  );
  console.log(
    "MARCO8_QUESTION_WRITE_PHYSICAL_DELETE=False"
  );
  console.log(
    "MARCO8_QUESTION_IMPORT_MAX_ITEMS=25"
  );
  console.log(
    "MARCO8_QUESTION_IMPORT_MAX_WRITES=50"
  );
  console.log(
    "MARCO8_QUESTION_IMPORT_BATCH=PASSED"
  );
  console.log(
    "MARCO8_QUESTION_IMPORT_PARTIAL_VALIDATION=PASSED"
  );
  console.log(
    "MARCO8_QUESTION_IMPORT_AUTO_APPROVAL=False"
  );
  console.log(
    "MARCO8_QUESTION_IMPORT_ARBITRARY_COLLECTION=False"
  );
  console.log(
    "MARCO8_QUESTION_AUDIT_ANSWER_KEY_EXPOSURE=False"
  );
  console.log(
    "MARCO8_ADMIN_QUESTION_WRITE_SERVICE=PASSED"
  );
}

main().catch(
  error => {
    console.error(error);
    process.exitCode = 1;
  }
);
