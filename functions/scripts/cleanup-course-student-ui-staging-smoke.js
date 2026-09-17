'use strict';

// Cleanup seguro do smoke 4B.4. Implementação operacional será validada localmente
// antes da primeira criação de fixture em staging.

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.course-student-ui-staging.local.json');

if (!fs.existsSync(STATE_FILE)) {
  console.log('COURSE_STUDENT_UI_STAGING_CLEANUP=NOTHING_TO_DO');
  process.exit(0);
}

console.error('COURSE_STUDENT_UI_STAGING_CLEANUP=BLOCKED_UNTIL_OPERATIONAL_IMPLEMENTATION');
process.exit(1);
