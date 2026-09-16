"use strict";

(function initInstructorCourseUi(root) {
  const api = root?.BjjExamsCourseAdmin;
  if (!root || !api) {
    console.error("Courses v1.2: cliente administrativo indisponível.");
    return;
  }

  let cachedCourses = [];
  let installed = false;

  const STATUS_CLASSES = Object.freeze({
    draft: "bg-slate-500/10 text-slate-300 border-slate-500/30",
    review: "bg-amber-500/10 text-amber-300 border-amber-500/30",
    published: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
    suspended: "bg-rose-500/10 text-rose-300 border-rose-500/30",
    archived: "bg-slate-800 text-slate-500 border-slate-700"
  });

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
    if (!auth) {
      throw new Error(
        "Autenticação v1.2 ainda não foi conectada ao painel do instrutor."
      );
    }

    const expected = expectedProjectId();
    const actual = String(auth.app?.options?.projectId || "").trim();

    if (!actual) {
      throw new Error("Não foi possível confirmar o projeto Firebase autenticado.");
    }

    if (actual !== expected) {
      const error = new Error(
        `Operação bloqueada: a página resolve para ${expected}, mas o Auth ativo pertence a ${actual}.`
      );
      error.code = "ENVIRONMENT_MISMATCH";
      error.expectedProjectId = expected;
      error.actualProjectId = actual;
      throw error;
    }

    return auth;
  }

  async function callableOptions() {
    const auth = assertSafeAuthProject();
    const user = auth.currentUser;

    if (!user) {
      throw new Error("Faça login novamente para administrar seus cursos.");
    }

    const idToken = await user.getIdToken();
    return {
      idToken,
      hostname: root.location?.hostname || ""
    };
  }

  function listContainer() {
    return document.getElementById("lista-cursos-prof");
  }

  function clearElement(element) {
    while (element?.firstChild) {
      element.removeChild(element.firstChild);
    }
  }

  function textElement(tag, className, value) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = value == null ? "" : String(value);
    return element;
  }

  function staticIcon(name, classes = "") {
    const icon = document.createElement("i");
    icon.className = `ph ph-${name} ${classes}`.trim();
    return icon;
  }

  function setCourseHeaderCopy() {
    const courseTab = document.getElementById("cursos");
    if (!courseTab) return;

    const heading = courseTab.querySelector("h2");
    const subtitle = courseTab.querySelector("h2 + p");
    if (heading) heading.textContent = "Meus Cursos";
    if (subtitle) {
      subtitle.textContent =
        "Crie, edite e envie seus cursos para revisão usando a arquitetura v1.2.";
    }

    const button = courseTab.querySelector("button[onclick*='abrirModalCriarCurso']");
    if (button) {
      const textNode = Array.from(button.childNodes)
        .find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      if (textNode) textNode.textContent = " Novo Curso";
    }

    if (currentEnvironment() === "staging" && !document.getElementById("course-v12-env-badge")) {
      const badge = textElement(
        "span",
        "inline-flex items-center px-3 py-1 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-300 text-[9px] font-black uppercase tracking-widest mt-3",
        "Ambiente de testes"
      );
      badge.id = "course-v12-env-badge";
      heading?.parentElement?.appendChild(badge);
    }
  }

  function renderLoading() {
    const container = listContainer();
    if (!container) return;
    clearElement(container);

    const wrapper = document.createElement("div");
    wrapper.className = "col-span-full text-center py-12";
    wrapper.appendChild(
      textElement("p", "text-slate-400 text-sm", "Carregando cursos v1.2...")
    );
    container.appendChild(wrapper);
  }

  function renderBlocked(error) {
    const container = listContainer();
    if (!container) return;
    clearElement(container);

    const card = document.createElement("div");
    card.className =
      "col-span-full bg-rose-500/10 border border-rose-500/30 rounded-2xl p-6";

    card.appendChild(
      textElement(
        "h3",
        "text-rose-300 font-black uppercase tracking-widest text-sm",
        "Gestão de cursos bloqueada por segurança"
      )
    );
    card.appendChild(
      textElement(
        "p",
        "text-slate-300 text-sm mt-3 leading-relaxed",
        error?.message || "Não foi possível validar o ambiente autenticado."
      )
    );

    if (error?.code === "ENVIRONMENT_MISMATCH") {
      card.appendChild(
        textElement(
          "p",
          "text-slate-500 text-xs mt-3",
          "Nenhuma operação de curso foi enviada. Ajuste o Firebase Auth do frontend para o mesmo ambiente antes de testar."
        )
      );
    }

    container.appendChild(card);
  }

  function actionButton(label, iconName, variant, onClick) {
    const button = document.createElement("button");
    const variants = {
      primary:
        "bg-neon text-slate-950 border-neon hover:bg-white",
      secondary:
        "bg-slate-900 text-white border-slate-700 hover:border-neon hover:text-neon",
      warning:
        "bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500 hover:text-slate-950",
      danger:
        "bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500 hover:text-white"
    };

    button.type = "button";
    button.className =
      `inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-black uppercase tracking-widest transition ${variants[variant] || variants.secondary}`;
    button.append(staticIcon(iconName), document.createTextNode(label));
    button.addEventListener("click", onClick);
    return button;
  }

  function courseCard(course) {
    const article = document.createElement("article");
    article.className =
      "bg-cardbg border border-slate-700/70 rounded-2xl p-5 flex flex-col min-h-[300px] shadow-lg";

    const top = document.createElement("div");
    top.className = "flex items-start justify-between gap-3";

    const badge = textElement(
      "span",
      `inline-flex px-2.5 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${STATUS_CLASSES[course.status] || STATUS_CLASSES.draft}`,
      api.statusLabel(course.status)
    );
    top.appendChild(badge);

    const ownership = textElement(
      "span",
      "text-[9px] text-slate-500 uppercase tracking-widest font-bold",
      course.ownerType === "user" ? "Curso próprio" : "Plataforma"
    );
    top.appendChild(ownership);

    const title = textElement(
      "h3",
      "text-xl font-black text-white mt-5 leading-tight",
      course.title || "Curso sem título"
    );

    const description = textElement(
      "p",
      "text-sm text-slate-400 mt-3 leading-relaxed line-clamp-3 flex-1",
      course.description || "Rascunho ainda sem descrição."
    );

    const price = textElement(
      "p",
      "text-2xl font-black text-neon mt-5",
      api.formatPrice(course)
    );

    const actions = document.createElement("div");
    actions.className = "flex flex-wrap gap-2 mt-5 pt-4 border-t border-slate-800";

    for (const action of api.instructorActions(course)) {
      if (action === "edit") {
        actions.appendChild(
          actionButton("Editar", "pencil-simple", "secondary", () => openEditCourse(course.id))
        );
      } else if (action === "review") {
        actions.appendChild(
          actionButton("Enviar para revisão", "paper-plane-tilt", "primary", () => submitForReview(course.id))
        );
      } else if (action === "archive") {
        actions.appendChild(
          actionButton("Arquivar", "archive", "danger", () => archiveCourse(course.id))
        );
      } else if (action === "view-public") {
        const link = document.createElement("a");
        link.href = `cursos.html?id=${encodeURIComponent(course.id)}`;
        link.className =
          "inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-neon/30 bg-neon/10 text-neon text-[10px] font-black uppercase tracking-widest hover:bg-neon hover:text-slate-950 transition";
        link.append(staticIcon("eye"), document.createTextNode("Ver público"));
        actions.appendChild(link);
      }
    }

    if (!actions.childNodes.length) {
      actions.appendChild(
        textElement(
          "p",
          "text-[10px] text-slate-500 uppercase tracking-widest font-bold",
          "Sem ações disponíveis neste estado"
        )
      );
    }

    article.append(top, title, description, price, actions);
    return article;
  }

  function renderCourses(courses) {
    const container = listContainer();
    if (!container) return;
    clearElement(container);

    if (!courses.length) {
      const empty = document.createElement("div");
      empty.className =
        "col-span-full bg-cardbg border border-dashed border-slate-700 rounded-2xl p-10 text-center";
      empty.appendChild(staticIcon("books", "text-4xl text-neon/60"));
      empty.appendChild(
        textElement("h3", "text-lg font-black text-white mt-4", "Nenhum curso criado ainda")
      );
      empty.appendChild(
        textElement(
          "p",
          "text-sm text-slate-400 mt-2",
          "Crie seu primeiro rascunho. A publicação pública exigirá revisão da plataforma."
        )
      );
      container.appendChild(empty);
      return;
    }

    for (const course of courses) {
      container.appendChild(courseCard(course));
    }
  }

  function findCourse(courseId) {
    return cachedCourses.find(course => course.id === courseId) || null;
  }

  function errorMessage(error) {
    if (error?.callableStatus === "PERMISSION_DENIED") {
      return "Você não possui permissão para executar esta ação.";
    }
    if (error?.callableStatus === "FAILED_PRECONDITION") {
      return error.message || "O curso não está em um estado compatível com esta ação.";
    }
    return error?.message || "Não foi possível concluir a operação.";
  }

  async function showOperationError(error) {
    console.error("Courses v1.2:", error);
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

  async function loadCourses() {
    setCourseHeaderCopy();
    renderLoading();

    try {
      const options = await callableOptions();
      cachedCourses = await api.listCourses(options);
      cachedCourses.sort((a, b) => {
        const left = a.updatedAt?._seconds ?? a.updatedAt?.seconds ?? 0;
        const right = b.updatedAt?._seconds ?? b.updatedAt?.seconds ?? 0;
        return right - left;
      });
      renderCourses(cachedCourses);
      return cachedCourses;
    } catch (error) {
      renderBlocked(error);
      return [];
    }
  }

  function courseFormHtml(mode) {
    const heading = mode === "edit" ? "Editar rascunho" : "Novo curso";
    return `
      <div class="text-left space-y-4 mt-2">
        <p class="text-[10px] text-neon uppercase tracking-widest font-black">${heading}</p>
        <div>
          <label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Título *</label>
          <input id="course-v12-title" maxlength="160" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon">
        </div>
        <div>
          <label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Descrição</label>
          <textarea id="course-v12-description" maxlength="10000" rows="5" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon"></textarea>
          <p class="text-[10px] text-slate-500 mt-1">Para enviar à revisão, a descrição precisa ter pelo menos 20 caracteres.</p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Modelo</label>
            <select id="course-v12-payment" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon">
              <option value="free">Gratuito</option>
              <option value="paid">Pago</option>
            </select>
          </div>
          <div>
            <label class="text-[10px] text-slate-400 uppercase font-black tracking-widest">Preço (R$)</label>
            <input id="course-v12-price" inputmode="decimal" placeholder="0,00" class="w-full mt-1 px-4 py-3 bg-slate-900 border border-slate-700 rounded-xl text-white outline-none focus:border-neon">
          </div>
        </div>
        <div class="bg-cyan-500/10 border border-cyan-500/20 rounded-xl p-3">
          <p class="text-xs text-slate-300">O curso será salvo em <strong>rascunho</strong>. O instrutor não publica diretamente; a publicação depende da moderação.</p>
        </div>
      </div>`;
  }

  function bindPaymentField() {
    const select = document.getElementById("course-v12-payment");
    const price = document.getElementById("course-v12-price");
    if (!select || !price) return;

    const sync = () => {
      const paid = select.value === "paid";
      price.disabled = !paid;
      if (!paid) price.value = "0,00";
      price.classList.toggle("opacity-50", !paid);
    };
    select.addEventListener("change", sync);
    sync();
  }

  function readCourseForm() {
    const title = document.getElementById("course-v12-title")?.value?.trim() || "";
    const description = document.getElementById("course-v12-description")?.value?.trim() || "";
    const isPaid = document.getElementById("course-v12-payment")?.value === "paid";
    const priceRaw = document.getElementById("course-v12-price")?.value || "0";

    if (title.length < 3) {
      root.Swal?.showValidationMessage("Informe um título com pelo menos 3 caracteres.");
      return false;
    }

    let priceCents = 0;
    try {
      priceCents = isPaid ? api.normalizeMoneyToCents(priceRaw) : 0;
    } catch (error) {
      root.Swal?.showValidationMessage(error.message);
      return false;
    }

    if (isPaid && priceCents <= 0) {
      root.Swal?.showValidationMessage("Curso pago precisa ter preço maior que zero.");
      return false;
    }

    return {
      title,
      description,
      visibility: "platform",
      organizationId: null,
      isPaid,
      priceCents,
      currency: "BRL"
    };
  }

  async function openCreateCourse() {
    try {
      await callableOptions();
    } catch (error) {
      renderBlocked(error);
      return showOperationError(error);
    }

    const result = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      title: "Criar curso",
      html: courseFormHtml("create"),
      showCancelButton: true,
      confirmButtonText: "Criar rascunho",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--brand-color)",
      cancelButtonColor: "#334155",
      didOpen: bindPaymentField,
      preConfirm: readCourseForm
    });

    if (!result.isConfirmed || !result.value) return;

    try {
      root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        title: "Criando rascunho...",
        allowOutsideClick: false,
        didOpen: () => root.Swal.showLoading()
      });
      const options = await callableOptions();
      await api.createCourse(
        {
          ...result.value,
          ownerType: "user",
          instructorIds: []
        },
        options
      );
      await root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        icon: "success",
        title: "Rascunho criado",
        text: "O curso foi criado na estrutura canônica v1.2.",
        confirmButtonColor: "var(--brand-color)"
      });
      await loadCourses();
    } catch (error) {
      await showOperationError(error);
    }
  }

  async function openEditCourse(courseId) {
    const course = findCourse(courseId);
    if (!course) return;

    if (course.status !== "draft") {
      return showOperationError(new Error("Somente rascunhos podem ser editados pelo instrutor."));
    }

    const result = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      title: "Editar curso",
      html: courseFormHtml("edit"),
      showCancelButton: true,
      confirmButtonText: "Salvar alterações",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--brand-color)",
      cancelButtonColor: "#334155",
      didOpen: () => {
        document.getElementById("course-v12-title").value = course.title || "";
        document.getElementById("course-v12-description").value = course.description || "";
        document.getElementById("course-v12-payment").value = course.isPaid ? "paid" : "free";
        document.getElementById("course-v12-price").value = course.isPaid
          ? (Number(course.priceCents || 0) / 100).toFixed(2).replace(".", ",")
          : "0,00";
        bindPaymentField();
      },
      preConfirm: readCourseForm
    });

    if (!result.isConfirmed || !result.value) return;

    try {
      const options = await callableOptions();
      await api.updateCourse(
        {
          courseId,
          ...result.value
        },
        options
      );
      await root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        icon: "success",
        title: "Curso atualizado",
        confirmButtonColor: "var(--brand-color)"
      });
      await loadCourses();
    } catch (error) {
      await showOperationError(error);
    }
  }

  async function submitForReview(courseId) {
    const course = findCourse(courseId);
    if (!course) return;

    if ((course.description || "").trim().length < 20) {
      return showOperationError(
        new Error("Complete a descrição do curso antes de enviá-lo para revisão.")
      );
    }

    const confirmation = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      icon: "question",
      title: "Enviar para revisão?",
      text: "Depois do envio, o instrutor não poderá editar o curso até a moderação devolvê-lo para rascunho.",
      showCancelButton: true,
      confirmButtonText: "Enviar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "var(--brand-color)",
      cancelButtonColor: "#334155"
    });

    if (!confirmation.isConfirmed) return;

    try {
      const options = await callableOptions();
      await api.changeStatus(courseId, "review", options);
      await root.Swal.fire({
        background: "var(--bg-card)",
        color: "var(--text-main)",
        icon: "success",
        title: "Enviado para revisão",
        text: "A publicação continuará sob responsabilidade da moderação da plataforma.",
        confirmButtonColor: "var(--brand-color)"
      });
      await loadCourses();
    } catch (error) {
      await showOperationError(error);
    }
  }

  async function archiveCourse(courseId) {
    const confirmation = await root.Swal.fire({
      background: "var(--bg-card)",
      color: "var(--text-main)",
      icon: "warning",
      title: "Arquivar curso?",
      text: "O arquivamento faz parte do ciclo de vida canônico e não remove fisicamente o documento.",
      showCancelButton: true,
      confirmButtonText: "Arquivar",
      cancelButtonText: "Cancelar",
      confirmButtonColor: "#f43f5e",
      cancelButtonColor: "#334155"
    });

    if (!confirmation.isConfirmed) return;

    try {
      const options = await callableOptions();
      await api.changeStatus(courseId, "archived", options);
      await loadCourses();
    } catch (error) {
      await showOperationError(error);
    }
  }

  function install() {
    if (installed) return;
    installed = true;

    setCourseHeaderCopy();

    // Compatibilidade controlada com a marcação atual do painel.
    // As funções legadas continuam no arquivo durante a transição, mas estes
    // handlers substituem o fluxo de gestão de cursos pela camada v1.2.
    root.carregarCursosProf = loadCourses;
    root.abrirModalCriarCurso = openCreateCourse;
    root.abrirEditor = openEditCourse;

    root.BjjExamsInstructorCourseUi = Object.freeze({
      loadCourses,
      openCreateCourse,
      openEditCourse,
      submitForReview,
      archiveCourse,
      assertSafeAuthProject,
      expectedProjectId
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install, { once: true });
  } else {
    install();
  }
})(typeof window !== "undefined" ? window : null);
