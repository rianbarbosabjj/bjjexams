"use strict";

// Gate 9.6B1: adversarial restore SIMULATION, only with demo Firestore Emulator.
// NOT a Firestore managed backup/import/export test. Absolutely no real cloud.
const assert=require("node:assert/strict");
const crypto=require("node:crypto");
const fs=require("node:fs");
const path=require("node:path");
const {
 DEMO_PROJECT,assertEmulatorOnly,runWithDemoFirestore
}=require("./helpers/marco9-demo-emulator-boundary-v1_2");
const {
 inspectRepository
}=require("../scripts/preflight-marco9-managed-backup-v1_2");
const SOURCE="_marco9_recovery_negative_source_v12";
const DEST="_marco9_recovery_negative_restore_v12";
const KEYS=Object.freeze(["course_fixture","exam_fixture","order_fixture","student_fixture"]);
const DATA=Object.freeze([
 {id:"course_fixture",data:{type:"course",name:"synthetic-course",published:false}},
 {id:"exam_fixture",data:{type:"exam",examId:"synthetic-exam",approved:false}},
 {id:"order_fixture",data:{type:"order",orderId:"synthetic-order",cents:10,state:"test_only"}},
 {id:"student_fixture",data:{type:"student",userId:"synthetic-user",active:false}}
]);
const DIGEST=docs=>crypto.createHash("sha256")
 .update(JSON.stringify(docs),"utf8").digest("hex");
