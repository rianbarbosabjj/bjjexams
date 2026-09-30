"use strict";

const AUDIT_OPERATIONAL_VIEW_FIELDS =
  Object.freeze([
    "auditId",
    "eventType",
    "actor",
    "target",
    "organizationId",
    "source",
    "requestId",
    "createdAt",
    "metadata"
  ]);

const AUDIT_ACTOR_FIELDS =
  Object.freeze([
    "uid",
    "role"
  ]);

const AUDIT_TARGET_FIELDS =
  Object.freeze([
    "type",
    "id"
  ]);

const AUDIT_METADATA_ALLOWED_FIELDS =
  Object.freeze([
    "schemaVersion",
    "operation",
    "changedFields",
    "importIndex",
    "previousStatus",
    "previousErrorCode",
    "reprocessCount",
    "beforeStatus",
    "afterStatus",
    "beforeLifecycleStatus",
    "afterLifecycleStatus",
    "beforeRevision",
    "afterRevision",
    "beforeOrderStatus",
    "afterOrderStatus",
    "beforeTransactionStatus",
    "afterTransactionStatus",
    "afterProviderStatus"
  ]);

const AUDIT_METADATA_MAX_JSON_BYTES =
  2048;

const AUDIT_CHANGED_FIELDS_MAX_ITEMS =
  25;

class AdminAuditModelError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "AdminAuditModelError";

    this.code =
      code;
  }
}

function cleanAuditText(
  value,
  maxLength = 255
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    String(value)
      .trim();

  if (!normalized) {
    return null;
  }

  if (
    normalized.length >
      maxLength
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_TEXT_INVALID",
      "Audit text exceeds the allowed size."
    );
  }

  return normalized;
}

function requiredAuditText(
  value,
  field,
  maxLength = 255
) {
  const normalized =
    cleanAuditText(
      value,
      maxLength
    );

  if (!normalized) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_FIELD_REQUIRED",
      `${field} is required.`
    );
  }

  return normalized;
}

function requiredAuditIdentifier(
  value,
  field,
  maxLength = 255
) {
  const normalized =
    requiredAuditText(
      value,
      field,
      maxLength
    );

  if (
    normalized.includes("/")
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_IDENTIFIER_INVALID",
      `${field} is invalid.`
    );
  }

  return normalized;
}

function optionalAuditIdentifier(
  value,
  field,
  maxLength = 255
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return requiredAuditIdentifier(
    value,
    field,
    maxLength
  );
}

function auditTimestampMillis(
  value,
  field = "createdAt"
) {
  if (
    value === undefined ||
    value === null
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_TIMESTAMP_INVALID",
      `${field} is required.`
    );
  }

  if (
    typeof value.toMillis ===
      "function"
  ) {
    const millis =
      value.toMillis();

    if (
      Number.isFinite(
        millis
      )
    ) {
      return millis;
    }
  }

  const date =
    value instanceof Date
      ? value
      : new Date(
          value
        );

  const millis =
    date.getTime();

  if (
    !Number.isFinite(
      millis
    )
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_TIMESTAMP_INVALID",
      `${field} is invalid.`
    );
  }

  return millis;
}

function normalizeAuditToken(
  value,
  field,
  {
    maxLength = 120,
    lowercase = false
  } = {}
) {
  const normalized =
    requiredAuditText(
      value,
      field,
      maxLength
    );

  if (
    !/^[A-Za-z0-9_.:-]+$/.test(
      normalized
    )
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_TOKEN_INVALID",
      `${field} is invalid.`
    );
  }

  return lowercase
    ? normalized.toLowerCase()
    : normalized;
}

function optionalAuditToken(
  value,
  field,
  options = {}
) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return normalizeAuditToken(
    value,
    field,
    options
  );
}

function resolveAuditAlias(
  input = {}
) {
  const {
    primary,
    legacy,
    field,
    normalize
  } = input;

  if (
    typeof normalize !==
      "function"
  ) {
    throw new TypeError(
      "Audit alias resolver requires a normalizer."
    );
  }

  const primaryPresent =
    primary !== undefined &&
    primary !== null &&
    String(primary).trim() !==
      "";

  const legacyPresent =
    legacy !== undefined &&
    legacy !== null &&
    String(legacy).trim() !==
      "";

  if (
    !primaryPresent &&
    !legacyPresent
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_FIELD_REQUIRED",
      `${field} is required.`
    );
  }

  const primaryValue =
    primaryPresent
      ? normalize(
          primary,
          field
        )
      : null;

  const legacyValue =
    legacyPresent
      ? normalize(
          legacy,
          field
        )
      : null;

  if (
    primaryValue !== null &&
    legacyValue !== null &&
    primaryValue !==
      legacyValue
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_ALIAS_CONFLICT",
      `${field} aliases conflict.`
    );
  }

  return primaryValue ??
    legacyValue;
}

