"use strict";

// Gate 9.5A: strictly allowlisted operational error CLASSIFICATION.
// Never serialize Error, request, payment, webhook, headers, stack or message.
const ALLOWED_ERROR_CLASSES = Object.freeze([
  "Error", "TypeError", "RangeError", "ReferenceError",
  "SyntaxError", "AggregateError", "FirebaseError", "HttpsError",
  "TimeoutError"
]);
const CLASS_SET = new Set(ALLOWED_ERROR_CLASSES);
function sanitizeOperationalError(error) {
  let candidate;
  try {
    candidate = error?.name;
  } catch (_) {
    candidate = null;
  }
  const name = typeof candidate === "string" && CLASS_SET.has(candidate)
    ? candidate : "Error";
  return { name };
}
module.exports = Object.freeze({ ALLOWED_ERROR_CLASSES, sanitizeOperationalError });
