"use strict";
// Temporary offline comparator: only public npm lockfile metadata, no credentials.
// No network or writes; run after npm computes a staged lockfile on the CI runner.
const fs=require("node:fs");
function main(){
 const [beforePath,afterPath]=process.argv.slice(2);
 if(!beforePath?.startsWith("/tmp/")||
    afterPath!=="functions/package-lock.json")throw Error("PATHS_INVALID");
 const before=JSON.parse(fs.readFileSync(beforePath,"utf8"));
 const after=JSON.parse(fs.readFileSync(afterPath,"utf8"));
 if(before.name!=="bjj-exams-functions"||after.name!==before.name||
    before.version!==after.version||after.lockfileVersion!==3||
    Object.keys(after.packages||{}).length>380)throw Error("ROOT_INVALID");
 const expected={axios:"1.20.0","firebase-admin":"14.4.0","firebase-functions":"7.3.2","form-data":"4.0.6"};
 if(JSON.stringify(after.packages[""].dependencies)!==JSON.stringify(expected)||
    JSON.stringify(before.packages[""].dependencies)!==JSON.stringify(expected)||
    JSON.stringify(JSON.parse(fs.readFileSync("functions/package.json","utf8")).overrides)!==JSON.stringify({
      "gaxios@6.7.1":{uuid:"11.1.1"}
    }))throw Error("DIRECT_OR_OVERRIDE_INCORRECT");
 for(const [name,version] of Object.entries(expected))
   if(after.packages["node_modules/"+name]?.version!==version)
     throw Error("DIRECT_INSTALLED_CHANGED");
 const changes=Object.entries(after.packages).filter(([p,v])=>
   JSON.stringify(before.packages[p])!==JSON.stringify(v));
 const removed=Object.keys(before.packages).filter(p=>!Object.hasOwn(after.packages,p));
 if(changes.length>40||removed.length>40)throw Error("OVERRIDES_TOO_BROAD");
 for(const [p,v] of changes){
   if(p==="")continue;
   if(!p.startsWith("node_modules/") ||typeof v.version!=="string"||
      (v.resolved &&(!v.resolved.startsWith("https://registry.npmjs.org/")||
        !/^sha(?:512|384|256)-[A-Za-z0-9+/=]+$/.test(v.integrity||""))))
     throw Error("UNTRUSTED_PATCH_METADATA");
 }
 const data=JSON.stringify({changes,removed,afterCount:Object.keys(after.packages).length});
 process.stdout.write("MARCO9_UUID_PATCH_CHUNKS="+Math.ceil(data.length/1800)+"\n");
 for(let i=0;i<data.length;i+=1800)
   process.stdout.write("MARCO9_UUID_PATCH_PART_"+(i/1800)+"="+data.slice(i,i+1800)+"\n");
 process.stdout.write("MARCO9_UUID_PATCH_TARGETS="+changes.map(([p,v])=>p+":"+v.version).join(",")+"\n");
}
if(require.main===module){try{main();}catch(e){const allowed=new Set(["PATHS_INVALID","ROOT_INVALID","DIRECT_OR_OVERRIDE_INCORRECT","DIRECT_INSTALLED_CHANGED","OVERRIDES_TOO_BROAD","UNTRUSTED_PATCH_METADATA"]);process.stderr.write("UUID_PATCH_PROPOSAL="+(allowed.has(e.message)?e.message:"FAILED")+"\n");process.exitCode=2;}}
