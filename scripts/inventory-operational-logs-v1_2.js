"use strict";
// Gate 9.5B1: source-only log sink inventory. NO Cloud Logging access.
// Output aggregates only, never code excerpts, literal log strings or PII.
const fs=require("node:fs");
const path=require("node:path");
const ROOT=path.resolve(__dirname,"..");
const SINK=/\b(?:console|logger)\.(?:log|info|warn|error|debug)\s*\(/g;
const SENSITIVE=/\b(?:err(?:or)?|req(?:uest)?|res(?:ponse)?|headers?|payload|body|token|secret|cpf|email|password|auth)\b/i;
function classifySource(source){
  if(typeof source!=="string")throw Error("SOURCE_REQUIRED");
  const lines=source.split(/\r?\n/);
  const entries=[];
  for(let i=0;i<lines.length;i++){
    // Approximate scanning on source lines: not a parser, not a proof of safety.
    const line=lines[i];
    const matches=[...line.matchAll(SINK)];
    if(!matches.length)continue;
    const context=lines.slice(i,Math.min(lines.length,i+6)).join("\n").split(";")[0];
    for(const match of matches){
      const type=match[0].replace(/\s*\($/,"").trim();
      let status="MANUAL_REVIEW_REQUIRED";
      if(/\bsanitizeOperationalError\s*\(/.test(context))
        status="SANITIZER_PRESENT_REVIEW_REQUIRED";
      else if(SENSITIVE.test(context.replace(SINK,"LOG(")))
        status="POSSIBLE_SENSITIVE_ARGUMENT_REVIEW_REQUIRED";
      entries.push(Object.freeze({line:i+1,sink:type,status}));
    }
  }
  return entries;
}
function inventorySources(sources){
  if(!sources||!Array.isArray(sources)||sources.length===0||
      sources.some(x=>typeof x?.path!=="string"||
      !/^(?:functions\/(?:src\/)?[a-zA-Z0-9_./-]+\.js)$/.test(x.path)||
      typeof x.content!=="string"))throw Error("LOG_INVENTORY_INPUT_INVALID");
  const counters={
    MANUAL_REVIEW_REQUIRED:0,
    POSSIBLE_SENSITIVE_ARGUMENT_REVIEW_REQUIRED:0,
    SANITIZER_PRESENT_REVIEW_REQUIRED:0
  };
  let sinks=0;
  const directories=new Set();
  for(const source of sources){
    directories.add(path.dirname(source.path));
    for(const entry of classifySource(source.content)){
      sinks++;
      counters[entry.status]++;
    }
  }
  return Object.freeze({
    schemaVersion:"9.5B1",
    scope:"STATIC_FUNCTION_SOURCE_ONLY",
    sourceFiles:sources.length,
    directoriesReviewed:directories.size,
    sinkCandidates:sinks,
    categories:counters,
    requiresHumanReview:true,
    actualCloudLoggingAccess:"NOT_RUN",
    cloudRetentionAndIAM:"NOT_INSPECTED",
    livePIIExposureProven:false,
    retentionDecision:"RETENTION_UNAPPROVED",
    deployment:"NOT_RUN",
    releaseDecision:"NO_GO"
  });
}
function loadRepositorySources() {
  const files=[
    path.join(ROOT,"functions/main.js"),
    path.join(ROOT,"functions/index.js")
  ];
  function visit(dir) {
    for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      const absolute=path.join(dir,item.name);
      if(item.isSymbolicLink())throw Error("SYMLINK_SOURCE_FORBIDDEN");
      if(item.isDirectory())visit(absolute);
      else if(item.isFile()&&item.name.endsWith(".js"))files.push(absolute);
    }
  }
  visit(path.join(ROOT,"functions/src"));
  return files.sort().map(file=>({
    path:path.relative(ROOT,file).split(path.sep).join("/"),
    content:fs.readFileSync(file,"utf8")
  }));
}
function inventoryRepository(){
  return inventorySources(loadRepositorySources());
}
if(require.main===module){
  try{
    if(process.argv.length!==2)throw Error("EXTRA_ARGUMENTS_FORBIDDEN");
    process.stdout.write(JSON.stringify(inventoryRepository(),null,2)+"\n");
  }catch(_){
    process.stderr.write("MARCO9_LOG_INVENTORY=BLOCKED\n");
    process.exitCode=2;
  }
}
module.exports=Object.freeze({
  ROOT,classifySource,inventorySources,loadRepositorySources,inventoryRepository
});
