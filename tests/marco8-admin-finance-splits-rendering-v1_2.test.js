"use strict";
const assert=require("assert");
const fs=require("fs");
const path=require("path");
const rendererApi=require("../js/admin-shell-finance-splits-renderer-v1_2");
const registryApi=require("../js/admin-shell-route-registry-v1_2");
const controllerApi=require("../js/admin-shell-controller-v1_2");
const ROOT=path.resolve(__dirname,"..");

function source(p){return fs.readFileSync(path.join(ROOT,p),"utf8").replace(/\r\n/g,"\n");}
function classList(){const s=new Set();return{add:v=>s.add(v),remove:v=>s.delete(v),contains:v=>s.has(v)};}
function element(tag="div"){return{
  tagName:String(tag).toUpperCase(),hidden:false,dataset:{},textContent:"",className:"",
  classList:classList(),children:[],attributes:{},listeners:{},value:"",id:"",name:"",
  type:"",maxLength:0,autocomplete:"",tabIndex:0,scope:"",
  replaceChildren(...c){this.children=c;},appendChild(c){this.children.push(c);return c;},
  setAttribute(n,v){this.attributes[n]=String(v);},removeAttribute(n){delete this.attributes[n];},
  addEventListener(n,h){this.listeners[n]=h;}
};}
function documentStub(){
  const selectors=[
    "[data-admin-shell-root]","[data-admin-state-loading]","[data-admin-state-denied]",
    "[data-admin-state-error]","[data-admin-error-message]","[data-admin-state-ready]",
    "[data-admin-navigation]","[data-admin-user-name]","[data-admin-environment]",
    "[data-admin-route-title]","[data-admin-route-section]","[data-admin-route-content]",
    "[data-admin-route-placeholder-panel]","[data-admin-operational-content]",
    "[data-admin-route-state-title]","[data-admin-route-placeholder]"
  ];
  const nodes=new Map(selectors.map(s=>[s,element()]));
  return{nodes,querySelector:s=>nodes.get(s)||null,createElement:t=>element(t)};
}
function findTag(node,tag){
  const wanted=String(tag).toUpperCase();
  if(node?.tagName===wanted)return node;
  for(const c of node?.children||[]){const found=findTag(c,wanted);if(found)return found;}
  return null;
}
function allButtons(node,out=[]){
  if(node?.tagName==="BUTTON")out.push(node);
  for(const c of node?.children||[])allButtons(c,out);
  return out;
}
function textTree(node){
  let out=String(node?.textContent||"");
  for(const c of node?.children||[])out+=" "+textTree(c);
  return out;
}

