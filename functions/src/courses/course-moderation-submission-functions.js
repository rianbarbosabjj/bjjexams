'use strict';

const crypto = require('crypto');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { FieldValue } = require('firebase-admin/firestore');
const { hasGlobalRole } = require('../auth/global-claims');
const {
  CourseDomainError,
  validateCourseForStatus,
  assertCourseStatusTransition
} = require('./course-domain');
const {
  POLICY_VERSION,
  RESPONSIBILITY_TERMS_VERSION,
  resolveAutomationOutcome,
  canonicalModerationSnapshot
} = require('./course-moderation-policy');

function createCourseModerationSubmissionFunctions(dependencies = {}) {
  const {
    REGION,
    db,
    moderationProviderFactory,
    secrets = []
  } = dependencies;

  if (!REGION || !db || typeof moderationProviderFactory !== 'function') {
    throw new Error('Course moderation: infraestrutura obrigatória ausente.');
  }

  function requireAuth(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Faça login para continuar.');
    return uid;
  }

  function isModerator(request) {
    const claims = request.auth?.token || {};
    return (
      claims.super_admin === true ||
      hasGlobalRole(claims, 'platform_admin') ||
      hasGlobalRole(claims, 'content_admin')
    );
  }

  function moderatorRole(request) {
    const claims = request.auth?.token || {};
    if (claims.super_admin === true) return 'super_admin';
    if (claims.platform_admin === true) return 'platform_admin';
    if (claims.content_admin === true) return 'content_admin';
    return null;
  }

  function domainError(error) {
    if (error instanceof CourseDomainError) {
      const code = error.code === 'INVALID_STATUS_TRANSITION'
        ? 'failed-precondition'
        : 'invalid-argument';
      throw new HttpsError(code, error.message, { domainCode: error.code });
    }
    throw error;
  }

  function contentFingerprint(course = {}) {
    const payload = JSON.stringify({
      title: String(course.title || '').trim(),
      description: String(course.description || '').trim(),
      ownerType: String(course.ownerType || '').trim(),
      ownerId: course.ownerId || null,
      instructorIds: Array.isArray(course.instructorIds)
        ? [...course.instructorIds].map(String).sort()
        : [],
      visibility: String(course.visibility || '').trim(),
      organizationId: course.organizationId || null,
      isPaid: course.isPaid === true,
      priceCents: Number(course.priceCents || 0),
      currency: String(course.currency || 'BRL').toUpperCase()
    });
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  function managedView(id, data = {}) {
    return {
      id,
      title: data.title || null,
      description: data.description || null,
      ownerType: data.ownerType || null,
      ownerId: data.ownerId || null,
      instructorIds: Array.isArray(data.instructorIds) ? data.instructorIds : [],
      visibility: data.visibility || null,
      organizationId: data.organizationId || null,
      status: data.status || null,
      isPaid: data.isPaid === true,
      priceCents: Number(data.priceCents || 0),
      currency: data.currency || 'BRL',
      publishedAt: data.publishedAt || null,
      createdAt: data.createdAt || null,
      updatedAt: data.updatedAt || null,
      moderation: data.moderation || null,
      contentResponsibility: data.contentResponsibility || null,
      lastModerationOverride: data.lastModerationOverride || null
    };
  }

  function systemAudit({ action, entityId, before, after, requestedBy }) {
    return {
      actorId: 'system:course-moderation',
      actorRole: 'ai_moderator',
      requestedBy: requestedBy || null,
      action,
      entityType: 'course',
      entityId,
      before: before || null,
      after: after || null,
      source: 'function',
      requestId: null,
      createdAt: FieldValue.serverTimestamp()
    };
  }

  function humanAudit({ action, entityId, before, after, actorId, actorRole }) {
    return {
      actorId,
      actorRole: actorRole || 'content_admin',
      action,
      entityType: 'course',
      entityId,
      before: before || null,
      after: after || null,
      source: 'function',
      requestId: null,
      createdAt: FieldValue.serverTimestamp()
    };
  }

  function fallbackDiagnostic(error) {
    return {
      provider: 'unknown',
      httpStatus: null,
      apiCode: null,
      apiStatus: null,
      errorCode: String(error?.code || 'PROVIDER_ERROR').slice(0, 80),
      message: String(error?.message || 'Provider failure').slice(0, 300)
    };
  }

  function updatedAtMillis(value) {
    const seconds = Number(value?._seconds ?? value?.seconds ?? 0);
    const nanos = Number(value?._nanoseconds ?? value?.nanoseconds ?? 0);
    return (Number.isFinite(seconds) ? seconds * 1000 : 0) +
      (Number.isFinite(nanos) ? nanos / 1000000 : 0);
  }

  async function moderateSafely(course, context = {}) {
    try {
      const provider = moderationProviderFactory();
      if (!provider || typeof provider.moderateCourse !== 'function') {
        throw new Error('Provedor de moderação indisponível.');
      }

      const result = await provider.moderateCourse(course);
      const outcome = resolveAutomationOutcome({
        responsibilityAccepted: true,
        providerDecision: result?.decision,
        providerRiskLevel: result?.riskLevel,
        providerConfidence: result?.confidence,
        providerReasonCodes: result?.reasonCodes
      });

      return {
        outcome,
        snapshot: canonicalModerationSnapshot({
          mode: 'ai',
          status: outcome.decision,
          riskLevel: result?.riskLevel,
          confidence: result?.confidence,
          requiresHumanReview: outcome.requiresHumanReview,
          reasonCodes: outcome.reasonCodes,
          summary: result?.summary,
          provider: result?.provider,
          model: result?.model,
          checkedBy: 'system:course-moderation'
        })
      };
    } catch (error) {
      const diagnostic = error?.safeDiagnostic || fallbackDiagnostic(error);
      console.error('COURSE_MODERATION_PROVIDER_ERROR', {
        courseId: context.courseId || null,
        submissionId: context.submissionId || null,
        diagnostic
      });

      const outcome = resolveAutomationOutcome({
        responsibilityAccepted: true,
        providerDecision: null,
        providerRiskLevel: 'high',
        providerConfidence: 0,
        providerReasonCodes: ['PROVIDER_ERROR']
      });

      return {
        outcome,
        snapshot: canonicalModerationSnapshot({
          mode: 'ai',
          status: 'manual_review',
          riskLevel: 'high',
          confidence: 0,
          requiresHumanReview: true,
          reasonCodes: outcome.reasonCodes,
          summary: 'A triagem automática não pôde ser concluída. Revisão humana necessária.',
          provider: null,
          model: null,
          checkedBy: 'system:course-moderation'
        }),
        providerDiagnostic: diagnostic
      };
    }
  }

  const solicitarPublicacaoCursoV12 = onCall(
    {
      region: REGION,
      secrets
    },
    async request => {
      const uid = requireAuth(request);
      const courseId = String(request.data?.courseId || '').trim();
      const responsibilityAccepted = request.data?.responsibilityAccepted === true;
      const termsVersion = String(request.data?.termsVersion || '').trim();

      if (!courseId) {
        throw new HttpsError('invalid-argument', 'Curso inválido.');
      }
      if (!responsibilityAccepted || termsVersion !== RESPONSIBILITY_TERMS_VERSION) {
        throw new HttpsError(
          'failed-precondition',
          'Aceite o Termo de Responsabilidade de Conteúdo vigente antes de solicitar publicação.',
          { expectedTermsVersion: RESPONSIBILITY_TERMS_VERSION }
        );
      }

      const courseRef = db.doc(`courses/${courseId}`);
      const submissionId = crypto.randomUUID();
      let lockedCourse = null;
      let fingerprint = null;

      await db.runTransaction(async tx => {
        const snap = await tx.get(courseRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Curso não encontrado.');

        const course = snap.data();
        const owner = course.ownerType === 'user' && course.ownerId === uid;
        if (!owner) {
          throw new HttpsError('permission-denied', 'Somente o responsável pelo curso pode solicitar a publicação.');
        }
        if (course.status !== 'draft') {
          throw new HttpsError('failed-precondition', 'Somente rascunhos podem ser enviados para triagem de publicação.');
        }
        if (String(course.title || '').trim().length < 3 || String(course.description || '').trim().length < 20) {
          throw new HttpsError('failed-precondition', 'Complete o título e a descrição do curso antes de solicitar publicação.');
        }

        fingerprint = contentFingerprint(course);
        lockedCourse = { ...course, status: 'review' };

        tx.update(courseRef, {
          status: 'review',
          contentResponsibility: {
            accepted: true,
            termsVersion: RESPONSIBILITY_TERMS_VERSION,
            acceptedBy: uid,
            acceptedAt: FieldValue.serverTimestamp(),
            submissionId,
            contentHash: fingerprint
          },
          moderationPending: {
            submissionId,
            state: 'processing',
            contentHash: fingerprint,
            policyVersion: POLICY_VERSION,
            startedAt: FieldValue.serverTimestamp()
          },
          updatedAt: FieldValue.serverTimestamp()
        });

        const auditRef = db.collection('audit_logs').doc();
        tx.create(auditRef, systemAudit({
          action: 'course.moderation.submitted',
          entityId: courseId,
          requestedBy: uid,
          before: { status: course.status },
          after: {
            status: 'review',
            submissionId,
            termsVersion: RESPONSIBILITY_TERMS_VERSION,
            contentHash: fingerprint
          }
        }));
      });

      const moderationResult = await moderateSafely(lockedCourse, {
        courseId,
        submissionId
      });
      let finalCourse = null;

      await db.runTransaction(async tx => {
        const snap = await tx.get(courseRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Curso não encontrado após a triagem.');

        const current = snap.data();
        const pending = current.moderationPending || {};
        if (pending.submissionId !== submissionId) {
          throw new HttpsError('aborted', 'Uma nova operação de moderação substituiu esta solicitação.');
        }

        const currentFingerprint = contentFingerprint(current);
        let outcome = moderationResult.outcome;
        let snapshot = moderationResult.snapshot;

        if (currentFingerprint !== fingerprint) {
          outcome = {
            decision: 'manual_review',
            targetStatus: 'review',
            requiresHumanReview: true,
            reasonCodes: ['CONTENT_CHANGED_DURING_MODERATION']
          };
          snapshot = canonicalModerationSnapshot({
            mode: 'ai',
            status: 'manual_review',
            riskLevel: 'high',
            confidence: 0,
            requiresHumanReview: true,
            reasonCodes: outcome.reasonCodes,
            summary: 'O conteúdo mudou durante a triagem automática.',
            checkedBy: 'system:course-moderation'
          });
        }

        const update = {
          status: outcome.targetStatus,
          moderation: {
            ...snapshot,
            submissionId,
            contentHash: fingerprint,
            checkedAt: FieldValue.serverTimestamp()
          },
          moderationPending: FieldValue.delete(),
          updatedAt: FieldValue.serverTimestamp()
        };

        if (outcome.targetStatus === 'published' && !current.publishedAt) {
          update.publishedAt = FieldValue.serverTimestamp();
        }

        tx.update(courseRef, update);
        const auditRef = db.collection('audit_logs').doc();
        tx.create(auditRef, systemAudit({
          action: `course.moderation.${outcome.decision}`,
          entityId: courseId,
          requestedBy: uid,
          before: { status: current.status },
          after: {
            status: outcome.targetStatus,
            moderation: snapshot,
            submissionId
          }
        }));

        finalCourse = {
          ...current,
          ...update,
          moderation: {
            ...snapshot,
            submissionId,
            contentHash: fingerprint
          }
        };
      });

      const refreshed = await courseRef.get();
      return {
        ok: true,
        course: managedView(courseId, refreshed.data() || finalCourse || {}),
        moderation: refreshed.data()?.moderation || finalCourse?.moderation || null
      };
    }
  );

  const listarExcecoesModeracaoV12 = onCall(
    { region: REGION },
    async request => {
      requireAuth(request);
      if (!isModerator(request)) {
        throw new HttpsError('permission-denied', 'A fila de revisão de conteúdo exige papel global de moderação.');
      }

      const snap = await db
        .collection('courses')
        .where('status', 'in', ['review', 'suspended'])
        .limit(100)
        .get();

      const courses = snap.docs
        .map(doc => managedView(doc.id, doc.data()))
        .sort((left, right) => updatedAtMillis(right.updatedAt) - updatedAtMillis(left.updatedAt));

      return { courses };
    }
  );

  const registrarDecisaoModeracaoV12 = onCall(
    { region: REGION },
    async request => {
      const uid = requireAuth(request);
      if (!isModerator(request)) {
        throw new HttpsError('permission-denied', 'A decisão humana exige papel global de moderação.');
      }

      const courseId = String(request.data?.courseId || '').trim();
      const targetStatus = String(request.data?.status || '').trim().toLowerCase();
      const reason = String(request.data?.reason || '').trim();

      if (!courseId || !targetStatus) {
        throw new HttpsError('invalid-argument', 'Curso e decisão são obrigatórios.');
      }
      if (reason.length < 10) {
        throw new HttpsError('invalid-argument', 'Informe um motivo com pelo menos 10 caracteres.');
      }
      if (reason.length > 1000) {
        throw new HttpsError('invalid-argument', 'O motivo da decisão excede 1000 caracteres.');
      }

      const courseRef = db.doc(`courses/${courseId}`);
      const auditRef = db.collection('audit_logs').doc();
      const role = moderatorRole(request);

      await db.runTransaction(async tx => {
        const snap = await tx.get(courseRef);
        if (!snap.exists) throw new HttpsError('not-found', 'Curso não encontrado.');

        const existing = snap.data();
        const allowedTargets = existing.status === 'review'
          ? new Set(['draft', 'published', 'archived'])
          : existing.status === 'suspended'
            ? new Set(['published', 'archived'])
            : null;

        if (!allowedTargets) {
          throw new HttpsError(
            'failed-precondition',
            'Somente exceções em revisão ou cursos suspensos podem receber decisão humana nesta fila.'
          );
        }
        if (!allowedTargets.has(targetStatus)) {
          throw new HttpsError('failed-precondition', 'Decisão humana incompatível com o estado atual do curso.');
        }

        try {
          assertCourseStatusTransition(existing.status, targetStatus);
          validateCourseForStatus({ ...existing, status: targetStatus }, targetStatus);
        } catch (error) {
          domainError(error);
        }

        const override = {
          fromStatus: existing.status,
          toStatus: targetStatus,
          reason,
          decidedBy: uid,
          decidedRole: role || 'content_admin',
          decidedAt: FieldValue.serverTimestamp()
        };

        const update = {
          status: targetStatus,
          lastModerationOverride: override,
          updatedAt: FieldValue.serverTimestamp()
        };

        if (targetStatus === 'published' && !existing.publishedAt) {
          update.publishedAt = FieldValue.serverTimestamp();
        }

        tx.update(courseRef, update);
        tx.create(auditRef, humanAudit({
          action: 'course.moderation.human_override',
          entityId: courseId,
          actorId: uid,
          actorRole: role,
          before: {
            status: existing.status,
            moderation: existing.moderation || null
          },
          after: {
            status: targetStatus,
            reason,
            moderationPreserved: true
          }
        }));
      });

      const refreshed = await courseRef.get();
      return {
        ok: true,
        course: managedView(courseId, refreshed.data() || {})
      };
    }
  );

  return {
    solicitarPublicacaoCursoV12,
    listarExcecoesModeracaoV12,
    registrarDecisaoModeracaoV12
  };
}

module.exports = {
  createCourseModerationSubmissionFunctions
};
