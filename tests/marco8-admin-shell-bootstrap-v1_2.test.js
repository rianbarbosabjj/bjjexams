"use strict";

const assert =
  require("assert");

const {
  FIREBASE_APP_URL,
  FIREBASE_AUTH_URL,
  STAGING_PROJECT_ID,
  routeFromLocation,
  isDeniedError,
  resolveFirebaseAuth,
  createBootstrap
} = require(
  "../js/admin-shell-bootstrap-v1_2"
);

async function main() {
  assert.ok(
    FIREBASE_APP_URL.includes(
      "firebase-app.js"
    )
  );

  assert.ok(
    FIREBASE_AUTH_URL.includes(
      "firebase-auth.js"
    )
  );

  assert.strictEqual(
    STAGING_PROJECT_ID,
    "bjj-exams-staging"
  );

  assert.strictEqual(
    routeFromLocation({
      hash: "#audit"
    }),
    "audit"
  );

  assert.strictEqual(
    routeFromLocation({
      hash: ""
    }),
    null
  );

  assert.strictEqual(
    isDeniedError({
      code:
        "ADMIN_PRODUCTION_BLOCKED"
    }),
    true
  );

  assert.strictEqual(
    isDeniedError({
      details: {
        callableStatus:
          "PERMISSION_DENIED"
      }
    }),
    true
  );

  assert.strictEqual(
    isDeniedError({
      code: "OTHER"
    }),
    false
  );

  let loadConfigCalls = 0;
  let initializeCalls = 0;

  const runtime = {
    async loadConfig() {
      loadConfigCalls += 1;

      return {
        apiKey: "test",
        authDomain:
          "bjj-exams-staging.firebaseapp.com",
        projectId:
          "bjj-exams-staging",
        appId:
          "test-app"
      };
    }
  };

  const adminApi = {
    resolveShellEnvironment({
      hostname
    }) {
      if (
        hostname ===
        "bjj-exams.web.app"
      ) {
        const error =
          new Error(
            "blocked"
          );

        error.code =
          "ADMIN_PRODUCTION_BLOCKED";

        throw error;
      }

      return {
        environment:
          "staging"
      };
    },

    async getAdminContext({
      idToken
    }) {
      assert.strictEqual(
        idToken,
        "valid-token"
      );

      return {
        userId:
          "admin-1",

        displayName:
          "Admin",

        globalRoles: [
          "support_admin"
        ],

        capabilities: [
          "ops.read",
          "ops.people.read",
          "console.read",
          "console.audit.read"
        ],

        surfaceAccess: {
          operations: true,
          console: true
        },

        environment:
          "staging",

        schemaVersion:
          "1.2"
      };
    }
  };

  const stagingApp = {
    options: {
      projectId:
        "bjj-exams-staging"
    }
  };

  const auth = {
    marker: "auth"
  };

  let observer = null;

  const appModule = {
    getApps() {
      return [];
    },

    initializeApp(
      config
    ) {
      initializeCalls += 1;

      assert.strictEqual(
        config.projectId,
        "bjj-exams-staging"
      );

      return stagingApp;
    }
  };

  const authModule = {
    getAuth(app) {
      assert.strictEqual(
        app,
        stagingApp
      );

      return auth;
    },

    onAuthStateChanged(
      receivedAuth,
      callback
    ) {
      assert.strictEqual(
        receivedAuth,
        auth
      );

      observer =
        callback;

      return () => {
        observer = null;
      };
    }
  };

  const importModule =
    async specifier => {
      if (
        specifier ===
        FIREBASE_APP_URL
      ) {
        return appModule;
      }

      if (
        specifier ===
        FIREBASE_AUTH_URL
      ) {
        return authModule;
      }

      throw new Error(
        "Unexpected module"
      );
    };

  const resolved =
    await resolveFirebaseAuth({
      runtime,
      adminApi,
      hostname:
        "localhost",
      importModule
    });

  assert.strictEqual(
    resolved.app,
    stagingApp
  );

  assert.strictEqual(
    resolved.auth,
    auth
  );

  assert.strictEqual(
    loadConfigCalls,
    1
  );

  assert.strictEqual(
    initializeCalls,
    1
  );

  loadConfigCalls = 0;

  await assert.rejects(
    () =>
      resolveFirebaseAuth({
        runtime,
        adminApi,
        hostname:
          "bjj-exams.web.app",
        importModule
      }),
    error =>
      error.code ===
      "ADMIN_PRODUCTION_BLOCKED"
  );

  assert.strictEqual(
    loadConfigCalls,
    0,
    "Production must be blocked before config load."
  );

  const events = [];

  const controller = {
    showLoading() {
      events.push(
        "loading"
      );

      return {
        state: "loading"
      };
    },

    showDenied() {
      events.push(
        "denied"
      );

      return {
        state: "denied"
      };
    },

    showError() {
      events.push(
        "error"
      );

      return {
        state: "error"
      };
    },

    mountContext(
      context,
      route
    ) {
      events.push(
        `ready:${route || "default"}`
      );

      assert.strictEqual(
        context.userId,
        "admin-1"
      );

      return {
        state: "ready"
      };
    }
  };

  const bootstrap =
    createBootstrap({
      root: {
        location: {
          hostname:
            "localhost",
          hash:
            "#audit"
        }
      },

      runtime,
      adminApi,
      controller,
      importModule,
      logger: {
        error() {}
      }
    });

  const started =
    await bootstrap.start();

  assert.strictEqual(
    started.started,
    true
  );

  assert.strictEqual(
    started.projectId,
    "bjj-exams-staging"
  );

  assert.strictEqual(
    typeof observer,
    "function"
  );

  const noUserResult =
    await bootstrap
      .processUser(null);

  assert.strictEqual(
    noUserResult.status,
    "denied"
  );

  const userResult =
    await bootstrap
      .processUser({
        async getIdToken(
          forceRefresh
        ) {
          assert.strictEqual(
            forceRefresh,
            true
          );

          return "valid-token";
        }
      });

  assert.strictEqual(
    userResult.status,
    "ready"
  );

  assert.ok(
    events.includes(
      "ready:audit"
    )
  );

  bootstrap.stop();

  assert.strictEqual(
    observer,
    null
  );

  console.log(
    "MARCO8_ADMIN_AUTH_SHARED_RUNTIME=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_AUTH_STAGING_PROJECT=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_AUTH_PRODUCTION_PRECONFIG=BLOCKED"
  );

  console.log(
    "MARCO8_ADMIN_AUTH_SESSION_REQUIRED=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_AUTH_TOKEN_REFRESH=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_AUTH_CONTEXT_BOOTSTRAP=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_AUTH_OBSERVER_LIFECYCLE=PASSED"
  );

  console.log(
    "MARCO8_ADMIN_AUTH_BOOTSTRAP_MODULE=PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