async function main(){
  assert.deepStrictEqual(rendererApi.FINANCE_SPLITS_ROUTE_IDS,["finance","splits"]);
  assert.strictEqual(rendererApi.basisPointsLabel(1000),"10%");
  assert.strictEqual(rendererApi.basisPointsLabel(1250),"12.5%");

  const f=rendererApi.buildFinanceViewModel({finance:{
    persisted:true,active:true,defaultPlatformFeeBps:1000,
    rule:{id:"platform-default",status:"active",scope:"platform_default",platformFeeBps:1000,
      recipientMode:"product_owner",recipientShares:[],version:2,updatedAt:"u",walletId:"secret"}
  }});
  assert.strictEqual(f.defaultPlatformFee,"10%");
  assert.strictEqual(f.rule.platformFee,"10%");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(f.rule,"walletId"),false);

  const s=rendererApi.buildSplitsViewModel({split:{
    lookupRequired:false,courseId:"course-1",courseFinancialRuleId:"rule-1",
    rule:{id:"rule-1",status:"active",scope:"product_override",platformFeeBps:1000,
      recipientMode:"explicit",recipientShares:[
        {recipientType:"platform",recipientId:null,shareBps:2000},
        {recipientType:"user",recipientId:"user-1",shareBps:8000}
      ],version:1,updatedAt:"u"},
    recipientReadiness:[
      {recipientType:"platform",recipientId:null,ready:true,reason:"PLATFORM_PRIMARY_ACCOUNT"},
      {recipientType:"user",recipientId:"user-1",ready:false,reason:"ACCOUNT_NOT_READY"}
    ]
  }});
  assert.strictEqual(s.recipients.length,2);
  assert.strictEqual(s.recipients[0].share,"20%");
  assert.strictEqual(s.recipients[1].share,"80%");
  assert.strictEqual(s.recipients[1].ready,"Nao");

  const calls=[];
  const document=documentStub();
  const renderer=rendererApi.createFinanceSplitsRenderer({
    document,
    routeRuntime:{applyFilters(routeId,filters){calls.push({routeId,filters});return Promise.resolve({state:"route-ready"});}}
  });

  const financeContainer=element();
  assert.strictEqual(renderer.render(financeContainer,{
    state:"route-ready",routeId:"finance",
    data:{finance:{persisted:true,active:true,defaultPlatformFeeBps:1000,rule:null}}
  }),true);
  assert.ok(textTree(financeContainer).includes("Taxa padrao da plataforma"));

  const splitsContainer=element();
  assert.strictEqual(renderer.render(splitsContainer,{
    state:"route-ready",routeId:"splits",
    data:{split:{lookupRequired:true,courseId:null,courseFinancialRuleId:null,rule:null,recipientReadiness:[]}}
  }),true);

  const form=findTag(splitsContainer,"form");
  const input=findTag(splitsContainer,"input");
  input.value="  course-123  ";
  form.listeners.submit({preventDefault(){}});
  assert.deepStrictEqual(calls[0],{routeId:"splits",filters:{courseId:"course-123"}});
  const clear=allButtons(splitsContainer).find(b=>b.textContent==="Limpar consulta");
  assert.ok(clear); clear.listeners.click();
  assert.deepStrictEqual(calls[1],{routeId:"splits",filters:{}});

  assert.strictEqual(renderer.render(element(),{state:"route-ready",routeId:"people",data:{}}),false);
  assert.strictEqual(registryApi.financeSplitsIntegratedRegistry().integratedRoutes().length,9);

  const operationalCalls=[],financeCalls=[];
  const controller=controllerApi.createController({
    document,
    navigationApi:{
      buildNavigation(){return[{id:"console",label:"Console",items:[{id:"finance",label:"Financeiro",route:"finance",capability:"console.finance.read"}]}];},
      canNavigateTo(_c,r){return r==="finance";},
      firstAllowedRoute(){return"finance";}
    },
    routeRuntime:{activate(routeId){return Promise.resolve({state:"route-ready",routeId,mode:"list",
      data:{finance:{persisted:false,active:false,defaultPlatformFeeBps:1000,rule:null}}});}},
    operationalRenderer:{render(_c,state){operationalCalls.push(state.routeId);return false;}},
    financeSplitsRenderer:{render(container,state){financeCalls.push(state.routeId);container.replaceChildren(element());return true;}}
  });
  controller.mountContext({userId:"admin-1",displayName:"Admin",environment:"staging"},"finance");
  await Promise.resolve(); await Promise.resolve();
  assert.deepStrictEqual(operationalCalls,["finance"]);
  assert.deepStrictEqual(financeCalls,["finance"]);
  assert.strictEqual(document.nodes.get("[data-admin-route-placeholder-panel]").hidden,true);
  assert.strictEqual(document.nodes.get("[data-admin-operational-content]").hidden,false);

  const html=source("admin_shell_v1_2.html");
  const controllerSource=source("js/admin-shell-controller-v1_2.js");
  const rendererSource=source("js/admin-shell-finance-splits-renderer-v1_2.js");
  const order=[
    "js/admin-shell-operational-renderer-v1_2.js",
    "js/admin-shell-finance-splits-renderer-v1_2.js",
    "js/admin-shell-controller-v1_2.js"
  ].map(x=>html.indexOf(x));
  assert.ok(order.every(x=>x>=0)&&order[0]<order[1]&&order[1]<order[2]);

  for(const marker of[
    "BjjExamsAdminShellFinanceSplitsRenderer","__bjjAdminShellFinanceSplitsRendererV12",
    "financeSplitsIntegratedRegistry","operationalIntegratedRegistry","financeSplitsRenderer"
  ]) assert.ok(html.includes(marker),`Missing ${marker}`);

  assert.ok(controllerSource.includes("rendererCandidates"));
  assert.ok(controllerSource.includes("financeSplitsRenderer"));
  assert.strictEqual(rendererSource.includes(".innerHTML"),false);
  assert.strictEqual(rendererSource.includes("JSON.stringify"),false);

  for(const m of[
    "configurarRegraFinanceiraPadraoV12","definirRegraFinanceiraCursoV12",
    "registrarContaRecebedorV12","configurarWalletRecebedorV12"
  ]) assert.strictEqual(rendererSource.includes(m),false);

  for(const forbidden of[
    "firebase-firestore","getFirestore(","getDocs(","setDoc(","addDoc(","updateDoc(","deleteDoc(","onSnapshot("
  ]) for(const src of[html,controllerSource,rendererSource]) assert.strictEqual(src.includes(forbidden),false);

  assert.ok(rendererSource.includes('"Consultar curso"'));
  assert.ok(rendererSource.includes('"Limpar consulta"'));
  assert.ok(rendererSource.includes('"aria-live"'));

  console.log("MARCO8_7D3_FINANCE_VIEW_MODEL=PASSED");
  console.log("MARCO8_7D3_SPLITS_VIEW_MODEL=PASSED");
  console.log("MARCO8_7D3_BPS_FORMATTING=PASSED");
  console.log("MARCO8_7D3_SPLITS_QUERY_FORM=PASSED");
  console.log("MARCO8_7D3_SPLITS_FILTER_RUNTIME=PASSED");
  console.log("MARCO8_7D3_RENDERER_FALLBACK=PASSED");
  console.log("MARCO8_7D3_ACTIVE_ROUTES=9/14");
  console.log("MARCO8_7D3_FINANCIAL_MUTATIONS=BLOCKED");
  console.log("MARCO8_7D3_SAFE_DOM=PASSED");
  console.log("MARCO8_7D3_BASIC_ACCESSIBILITY=PASSED");
  console.log("MARCO8_7D3_DIRECT_FIRESTORE=FORBIDDEN");
  console.log("MARCO8_7D3_FINANCE_SPLITS_RENDERING=PASSED");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
