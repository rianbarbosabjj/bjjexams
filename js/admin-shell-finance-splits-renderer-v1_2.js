"use strict";
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports){module.exports=api;}
  if(root){root.BjjExamsAdminShellFinanceSplitsRenderer=api;}
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  const FINANCE_SPLITS_ROUTE_IDS=Object.freeze(["finance","splits"]);

  function value(v,fallback="—"){
    return v===undefined||v===null||v===""?fallback:String(v);
  }

  function yesNo(v){
    return v===true?"Sim":v===false?"Nao":"—";
  }

  function bps(v){
    const n=Number(v);
    return Number.isFinite(n)?`${n/100}%`:"—";
  }

  function el(document,tag,text){
    const node=document.createElement(tag);
    node.textContent=String(text??"");
    return node;
  }

  function addRow(document,dl,label,val){
    dl.appendChild(el(document,"dt",label));
    dl.appendChild(el(document,"dd",val));
  }

  function buildFinanceViewModel(result){
    const finance=result?.finance&&typeof result.finance==="object"&&!Array.isArray(result.finance)
      ? result.finance : {};
    const rule=finance.rule&&typeof finance.rule==="object"&&!Array.isArray(finance.rule)
      ? finance.rule : null;

    return Object.freeze({
      routeId:"finance",
      persisted:finance.persisted===true,
      active:finance.active===true,
      defaultPlatformFee:bps(finance.defaultPlatformFeeBps),
      rule:rule?Object.freeze({
        id:value(rule.id),
        status:value(rule.status),
        scope:value(rule.scope),
        platformFee:bps(rule.platformFeeBps),
        recipientMode:value(rule.recipientMode),
        recipientCount:Array.isArray(rule.recipientShares)?String(rule.recipientShares.length):"0",
        version:value(rule.version),
        updatedAt:value(rule.updatedAt)
      }):null
    });
  }

  function buildSplitsViewModel(result){
    const split=result?.split&&typeof result.split==="object"&&!Array.isArray(result.split)
      ? result.split : {};
    const rule=split.rule&&typeof split.rule==="object"&&!Array.isArray(split.rule)
      ? split.rule : null;
    const readiness=Array.isArray(split.recipientReadiness)?split.recipientReadiness:[];
    const shares=Array.isArray(rule?.recipientShares)?rule.recipientShares:[];

    const recipients=shares.map(share=>{
      const type=value(share?.recipientType,"");
      const id=share?.recipientId===undefined||share?.recipientId===null||share?.recipientId===""
        ? null:String(share.recipientId);
      const ready=readiness.find(item=>
        value(item?.recipientType,"")===type &&
        (item?.recipientId??null)===id
      )||null;
      return Object.freeze({
        recipientType:type||"—",
        recipientId:id||"Conta principal da plataforma",
        share:bps(share?.shareBps),
        ready:yesNo(ready?.ready),
        reason:value(ready?.reason)
      });
    });

    return Object.freeze({
      routeId:"splits",
      lookupRequired:split.lookupRequired===true,
      courseId:value(split.courseId,""),
      courseFinancialRuleId:value(split.courseFinancialRuleId),
      rule:rule?Object.freeze({
        id:value(rule.id),
        status:value(rule.status),
        scope:value(rule.scope),
        platformFee:bps(rule.platformFeeBps),
        recipientMode:value(rule.recipientMode),
        version:value(rule.version),
        updatedAt:value(rule.updatedAt)
      }):null,
      recipients:Object.freeze(recipients)
    });
  }

  function renderFinance(document,container,state){
    const model=buildFinanceViewModel(state.data);
    const section=document.createElement("section");
    section.className="finance-console-panel";
    section.setAttribute("aria-labelledby","finance-console-title");
    const h=el(document,"h2","Financeiro");
    h.id="finance-console-title";
    section.appendChild(h);
    const note=el(document,"p","Visao somente leitura da regra financeira canonica da plataforma.");
    note.className="finance-console-note";
    section.appendChild(note);

    const dl=document.createElement("dl");
    dl.className="finance-console-summary";
    addRow(document,dl,"Regra persistida",yesNo(model.persisted));
    addRow(document,dl,"Regra ativa",yesNo(model.active));
    addRow(document,dl,"Taxa padrao da plataforma",model.defaultPlatformFee);
    if(model.rule){
      addRow(document,dl,"ID da regra",model.rule.id);
      addRow(document,dl,"Status",model.rule.status);
      addRow(document,dl,"Escopo",model.rule.scope);
      addRow(document,dl,"Taxa da plataforma",model.rule.platformFee);
      addRow(document,dl,"Modo de recebedores",model.rule.recipientMode);
      addRow(document,dl,"Recebedores explicitos",model.rule.recipientCount);
      addRow(document,dl,"Versao",model.rule.version);
      addRow(document,dl,"Atualizado em",model.rule.updatedAt);
    }
    section.appendChild(dl);
    container.replaceChildren(section);
    return true;
  }

  function renderSplits(document,routeRuntime,container,state){
    const model=buildSplitsViewModel(state.data);
    const section=document.createElement("section");
    section.className="finance-console-panel";
    section.setAttribute("aria-labelledby","splits-console-title");
    const h=el(document,"h2","Splits");
    h.id="splits-console-title";
    section.appendChild(h);
    const note=el(document,"p","Consulte a regra de split canonica de um curso. Nenhuma alteracao e realizada nesta tela.");
    note.className="finance-console-note";
    section.appendChild(note);

    const form=document.createElement("form");
    form.className="finance-splits-query";
    form.setAttribute("aria-label","Consulta de split por curso");
    const label=el(document,"label","ID do curso");
    label.setAttribute("for","finance-splits-course-id");
    const input=document.createElement("input");
    input.id="finance-splits-course-id";
    input.name="courseId";
    input.type="text";
    input.maxLength=200;
    input.autocomplete="off";
    input.value=model.courseId;
    input.setAttribute("placeholder","courseId");

    const actions=document.createElement("div");
    actions.className="finance-console-actions";
    const submit=el(document,"button","Consultar curso");
    submit.type="submit";
    const clear=el(document,"button","Limpar consulta");
    clear.type="button";

    clear.addEventListener("click",()=>{
      input.value="";
      routeRuntime.applyFilters("splits",{});
    });

    form.addEventListener("submit",event=>{
      if(event&&typeof event.preventDefault==="function"){event.preventDefault();}
      const courseId=String(input.value||"").trim();
      routeRuntime.applyFilters("splits",courseId?{courseId}:{});
    });

    form.appendChild(label);
    form.appendChild(input);
    actions.appendChild(submit);
    actions.appendChild(clear);
    form.appendChild(actions);
    section.appendChild(form);

    const status=el(document,"p",
      model.lookupRequired
        ?"Informe um curso para consultar a configuracao de split."
        :model.rule
          ?`Regra carregada para o curso ${model.courseId}.`
          :`O curso ${model.courseId} nao possui regra financeira especifica.`
    );
    status.className="finance-console-status";
    status.setAttribute("role","status");
    status.setAttribute("aria-live","polite");
    section.appendChild(status);

    if(!model.lookupRequired){
      const dl=document.createElement("dl");
      dl.className="finance-console-summary";
      addRow(document,dl,"Curso",model.courseId||"—");
      addRow(document,dl,"Regra vinculada no curso",model.courseFinancialRuleId);
      if(model.rule){
        addRow(document,dl,"ID da regra",model.rule.id);
        addRow(document,dl,"Status",model.rule.status);
        addRow(document,dl,"Escopo",model.rule.scope);
        addRow(document,dl,"Taxa da plataforma",model.rule.platformFee);
        addRow(document,dl,"Modo de recebedores",model.rule.recipientMode);
        addRow(document,dl,"Versao",model.rule.version);
        addRow(document,dl,"Atualizado em",model.rule.updatedAt);
      }
      section.appendChild(dl);
    }

    if(model.recipients.length){
      const region=document.createElement("div");
      region.className="finance-console-table-region";
      region.tabIndex=0;
      const table=document.createElement("table");
      table.appendChild(el(document,"caption","Recebedores da regra de split"));
      const thead=document.createElement("thead");
      const hr=document.createElement("tr");
      for(const title of ["Tipo","Recebedor","Participacao","Pronto","Motivo"]){
        const th=el(document,"th",title); th.scope="col"; hr.appendChild(th);
      }
      thead.appendChild(hr); table.appendChild(thead);
      const tbody=document.createElement("tbody");
      for(const recipient of model.recipients){
        const tr=document.createElement("tr");
        for(const cell of [recipient.recipientType,recipient.recipientId,recipient.share,recipient.ready,recipient.reason]){
          tr.appendChild(el(document,"td",cell));
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody); region.appendChild(table); section.appendChild(region);
    }

    container.replaceChildren(section);
    return true;
  }

  function createFinanceSplitsRenderer(options={}){
    const document=options.document;
    const routeRuntime=options.routeRuntime;
    if(!document||typeof document.createElement!=="function"){
      throw new TypeError("Finance/Splits renderer requires a document.");
    }
    if(!routeRuntime||typeof routeRuntime.applyFilters!=="function"){
      throw new TypeError("Finance/Splits renderer requires route filter interactions.");
    }

    function render(container,state){
      if(!container||typeof container.replaceChildren!=="function"||!state||
         (state.state!=="route-ready"&&state.state!=="route-empty")){
        return false;
      }
      const routeId=String(state.routeId||"").trim();
      if(routeId==="finance"){return renderFinance(document,container,state);}
      if(routeId==="splits"){return renderSplits(document,routeRuntime,container,state);}
      return false;
    }

    return Object.freeze({render});
  }

  return Object.freeze({
    FINANCE_SPLITS_ROUTE_IDS,
    basisPointsLabel:bps,
    buildFinanceViewModel,
    buildSplitsViewModel,
    createFinanceSplitsRenderer
  });
});
