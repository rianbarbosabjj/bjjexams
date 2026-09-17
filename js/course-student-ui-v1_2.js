"use strict";

(function initCourseStudentUi(root, factory) {
  const ui = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = ui;
  }

  if (root) {
    root.BjjExamsCourseStudentUI = ui;
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildCourseStudentUi(root) {
    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function clampPercent(value) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return 0;
      return Math.min(100, Math.max(0, Math.round(parsed * 100) / 100));
    }

    function flattenLessons(structure = {}) {
      const lessons = [];
      for (const module of asArray(structure.modules)) {
        for (const lesson of asArray(module.lessons)) {
          lessons.push({
            ...lesson,
            moduleId: lesson.moduleId || module.id,
            moduleTitle: module.title || "Módulo"
          });
        }
      }
      return lessons;
    }

    function pickInitialLesson(structure = {}, progress = {}) {
      const lessons = flattenLessons(structure);
      if (!lessons.length) return null;
      const completed = new Set(asArray(progress.completedLessonIds));
      return lessons.find(lesson => !completed.has(lesson.id)) || lessons[0];
    }

    function courseCardView(entry = {}) {
      const course = entry.course || {};
      const enrollment = entry.enrollment || {};
      const entitlement = entry.entitlement || {};
      const progressPercent = clampPercent(enrollment.progressPercent);
      return {
        courseId: String(course.id || enrollment.courseId || ""),
        title: String(course.title || "Curso"),
        description: String(course.description || ""),
        status: String(enrollment.status || "active"),
        progressPercent,
        accessGranted: entitlement.granted === true,
        accessReason: String(entitlement.reason || "")
      };
    }

    function normalizeError(error) {
      const status = String(error?.callableStatus || "").toUpperCase();
      const domainCode = String(error?.domainCode || "").toUpperCase();
      const httpStatus = Number(error?.httpStatus || 0);

      if (httpStatus === 401 || status === "UNAUTHENTICATED") {
        return {
          kind: "auth",
          title: "Sessão expirada",
          message: "Entre novamente para continuar seus estudos."
        };
      }

      if (
        httpStatus === 403 ||
        status === "PERMISSION_DENIED" ||
        domainCode.includes("ENTITLEMENT") ||
        domainCode.includes("COURSE_NOT_PUBLISHED")
      ) {
        return {
          kind: "access",
          title: "Acesso indisponível",
          message: "Seu acesso a este curso não está ativo no momento."
        };
      }

      return {
        kind: "network",
        title: "Não foi possível carregar",
        message: "Tente novamente em alguns instantes."
      };
    }

    function textNode(document, tag, text, className) {
      const node = document.createElement(tag);
      node.textContent = text == null ? "" : String(text);
      if (className) node.className = className;
      return node;
    }

    function createController(options = {}) {
      const api = options.api || root?.BjjExamsCourseStudent;
      const document = options.document || root?.document;
      const getIdToken = options.getIdToken;
      const hostname = options.hostname ?? root?.location?.hostname ?? "";

      if (!api) throw new Error("Cliente de cursos do aluno não configurado.");
      if (!document) throw new Error("Documento indisponível para a interface do aluno.");
      if (typeof getIdToken !== "function") {
        throw new Error("getIdToken é obrigatório para a interface privada do aluno.");
      }

      const state = {
        courses: [],
        structure: null,
        progress: null,
        activeCourseId: null,
        activeLessonId: null,
        loading: false
      };

      const apiOptions = () => ({
        ...(options.apiOptions || {}),
        hostname,
        getIdToken
      });

      function myCoursesContainer() {
        return document.getElementById(options.myCoursesContainerId || "grid-meus-cursos");
      }

      function clear(node) {
        while (node?.firstChild) node.removeChild(node.firstChild);
      }

      function renderState(container, title, message, actionLabel, action) {
        clear(container);
        const box = document.createElement("div");
        box.className = "col-span-full rounded-2xl border border-slate-700 bg-slate-900 p-8 text-center";
        box.appendChild(textNode(document, "h3", title, "text-lg font-black text-white mb-2"));
        box.appendChild(textNode(document, "p", message, "text-sm text-slate-400"));
        if (actionLabel && typeof action === "function") {
          const button = textNode(document, "button", actionLabel, "mt-5 px-5 py-3 rounded-xl bg-neon text-slate-900 text-xs font-black uppercase tracking-widest");
          button.type = "button";
          button.addEventListener("click", action);
          box.appendChild(button);
        }
        container.appendChild(box);
      }

      function renderMyCourses() {
        const container = myCoursesContainer();
        if (!container) return;
        clear(container);

        if (!state.courses.length) {
          renderState(
            container,
            "Nenhum curso em andamento",
            "Quando você tiver acesso a um curso, ele aparecerá aqui."
          );
          return;
        }

        for (const entry of state.courses) {
          const view = courseCardView(entry);
          const card = document.createElement("article");
          card.className = "bg-gradient-to-t from-slate-900 to-slate-800 border border-slate-700 p-6 rounded-2xl flex flex-col justify-between relative overflow-hidden";
          card.dataset.courseId = view.courseId;

          const progressTrack = document.createElement("div");
          progressTrack.className = "absolute top-0 left-0 w-full h-1.5 bg-slate-800";
          const progressBar = document.createElement("div");
          progressBar.className = "h-full bg-neon transition-all";
          progressBar.style.width = `${view.progressPercent}%`;
          progressTrack.appendChild(progressBar);
          card.appendChild(progressTrack);

          const body = document.createElement("div");
          body.appendChild(textNode(document, "h3", view.title, "font-black text-lg mt-2 mb-2 text-white"));
          if (view.description) {
            body.appendChild(textNode(document, "p", view.description, "text-sm text-slate-400 mb-5 line-clamp-3"));
          }
          body.appendChild(textNode(
            document,
            "p",
            view.status === "completed" ? "Curso concluído" : `Progresso: ${view.progressPercent}%`,
            "text-[11px] text-slate-400 uppercase tracking-widest mb-5"
          ));
          card.appendChild(body);

          const button = textNode(
            document,
            "button",
            view.accessGranted
              ? (view.status === "completed" ? "Rever curso" : "Continuar curso")
              : "Acesso indisponível",
            view.accessGranted
              ? "w-full bg-neon text-slate-900 py-3 rounded-xl text-xs font-black uppercase tracking-widest"
              : "w-full bg-slate-800 text-slate-500 py-3 rounded-xl text-xs font-black uppercase tracking-widest cursor-not-allowed"
          );
          button.type = "button";
          button.disabled = !view.accessGranted;
          if (view.accessGranted) {
            button.addEventListener("click", () => openCourse(view.courseId));
          }
          card.appendChild(button);
          container.appendChild(card);
        }
      }

      function ensurePlayer() {
        let overlay = document.getElementById("bjj-student-v12-player");
        if (overlay) return overlay;

        overlay = document.createElement("section");
        overlay.id = "bjj-student-v12-player";
        overlay.className = "hidden fixed inset-0 z-[300] bg-darkbg text-white";

        const header = document.createElement("header");
        header.className = "h-16 border-b border-slate-800 bg-panelbg flex items-center justify-between px-4 sm:px-6";
        const closeButton = textNode(document, "button", "← Voltar", "text-sm font-black text-neon");
        closeButton.type = "button";
        closeButton.addEventListener("click", closeCourse);
        const title = textNode(document, "h2", "Curso", "font-black text-sm sm:text-lg truncate ml-4 flex-1");
        title.id = "bjj-student-v12-course-title";
        header.append(closeButton, title);

        const layout = document.createElement("div");
        layout.className = "h-[calc(100vh-4rem)] flex flex-col lg:flex-row";

        const main = document.createElement("main");
        main.className = "flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8";
        main.id = "bjj-student-v12-main";

        const meta = document.createElement("div");
        meta.className = "max-w-4xl mx-auto";
        const lessonModule = textNode(document, "p", "", "text-[10px] text-neon uppercase tracking-[0.2em] font-black mb-2");
        lessonModule.id = "bjj-student-v12-module";
        const lessonTitle = textNode(document, "h3", "Selecione uma aula", "text-2xl font-black mb-5");
        lessonTitle.id = "bjj-student-v12-lesson-title";
        const content = document.createElement("div");
        content.id = "bjj-student-v12-content";
        content.className = "rounded-2xl border border-slate-800 bg-panelbg p-4 sm:p-6 min-h-52";

        const controls = document.createElement("div");
        controls.className = "mt-6 flex flex-wrap items-center justify-between gap-3";
        const prev = textNode(document, "button", "Aula anterior", "px-4 py-3 rounded-xl border border-slate-700 text-xs font-black uppercase tracking-widest disabled:opacity-30");
        prev.id = "bjj-student-v12-prev";
        prev.type = "button";
        prev.addEventListener("click", () => navigateLesson(-1));
        const complete = textNode(document, "button", "Concluir aula", "px-5 py-3 rounded-xl bg-neon text-slate-900 text-xs font-black uppercase tracking-widest disabled:opacity-50");
        complete.id = "bjj-student-v12-complete";
        complete.type = "button";
        complete.addEventListener("click", completeCurrentLesson);
        const next = textNode(document, "button", "Próxima aula", "px-4 py-3 rounded-xl border border-slate-700 text-xs font-black uppercase tracking-widest disabled:opacity-30");
        next.id = "bjj-student-v12-next";
        next.type = "button";
        next.addEventListener("click", () => navigateLesson(1));
        controls.append(prev, complete, next);
        meta.append(lessonModule, lessonTitle, content, controls);
        main.appendChild(meta);

        const aside = document.createElement("aside");
        aside.className = "w-full lg:w-96 border-l border-slate-800 bg-panelbg flex flex-col max-h-[45vh] lg:max-h-none";
        const progressBox = document.createElement("div");
        progressBox.className = "p-5 border-b border-slate-800";
        const progressLabel = textNode(document, "p", "0% concluído", "text-xs text-slate-400 mb-2");
        progressLabel.id = "bjj-student-v12-progress-label";
        const track = document.createElement("div");
        track.className = "w-full h-2 bg-slate-800 rounded-full overflow-hidden";
        const bar = document.createElement("div");
        bar.id = "bjj-student-v12-progress-bar";
        bar.className = "h-full bg-neon transition-all";
        bar.style.width = "0%";
        track.appendChild(bar);
        progressBox.append(progressLabel, track);
        const list = document.createElement("div");
        list.id = "bjj-student-v12-lessons";
        list.className = "flex-1 overflow-y-auto p-4";
        aside.append(progressBox, list);
        layout.append(main, aside);
        overlay.append(header, layout);
        document.body.appendChild(overlay);
        return overlay;
      }

      function completedIds() {
        return new Set(asArray(state.progress?.completedLessonIds));
      }

      function renderProgress() {
        const progress = state.progress || {};
        const percent = clampPercent(progress.progressPercent);
        const label = document.getElementById("bjj-student-v12-progress-label");
        const bar = document.getElementById("bjj-student-v12-progress-bar");
        if (label) {
          label.textContent = progress.courseCompleted
            ? "Curso concluído"
            : `${percent}% concluído`;
        }
        if (bar) bar.style.width = `${percent}%`;
      }

      function renderLessonList() {
        const list = document.getElementById("bjj-student-v12-lessons");
        if (!list) return;
        clear(list);
        const completed = completedIds();
        const modules = asArray(state.structure?.modules);

        if (!flattenLessons(state.structure || {}).length) {
          list.appendChild(textNode(document, "p", "Este curso ainda não possui aulas.", "text-sm text-slate-400 text-center py-8"));
          return;
        }

        for (const module of modules) {
          const group = document.createElement("div");
          group.className = "mb-5";
          group.appendChild(textNode(document, "h4", module.title || "Módulo", "text-xs font-black uppercase tracking-widest text-slate-400 mb-2"));

          for (const lesson of asArray(module.lessons)) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = `w-full text-left rounded-xl p-3 mb-2 border transition-all ${lesson.id === state.activeLessonId ? "border-neon bg-neon/10" : "border-slate-800 bg-slate-900 hover:border-slate-600"}`;
            const title = completed.has(lesson.id) ? `✓ ${lesson.title}` : lesson.title;
            button.appendChild(textNode(document, "span", title, "block text-sm font-bold text-white"));
            const details = [lesson.contentType, lesson.durationMinutes ? `${lesson.durationMinutes} min` : null].filter(Boolean).join(" • ");
            if (details) button.appendChild(textNode(document, "span", details, "block text-[10px] text-slate-500 mt-1 uppercase tracking-widest"));
            button.addEventListener("click", () => selectLesson(lesson.id));
            group.appendChild(button);
          }
          list.appendChild(group);
        }
      }

      function renderNavigation() {
        const lessons = flattenLessons(state.structure || {});
        const index = lessons.findIndex(lesson => lesson.id === state.activeLessonId);
        const prev = document.getElementById("bjj-student-v12-prev");
        const next = document.getElementById("bjj-student-v12-next");
        if (prev) prev.disabled = index <= 0;
        if (next) next.disabled = index < 0 || index >= lessons.length - 1;
      }

      function youtubeEmbed(url) {
        const value = String(url || "");
        let match = value.match(/[?&]v=([A-Za-z0-9_-]{11})/);
        if (!match) match = value.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
        if (!match) match = value.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
        return match ? `https://www.youtube.com/embed/${match[1]}` : null;
      }

      function renderLessonContent(lesson = {}) {
        const content = document.getElementById("bjj-student-v12-content");
        const title = document.getElementById("bjj-student-v12-lesson-title");
        const moduleLabel = document.getElementById("bjj-student-v12-module");
        if (!content) return;
        clear(content);
        if (title) title.textContent = lesson.title || "Aula";

        const summary = flattenLessons(state.structure || {}).find(item => item.id === lesson.id);
        if (moduleLabel) moduleLabel.textContent = summary?.moduleTitle || "Módulo";

        if (lesson.description) {
          content.appendChild(textNode(document, "p", lesson.description, "text-sm text-slate-400 mb-5 whitespace-pre-wrap"));
        }

        if (lesson.contentType === "text") {
          content.appendChild(textNode(document, "div", lesson.body || "", "text-base text-slate-200 leading-relaxed whitespace-pre-wrap"));
        } else if (lesson.contentType === "video" && lesson.videoUrl) {
          const embedUrl = youtubeEmbed(lesson.videoUrl);
          if (embedUrl) {
            const frame = document.createElement("iframe");
            frame.src = embedUrl;
            frame.className = "w-full aspect-video rounded-xl bg-black";
            frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            frame.allowFullscreen = true;
            frame.referrerPolicy = "strict-origin-when-cross-origin";
            content.appendChild(frame);
          } else {
            const video = document.createElement("video");
            video.src = lesson.videoUrl;
            video.controls = true;
            video.preload = "metadata";
            video.className = "w-full rounded-xl bg-black";
            content.appendChild(video);
          }
        } else if (lesson.contentType === "document" && lesson.documentUrl) {
          const link = textNode(document, "a", "Abrir material da aula", "inline-flex px-5 py-3 rounded-xl bg-neon text-slate-900 text-xs font-black uppercase tracking-widest");
          link.href = lesson.documentUrl;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          content.appendChild(link);
        } else {
          content.appendChild(textNode(document, "p", "Conteúdo indisponível.", "text-sm text-slate-400"));
        }

        const complete = document.getElementById("bjj-student-v12-complete");
        if (complete) {
          const done = completedIds().has(lesson.id);
          complete.disabled = done;
          complete.textContent = done ? "Aula concluída" : "Concluir aula";
        }
        renderNavigation();
      }

      async function loadMyCourses() {
        const container = myCoursesContainer();
        if (container) {
          renderState(container, "Carregando seus cursos", "Aguarde enquanto buscamos seus acessos.");
        }

        try {
          state.courses = await api.listMyCourses(apiOptions());
          renderMyCourses();
          return state.courses;
        } catch (error) {
          const uiError = normalizeError(error);
          if (container) {
            renderState(container, uiError.title, uiError.message, "Tentar novamente", loadMyCourses);
          }
          throw error;
        }
      }

      async function openCourse(courseId) {
        const id = String(courseId || "").trim();
        if (!id) throw new Error("Curso inválido.");
        const overlay = ensurePlayer();
        overlay.classList.remove("hidden");
        document.body.style.overflow = "hidden";
        state.activeCourseId = id;
        state.activeLessonId = null;

        const main = document.getElementById("bjj-student-v12-content");
        if (main) {
          clear(main);
          main.appendChild(textNode(document, "p", "Carregando conteúdo protegido...", "text-sm text-slate-400"));
        }

        try {
          const [structureResponse, progressResponse] = await Promise.all([
            api.getCourseStructure(id, apiOptions()),
            api.getProgress(id, apiOptions())
          ]);
          state.structure = {
            course: structureResponse.course || {},
            modules: asArray(structureResponse.modules)
          };
          state.progress = progressResponse.progress || {};

          const courseTitle = document.getElementById("bjj-student-v12-course-title");
          if (courseTitle) courseTitle.textContent = state.structure.course.title || "Curso";
          renderProgress();
          renderLessonList();

          const initial = pickInitialLesson(state.structure, state.progress);
          if (initial) {
            await selectLesson(initial.id);
          } else if (main) {
            clear(main);
            main.appendChild(textNode(document, "p", "Este curso ainda não possui aulas disponíveis.", "text-sm text-slate-400"));
          }
          return { structure: state.structure, progress: state.progress };
        } catch (error) {
          const uiError = normalizeError(error);
          if (main) {
            clear(main);
            main.appendChild(textNode(document, "h3", uiError.title, "text-lg font-black text-white mb-2"));
            main.appendChild(textNode(document, "p", uiError.message, "text-sm text-slate-400"));
          }
          throw error;
        }
      }

      async function selectLesson(lessonId) {
        if (!state.activeCourseId) throw new Error("Nenhum curso aberto.");
        const id = String(lessonId || "").trim();
        const summary = flattenLessons(state.structure || {}).find(item => item.id === id);
        if (!summary) throw new Error("Aula fora da estrutura carregada.");
        state.activeLessonId = id;
        renderLessonList();
        renderNavigation();

        const content = document.getElementById("bjj-student-v12-content");
        if (content) {
          clear(content);
          content.appendChild(textNode(document, "p", "Carregando aula...", "text-sm text-slate-400"));
        }

        try {
          const response = await api.getLesson(state.activeCourseId, id, apiOptions());
          renderLessonContent(response.lesson || {});
          return response.lesson || null;
        } catch (error) {
          const uiError = normalizeError(error);
          if (content) {
            clear(content);
            content.appendChild(textNode(document, "h3", uiError.title, "text-lg font-black text-white mb-2"));
            content.appendChild(textNode(document, "p", uiError.message, "text-sm text-slate-400"));
          }
          throw error;
        }
      }

      async function completeCurrentLesson() {
        if (!state.activeCourseId || !state.activeLessonId) return null;
        const button = document.getElementById("bjj-student-v12-complete");
        if (button) {
          button.disabled = true;
          button.textContent = "Salvando...";
        }

        try {
          const result = await api.completeLesson(
            state.activeCourseId,
            state.activeLessonId,
            apiOptions()
          );
          const completedLessonIds = new Set(asArray(state.progress?.completedLessonIds));
          completedLessonIds.add(state.activeLessonId);
          state.progress = {
            ...(state.progress || {}),
            ...(result.progress || {}),
            completedLessonIds: [...completedLessonIds]
          };
          renderProgress();
          renderLessonList();

          if (button) {
            button.disabled = true;
            button.textContent = "Aula concluída";
          }

          try {
            const canonicalProgress = await api.getProgress(
              state.activeCourseId,
              apiOptions()
            );
            state.progress = canonicalProgress.progress || state.progress;
            renderProgress();
            renderLessonList();
            if (button) {
              const done = completedIds().has(state.activeLessonId);
              button.disabled = done;
              button.textContent = done ? "Aula concluída" : "Concluir aula";
            }
          } catch (_error) {
            // A conclusão já foi confirmada pelo backend. Mantém o estado seguro
            // derivado da resposta de concluirAulaCursoV12 se a reconciliação falhar.
          }

          loadMyCourses().catch(() => undefined);
          return result;
        } catch (error) {
          if (button) {
            button.disabled = false;
            button.textContent = "Concluir aula";
          }
          throw error;
        }
      }

      async function navigateLesson(direction) {
        const lessons = flattenLessons(state.structure || {});
        const index = lessons.findIndex(item => item.id === state.activeLessonId);
        const next = lessons[index + Number(direction || 0)];
        if (next) return selectLesson(next.id);
        return null;
      }

      function closeCourse() {
        const overlay = document.getElementById("bjj-student-v12-player");
        overlay?.classList.add("hidden");
        document.body.style.overflow = "";
        state.structure = null;
        state.progress = null;
        state.activeCourseId = null;
        state.activeLessonId = null;
      }

      async function mount() {
        ensurePlayer();
        return loadMyCourses();
      }

      return Object.freeze({
        state,
        mount,
        loadMyCourses,
        renderMyCourses,
        openCourse,
        closeCourse,
        selectLesson,
        completeCurrentLesson,
        navigateLesson
      });
    }

    return Object.freeze({
      clampPercent,
      flattenLessons,
      pickInitialLesson,
      courseCardView,
      normalizeError,
      createController
    });
  }
);
