"use strict";

(function initAdminShellBootstrap(root, factory) {
  const api = factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellBootstrap = api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellBootstrap(root) {
    const FIREBASE_APP_URL =
      "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";

    const FIREBASE_AUTH_URL =
      "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

    const STAGING_PROJECT_ID =
      "bjj-exams-staging";

    function normalizeHostname(
      value
    ) {
      return String(value || "")
        .trim()
        .toLowerCase();
    }

    function routeFromLocation(
      location
    ) {
      const hash =
        String(
          location?.hash || ""
        )
          .replace(/^#/, "")
          .trim();

      return hash || null;
    }

    function isDeniedError(
      error
    ) {
      const code =
        String(
          error?.code || ""
        ).trim();

      if (
        code ===
          "ADMIN_PRODUCTION_BLOCKED" ||
        code ===
          "ADMIN_HOST_NOT_ALLOWED"
      ) {
        return true;
      }

      const callableStatus =
        String(
          error?.details
            ?.callableStatus ||
          ""
        )
          .trim()
          .toUpperCase();

      return (
        callableStatus ===
          "PERMISSION_DENIED" ||
        callableStatus ===
          "UNAUTHENTICATED"
      );
    }

    async function resolveFirebaseAuth(
      options = {}
    ) {
      const runtime =
        options.runtime ||
        root?.BjjExamsFirebaseRuntime;

      const adminApi =
        options.adminApi ||
        root?.BjjExamsAdminShell;

      const hostname =
        normalizeHostname(
          options.hostname ??
          root?.location?.hostname
        );

      if (
        !runtime ||
        typeof runtime.loadConfig !==
          "function"
      ) {
        throw new TypeError(
          "Firebase runtime indisponivel."
        );
      }

      if (
        !adminApi ||
        typeof adminApi
          .resolveShellEnvironment !==
          "function"
      ) {
        throw new TypeError(
          "Admin shell API indisponivel."
        );
      }

      // Hard boundary before Firebase config or SDK work.
      adminApi.resolveShellEnvironment({
        hostname
      });

      const config =
        await runtime.loadConfig({
          hostname,
          fetchImpl:
            options.fetchImpl,
          injectedConfig:
            options.injectedConfig
        });

      if (
        config?.projectId !==
        STAGING_PROJECT_ID
      ) {
        throw new Error(
          "Firebase project administrativo bloqueado."
        );
      }

      const importModule =
        options.importModule ||
        (
          specifier =>
            import(specifier)
        );

      const [
        appModule,
        authModule
      ] =
        await Promise.all([
          importModule(
            FIREBASE_APP_URL
          ),
          importModule(
            FIREBASE_AUTH_URL
          )
        ]);

      if (
        typeof appModule?.getApps !==
          "function" ||
        typeof appModule
          ?.initializeApp !==
          "function" ||
        typeof authModule?.getAuth !==
          "function" ||
        typeof authModule
          ?.onAuthStateChanged !==
          "function"
      ) {
        throw new Error(
          "Firebase Auth administrativo indisponivel."
        );
      }

      const apps =
        appModule.getApps();

      const existing =
        Array.isArray(apps)
          ? apps.find(
              app =>
                app?.options
                  ?.projectId ===
                STAGING_PROJECT_ID
            )
          : null;

      const app =
        existing ||
        appModule.initializeApp(
          config,
          Array.isArray(apps) &&
          apps.length > 0
            ? "bjj-exams-admin-staging"
            : undefined
        );

      if (
        app?.options?.projectId !==
        STAGING_PROJECT_ID
      ) {
        throw new Error(
          "Firebase App administrativo nao pertence ao staging."
        );
      }

      const auth =
        authModule.getAuth(
          app
        );

      return Object.freeze({
        app,
        auth,
        authModule
      });
    }

    function createBootstrap(
      options = {}
    ) {
      const rootRef =
        options.root ||
        root;

      const adminApi =
        options.adminApi ||
        rootRef?.BjjExamsAdminShell;

      const controller =
        options.controller;

      const runtime =
        options.runtime ||
        rootRef?.BjjExamsFirebaseRuntime;

      const hostname =
        normalizeHostname(
          options.hostname ??
          rootRef?.location?.hostname
        );

      const logger =
        options.logger ||
        rootRef?.console ||
        console;

      if (
        !adminApi ||
        typeof adminApi
          .getAdminContext !==
          "function" ||
        typeof adminApi
          .resolveShellEnvironment !==
          "function"
      ) {
        throw new TypeError(
          "Admin shell API invalida."
        );
      }

      if (
        !controller ||
        typeof controller.showLoading !==
          "function" ||
        typeof controller.showDenied !==
          "function" ||
        typeof controller.showError !==
          "function" ||
        typeof controller.mountContext !==
          "function"
      ) {
        throw new TypeError(
          "Controller administrativo invalido."
        );
      }

      if (
        !runtime ||
        typeof runtime.loadConfig !==
          "function"
      ) {
        throw new TypeError(
          "Firebase runtime invalido."
        );
      }

      let generation = 0;
      let unsubscribe = null;

      async function processUser(
        user
      ) {
        const myGeneration =
          ++generation;

        if (!user) {
          controller.showDenied(
            "Sessao autenticada nao encontrada."
          );

          return Object.freeze({
            status: "denied",
            reason:
              "AUTH_SESSION_REQUIRED"
          });
        }

        controller.showLoading();

        try {
          if (
            typeof user.getIdToken !==
            "function"
          ) {
            throw new Error(
              "Token Firebase indisponivel."
            );
          }

          const idToken =
            String(
              await user.getIdToken(
                true
              )
            ).trim();

          if (!idToken) {
            throw new Error(
              "Token Firebase vazio."
            );
          }

          const context =
            await adminApi
              .getAdminContext({
                hostname,
                idToken,
                fetchImpl:
                  options.fetchImpl
              });

          if (
            myGeneration !==
            generation
          ) {
            return Object.freeze({
              status: "stale"
            });
          }

          const viewModel =
            controller.mountContext(
              context,
              routeFromLocation(
                rootRef?.location
              )
            );

          return Object.freeze({
            status:
              viewModel?.state ||
              "ready",

            context
          });
        }
        catch (error) {
          if (
            myGeneration !==
            generation
          ) {
            return Object.freeze({
              status: "stale"
            });
          }

          if (
            isDeniedError(
              error
            )
          ) {
            controller.showDenied(
              "Sua conta nao possui acesso administrativo."
            );

            return Object.freeze({
              status: "denied",
              reason:
                "ADMIN_ACCESS_DENIED"
            });
          }

          if (
            typeof logger?.error ===
            "function"
          ) {
            logger.error(
              "Falha no bootstrap administrativo:",
              error
            );
          }

          controller.showError(
            "Nao foi possivel validar sua sessao administrativa."
          );

          return Object.freeze({
            status: "error"
          });
        }
      }

      async function start() {
        controller.showLoading();

        // Hard host gate before runtime.loadConfig().
        adminApi.resolveShellEnvironment({
          hostname
        });

        const firebase =
          await resolveFirebaseAuth({
            runtime,
            adminApi,
            hostname,
            fetchImpl:
              options.fetchImpl,
            injectedConfig:
              options.injectedConfig,
            importModule:
              options.importModule
          });

        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }

        unsubscribe =
          firebase.authModule
            .onAuthStateChanged(
              firebase.auth,
              user => {
                Promise.resolve(
                  processUser(user)
                ).catch(error => {
                  if (
                    typeof logger?.error ===
                    "function"
                  ) {
                    logger.error(
                      "Falha inesperada no observer administrativo:",
                      error
                    );
                  }

                  controller.showError(
                    "Nao foi possivel validar sua sessao administrativa."
                  );
                });
              }
            );

        return Object.freeze({
          started: true,
          projectId:
            firebase.app
              ?.options
              ?.projectId ||
            null
        });
      }

      function stop() {
        generation += 1;

        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }

        return true;
      }

      return Object.freeze({
        start,
        stop,
        processUser
      });
    }

    return Object.freeze({
      FIREBASE_APP_URL,
      FIREBASE_AUTH_URL,
      STAGING_PROJECT_ID,
      routeFromLocation,
      isDeniedError,
      resolveFirebaseAuth,
      createBootstrap
    });
  }
);
