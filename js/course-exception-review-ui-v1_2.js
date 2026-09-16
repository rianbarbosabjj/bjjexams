"use strict";

(function initCourseExceptionReviewUi(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root?.document) {
    root.BjjExamsCourseModerationUi = api;
    api.install();
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCourseExceptionReviewUi(root) {
    const courseApi = root?.BjjExamsCourseAdmin || null;
    const hybridApi = root?.BjjExamsCourseHybridModeration || null;
    let cachedCourses = [];
    let installed = false;

    function getAuth() {
      return root?.__BJJ_EXAMS_AUTH__ || null;
    }

    async function callableOptions() {
      if (!courseApi || !hybridApi) throw new Error("Cliente de revisão de conteúdo indisponível.");
      const auth = getAuth();
      if (!auth?.currentUser) throw new Error("Faça login novamente para revisar conteúdo.");

      const expected = hybridApi.PROJECTS[
        hybridApi.inferEnvironment({ hostname: root?.location?.hostname || "" })
      ];
      const actual = String(auth.app?.options?.projectId || "").trim();
      if (!actual || actual !== expected) {
        const error = new Error(
          `Operação bloqueada: a página resolve para ${expected}, mas o Auth ativo pertence a ${actual || "projeto desconhecido"}.`
        );
        error.code = "ENVIRONMENT_MISMATCH";
        throw error;
      }

      const tokenResult = await auth.currentUser.getIdTokenResult();
      const claims = tokenResult?.claims || {};
      const moderator =
        claims.super_admin === true ||
        claims.platform_admin === true ||
        claims.content_admin === true;
      if (!moderator) {
        const error = new Error("Seu token não possui papel global de revisão de conteúdo.");
        error.code = "MODERATOR_ROLE_REQUIRED";
        throw error;
      }

      return {
        idToken: await auth.currentUser.getIdToken(),
        hostname: root?.location?.hostname || ""
      };
    }

    function textElement(tag, className, text) {
      const el = root.document.createElement(tag);
      el.className = className;
      el.textContent = text == null ? "" : String(text);
      return el;
    }

    function clearElement(el) {
      while (el?.firstChild) el.removeChild(el.firstChild);
    }

    function container() {
      return root.document.getElementById("course-moderation-list-v12");
    }

    function safeDate(value) {
      const seconds = value?._seconds ?? value?.seconds;
      if (!Number.isFinite(Number(seconds))) return "—";
      return new Date(Number(seconds) * 1000).toLocaleString("pt-BR");
    }

    function moderationLabel(course) {
      const status = String(course?.moderation?.status || "").toLowerCase();
      return {
        manual_review: "REVISÃO HUMANA",
        blocked: "BLOQUEADO PELA TRIAGEM",
        needs_changes: "AJUSTES NECESSÁRIOS",
        approved: "APROVADO AUTOMATICAMENTE"
      }[status] || (course.status === "suspended" ? "SUSPENSO" : "REVISÃO PENDENTE");
    }

    function badgeClass(course) {
      const status = String(course?.moderation?.status || "").toLowerCase();
      if (status === "blocked") return "border-rose-500/30 bg-rose-500/10 text-rose-300";
      if (course.status === "suspended") return "border-rose-500/30 bg-rose-500/10 text-rose-300";
      return "border-amber-500/30 bg-amber-500/10 text-amber-300";
    }

    function renderCounters() {
      const counts = cachedCourses.reduce((acc, course) => {
        acc.total += 1;
        if (course.status === "review") acc.review += 1;
        if (String(course?.moderation?.status || "") === "blocked") acc.blocked += 1;
        if (course.status === "suspended") acc.suspended += 1;
        return acc;
      }, { total: 0, review: 0, blocked: 0, suspended: 0 });

      const mapping = {
        total: counts.total,
        review: counts.review,
        published: counts.blocked,
        suspended: counts.suspended
      };
      for (const [key, value] of Object.entries(mapping)) {
        const el = root.document.getElementById(`course-moderation-count-${key}`);
        if (el) el.textContent = String(value);
      }
    }

    function filteredCourses() {
      const filter = String(root.document.getElementById("course-moderation-filter-v12")?.value || "all").toLowerCase();
      const search = String(root.document.getElementById("course-moderation-search-v12")?.value || "").trim().toLowerCase();

      return cachedCourses.filter(course => {
        if (filter === "review" && course.status !== "review") return false;
        if (filter === "suspended" && course.status !== "suspended") return false;
        if (filter === "blocked" && String(course?.moderation?.status || "") !== "blocked") return false;
        if (!search) return true;
        return [course.title, course.description, course.ownerId, course.id, course.moderation?.summary]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(search));
      });
    }

    function button(label, className, onClick) {
      const el = root.document.createElement("button");
      el.type = "button";
      el.className = `px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-widest transition ${className}`;
      el.textContent = label;
      el.addEventListener("click", onClick);
      return el;
    }

    async function changeStatus(course, targetStatus) {
      const copy = {
        draft: ["Devolver ao rascunho?", "O instrutor poderá corrigir o conteúdo e solicitar publicação novamente."],
        published: ["Aprovar e publicar?", "Esta decisão humana substituirá a exceção automática e publicará o curso."],
        suspended: ["Suspender curso?", "O curso permanecerá fora do catálogo público."],
        archived: ["Arquivar curso?", "O curso ficará indisponível para novas operações de fluxo."]
      }[targetStatus] || ["Alterar status?", "Confirme a alteração."];

      const confirm = await root.Swal.fire({
        background: "var(--bg-card)", color: "var(--text-main)", icon: "question",
        title: copy[0], text: copy[1], showCancelButton: true,
        confirmButtonText: "Confirmar", cancelButtonText: "Cancelar",
        confirmButtonColor: "var(--brand-color)", cancelButtonColor: "#334155"
      });
      if (!confirm.isConfirmed) return;

      try {
        const options = await callableOptions();
        await courseApi.changeStatus(course.id, targetStatus, options);
        await loadCourses();
        await root.Swal.fire({
          background: "var(--bg-card)", color: "var(--text-main)", icon: "success",
          title: "Decisão registrada", confirmButtonColor: "var(--brand-color)"
        });
      } catch (error) {
        await root.Swal.fire({
          background: "var(--bg-card)", color: "var(--text-main)", icon: "error",
          title: "Operação não concluída", text: error?.message || "Falha ao atualizar o curso.",
          confirmButtonColor: "#f43f5e"
        });
      }
    }

    async function showDetails(course) {
      if (!root.Swal) return;
      const escape = value => String(value ?? "—").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));
      const moderation = course.moderation || {};
      await root.Swal.fire({
        background: "var(--bg-card)", color: "var(--text-main)", title: "Revisão de conteúdo",
        html: `<div class="text-left space-y-3 text-sm">
          <p><strong>Curso:</strong> ${escape(course.title)}</p>
          <p><strong>Status:</strong> ${escape(courseApi.statusLabel(course.status))}</p>
          <p><strong>Decisão automática:</strong> ${escape(moderation.status || "Sem decisão automática")}</p>
          <p><strong>Risco:</strong> ${escape(moderation.riskLevel || "—")}</p>
          <p><strong>Confiança:</strong> ${Number.isFinite(Number(moderation.confidence)) ? Math.round(Number(moderation.confidence) * 100) + "%" : "—"}</p>
          <p><strong>Resumo:</strong><br>${escape(moderation.summary || "Sem resumo disponível.")}</p>
          <p><strong>Códigos:</strong> ${escape(Array.isArray(moderation.reasonCodes) ? moderation.reasonCodes.join(", ") : "—")}</p>
          <p class="text-xs opacity-70"><strong>ID:</strong> ${escape(course.id)}</p>
        </div>`,
        confirmButtonText: "Fechar", confirmButtonColor: "var(--brand-color)"
      });
    }

    function courseCard(course) {
      const card = root.document.createElement("article");
      card.className = "bg-cardbg border border-slate-700/70 rounded-2xl p-5 flex flex-col shadow-lg min-h-[330px]";
      const badge = textElement(
        "span",
        `inline-flex self-start px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${badgeClass(course)}`,
        moderationLabel(course)
      );
      const title = textElement("h3", "text-xl font-black text-white mt-5 leading-tight", course.title || "Curso sem título");
      const desc = textElement("p", "text-sm text-slate-400 mt-3 leading-relaxed line-clamp-3", course.description || "Sem descrição.");
      const reason = textElement(
        "p",
        "text-xs text-amber-200 mt-4 min-h-[40px]",
        course.moderation?.summary || (course.status === "suspended" ? "Curso suspenso aguardando decisão administrativa." : "Caso pendente de revisão humana.")
      );
      const meta = textElement(
        "p",
        "text-[10px] text-slate-500 uppercase tracking-widest mt-4",
        `Atualizado: ${safeDate(course.updatedAt)} · Risco: ${course.moderation?.riskLevel || "—"}`
      );
      const actions = root.document.createElement("div");
      actions.className = "flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-800";

      if (course.status === "review") {
        actions.append(
          button("Aprovar e publicar", "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", () => changeStatus(course, "published")),
          button("Solicitar ajustes", "border-amber-500/30 bg-amber-500/10 text-amber-300", () => changeStatus(course, "draft")),
          button("Arquivar", "border-slate-600 bg-slate-900 text-slate-300", () => changeStatus(course, "archived"))
        );
      } else if (course.status === "suspended") {
        actions.append(
          button("Republicar", "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", () => changeStatus(course, "published")),
          button("Arquivar", "border-slate-600 bg-slate-900 text-slate-300", () => changeStatus(course, "archived"))
        );
      }
      actions.appendChild(button("Detalhes", "border-slate-700 bg-slate-900 text-white", () => showDetails(course)));
      card.append(badge, title, desc, reason, meta, actions);
      return card;
    }

    function renderCourses() {
      renderCounters();
      const list = container();
      if (!list) return;
      clearElement(list);
      const courses = filteredCourses();
      if (!courses.length) {
        list.appendChild(textElement(
          "div",
          "col-span-full border border-dashed border-emerald-500/30 bg-emerald-500/5 rounded-2xl p-10 text-center text-sm text-emerald-300",
          "Nenhuma exceção aguardando revisão humana."
        ));
        return;
      }
      for (const course of courses) list.appendChild(courseCard(course));
    }

    function renderBlocked(error) {
      const list = container();
      if (!list) return;
      clearElement(list);
      list.appendChild(textElement(
        "div",
        "col-span-full bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6 text-rose-300",
        error?.message || "Não foi possível carregar a fila de exceções."
      ));
    }

    async function loadCourses() {
      const list = container();
      if (list) {
        clearElement(list);
        list.appendChild(textElement("p", "col-span-full text-center py-10 text-slate-400", "Carregando exceções de conteúdo..."));
      }
      try {
        const options = await callableOptions();
        cachedCourses = await hybridApi.listExceptions(options);
        renderCourses();
        return cachedCourses;
      } catch (error) {
        console.error("Course exception review v1.2:", error);
        renderBlocked(error);
        return [];
      }
    }

    function install() {
      if (installed) return;
      installed = true;
      root.document.addEventListener("input", event => {
        if (event.target?.id === "course-moderation-search-v12") renderCourses();
      });
      root.document.addEventListener("change", event => {
        if (event.target?.id === "course-moderation-filter-v12") renderCourses();
      });
    }

    return Object.freeze({ loadCourses, install });
  }
);
