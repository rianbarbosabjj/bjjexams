"use strict";

(function initBeltExamInstructorUi(root, factory) {
  const ui = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = ui;
  }

  if (root) {
    root.BjjExamsBeltExamInstructorUI = ui;
    ui.autoInstall();
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildBeltExamInstructorUi(root) {
    const SESSION_STATUS = Object.freeze({
      draft: Object.freeze({ label: "Rascunho", className: "bg-slate-500/10 text-slate-300 border-slate-500/30" }),
      candidates_selected: Object.freeze({ label: "Candidatos selecionados", className: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30" }),
      awaiting_payment: Object.freeze({ label: "Aguardando pagamentos", className: "bg-amber-500/10 text-amber-300 border-amber-500/30" }),
      ready: Object.freeze({ label: "Pronta", className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" }),
      cancelled: Object.freeze({ label: "Cancelada", className: "bg-rose-500/10 text-rose-300 border-rose-500/30" }),
      archived: Object.freeze({ label: "Arquivada", className: "bg-slate-800 text-slate-400 border-slate-700" })
    });

    const REGISTRATION_STATUS = Object.freeze({
      selected: "Selecionado",
      awaiting_payment: "Aguardando pagamento",
      authorized: "Pagamento confirmado",
      started: "Prova iniciada",
      submitted: "Prova enviada",
      passed: "Aprovado",
      failed: "Reprovado",
      certified: "Certificado",
      cancelled: "Cancelado",
      needs_reconciliation: "Revisão necessária"
    });

    const BELTS = Object.freeze(["Branca", "Azul", "Roxa", "Marrom", "Preta"]);

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function formatCurrency(amountCents, currency = "BRL") {
      const amount = Number(amountCents);
      if (!Number.isSafeInteger(amount) || amount < 0) return "Valor indisponível";
      try {
        return new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: String(currency || "BRL").toUpperCase()
        }).format(amount / 100);
      } catch (_) {
        return `R$ ${(amount / 100).toFixed(2).replace(".", ",")}`;
      }
    }

    function parsePriceCents(value) {
      const normalized = String(value || "")
        .trim()
        .replace(/\s/g, "")
        .replace(/\./g, "")
        .replace(",", ".");
      const amount = Number(normalized);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("Informe um valor de exame maior que zero.");
      }
      const cents = Math.round(amount * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0) {
        throw new Error("Valor do exame inválido.");
      }
      return cents;
    }

    function formatDate(value) {
      if (!value) return "Sem data definida";
      let date;
      if (value instanceof Date) date = value;
      else if (typeof value?.toDate === "function") date = value.toDate();
      else if (Number.isFinite(value?.seconds)) date = new Date(value.seconds * 1000);
      else date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Sem data definida";
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(date);
    }

    function statusMeta(status) {
      return SESSION_STATUS[String(status || "").trim()] || {
        label: "Estado desconhecido",
        className: "bg-slate-800 text-slate-400 border-slate-700"
      };
    }

    function normalizeError(error) {
      const status = String(error?.callableStatus || "").toUpperCase().replace(/-/g, "_");
      const domainCode = String(error?.domainCode || "").toUpperCase();
      if (error?.code === "BELT_EXAM_STAGING_ONLY") {
        return "Venda individual de exame está disponível somente no ambiente de staging.";
      }
      if (status === "UNAUTHENTICATED" || Number(error?.httpStatus) === 401) {
        return "Sua sessão expirou. Faça login novamente.";
      }
      if (status === "PERMISSION_DENIED" || Number(error?.httpStatus) === 403) {
        return "Seu vínculo não possui permissão para aplicar exames nesta organização.";
      }
      if (status === "FAILED_PRECONDITION" || domainCode.includes("NOT_ACTIVE")) {
        return error?.message || "A operação não é permitida no estado atual.";
      }
      return error?.message || "Não foi possível concluir a operação agora.";
    }

    function textElement(document, tag, text, className = "") {
      const element = document.createElement(tag);
      element.textContent = text == null ? "" : String(text);
      if (className) element.className = className;
      return element;
    }

    async function resolveAuth() {
      if (root?.__BJJ_EXAMS_AUTH__) return root.__BJJ_EXAMS_AUTH__;
      const [{ getApps }, { getAuth }] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js")
      ]);
      const apps = getApps();
      if (!apps.length) throw new Error("Firebase Auth ainda não foi inicializado.");
      return getAuth(apps[0]);
    }

    function createController(options = {}) {
      const api = options.api || root?.BjjExamsBeltExam;
      const document = options.document || root?.document;
      const hostname = options.hostname ?? root?.location?.hostname ?? "";
      if (!api) throw new Error("Cliente canônico de exames não configurado.");
      if (!document) throw new Error("Documento indisponível para a interface de exames.");

      const state = {
        organizations: [],
        organizationId: null,
        sessions: [],
        detail: null,
        eligibleStudents: [],
        installed: false,
        originalTabSwitch: null
      };

      async function callableOptions() {
        const auth = await resolveAuth();
        const expected = api.projectIdForEnvironment("staging", { hostname });
        const actual = String(auth.app?.options?.projectId || "").trim();
        if (actual !== expected) {
          const error = new Error(
            `Operação bloqueada: Auth ativo pertence a ${actual || "projeto desconhecido"}, esperado ${expected}.`
          );
          error.code = "ENVIRONMENT_MISMATCH";
          throw error;
        }
        if (!auth.currentUser) throw new Error("Faça login novamente para administrar exames.");
        return {
          hostname,
          getIdToken: () => auth.currentUser.getIdToken()
        };
      }

      function host() {
        return document.getElementById("acompanhamento");
      }

      function buildShell() {
        const container = host();
        if (!container) return false;
        container.innerHTML = "";
        container.dataset.beltExamCanonicalV12 = "true";

        const wrapper = document.createElement("div");
        wrapper.className = "space-y-6";

        const header = document.createElement("section");
        header.className = "bg-cardbg border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-xl";
        const top = document.createElement("div");
        top.className = "flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5";
        const copy = document.createElement("div");
        copy.append(
          textElement(document, "p", "Exames oficiais · v1.2", "text-[10px] text-neon uppercase tracking-[0.2em] font-black"),
          textElement(document, "h2", "Sessões e candidatos", "text-2xl font-black text-white mt-2"),
          textElement(document, "p", "Crie a sessão, selecione alunos ativos da organização e acompanhe a autorização financeira individual. Nenhum crédito do professor é consumido nesta jornada.", "text-sm text-slate-400 mt-2 max-w-3xl")
        );
        const badge = textElement(document, "span", "Ambiente de testes", "inline-flex w-max px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[9px] font-black uppercase tracking-widest");
        copy.appendChild(badge);
        top.appendChild(copy);

        const controls = document.createElement("div");
        controls.className = "flex flex-col sm:flex-row gap-3 min-w-[280px]";
        const select = document.createElement("select");
        select.id = "belt-exam-v12-organization";
        select.className = "flex-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-neon";
        select.addEventListener("change", () => {
          state.organizationId = select.value || null;
          state.detail = null;
          loadSessions().catch(showError);
        });
        const createButton = textElement(document, "button", "Nova sessão", "px-5 py-3 rounded-xl bg-neon text-slate-950 text-xs font-black uppercase tracking-widest");
        createButton.type = "button";
        createButton.addEventListener("click", () => openCreateSession().catch(showError));
        controls.append(select, createButton);
        top.appendChild(controls);
        header.appendChild(top);

        const sessions = document.createElement("section");
        sessions.id = "belt-exam-v12-sessions";
        sessions.className = "grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5";

        const detail = document.createElement("section");
        detail.id = "belt-exam-v12-detail";
        detail.className = "hidden bg-cardbg border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-xl";

        wrapper.append(header, sessions, detail);
        container.appendChild(wrapper);
        return true;
      }

      function renderOrganizations() {
        const select = document.getElementById("belt-exam-v12-organization");
        if (!select) return;
        select.innerHTML = "";
        for (const organization of state.organizations) {
          const option = document.createElement("option");
          option.value = String(organization.id || "");
          option.textContent = String(organization.nome || "Academia");
          option.selected = option.value === state.organizationId;
          select.appendChild(option);
        }
      }

      function renderSessionsLoading() {
        const container = document.getElementById("belt-exam-v12-sessions");
        if (!container) return;
        container.innerHTML = "";
        const loading = textElement(document, "div", "Carregando sessões canônicas...", "col-span-full text-center py-10 text-sm text-slate-400");
        container.appendChild(loading);
      }

      function sessionCard(session) {
        const article = document.createElement("article");
        article.className = "bg-cardbg border border-slate-700 rounded-2xl p-5 flex flex-col gap-4 shadow-lg";
        article.dataset.sessionId = String(session.sessionId || "");
        const meta = statusMeta(session.status);
        article.appendChild(textElement(document, "span", meta.label, `inline-flex w-max px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${meta.className}`));
        article.appendChild(textElement(document, "h3", `Exame para faixa ${session.targetBelt || "-"}`, "text-lg font-black text-white"));
        article.appendChild(textElement(document, "p", session.organization?.name || "Academia", "text-xs text-slate-400"));
        article.appendChild(textElement(document, "p", formatCurrency(session.price?.amountCents, session.price?.currency), "text-xl font-black text-neon"));
        article.appendChild(textElement(document, "p", `Data: ${formatDate(session.scheduledAt)}`, "text-xs text-slate-400"));
        const button = textElement(document, "button", "Abrir candidatos", "mt-auto w-full px-4 py-3 rounded-xl border border-neon/30 bg-neon/10 text-neon text-xs font-black uppercase tracking-widest hover:bg-neon hover:text-slate-950 transition");
        button.type = "button";
        button.addEventListener("click", () => openSession(session.sessionId).catch(showError));
        article.appendChild(button);
        return article;
      }

      function renderSessions() {
        const container = document.getElementById("belt-exam-v12-sessions");
        if (!container) return;
        container.innerHTML = "";
        if (!state.sessions.length) {
          container.appendChild(textElement(document, "div", "Nenhuma sessão criada nesta organização. Use “Nova sessão” para iniciar a seleção canônica.", "col-span-full border border-dashed border-slate-700 rounded-2xl p-10 text-center text-sm text-slate-400"));
          return;
        }
        for (const session of state.sessions) container.appendChild(sessionCard(session));
      }

      function renderDetail() {
        const container = document.getElementById("belt-exam-v12-detail");
        if (!container) return;
        container.innerHTML = "";
        if (!state.detail?.session) {
          container.classList.add("hidden");
          return;
        }
        container.classList.remove("hidden");
        const session = state.detail.session;
        const candidates = asArray(state.detail.candidates);
        const selectedIds = new Set(candidates.map(item => item.student?.studentId).filter(Boolean));

        const head = document.createElement("div");
        head.className = "flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6";
        const copy = document.createElement("div");
        copy.append(
          textElement(document, "p", "Sessão selecionada", "text-[10px] text-neon uppercase tracking-widest font-black"),
          textElement(document, "h3", `Faixa ${session.targetBelt} · ${formatCurrency(session.price?.amountCents, session.price?.currency)}`, "text-xl font-black text-white mt-1"),
          textElement(document, "p", `${session.organization?.name || "Academia"} · ${formatDate(session.scheduledAt)}`, "text-xs text-slate-400 mt-1")
        );
        head.appendChild(copy);

        const selectorWrap = document.createElement("div");
        selectorWrap.className = "flex flex-col sm:flex-row gap-3 min-w-[320px]";
        const selector = document.createElement("select");
        selector.id = "belt-exam-v12-student";
        selector.className = "flex-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white text-sm outline-none focus:border-neon";
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = "Selecione um aluno ativo";
        selector.appendChild(placeholder);
        for (const student of state.eligibleStudents.filter(item => !selectedIds.has(item.studentId))) {
          const option = document.createElement("option");
          option.value = student.studentId;
          option.textContent = `${student.name} · ${student.currentBelt}`;
          selector.appendChild(option);
        }
        const selectButton = textElement(document, "button", "Selecionar", "px-5 py-3 rounded-xl bg-neon text-slate-950 text-xs font-black uppercase tracking-widest");
        selectButton.type = "button";
        selectButton.addEventListener("click", () => {
          const studentId = selector.value;
          if (!studentId) return showError(new Error("Selecione um aluno ativo."));
          selectCandidate(studentId).catch(showError);
        });
        selectorWrap.append(selector, selectButton);
        head.appendChild(selectorWrap);
        container.appendChild(head);

        const table = document.createElement("div");
        table.className = "overflow-x-auto border border-slate-700 rounded-2xl";
        const rows = document.createElement("div");
        rows.className = "divide-y divide-slate-800";
        if (!candidates.length) {
          rows.appendChild(textElement(document, "p", "Nenhum candidato selecionado nesta sessão.", "p-6 text-sm text-slate-400"));
        }
        for (const candidate of candidates) {
          const row = document.createElement("div");
          row.className = "p-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-3 items-center bg-slate-900/40";
          const student = document.createElement("div");
          student.append(
            textElement(document, "p", candidate.student?.name || "Aluno", "font-bold text-white"),
            textElement(document, "p", `${candidate.currentBelt || "-"} → ${candidate.targetBelt || "-"}`, "text-[10px] text-slate-500 uppercase tracking-widest mt-1")
          );
          row.appendChild(student);
          row.appendChild(textElement(document, "span", REGISTRATION_STATUS[candidate.status] || candidate.state || "Estado", "text-[10px] font-black uppercase tracking-widest text-slate-300"));
          row.appendChild(textElement(document, "span", candidate.authorized ? "Autorizado financeiramente" : candidate.needsReconciliation ? "Revisão financeira" : candidate.awaitingPayment ? "PIX pendente" : "Aguardando aluno", candidate.authorized ? "text-[10px] text-emerald-300 font-black uppercase" : candidate.needsReconciliation ? "text-[10px] text-rose-300 font-black uppercase" : "text-[10px] text-amber-300 font-black uppercase"));
          rows.appendChild(row);
        }
        table.appendChild(rows);
        container.appendChild(table);
      }

      async function showError(error) {
        if (root?.console?.error) root.console.error("BJJ Exams belt_exam instructor:", error);
        if (root?.Swal) {
          await root.Swal.fire({
            background: "var(--bg-card)",
            color: "var(--text-main)",
            icon: "error",
            title: "Operação não concluída",
            text: normalizeError(error),
            confirmButtonColor: "var(--brand-color)"
          });
        }
      }

      async function loadOrganizations() {
        const options = await callableOptions();
        const organizations = await api.listOrganizations(options);
        state.organizations = organizations.filter(item => item?.podeAplicarExames === true);
        if (!state.organizations.length) {
          state.organizationId = null;
          renderOrganizations();
          throw new Error("Nenhuma organização ativa permite que seu perfil aplique exame oficial.");
        }
        if (!state.organizations.some(item => item.id === state.organizationId)) {
          const preferred = state.organizations.find(item => item.principal) || state.organizations[0];
          state.organizationId = preferred.id;
        }
        renderOrganizations();
      }

      async function loadSessions() {
        if (!state.organizationId) return [];
        renderSessionsLoading();
        const options = await callableOptions();
        state.sessions = await api.listInstructorSessions(state.organizationId, 50, options);
        renderSessions();
        renderDetail();
        return state.sessions;
      }

      async function load() {
        try {
          if (!state.organizations.length) await loadOrganizations();
          return await loadSessions();
        } catch (error) {
          const container = document.getElementById("belt-exam-v12-sessions");
          if (container) {
            container.innerHTML = "";
            container.appendChild(textElement(document, "div", normalizeError(error), "col-span-full border border-rose-500/30 bg-rose-500/10 rounded-2xl p-6 text-sm text-rose-200"));
          }
          return [];
        }
      }

      async function openCreateSession() {
        if (!state.organizationId) throw new Error("Selecione uma organização.");
        if (!root?.Swal) throw new Error("Interface de confirmação indisponível.");
        const beltOptions = BELTS.map(belt => `<option value="${belt}">${belt}</option>`).join("");
        const result = await root.Swal.fire({
          background: "var(--bg-card)",
          color: "var(--text-main)",
          title: "Nova sessão de exame",
          html: `
            <div class="text-left space-y-4 mt-2">
              <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Faixa alvo</label><select id="belt-exam-modal-belt" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white">${beltOptions}</select></div>
              <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Valor individual (R$)</label><input id="belt-exam-modal-price" inputmode="decimal" placeholder="150,00" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white"></div>
              <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Data prevista</label><input id="belt-exam-modal-date" type="datetime-local" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white"></div>
              <p class="text-xs text-slate-500">O aluno pagará individualmente via PIX. A taxa e o split são resolvidos no backend e ficam registrados por snapshot.</p>
            </div>`,
          showCancelButton: true,
          confirmButtonText: "Criar sessão",
          cancelButtonText: "Cancelar",
          confirmButtonColor: "var(--brand-color)",
          preConfirm: () => {
            try {
              const priceCents = parsePriceCents(document.getElementById("belt-exam-modal-price")?.value);
              const targetBelt = String(document.getElementById("belt-exam-modal-belt")?.value || "");
              const rawDate = String(document.getElementById("belt-exam-modal-date")?.value || "");
              const scheduledAt = rawDate ? new Date(rawDate).toISOString() : null;
              return { priceCents, targetBelt, scheduledAt };
            } catch (error) {
              root.Swal.showValidationMessage(error.message);
              return false;
            }
          }
        });
        if (!result.isConfirmed || !result.value) return null;
        const options = await callableOptions();
        const created = await api.createSession({
          organizationId: state.organizationId,
          ...result.value
        }, options);
        await loadSessions();
        if (created?.session?.id || created?.session?.sessionId) {
          await openSession(created.session.id || created.session.sessionId);
        }
        return created;
      }

      async function openSession(sessionId) {
        const options = await callableOptions();
        const [detail, eligibleStudents] = await Promise.all([
          api.getInstructorSession(sessionId, options),
          api.listEligibleStudents(state.organizationId, 100, options)
        ]);
        state.detail = detail;
        state.eligibleStudents = eligibleStudents;
        renderDetail();
        document.getElementById("belt-exam-v12-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
        return detail;
      }

      async function selectCandidate(studentId) {
        const sessionId = state.detail?.session?.sessionId;
        if (!sessionId) throw new Error("Abra uma sessão antes de selecionar candidatos.");
        const options = await callableOptions();
        await api.selectStudent(sessionId, studentId, options);
        await Promise.all([
          openSession(sessionId),
          loadSessions()
        ]);
        if (root?.Swal) {
          await root.Swal.fire({
            background: "var(--bg-card)",
            color: "var(--text-main)",
            icon: "success",
            title: "Aluno selecionado",
            text: "A seleção canônica foi registrada. O aluno já poderá visualizar a cobrança no portal.",
            confirmButtonColor: "var(--brand-color)"
          });
        }
      }

      function activateTab(evt) {
        document.querySelectorAll(".tab-content").forEach(node => node.classList.remove("active"));
        document.querySelectorAll(".nav-item").forEach(node => node.classList.remove("active"));
        const container = host();
        container?.classList.add("active");
        evt?.currentTarget?.classList?.add("active");
        const title = document.getElementById("titulo-pagina");
        if (title) title.textContent = evt?.currentTarget?.innerText?.trim() || "Exames de Faixa";
        if (root.innerWidth < 768) {
          const sidebar = document.getElementById("sidebar");
          if (sidebar && !sidebar.classList.contains("-translate-x-full") && typeof root.toggleSidebar === "function") {
            root.toggleSidebar();
          }
        }
        load().catch(showError);
      }

      function installTabInterceptor() {
        if (state.originalTabSwitch || typeof root.mudarAba !== "function") return false;
        state.originalTabSwitch = root.mudarAba;
        root.mudarAba = function beltExamCanonicalTabSwitch(evt, tabName) {
          if (tabName === "acompanhamento") {
            activateTab(evt);
            return;
          }
          return state.originalTabSwitch.call(this, evt, tabName);
        };
        return true;
      }

      function install() {
        if (state.installed) return true;
        if (!buildShell()) return false;
        state.installed = true;
        root.__BJJ_EXAMS_BELT_EXAM_CANONICAL_INSTRUCTOR_V12__ = true;

        let attempts = 0;
        const timer = root.setInterval(() => {
          attempts += 1;
          if (installTabInterceptor() || attempts >= 100) root.clearInterval(timer);
        }, 50);
        return true;
      }

      return Object.freeze({
        state,
        install,
        load,
        loadOrganizations,
        loadSessions,
        openCreateSession,
        openSession,
        selectCandidate,
        activateTab
      });
    }

    let autoController = null;
    function autoInstall() {
      if (!root?.document || !root?.location) return null;
      const path = String(root.location.pathname || "").toLowerCase();
      if (!path.endsWith("/painel_professor.html") && !path.endsWith("painel_professor.html")) return null;
      const start = () => {
        if (autoController) return autoController;
        try {
          autoController = createController();
          autoController.install();
          root.__bjjBeltExamInstructorControllerV12 = autoController;
          return autoController;
        } catch (error) {
          root.console?.error?.("BJJ Exams belt_exam instructor bootstrap:", error);
          return null;
        }
      };
      if (root.document.readyState === "complete") return start();
      root.addEventListener("load", start, { once: true });
      return null;
    }

    return Object.freeze({
      SESSION_STATUS,
      REGISTRATION_STATUS,
      BELTS,
      formatCurrency,
      parsePriceCents,
      formatDate,
      statusMeta,
      normalizeError,
      createController,
      autoInstall
    });
  }
);