function snapshot(docs){
  const b={schemaVersion:"9.6B1-DEMO",
    projectId:DEMO_PROJECT,sourceCollection:SOURCE,
    targetCollection:DEST,
    documents:docs.map(doc=>({id:doc.id,data:doc.data()}))
  };
  return {...b,sha256:DIGEST(b.documents)};
}
function validate(snapshotValue){
  if(!snapshotValue||typeof snapshotValue!=="object"||
     Array.isArray(snapshotValue)||
     Object.keys(snapshotValue).sort().join("|")!==
       "documents|projectId|schemaVersion|sha256|sourceCollection|targetCollection"||
     snapshotValue.schemaVersion!=="9.6B1-DEMO"||
     snapshotValue.projectId!==DEMO_PROJECT||
     snapshotValue.sourceCollection!==SOURCE||
     snapshotValue.targetCollection!==DEST||
     !Array.isArray(snapshotValue.documents)||
     snapshotValue.documents.length!==KEYS.length||
     snapshotValue.documents.some((doc,i)=>
       doc?.id!==KEYS[i]||!doc.data||
       typeof doc.data!=="object"||Array.isArray(doc.data)||
       Object.keys(doc).sort().join("|")!=="data|id")||
     typeof snapshotValue.sha256!=="string"||
     !/^[a-f0-9]{64}$/.test(snapshotValue.sha256)||
     DIGEST(snapshotValue.documents)!==snapshotValue.sha256)
    throw Error("MARCO9_6B1_UNTRUSTED_BACKUP_REJECTED");
}
async function readDocs(db,collection){
  return Promise.all(KEYS.map(id=>db.collection(collection).doc(id).get()));
}
async function assertAbsent(db,collection){
  const docs=await readDocs(db,collection);
  assert.ok(docs.every(d=>!d.exists),"demo cleanup required");
}
async function isolatedRestore(db,backup){
  validate(backup); // no DB access until integrity, project and namespace checked
  await db.runTransaction(async tx=>{
    const refs=backup.documents.map(({id})=>db.collection(DEST).doc(id));
    const docs=await Promise.all(refs.map(ref=>tx.get(ref)));
    if(docs.some(d=>d.exists)){
      throw Error("MARCO9_6B1_TARGET_NOT_EMPTY");
    }
    for(let i=0;i<refs.length;i++)
      tx.create(refs[i],backup.documents[i].data);
  });
}
async function main(){
  assertEmulatorOnly();
  const readiness=inspectRepository();
  assert.equal(readiness.releaseDecision,"NO_GO");
  assert.equal(readiness.operatorApproval,"NOT_GRANTED");
  assert.equal(readiness.inventoryDomains,12);
  const workflow=fs.readFileSync(path.resolve(__dirname,
    "../.github/workflows/marco8-rc-regression.yml"),"utf8");
  assert.ok(workflow.includes("demo-bjj-exams-resilience"));
  assert.ok(!workflow.includes("firebase deploy"));
  await runWithDemoFirestore("recovery-negative",async({db,projectId})=>{
    assert.equal(projectId,DEMO_PROJECT);
    try {
      await assertAbsent(db,SOURCE);
      await assertAbsent(db,DEST);
      const seed=db.batch();
      for(const record of DATA)seed.create(db.collection(SOURCE).doc(record.id),record.data);
      await seed.commit();
      const original=await readDocs(db,SOURCE);
      assert.ok(original.every(d=>d.exists));
      const b=snapshot(original);
      validate(b);
      for(const bad of [
        {...b,projectId:"bjj-exams-staging"},
        {...b,projectId:"bjj-exams"},
        {...b,targetCollection:SOURCE},
        {...b,sourceCollection:"users"},
        {...b,sha256:"0".repeat(64)},
        {...b,documents:[...b.documents].reverse()},
        {...b,documents:[...b.documents,{id:"rogue",data:{}}]}
      ]){
        assert.throws(()=>validate(bad),/UNTRUSTED_BACKUP_REJECTED/);
        await assert.rejects(isolatedRestore(db,bad),/UNTRUSTED_BACKUP_REJECTED/);
      }
      const changed=structuredClone(b);
      changed.documents[2].data.cents=50000;
      await assert.rejects(isolatedRestore(db,changed),/UNTRUSTED_BACKUP_REJECTED/);
      await assertAbsent(db,DEST);
      console.log("MARCO9_6B1_CORRUPTED_CROSS_PROJECT_BACKUPS=REJECTED");

      // Partially populated destination must fail with zero additional writes.
      await db.collection(DEST).doc(KEYS[0]).create({type:"existing",marker:"untouched"});
      await assert.rejects(isolatedRestore(db,b),/TARGET_NOT_EMPTY/);
      const partial=await readDocs(db,DEST);
      assert.equal(partial.filter(d=>d.exists).length,1);
      assert.deepEqual(partial[0].data(),{type:"existing",marker:"untouched"});
      await db.collection(DEST).doc(KEYS[0]).delete();
      await assertAbsent(db,DEST);
      console.log("MARCO9_6B1_PARTIAL_RESTORE_NO_OVERWRITE=PASSED");

      // Contention: only one isolated transaction may commit the same snapshot.
      const attempts=await Promise.allSettled([
        isolatedRestore(db,b),isolatedRestore(db,b)
      ]);
      assert.equal(attempts.filter(x=>x.status==="fulfilled").length,1);
      assert.equal(attempts.filter(x=>x.status==="rejected").length,1);
      const failure=attempts.find(x=>x.status==="rejected");
      assert.match(String(failure.reason?.message||""),/TARGET_NOT_EMPTY/);
      const output=await readDocs(db,DEST);
      assert.ok(output.every(d=>d.exists));
      assert.equal(DIGEST(output.map(d=>({id:d.id,data:d.data()}))),b.sha256);
      assert.deepEqual(
        (await readDocs(db,SOURCE)).map(d=>d.data()),
        original.map(d=>d.data()),"restoring must NEVER modify source"
      );
      await assert.rejects(isolatedRestore(db,b),/TARGET_NOT_EMPTY/);
      console.log("MARCO9_6B1_CONCURRENT_RESTORES=ONE_COMMIT_ONE_REJECT");
      console.log("MARCO9_6B1_SOURCE_UNTOUCHED=4/4");
      console.log("MARCO9_6B1_ISOLATED_RESTORE_DIGEST=PASSED");
    }finally {
      const cleanup=db.batch();
      for(const id of KEYS){
        cleanup.delete(db.collection(SOURCE).doc(id));
        cleanup.delete(db.collection(DEST).doc(id));
      }
      await cleanup.commit();
      await assertAbsent(db,SOURCE);
      await assertAbsent(db,DEST);
      console.log("MARCO9_6B1_DEMO_CLEANUP=8/8_ABSENT");
    }
  });
  console.log("MARCO9_6B1_CLOUD_MANAGED_BACKUP=NOT_VERIFIED");
  console.log("MARCO9_6B1_STAGING_RPO_RTO=UNAPPROVED");
  console.log("MARCO9_6B1_STAGING_IAM_RESTORE=NOT_RUN");
  console.log("MARCO9_6B1_RC_DECISION=NO_GO");
  console.log("MARCO9_GATE_9_6B1_ADVERSARIAL_DEMO=PASSED");
}
main().catch(err=>{
  const allowed=new Set(["MARCO9_6B1_TARGET_NOT_EMPTY",
    "MARCO9_6B1_UNTRUSTED_BACKUP_REJECTED"]);
  console.error("MARCO9_6B1_DEMO=FAILED",
    allowed.has(err?.message)?err.message:"ASSERTION_OR_EMULATOR_FAILURE");
  process.exitCode=1;
});
