"use strict";

const assert =
  require("assert");

const fs =
  require("fs");

const path =
  require("path");

const navigation =
  require(
    "../js/admin-shell-navigation-v1_2"
  );

const {
  SHELL_STATES,
  loadingViewModel,
  deniedViewModel,
  errorViewModel,
  readyViewModel
} = require(
  "../js/admin-shell-controller-v1_2"
);

const ROOT =
  path.resolve(
    __dirname,
    ".."
  );

function read(
  relativePath
) {
  return fs
    .readFileSync(
      path.join(
        ROOT,
        relativePath
      ),
      "utf8"
    )
    .replace(
      /\r\n/g,
      "\n"
    );
}

function adminContext(
  capabilities,
  surfaceAccess
) {
  return {
    userId:
      "admin-test",

    displayName:
      "Admin Test",

    globalRoles: [
      "support_admin"
    ],

    capabilities,

    surfaceAccess,

    environment:
      "staging",

    schemaVersion:
      "1.2"
  };
}

assert.deepStrictEqual(
  SHELL_STATES,
  {
    loading: "loading",
    ready: "ready",
    denied: "denied",
    error: "error"
  }
);

assert.strictEqual(
  loadingViewModel().state,
  "loading"
);

assert.strictEqual(
  deniedViewModel().state,
  "denied"
);

assert.strictEqual(
  errorViewModel().state,
  "error"
);

const support =
  adminContext(
    [
      "ops.read",
      "ops.people.read",
      "ops.organizations.read",
      "ops.courses.read",
      "ops.exams.read",
      "ops.questions.read",
      "ops.certificates.read",
      "ops.orders.read",

      "console.read",
      "console.audit.read",
      "console.security.read",
      "console.health.read"
    ],
    {
      operations: true,
      console: true
    }
  );

const supportView =
  readyViewModel(
    support,
    navigation,
    "audit"
  );

assert.strictEqual(
  supportView.state,
  "ready"
);

assert.strictEqual(
  supportView.activeRoute,
  "audit"
);

assert.strictEqual(
  supportView.activeLabel,
  "Auditoria"
);

assert.strictEqual(
  supportView.sections.length,
  2
);

const unauthorizedRoute =
  readyViewModel(
    support,
    navigation,
    "finance"
  );

assert.strictEqual(
  unauthorizedRoute.activeRoute,
  "people"
);

const content =
  adminContext(
    [
      "ops.read",
      "ops.courses.read",
      "ops.exams.read",
      "ops.questions.read",
      "ops.certificates.read"
    ],
    {
      operations: true,
      console: false
    }
  );

const contentView =
  readyViewModel(
    content,
    navigation
  );

assert.strictEqual(
  contentView.state,
  "ready"
);

assert.strictEqual(
  contentView.sections.length,
  1
);

assert.strictEqual(
  contentView.activeRoute,
  "courses"
);

const emptyContext =
  adminContext(
    [
      "ops.read"
    ],
    {
      operations: true,
      console: false
    }
  );

assert.strictEqual(
  readyViewModel(
    emptyContext,
    navigation
  ).state,
  "denied"
);

const html =
  read(
    "admin_shell_v1_2.html"
  );

const controllerSource =
  read(
    "js/admin-shell-controller-v1_2.js"
  );

for (
  const marker of [
    "data-admin-shell-root",
    "data-admin-state-loading",
    "data-admin-state-denied",
    "data-admin-state-error",
    "data-admin-state-ready",
    "data-admin-navigation",
    "data-admin-user-name",
    "data-admin-environment",
    "data-admin-route-title",
    "data-admin-route-section",
    "data-admin-route-placeholder"
  ]
) {
  assert.ok(
    html.includes(marker),
    `Missing shell marker: ${marker}`
  );
}

assert.ok(
  html.includes(
    'js/admin-shell-navigation-v1_2.js'
  )
);

assert.ok(
  html.includes(
    'js/firebase-runtime-v1_2.js'
  )
);

assert.ok(
  html.includes(
    'js/admin-shell-api-v1_2.js'
  )
);

assert.ok(
  html.includes(
    'js/admin-shell-navigation-v1_2.js'
  )
);

assert.ok(
  html.includes(
    'js/admin-shell-controller-v1_2.js'
  )
);

assert.ok(
  html.includes(
    'js/admin-shell-bootstrap-v1_2.js'
  )
);

const runtimeIndex =
  html.indexOf(
    'js/firebase-runtime-v1_2.js'
  );

const apiIndex =
  html.indexOf(
    'js/admin-shell-api-v1_2.js'
  );

const navigationIndex =
  html.indexOf(
    'js/admin-shell-navigation-v1_2.js'
  );

const controllerIndex =
  html.indexOf(
    'js/admin-shell-controller-v1_2.js'
  );

const bootstrapIndex =
  html.indexOf(
    'js/admin-shell-bootstrap-v1_2.js'
  );

assert.ok(
  runtimeIndex >= 0 &&
  apiIndex > runtimeIndex &&
  navigationIndex > apiIndex &&
  controllerIndex > navigationIndex &&
  bootstrapIndex > controllerIndex,
  "Administrative shell scripts must load in dependency order."
);

assert.ok(
  html.includes(
    "bootstrapApi.createBootstrap({"
  )
);

assert.ok(
  html.includes(
    "await bootstrap.start();"
  )
);

assert.ok(
  html.includes(
    "window.__bjjAdminShellBootstrapV12"
  )
);

assert.ok(
  html.includes(
    "Staging / Demo"
  )
);

for (
  const forbidden of [
    "firebase-firestore",
    "getFirestore(",
    "collection(",
    "getDoc(",
    "getDocs(",
    "setDoc(",
    "addDoc(",
    "updateDoc(",
    "deleteDoc(",
    "onSnapshot(",
    "super_admins",
    'doc(db, "admins"',
    "firebaseConfig",
    "bjj-exams.web.app",
    'projectId: "bjj-exams"'
  ]
) {
  assert.ok(
    !html.includes(
      forbidden
    ),
    `Forbidden HTML authority token: ${forbidden}`
  );

  assert.ok(
    !controllerSource.includes(
      forbidden
    ),
    `Forbidden controller authority token: ${forbidden}`
  );
}

assert.ok(
  !controllerSource.includes(
    ".innerHTML"
  ),
  "Controller must avoid innerHTML."
);

assert.ok(
  controllerSource.includes(
    ".textContent"
  ),
  "Controller must use textContent."
);

assert.ok(
  controllerSource.includes(
    ".replaceChildren"
  ),
  "Controller must replace navigation nodes safely."
);

console.log(
  "MARCO8_ADMIN_SHELL_STATES=4/4"
);

console.log(
  "MARCO8_ADMIN_SHELL_READY_MODEL=PASSED"
);

console.log(
  "MARCO8_ADMIN_SHELL_DENIED_MODEL=PASSED"
);

console.log(
  "MARCO8_ADMIN_SHELL_ROUTE_FALLBACK=PASSED"
);

console.log(
  "MARCO8_ADMIN_SHELL_HTML_CONTRACT=PASSED"
);

console.log(
  "MARCO8_ADMIN_SHELL_NO_DIRECT_FIRESTORE=PASSED"
);

console.log(
  "MARCO8_ADMIN_SHELL_DOM_SAFETY=PASSED"
);

console.log(
  "MARCO8_ADMIN_VISUAL_SHELL=PASSED"
);