function plainAuditObject(
  value
) {
  return (
    value &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  )
    ? value
    : {};
}

function safeAuditInteger(
  value,
  field,
  {
    min = 0,
    max =
      Number.MAX_SAFE_INTEGER
  } = {}
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const number =
    Number(value);

  if (
    !Number.isSafeInteger(
      number
    ) ||
    number < min ||
    number > max
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_METADATA_INVALID",
      `${field} is invalid.`
    );
  }

  return number;
}

function safeChangedFields(
  value
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (
    !Array.isArray(
      value
    ) ||
    value.length >
      AUDIT_CHANGED_FIELDS_MAX_ITEMS
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_METADATA_INVALID",
      "changedFields is invalid."
    );
  }

  const result = [];

  for (
    const raw
    of value
  ) {
    const field =
      normalizeAuditToken(
        raw,
        "changedFields",
        {
          maxLength:
            80
        }
      );

    if (
      !result.includes(
        field
      )
    ) {
      result.push(
        field
      );
    }
  }

  return Object.freeze(
    result
  );
}

function assignMetadataToken(
  output,
  key,
  value,
  options = {}
) {
  const normalized =
    optionalAuditToken(
      value,
      key,
      options
    );

  if (
    normalized !==
    null
  ) {
    output[key] =
      normalized;
  }
}

function assignMetadataInteger(
  output,
  key,
  value,
  options = {}
) {
  const normalized =
    safeAuditInteger(
      value,
      key,
      options
    );

  if (
    normalized !==
    null
  ) {
    output[key] =
      normalized;
  }
}

function normalizeAuditMetadata(
  audit = {}
) {
  const direct =
    plainAuditObject(
      audit.metadata
    );

  const before =
    plainAuditObject(
      audit.before
    );

  const after =
    plainAuditObject(
      audit.after
    );

  const output = {};

  assignMetadataInteger(
    output,
    "schemaVersion",
    direct.schemaVersion,
    {
      min:
        1,
      max:
        1000000
    }
  );

  assignMetadataToken(
    output,
    "operation",
    direct.operation,
    {
      maxLength:
        80,
      lowercase:
        true
    }
  );

  const changedFields =
    safeChangedFields(
      direct.changedFields
    );

  if (
    changedFields !==
    null
  ) {
    output.changedFields =
      changedFields;
  }

  assignMetadataInteger(
    output,
    "importIndex",
    direct.importIndex,
    {
      min:
        0,
      max:
        1000000
    }
  );

  assignMetadataToken(
    output,
    "previousStatus",
    direct.previousStatus,
    {
      lowercase:
        true
    }
  );

  assignMetadataToken(
    output,
    "previousErrorCode",
    direct.previousErrorCode,
    {
      maxLength:
        120
    }
  );

  assignMetadataInteger(
    output,
    "reprocessCount",
    direct.reprocessCount,
    {
      min:
        0
    }
  );

  assignMetadataToken(
    output,
    "beforeStatus",
    before.status,
    {
      lowercase:
        true
    }
  );

  assignMetadataToken(
    output,
    "afterStatus",
    after.status,
    {
      lowercase:
        true
    }
  );

  assignMetadataToken(
    output,
    "beforeLifecycleStatus",
    before.lifecycleStatus,
    {
      lowercase:
        true
    }
  );

  assignMetadataToken(
    output,
    "afterLifecycleStatus",
    after.lifecycleStatus,
    {
      lowercase:
        true
    }
  );

  assignMetadataInteger(
    output,
    "beforeRevision",
    before.revision,
    {
      min:
        1
    }
  );

  assignMetadataInteger(
    output,
    "afterRevision",
    after.revision,
    {
      min:
        1
    }
  );

  assignMetadataToken(
    output,
    "beforeOrderStatus",
    before.orderStatus,
    {
      lowercase:
        true
    }
  );

  assignMetadataToken(
    output,
    "afterOrderStatus",
    after.orderStatus,
    {
      lowercase:
        true
    }
  );

  assignMetadataToken(
    output,
    "beforeTransactionStatus",
    before.transactionStatus,
    {
      lowercase:
        true
    }
  );

  assignMetadataToken(
    output,
    "afterTransactionStatus",
    after.transactionStatus,
    {
      lowercase:
        true
    }
  );

  assignMetadataToken(
    output,
    "afterProviderStatus",
    after.providerStatus,
    {
      maxLength:
        80
    }
  );

  for (
    const key
    of Object.keys(
      output
    )
  ) {
    if (
      !AUDIT_METADATA_ALLOWED_FIELDS
        .includes(
          key
        )
    ) {
      throw new AdminAuditModelError(
        "ADMIN_AUDIT_METADATA_INVALID",
        "Audit metadata contains an unsupported projection."
      );
    }
  }

  const serialized =
    JSON.stringify(
      output
    );

  if (
    Buffer.byteLength(
      serialized,
      "utf8"
    ) >
      AUDIT_METADATA_MAX_JSON_BYTES
  ) {
    throw new AdminAuditModelError(
      "ADMIN_AUDIT_METADATA_INVALID",
      "Audit metadata projection exceeds the allowed size."
    );
  }

  return Object.freeze(
    output
  );
}

