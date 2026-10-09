"use strict";

// Gate 9.6A: synthetic document snapshot/restore drill, NEVER a real backup tool.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DEMO_PROJECT, assertEmulatorOnly, runWithDemoFirestore } =
  require("./helpers/marco9-demo-emulator-boundary-v1_2");

const SOURCE = "_marco9_recovery_fixture_v12";
const DEST = "_marco9_recovery_restored_v12";
const IDS = Object.freeze(["student_fake","course_fake","order_fake","exam_fake"]);
const fixtures = Object.freeze([
  { id:"student_fake", data:{ type:"student", userId:"SYNTHETIC_ID_A", rank:"blue", active:true } },
  { id:"course_fake", data:{ type:"course", courseId:"SYNTHETIC_COURSE", cost:0, published:false } },
  { id:"order_fake", data:{ type:"order", orderId:"SYNTHETIC_ORDER", cents:100, state:"sandbox_fixture" } },
  { id:"exam_fake", data:{ type:"exam", examId:"SYNTHETIC_EXAM", grade:80, approved:true } }
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}
function validateBackup(backup) {
  if (!backup || backup.schemaVersion !== "9.6A" ||
      backup.projectId !== DEMO_PROJECT ||
      backup.sourceCollection !== SOURCE ||
      !Array.isArray(backup.documents) || backup.documents.length !== IDS.length ||
      backup.documents.some((doc,i) => doc?.id !== IDS[i] ||
        !doc.data || typeof doc.data !== "object" ||
        Array.isArray(doc.data) ||
        Object.keys(doc).sort().join("|") !== "data|id") ||
      typeof backup.sha256 !== "string" ||
      Object.keys(backup).sort().join("|") !==
        "documents|projectId|schemaVersion|sha256|sourceCollection") {
    throw new Error("MARCO9_BACKUP_METADATA_OR_NAMESPACE_INVALID");
  }
  const digest = sha256(JSON.stringify(backup.documents));
  if (digest !== backup.sha256) throw new Error("MARCO9_BACKUP_INTEGRITY_INVALID");
  return true;
}
function makeSnapshot(readDocs) {
  const documents = readDocs.map((snap,i) => {
    if (!snap.exists || snap.id !== IDS[i]) throw new Error("MARCO9_BACKUP_SOURCE_MISSING");
    return { id: snap.id, data: snap.data() };
  });
  const backup = {
    schemaVersion:"9.6A", projectId:DEMO_PROJECT, sourceCollection:SOURCE,
    documents, sha256:sha256(JSON.stringify(documents))
  };
  validateBackup(backup);
  return backup;
}
async function restoreToIsolatedNamespace(db, backup) {
  validateBackup(backup); // Fail before write on tamper / project mismatch.
  const batch = db.batch();
  for (const doc of backup.documents) {
    batch.set(db.collection(DEST).doc(doc.id), doc.data);
  }
  await batch.commit();
}
async function readInOrder(db, collection) {
  return Promise.all(IDS.map(id => db.collection(collection).doc(id).get()));
}
async function assertAbsent(db, collection) {
  const docs = await readInOrder(db,collection);
  assert.ok(docs.every(doc => !doc.exists), "fixture cleanup must remove all synthetic docs");
}

async function main() {
  assertEmulatorOnly();
  const root = path.resolve(__dirname,"..");
  const mainSource = fs.readFileSync(path.join(root,"functions/main.js"),"utf8");
  const ci = fs.readFileSync(path.join(root,
    ".github/workflows/marco8-rc-regression.yml"),"utf8");
  assert.ok(mainSource.includes('const STAGING_PROJECT_ID = "bjj-exams-staging";'));
  assert.ok(ci.includes("demo-bjj-exams-resilience"));
  assert.ok(!ci.includes("firebase deploy"));
  assert.ok(!ci.includes("secrets."));

  await runWithDemoFirestore("backup-restore",async({db,projectId})=>{
    assert.equal(projectId,DEMO_PROJECT);
    try {
      await assertAbsent(db,SOURCE);
      await assertAbsent(db,DEST);
      const seed = db.batch();
      for(const doc of fixtures)seed.set(db.collection(SOURCE).doc(doc.id),doc.data);
      await seed.commit();
      const backup = makeSnapshot(await readInOrder(db,SOURCE));
      assert.equal(backup.documents.length,4);
      assert.match(backup.sha256,/^[a-f0-9]{64}$/);

      const tampered = structuredClone(backup);
      tampered.documents[2].data.cents = 9999;
      assert.throws(()=>validateBackup(tampered),/INTEGRITY_INVALID/);
      const wrongProject = {...backup,projectId:"bjj-exams"};
      assert.throws(()=>validateBackup(wrongProject),/METADATA_OR_NAMESPACE_INVALID/);
      await assertAbsent(db,DEST); // Tampered backup never causes any write.

      const deletion = db.batch();
      for(const id of IDS)deletion.delete(db.collection(SOURCE).doc(id));
      await deletion.commit();
      await assertAbsent(db,SOURCE); // Simulate source loss.
      await restoreToIsolatedNamespace(db,backup);
      const recovered=await readInOrder(db,DEST);
      assert.ok(recovered.every(s=>s.exists));
      const recoveredBackup = {
        ...backup,
        documents:recovered.map(s=>({id:s.id,data:s.data()}))
      };
      assert.equal(sha256(JSON.stringify(recoveredBackup.documents)),backup.sha256);
      assert.deepEqual(recoveredBackup.documents,backup.documents);
      console.log("MARCO9_6A_SYNTHETIC_DOCUMENTS_RESTORED=4/4");
      console.log("MARCO9_6A_SNAPSHOT_INTEGRITY=PASSED");
      console.log("MARCO9_6A_TAMPER_AND_PROJECT_MISMATCH_REJECTED=PASSED");
    }finally {
      // Cleanup is mandatory even after a failed assertion.
      const cleanup=db.batch();
      for(const id of IDS){
        cleanup.delete(db.collection(SOURCE).doc(id));
        cleanup.delete(db.collection(DEST).doc(id));
      }
      await cleanup.commit();
      await assertAbsent(db,SOURCE);
      await assertAbsent(db,DEST);
      console.log("MARCO9_6A_EMULATOR_CLEANUP=8/8_ABSENT");
    }
  });
  console.log("MARCO9_6A_MANAGED_FIRESTORE_EXPORT_RESTORE=NOT_TESTED");
  console.log("MARCO9_6A_RPO_RTO=NOT_APPROVED");
  console.log("MARCO9_6A_CLOUD_ACCESS=NOT_RUN");
  console.log("MARCO9_GATE_9_6A_RECOVERY_DEMO=PASSED");
}
main().catch(error => {
  console.error("MARCO9_6A_RECOVERY_DEMO=FAILED", error?.code || "ASSERTION_FAILED");
  process.exitCode=1;
});
