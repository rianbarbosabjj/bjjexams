"use strict";

(function initCourseModerationUi(root, factory) {
  const api = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root?.document) {
    root.BjjExamsCourseModerationUi = api;
    api.install();
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCourseModerationUi(root) {
    const courseApi = root?.BjjExamsCourseAdmin || null;
    let cachedCourses = [];
    let installed = false;

    const STATUS_CLASSES = Object.freeze({
      draft: "bg-slate-500/10 text-slate-300 border-slate-500/30",
      review: "bg-amber-500/10 text-amber-300 border-amber-500/30",
      published: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
      suspended: "bg-rose-500/10 text-rose-300 border-rose-500/30",
      archived: "bg-slate-800 text-slate-500 border-slate-700"
    });

    function moderatorActions(course = {}) {
      const status = String(course.status || "").trim().toLowerCase();

      if (status === "draft") {
        return ["review", "archive", "details"];
      }
      if (status === "review") {
        return ["draft", "publish", "archive", "details"];
      }
      if (status === "published") {
        return ["suspend", "archive", "view-public", "details"];
      }
      if (status === "suspended") {
        return ["publish", "archive", "details"];
      }
      if (status === "archived") {
        return ["details"];
      }
      return ["details"];
    }

    function currentEnvironment() {
      if (!courseApi) return null;
      return courseApi.inferEnvironment({ hostname: root?.location?.hostname || "" });
    }

    function expectedProjectId() {
      if (!courseApi) return null;
      return courseApi.projectIdForEnvironment(currentEnvironment());
    }

    function getAuth() {
      return root?.__BJJ_EXAMS_AUTH__ || null;
    }

    async function assertModeratorAccess() {
      if (!courseApi) {
        throw new Error("Cliente administrativo de cursos indisponível.");
      }

      const auth = getAuth();
      if (!auth) {
        throw new Error("Autenticação v1.2 ainda não foi conectada ao painel administrativo.");
      }

      const expected = expectedProjectId();
      const actual = String(auth.app?.options?.projectId || "").trim();
      if (!actual || actual !== expected) {
        const error = new Error(
          `Operação bloqueada: a página resolve para ${expected}, mas o Auth ativo pertence a ${actual || "projeto desconhecido"}.`
        );
        error.code = "ENVIRONMENT_MISMATCH";
        throw error;
      }

      const user = auth.currentUser;
      if (!user) {
        throw new Error("Faça login novamente para moderar cursos.");
      }

      const tokenResult = await user.getIdTokenResult();
      const claims = tokenResult?.claims || {};
      const moderator =
        claims.super_admin === true ||
        claims.platform_admin === true ||
        claims.content_admin === true;

      if (!moderator) {
        const error = new Error("Seu token autenticado não possui papel global de moderação de cursos.");
        error.code = "MODERATOR_ROLE_REQUIRED";
        throw error;
      }

      return { user, claims };
    }

    async function callableOptions() {
      const { user } = await assertModeratorAccess();
      const idToken = await user.getIdToken();
      return {
        idToken,
        hostname: root?.location?.hostname || ""
      };
    }

    function textElement(tag, className, text) {
      const element = root.document.createElement(tag);
      element.className = className;
      element.textContent = text == null ? "" : String(text);
      return element;
    }

    function clearElement(element) {
      while (element?.firstChild) element.removeChild(element.firstChild);
    }

    function container() {
      return root.document.getElementById("course-moderation-list-v12");
    }

    function safeDate(value) {
      const seconds = value?._seconds ?? value?.seconds;
      if (!Number.isFinite(Number(seconds))) return "—";
      return new Date(Number(seconds) * 1000).toLocaleString("pt-BR");
    }

    function formatPrice(course) {
      return courseApi?.formatPrice(course) || "—";
    }

    function statusLabel(status) {
      return courseApi?.statusLabel(status) || String(status || "");
    }

    function renderCounters() {
      const counts = cachedCourses.reduce(
        (acc, course) => {
          const status = String(course.status || "");
          acc.total += 1;
          if (Object.prototype.hasOwnProperty.call(acc, status)) acc[status] += 1;
          return acc;
        },
        { total: 0, review: 0, published: 0, suspended: 0 }
      );

      for (const [key, value] of Object.entries(counts)) {
        const el = root.document.getElementById(`course-moderation-count-${key}`);
        if (el) el.textContent = String(value);
      }
    }

    function filteredCourses() {
      const filter = String(
        root.document.getElementById("course-moderation-filter-v12")?.value || "all"
      ).toLowerCase();
      const search = String(
        root.document.getElementById("course-moderation-search-v12")?.value || ""
      ).trim().toLowerCase();

      return cachedCourses.filter(course => {
        if (filter !== "all" && String(course.status || "").toLowerCase() !== filter) {
          return false;
        }
        if (!search) return true;
        return [course.title, course.description, course.ownerId, course.id]
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

    function courseCard(course) {
      const card = root.document.createElement("article");
      card.className = "bg-cardbg border border-slate-700/70 rounded-2xl p-5 flex flex-col shadow-lg min-h-[315px]";

      const top = root.document.createElement("div");
      top.className = "flex items-start justify-between gap-3";
      top.append(
        textElement(
          "span",
          `inline-flex px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${STATUS_CLASSES[course.status] || STATUS_CLASSES.draft}`,
          statusLabel(course.status)
        ),
        textElement(
          "span",
          "text-[9px] text-slate-500 uppercase tracking-widest font-bold text-right",
          course.ownerType === "platform" ? "Plataforma" : "Instrutor"
        )
      );

      const title = textElement("h3", "text-xl font-black text-white mt-5 leading-tight", course.title || "Curso sem título");
      const desc = textElement(
        "p",
        "text-sm text-slate-400 mt-3 leading-relaxed line-clamp-3 flex-1",
        course.description || "Sem descrição."
      );
      const meta = textElement(
        "p",
        "text-[10px] text-slate-500 uppercase tracking-widest mt-4",
        `Atualizado: ${safeDate(course.updatedAt)} · ${course.instructorIds?.length || 0} instrutor(es)`
      );
      const price = textElement("p", "text-2xl font-black text-neon mt-3", formatPrice(course));

      const actions = root.document.createElement("div");
      actions.className = "flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-800";

      for (const action of moderatorActions(course)) {
        if (action === "review") {
          actions.appendChild(button("Enviar à revisão", "border-cyan-500/30 bg-cyan-500/10 text-cyan-300", () => changeStatus(course, "review")));
        } else if (action === "draft") {
          actions.appendChild(button("Devolver ao rascunho", "border-amber-500/30 bg-amber-500/10 text-amber-300", () => changeStatus(course, "draft")));
        } else if (action === "publish") {
          actions.appendChild(button(course.status === "suspended" ? "Republicar" : "Publicar", "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", () => changeStatus(course, "published")));
        } else if (action === "suspend") {
          actions.appendChild(button("Suspender", "border-rose-500/30 bg-rose-500/10 text-rose-300", () => changeStatus(course, "suspended")));
        } else if (action === "archive") {
          actions.appendChild(button("Arquivar", "border-slate-600 bg-slate-900 text-slate-300", () => changeStatus(course, "archived")));
        } else if (action === "view-public") {
          const link = root.document.createElement("a");
          link.href = `cursos.html?id=${encodeURIComponent(course.id)}`;
          link.target = "_blank";
          link.rel = "noopener";
          link.className = "px-3 py-2 rounded-lg border border-neon/30 bg-neon/10 text-neon text-[10px] font-black uppercase tracking-widest transition";
          link.textContent = "Ver público";
          actions.appendChild(link);
        } else if (action === "details") {
          actions.appendChild(button("Detalhes", "border-slate-700 bg-slate-900 text-white", () => showDetails(course)));
        }
      }

      card.append(top, title, desc, meta, price, actions);
      return card;
    }

    function renderCourses() {
      renderCounters();
      const list = container();
      if (!list) return;
      clearElement(list);

      const courses = filteredCourses();
      if (!courses.length) {
        const empty = textElement(
          "div",
          "col-span-full border border-dashed border-slate-700 rounded-2xl p-10 text-center text-sm text-slate-500",
          "Nenhum curso encontrado para este filtro."
        );
        list.appendChild(empty);
        return;
      }

      for (const course of courses) list.appendChild(courseCard(course));
    }

    function renderBlocked(error) {
      const list = container();
      if (!list) return;
      clearElement(list);
      const box = root.document.createElement("div");
      box.className = "col-span-full bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6";
      box.append(
        textElement("h3", "text-rose-300 font-black uppercase tracking-widest text-sm", "Moderação de cursos bloqueada"),
        textElement("p", "text-slate-300 text-sm mt-3", error?.message || "Não foi possível validar o acesso.")
      );
      list.appendChild(box);
    }

    async function loadCourses() {
      const list = container();
      if (list) {
        clearElement(list);
        list.appendChild(textElement("p", "col-span-full text-center py-10 text-slate-400", "Carregando cursos para moderação..."));
      }

      try {
        const options = await callableOptions();
        cachedCourses = await courseApi.listCourses(options);
        cachedCourses.sort((a, b) => {
          const left = a.updatedAt?._seconds ?? a.updatedAt?.seconds ?? 0;
          const right = b.updatedAt?._seconds ?? b.updatedAt?.seconds ?? 0;
          return right - left;
        });
        renderCourses();
        return cachedCourses;
      } catch (error) {
        console.error("Course moderation v1.2:", error);
        renderBlocked(error);
        return [];
      }
    }

    async function showDetails(course) {
      if (!root.Swal) return;
      const escape = value => String(value ?? "—").replace(/[&<>"']/g, ch => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[ch]));

      await root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        title: "Detalhes do curso",
        html: `
          <div class="text-left space-y-3 text-sm">
            <p><strong>Título:</strong> ${escape(course.title)}</p>
            <p><strong>Status:</strong> ${escape(statusLabel(course.status))}</p>
            <p><strong>Origem:</strong> ${escape(course.ownerType === "platform" ? "Plataforma" : "Instrutor")}</p>
            <p><strong>Preço:</strong> ${escape(formatPrice(course))}</p>
            <p><strong>Instrutores:</strong> ${escape(course.instructorIds?.length || 0)}</p>
            <p><strong>Descrição:</strong><br>${escape(course.description || "Sem descrição")}</p>
            <p class="text-xs opacity-70"><strong>ID:</strong> ${escape(course.id)}</p>
          </div>`,
        confirmButtonText: "Fechar",
        confirmButtonColor: "var(--brand-color)"
      });
    }

    function actionCopy(status) {
      return {
        review: ["Enviar para revisão?", "O curso entrará na fila formal de revisão."],
        draft: ["Devolver ao rascunho?", "O instrutor poderá voltar a editar o curso."],
        published: ["Publicar curso?", "O curso ficará disponível no catálogo público da plataforma."],
        suspended: ["Suspender curso?", "O curso deixará de aparecer no catálogo público."],
        archived: ["Arquivar curso?", "O curso ficará indisponível para novas operações de fluxo."]
      }[status] || ["Alterar status?", "Confirme a alteração do curso."];
    }

    async function changeStatus(course, targetStatus) {
      const [title, text] = actionCopy(targetStatus);
      const confirm = await root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        icon: "question",
        title,
        text,
        showCancelButton: true,
        confirmButtonText: "Confirmar",
        cancelButtonText: "Cancelar",
        confirmButtonColor: "var(--brand-color)",
        cancelButtonColor: "#334155"
      });
      if (!confirm.isConfirmed) return;

      try {
        root.Swal.fire({
          background: "var(--bg-card)",
          color: "var(--text-main)",
          title: "Processando...",
          allowOutsideClick: false,
          didOpen: () => root.Swal.showLoading()
        });
        const options = await callableOptions();
        await courseApi.changeStatus(course.id, targetStatus, options);
        await loadCourses();
        await root.Swal.fire({
          background: "var(--bg-card)",
          color: "var(--text-main)",
          icon: "success",
          title: "Status atualizado",
          confirmButtonColor: "var(--brand-color)"
        });
      } catch (error) {
        console.error("Course moderation v1.2:", error);
        await root.Swal.fire({
          background: "var(--bg-card)",
          color: "var(--text-main)",
          icon: "error",
          title: "Operação não concluída",
          text: error?.message || "Não foi possível alterar o status do curso.",
          confirmButtonColor: "var(--brand-color)"
        });
      }
    }

    function install() {
      if (installed || !root?.document) return;
      installed = true;

      const filter = root.document.getElementById("course-moderation-filter-v12");
      const search = root.document.getElementById("course-moderation-search-v12");
      filter?.addEventListener("change", renderCourses);
      search?.addEventListener("input", renderCourses);

      root.carregarCursosModeracaoV12 = loadCourses;
    }

    return Object.freeze({
      moderatorActions,
      currentEnvironment,
      expectedProjectId,
      assertModeratorAccess,
      loadCourses,
      renderCourses,
      changeStatus,
      install
    });
  }
);