function normalizeCanonicalAuditEvent(
  input = {}
) {
  const auditId =
    requiredAuditIdentifier(
      input.auditId,
      "auditId"
    );

  const audit =
    plainAuditObject(
      input.audit
    );

  const eventType =
    resolveAuditAlias({
      primary:
        audit.eventType,

      legacy:
        audit.action,

      field:
        "eventType",

      normalize:
        value =>
          normalizeAuditToken(
            value,
            "eventType",
            {
              maxLength:
                160,
              lowercase:
                true
            }
          )
    });

  const actorUid =
    resolveAuditAlias({
      primary:
        audit.actorUid,

      legacy:
        audit.actorId,

      field:
        "actorUid",

      normalize:
        value =>
          requiredAuditIdentifier(
            value,
            "actorUid"
          )
    });

  const actorRole =
    normalizeAuditToken(
      audit.actorRole,
      "actorRole",
      {
        maxLength:
          80,
        lowercase:
          true
      }
    );

  const targetType =
    resolveAuditAlias({
      primary:
        audit.targetType,

      legacy:
        audit.entityType,

      field:
        "targetType",

      normalize:
        value =>
          normalizeAuditToken(
            value,
            "targetType",
            {
              maxLength:
                120,
              lowercase:
                true
            }
          )
    });

  const targetId =
    resolveAuditAlias({
      primary:
        audit.targetId,

      legacy:
        audit.entityId,

      field:
        "targetId",

      normalize:
        value =>
          requiredAuditIdentifier(
            value,
            "targetId"
          )
    });

  const organizationId =
    optionalAuditIdentifier(
      audit.organizationId,
      "organizationId"
    );

  const source =
    optionalAuditToken(
      audit.source,
      "source",
      {
        maxLength:
          80,
        lowercase:
          true
      }
    );

  const requestId =
    optionalAuditIdentifier(
      audit.requestId,
      "requestId"
    );

  const createdAtMillis =
    auditTimestampMillis(
      audit.createdAt,
      "createdAt"
    );

  const metadata =
    normalizeAuditMetadata(
      audit
    );

  return Object.freeze({
    auditId,
    eventType,
    actorUid,
    actorRole,
    targetType,
    targetId,
    organizationId,
    source,
    requestId,
    createdAt:
      audit.createdAt,
    createdAtMillis,
    metadata
  });
}

function buildOperationalAuditView(
  input = {}
) {
  const normalized =
    normalizeCanonicalAuditEvent(
      input
    );

  return Object.freeze({
    auditId:
      normalized.auditId,

    eventType:
      normalized.eventType,

    actor:
      Object.freeze({
        uid:
          normalized.actorUid,

        role:
          normalized.actorRole
      }),

    target:
      Object.freeze({
        type:
          normalized.targetType,

        id:
          normalized.targetId
      }),

    organizationId:
      normalized.organizationId,

    source:
      normalized.source,

    requestId:
      normalized.requestId,

    createdAt:
      normalized.createdAt,

    metadata:
      normalized.metadata
  });
}

module.exports = {
  AUDIT_OPERATIONAL_VIEW_FIELDS,
  AUDIT_ACTOR_FIELDS,
  AUDIT_TARGET_FIELDS,
  AUDIT_METADATA_ALLOWED_FIELDS,

  AUDIT_METADATA_MAX_JSON_BYTES,
  AUDIT_CHANGED_FIELDS_MAX_ITEMS,

  AdminAuditModelError,

  cleanAuditText,
  requiredAuditText,
  requiredAuditIdentifier,
  optionalAuditIdentifier,
  auditTimestampMillis,

  normalizeAuditToken,
  optionalAuditToken,
  resolveAuditAlias,
  plainAuditObject,
  safeAuditInteger,
  safeChangedFields,

  normalizeAuditMetadata,
  normalizeCanonicalAuditEvent,
  buildOperationalAuditView
};
