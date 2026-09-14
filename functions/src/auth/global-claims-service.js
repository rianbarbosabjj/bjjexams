'use strict';

const { isDeepStrictEqual } = require('node:util');

const {
  deriveGlobalClaims,
  mergeSynchronizedGlobalClaims
} = require('./global-claims');

function normalizeUserType(data = {}) {
  return String(
    data.tipo_usuario ||
    data.tipoUsuario ||
    data.papel_principal ||
    ''
  ).trim().toLowerCase() || null;
}

function createGlobalClaimsService({ db, auth } = {}) {
  if (!db || typeof db.doc !== 'function') {
    throw new TypeError('A valid Firestore instance is required.');
  }

  if (
    !auth ||
    typeof auth.getUser !== 'function' ||
    typeof auth.setCustomUserClaims !== 'function'
  ) {
    throw new TypeError('A valid Firebase Auth instance is required.');
  }

  async function resolveAuthoritativeSources(uid) {
    if (!uid || typeof uid !== 'string') {
      throw new TypeError('A valid uid is required.');
    }

    const superRef = db.doc(`super_admins/${uid}`);
    const adminRef = db.doc(`admins/${uid}`);
    const userRef = db.doc(`usuarios/${uid}`);

    const [
      superSnap,
      adminSnap,
      userSnap
    ] = await Promise.all([
      superRef.get(),
      adminRef.get(),
      userRef.get()
    ]);

    const userData = userSnap.exists
      ? (userSnap.data() || {})
      : {};

    return {
      hasSuperAdminMarker: superSnap.exists === true,
      hasAdminMarker: adminSnap.exists === true,
      userType: normalizeUserType(userData)
    };
  }

  async function synchronizeUserGlobalClaims(uid) {
    if (!uid || typeof uid !== 'string') {
      throw new TypeError('A valid uid is required.');
    }

    // As fontes autoritativas e o estado atual do Auth precisam
    // ser conhecidos antes de qualquer escrita.
    const [
      sources,
      authUser
    ] = await Promise.all([
      resolveAuthoritativeSources(uid),
      auth.getUser(uid)
    ]);

    const desiredClaims = deriveGlobalClaims(sources);

    const existingClaims =
      authUser && authUser.customClaims
        ? authUser.customClaims
        : {};

    const mergedClaims = mergeSynchronizedGlobalClaims(
      existingClaims,
      desiredClaims
    );

    if (isDeepStrictEqual(existingClaims, mergedClaims)) {
      return {
        updated: false,
        desiredClaims,
        sources
      };
    }

    // setCustomUserClaims substitui o objeto inteiro.
    // Por isso mergedClaims preserva tudo que nao e administrado
    // por este sincronizador.
    await auth.setCustomUserClaims(uid, mergedClaims);

    return {
      updated: true,
      desiredClaims,
      sources
    };
  }

  return {
    resolveAuthoritativeSources,
    synchronizeUserGlobalClaims
  };
}

module.exports = {
  createGlobalClaimsService
};