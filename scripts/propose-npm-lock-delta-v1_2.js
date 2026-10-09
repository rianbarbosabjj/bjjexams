"use strict";

// Temporary Gate 9.4C2 proposal: serializes npm-generated LOCK delta only.
// No GitHub permissions, credentials, production access or repository writes.
const fs=require("node:fs");
const path=require("node:path");
function computeLockDelta(before,after){
  if(before?.name!=="bjj-exams-functions" || after?.name!==before.name ||
     before?.version!=="1.2.0" || after?.version!==before.version ||
     before?.lockfileVersion!==3 || after?.lockfileVersion!==3 ||
     !before.packages?.[""] || !after.packages?.[""] ||
     JSON.stringify(before.packages[""])!==JSON.stringify(after.packages[""]))
    throw Error("NPM_LOCKPATCH_DIRECT_ROOT_CHANGED");
  const allowed=Object.keys(before.packages[""].dependencies);
  if(allowed.join("|")!=="axios|firebase-admin|firebase-functions|form-data")
    throw Error("NPM_LOCKPATCH_DIRECT_ALLOWLIST_CHANGED");
  for(const name of allowed) {
    if(before.packages["node_modules/"+name]?.version !==
       after.packages["node_modules/"+name]?.version)
       throw Error("NPM_LOCKPATCH_PINNED_DIRECT_PACKAGE_CHANGED");
  }
  const changes=[];
  for(const [location,value] of Object.entries(after.packages)) {
    if(location==="")continue;
    if(!location.startsWith("node_modules/") || !value ||
       typeof value.version!=="string" ||
       (value.resolved &&
         (!value.resolved.startsWith("https://registry.npmjs.org/") ||
          !/^sha(?:512|384|256)-[A-Za-z0-9+/=]+$/.test(value.integrity||""))))
      throw Error("NPM_LOCKPATCH_UNSAFE_PACKAGE_METADATA");
    if(JSON.stringify(before.packages[location])!==JSON.stringify(value))
      changes.push([location,value]);
  }
  const removed=Object.keys(before.packages).filter(k=>k!=="" &&
    !Object.hasOwn(after.packages,k));
  if(changes.length>140 || removed.length>140)
    throw Error("NPM_LOCKPATCH_DIFF_TOO_LARGE");
  const result={lockfileVersion:3,
    direct:after.packages[""].dependencies,
    beforeCount:Object.keys(before.packages).length,
    afterCount:Object.keys(after.packages).length,
    changes,removed};
  return result;
}
function main() {
  const args=process.argv.slice(2);
  if(args.length!==2 || !args[0].startsWith("/tmp/") ||
     args[1]!=="functions/package-lock.json")
    throw Error("NPM_LOCKPATCH_PATHS_INVALID");
  const original=JSON.parse(fs.readFileSync(args[0],"utf8"));
  const updated=JSON.parse(fs.readFileSync(args[1],"utf8"));
  const patch=computeLockDelta(original,updated);
  const json=JSON.stringify(patch);
  process.stdout.write("MARCO9_LOCKPATCH_CHUNK_COUNT="+Math.ceil(json.length/2000)+"\n");
  for(let i=0;i<json.length;i+=2000){
    process.stdout.write("MARCO9_LOCKPATCH_CHUNK_"+Math.floor(i/2000)+"="+json.slice(i,i+2000)+"\n");
  }
  process.stdout.write("MARCO9_LOCKPATCH_CHANGED="+patch.changes.length+"\n");
  process.stdout.write("MARCO9_LOCKPATCH_REMOVED="+patch.removed.length+"\n");
}
if(require.main===module){
  try{main();}catch(_){process.stderr.write("MARCO9_LOCKPATCH=BLOCKED\n");process.exitCode=2;}
}
module.exports=Object.freeze({computeLockDelta});
