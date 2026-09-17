"use strict";

(function initCourseContentUi(root) {
  const api = root?.BjjExamsCourseContent;
  if (!root || !api) {
    console.error("Course content UI v1.2: cliente de conteúdo indisponível.");
    return;
  }

  let currentCourse = null;
  let currentContent = null;
  let overlay = null;

  function currentEnvironment() {
    return api.inferEnvironment({ hostname: root.location?.hostname || "" });
  }

  function expectedProjectId() {
    return api.projectIdForEnvironment(currentEnvironment());
  }

  function getAuth() {
    return root.__BJJ_EXAMS_AUTH__ || null;
  }

  function assertSafeAuthProject() {
    const auth = getAuth();
    if (!auth) throw new Error("Autenticação v1.2 indisponível.");

    const expected = expectedProjectId();
    const actual = String(auth.app?.options?.projectId || "").trim();
    if (!actual) throw new Error("Não foi possível confirmar o projeto Firebase autenticado.");
    if (actual !== expected) {
      const error = new Error(
        `Operação bloqueada: a página resolve para ${expected}, mas o Auth ativo pertence a ${actual}.`
      );
      error.code = "ENVIRONMENT_MISMATCH";
      throw error;
    }
    return auth;
  }

  async function callableOptions() {
    const auth = assertSafeAuthProject();
    const user = auth.currentUser;
    if (!user) throw new Error("Faça login novamente para editar o conteúdo do curso.");
    return {
      idToken: await user.getIdToken(),
      hostname: root.location?.hostname || ""
    };
  }

  function textElement(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value == null ? "" : String(value);
    return element;
  }

  function icon(name, classes = "") {
    const element = document.createElement("i");
    element.className = `ph ph-${name} ${classes}`.trim();
    return element;
  }

  function button(label, iconName, variant, onClick, title = "") {
    const variants = {
      primary: "bg-neon text-slate-950 border-neon hover:bg-white",
      secondary: "bg-slate-900 text-white border-slate-700 hover:border-neon hover:text-neon",
      subtle: "bg-slate-900/60 text-slate-300 border-slate-700 hover:text-white",
      danger: "bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500 hover:text-white"
    };
    const element = document.createElement("button");
    element.type = "button";
    element.title = title;
    element.className = `inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-widest transition ${variants[variant] || variants.secondary}`;
    element.append(icon(iconName), document.createTextNode(label));
    element.addEventListener("click", onClick);
    return element;
  }

  function errorMessage(error) {
    if (error?.callableStatus === "PERMISSION_DENIED") {
      return "Você não possui permissão para alterar este conteúdo.";
    }
    if (error?.callableStatus === "FAILED_PRECONDITION") {
      return error.message || "O curso não está em um estado compatível com esta alteração.";
    }
    return error?.message || "Não foi possível concluir a operação.";
  }

  async function showError(error) {
    console.error("Course content UI v1.2:", error);
    if (root.Swal) {
      await root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        icon: "error",
        title: "Operação não concluída",
        text: errorMessage(error),
        confirmButtonColor: "var(--brand-color)"
      });
    }
  }

  function ensureOverlay() {
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "course-content-studio-v12";
    overlay.className = "fixed inset-0 z-[90] hidden bg-slate-950/95 backdrop-blur-sm";

    const shell = document.createElement("div");
    shell.className = "h-full flex flex-col";

    const header = document.createElement("header");
    header.className = "shrink-0 border-b border-slate-800 bg-panelbg px-4 sm:px-8 py-4 flex items-center justify-between gap-4";

    const headerText = document.createElement("div");
    headerText.className = "min-w-0";
    headerText.append(
      textElement("p", "text-[9px] text-neon uppercase tracking-[0.3em] font-black", "Estúdio de conteúdo v1.2"),
      textElement("h2", "text-lg sm:text-2xl font-black text-white truncate", "Conteúdo do curso")
    );
    headerText.lastChild.id = "course-content-studio-title";

    const close = button("Fechar", "x", "secondary", closeStudio);
    header.append(headerText, close);

    const body = document.createElement("main");
    body.id = "course-content-studio-body";
    body.className = "flex-1 overflow-y-auto custom-scroll px-4 sm:px-8 py-6";

    shell.append(header, body);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeStudio() {
    if (!overlay) return;
    overlay.classList.add("hidden");
    document.body.style.overflow = "";
    currentCourse = null;
    currentContent = null;
    if (typeof root.carregarCursosProf === "function") {
      root.carregarCursosProf().catch(() => undefined);
    }
  }

  function sortedModules() {
    return [...(currentContent?.modules || [])].sort(
      (a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.title || "").localeCompare(String(b.title || ""), "pt-BR")
    );
  }

  function lessonsFor(moduleId) {
    return [...(currentContent?.lessons || [])]
      .filter(lesson => lesson.moduleId === moduleId)
      .sort((a, b) => Number(a.position || 0) - Number(b.position || 0) || String(a.title || "").localeCompare(String(b.title || ""), "pt-BR"));
  }

  function renderCounters(container) {
    const counters = currentContent?.counters || {};
    const grid = document.createElement("div");
    grid.className = "grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6";

    for (const [label, value] of [
      ["Módulos", counters.moduleCount || 0],
      ["Aulas", counters.lessonCount || 0],
      ["Duração estimada", `${counters.estimatedDurationMinutes || 0} min`],
      ["Revisão de conteúdo", counters.contentRevision || 0]
    ]) {
      const card = document.createElement("div");
      card.className = "bg-cardbg border border-slate-800 rounded-xl p-4";
      card.append(
        textElement("p", "text-[9px] text-slate-500 uppercase tracking-widest font-black", label),
        textElement("p", "text-xl font-black text-white mt-1", value)
      );
      grid.appendChild(card);
    }
    container.appendChild(grid);
  }

  function renderLesson(module, lesson, index, siblings) {
    const row = document.createElement("div");
    row.className = "bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center gap-4";

    const main = document.createElement("div");
    main.className = "flex-1 min-w-0";
    const typeLabels = { video: "Vídeo", text: "Texto", document: "Documento" };
    main.append(
      textElement("h4", "text-sm font-black text-white", lesson.title || "Aula"),
      textElement(
        "p",
        "text-[10px] text-slate-500 uppercase tracking-widest mt-1",
        `${typeLabels[lesson.contentType] || lesson.contentType} · ${lesson.durationMinutes || 0} min${lesson.isPreview ? " · Prévia" : ""}`
      )
    );
    if (lesson.description) {
      main.appendChild(textElement("p", "text-xs text-slate-400 mt-2 line-clamp-2", lesson.description));
    }

    const actions = document.createElement("div");
    actions.className = "flex flex-wrap gap-2 shrink-0";
    const up = button("", "arrow-up", "subtle", () => reorderLesson(module.id, index, -1), "Mover aula para cima");
    const down = button("", "arrow-down", "subtle", () => reorderLesson(module.id, index, 1), "Mover aula para baixo");
    up.disabled = index === 0;
    down.disabled = index === siblings.length - 1;
    if (up.disabled) up.classList.add("opacity-30", "pointer-events-none");
    if (down.disabled) down.classList.add("opacity-30", "pointer-events-none");
    actions.append(
      up,
      down,
      button("Editar", "pencil-simple", "secondary", () => editLesson(lesson)),
      button("Excluir", "trash", "danger", () => deleteLesson(lesson))
    );

    row.append(main, actions);
    return row;
  }

  function renderModule(module, index, modules) {
    const card = document.createElement("section");
    card.className = "bg-cardbg border border-slate-800 rounded-2xl p-4 sm:p-6";

    const heading = document.createElement("div");
    heading.className = "flex flex-col lg:flex-row lg:items-start justify-between gap-4 border-b border-slate-800 pb-4";

    const title = document.createElement("div");
    title.className = "min-w-0";
    title.append(
      textElement("p", "text-[9px] text-neon uppercase tracking-widest font-black", `Módulo ${index + 1}`),
      textElement("h3", "text-xl font-black text-white mt-1", module.title || "Módulo")
    );
    if (module.description) title.appendChild(textElement("p", "text-sm text-slate-400 mt-2", module.description));

    const actions = document.createElement("div");
    actions.className = "flex flex-wrap gap-2 shrink-0";
    const up = button("", "arrow-up", "subtle", () => reorderModule(index, -1), "Mover módulo para cima");
    const down = button("", "arrow-down", "subtle", () => reorderModule(index, 1), "Mover módulo para baixo");
    up.disabled = index === 0;
    down.disabled = index === modules.length - 1;
    if (up.disabled) up.classList.add("opacity-30", "pointer-events-none");
    if (down.disabled) down.classList.add("opacity-30", "pointer-events-none");
    actions.append(
      up,
      down,
      button("Editar", "pencil-simple", "secondary", () => editModule(module)),
      button("Aula", "plus", "primary", () => createLesson(module.id)),
      button("Excluir", "trash", "danger", () => deleteModule(module))
    );
    heading.append(title, actions);
    card.appendChild(heading);

    const lessons = lessonsFor(module.id);
    const lessonContainer = document.createElement("div");
    lessonContainer.className = "space-y-3 mt-4";
    if (!lessons.length) {
      lessonContainer.appendChild(
        textElement("p", "text-sm text-slate-500 text-center border border-dashed border-slate-700 rounded-xl py-6", "Nenhuma aula neste módulo.")
      );
    } else {
      lessons.forEach((lesson, lessonIndex) => {
        lessonContainer.appendChild(renderLesson(module, lesson, lessonIndex, lessons));
      });
    }
    card.appendChild(lessonContainer);
    return card;
  }

  function renderStudio() {
    ensureOverlay();
    const body = document.getElementById("course-content-studio-body");
    const title = document.getElementById("course-content-studio-title");
    if (!body || !title) return;
    title.textContent = currentCourse?.title || "Conteúdo do curso";
    while (body.firstChild) body.removeChild(body.firstChild);

    const toolbar = document.createElement("div");
    toolbar.className = "flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6";
    const copy = document.createElement("div");
    copy.append(
      textElement("h3", "text-lg font-black text-white", "Módulos e aulas"),
      textElement("p", "text-sm text-slate-400 mt-1", "Organize o conteúdo do curso. Alterações são permitidas somente enquanto ele estiver em rascunho.")
    );
    toolbar.append(copy, button("Novo módulo", "plus", "primary", createModule));
    body.appendChild(toolbar);
    renderCounters(body);

    const modules = sortedModules();
    const list = document.createElement("div");
    list.className = "space-y-5 pb-16";
    if (!modules.length) {
      list.appendChild(
        textElement("p", "text-slate-500 text-sm text-center py-12 border border-dashed border-slate-700 rounded-2xl", "Nenhum módulo criado. Comece adicionando o primeiro módulo.")
      );
    } else {
      modules.forEach((module, index) => list.appendChild(renderModule(module, index, modules)));
    }
    body.appendChild(list);
  }

  async function refreshContent() {
    const options = await callableOptions();
    currentContent = await api.listContent(currentCourse.id, options);
    renderStudio();
  }

  async function runMutation(task) {
    try {
      const options = await callableOptions();
      await task(options);
      await refreshContent();
    } catch (error) {
      await showError(error);
    }
  }

  function nextModulePosition() {
    const modules = sortedModules();
    if (!modules.length) return 10;
    return Math.min(9999, Number(modules[modules.length - 1].position || 0) + 10);
  }

  function nextLessonPosition(moduleId) {
    const lessons = lessonsFor(moduleId);
    if (!lessons.length) return 10;
    return Math.min(9999, Number(lessons[lessons.length - 1].position || 0) + 10);
  }

  function moduleFormHtml() {
    return `
      <div class="text-left space-y-4 mt-2">
        <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Título *</label><input id="content-module-title" maxlength="160" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></div>
        <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Descrição</label><textarea id="content-module-description" maxlength="2000" rows="4" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></textarea></div>
      </div>`;
  }

  async function promptModule(existing = null) {
    const result = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      title: existing ? "Editar módulo" : "Novo módulo",
      html: moduleFormHtml(),
      showCancelButton: true,
      confirmButtonText: existing ? "Salvar" : "Criar módulo",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--brand-color)",
      cancelButtonColor: "#334155",
      didOpen: () => {
        document.getElementById("content-module-title").value = existing?.title || "";
        document.getElementById("content-module-description").value = existing?.description || "";
      },
      preConfirm: () => {
        const title = document.getElementById("content-module-title")?.value?.trim() || "";
        const description = document.getElementById("content-module-description")?.value?.trim() || "";
        if (title.length < 3) {
          root.Swal.showValidationMessage("Informe um título com pelo menos 3 caracteres.");
          return false;
        }
        return { title, description };
      }
    });
    return result.isConfirmed ? result.value : null;
  }

  async function createModule() {
    const value = await promptModule();
    if (!value) return;
    await runMutation(options => api.createModule(
      currentCourse.id,
      { ...value, position: nextModulePosition() },
      options
    ));
  }

  async function editModule(module) {
    const value = await promptModule(module);
    if (!value) return;
    await runMutation(options => api.updateModule(currentCourse.id, module.id, value, options));
  }

  async function deleteModule(module) {
    const result = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      icon: "warning",
      title: "Excluir módulo?",
      text: module.lessonCount > 0
        ? "Este módulo possui aulas. Mova ou exclua as aulas antes de remover o módulo."
        : "Esta ação remove o módulo do rascunho.",
      showCancelButton: true,
      confirmButtonText: "Excluir",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#f43f5e",
      cancelButtonColor: "#334155"
    });
    if (!result.isConfirmed) return;
    await runMutation(options => api.deleteModule(currentCourse.id, module.id, options));
  }

  async function reorderModule(index, direction) {
    const modules = sortedModules();
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= modules.length) return;
    const current = modules[index];
    const other = modules[otherIndex];
    await runMutation(options => api.reorderPair(
      currentCourse.id,
      "module",
      current.id,
      other.id,
      options
    ));
  }

  function lessonFormHtml() {
    const modules = sortedModules();
    const options = modules.map(module => `<option value="${String(module.id).replace(/"/g, "&quot;")}"></option>`).join("");
    return `
      <div class="text-left space-y-4 mt-2">
        <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Título *</label><input id="content-lesson-title" maxlength="160" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></div>
        <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Descrição</label><textarea id="content-lesson-description" maxlength="4000" rows="3" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></textarea></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Módulo</label><select id="content-lesson-module" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon">${options}</select></div>
          <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Tipo</label><select id="content-lesson-type" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"><option value="video">Vídeo</option><option value="text">Texto</option><option value="document">Documento</option></select></div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Duração estimada (min)</label><input id="content-lesson-duration" type="number" min="0" max="1440" step="1" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></div>
          <label class="flex items-center gap-3 mt-6 text-sm text-slate-300"><input id="content-lesson-preview" type="checkbox" class="w-4 h-4 accent-cyan-400"> Disponível como prévia</label>
        </div>
        <div id="content-field-video"><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">URL HTTPS do vídeo *</label><input id="content-lesson-video" maxlength="2000" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></div>
        <div id="content-field-text" class="hidden"><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Conteúdo textual *</label><textarea id="content-lesson-body" maxlength="100000" rows="8" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></textarea></div>
        <div id="content-field-document" class="hidden"><label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">URL HTTPS do documento *</label><input id="content-lesson-document" maxlength="2000" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></div>
      </div>`;
  }

  function syncLessonTypeFields() {
    const type = document.getElementById("content-lesson-type")?.value || "video";
    document.getElementById("content-field-video")?.classList.toggle("hidden", type !== "video");
    document.getElementById("content-field-text")?.classList.toggle("hidden", type !== "text");
    document.getElementById("content-field-document")?.classList.toggle("hidden", type !== "document");
  }

  async function promptLesson(existing = null, preferredModuleId = null) {
    const modules = sortedModules();
    if (!modules.length) {
      await showError(new Error("Crie um módulo antes de adicionar aulas."));
      return null;
    }

    const result = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      title: existing ? "Editar aula" : "Nova aula",
      html: lessonFormHtml(),
      width: "760px",
      showCancelButton: true,
      confirmButtonText: existing ? "Salvar" : "Criar aula",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--brand-color)",
      cancelButtonColor: "#334155",
      didOpen: () => {
        const moduleSelect = document.getElementById("content-lesson-module");
        for (const option of moduleSelect.options) {
          const module = modules.find(item => item.id === option.value);
          option.textContent = module?.title || "Módulo";
        }
        document.getElementById("content-lesson-title").value = existing?.title || "";
        document.getElementById("content-lesson-description").value = existing?.description || "";
        moduleSelect.value = existing?.moduleId || preferredModuleId || modules[0].id;
        document.getElementById("content-lesson-type").value = existing?.contentType || "video";
        document.getElementById("content-lesson-duration").value = Number(existing?.durationMinutes || 0);
        document.getElementById("content-lesson-preview").checked = existing?.isPreview === true;
        document.getElementById("content-lesson-video").value = existing?.videoUrl || "";
        document.getElementById("content-lesson-body").value = existing?.body || "";
        document.getElementById("content-lesson-document").value = existing?.documentUrl || "";
        document.getElementById("content-lesson-type").addEventListener("change", syncLessonTypeFields);
        syncLessonTypeFields();
      },
      preConfirm: () => {
        const title = document.getElementById("content-lesson-title")?.value?.trim() || "";
        const description = document.getElementById("content-lesson-description")?.value?.trim() || "";
        const moduleId = document.getElementById("content-lesson-module")?.value || "";
        const contentType = document.getElementById("content-lesson-type")?.value || "";
        const durationMinutes = Number(document.getElementById("content-lesson-duration")?.value || 0);
        const isPreview = document.getElementById("content-lesson-preview")?.checked === true;
        const videoUrl = document.getElementById("content-lesson-video")?.value?.trim() || null;
        const body = document.getElementById("content-lesson-body")?.value?.trim() || null;
        const documentUrl = document.getElementById("content-lesson-document")?.value?.trim() || null;
        if (title.length < 3) {
          root.Swal.showValidationMessage("Informe um título com pelo menos 3 caracteres.");
          return false;
        }
        if (!Number.isInteger(durationMinutes) || durationMinutes < 0 || durationMinutes > 1440) {
          root.Swal.showValidationMessage("Informe uma duração válida entre 0 e 1440 minutos.");
          return false;
        }
        if (contentType === "video" && !videoUrl) {
          root.Swal.showValidationMessage("Informe a URL HTTPS do vídeo.");
          return false;
        }
        if (contentType === "text" && !body) {
          root.Swal.showValidationMessage("Informe o conteúdo textual da aula.");
          return false;
        }
        if (contentType === "document" && !documentUrl) {
          root.Swal.showValidationMessage("Informe a URL HTTPS do documento.");
          return false;
        }
        return { moduleId, title, description, contentType, durationMinutes, isPreview, videoUrl, body, documentUrl };
      }
    });
    return result.isConfirmed ? result.value : null;
  }

  async function createLesson(moduleId) {
    const value = await promptLesson(null, moduleId);
    if (!value) return;
    await runMutation(options => api.createLesson(
      currentCourse.id,
      { ...value, position: nextLessonPosition(value.moduleId) },
      options
    ));
  }

  async function editLesson(lesson) {
    const value = await promptLesson(lesson, lesson.moduleId);
    if (!value) return;
    await runMutation(options => api.updateLesson(
      currentCourse.id,
      lesson.id,
      { ...value, position: lesson.position },
      options
    ));
  }

  async function deleteLesson(lesson) {
    const result = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      icon: "warning",
      title: "Excluir aula?",
      text: "A aula será removida do rascunho e os contadores serão atualizados.",
      showCancelButton: true,
      confirmButtonText: "Excluir",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#f43f5e",
      cancelButtonColor: "#334155"
    });
    if (!result.isConfirmed) return;
    await runMutation(options => api.deleteLesson(currentCourse.id, lesson.id, options));
  }

  async function reorderLesson(moduleId, index, direction) {
    const lessons = lessonsFor(moduleId);
    const otherIndex = index + direction;
    if (otherIndex < 0 || otherIndex >= lessons.length) return;
    const current = lessons[index];
    const other = lessons[otherIndex];
    await runMutation(options => api.reorderPair(
      currentCourse.id,
      "lesson",
      current.id,
      other.id,
      options
    ));
  }

  async function openStudio(courseOrId) {
    try {
      const course = typeof courseOrId === "object"
        ? courseOrId
        : { id: String(courseOrId || ""), title: "Conteúdo do curso", status: "draft" };
      if (!course.id) throw new Error("Curso inválido.");
      if (course.status && course.status !== "draft") {
        throw new Error("O conteúdo só pode ser alterado enquanto o curso estiver em rascunho.");
      }

      await callableOptions();
      currentCourse = course;
      ensureOverlay();
      overlay.classList.remove("hidden");
      document.body.style.overflow = "hidden";

      const body = document.getElementById("course-content-studio-body");
      while (body.firstChild) body.removeChild(body.firstChild);
      body.appendChild(textElement("p", "text-center text-slate-400 py-16", "Carregando conteúdo do curso..."));
      await refreshContent();
    } catch (error) {
      await showError(error);
    }
  }

  root.BjjExamsCourseContentUi = Object.freeze({
    openStudio,
    closeStudio,
    refreshContent,
    assertSafeAuthProject,
    expectedProjectId
  });
})(typeof window !== "undefined" ? window : null);
