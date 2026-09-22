"use strict";

(function initBeltExamExecutionUi(root, factory) {
  const ui = factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = ui;
  }

  if (root) {
    root.BjjExamsBeltExamExecutionUI = ui;
    ui.autoInstall();
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,
  function buildBeltExamExecutionUi(root) {
    const LABELS = Object.freeze([
      "A",
      "B",
      "C",
      "D"
    ]);

    function requireId(value, label) {
      const id =
        String(value || "").trim();

      if (
        !id ||
        id.includes("/") ||
        id.length > 200
      ) {
        throw new Error(
          `${label} inválido.`
        );
      }

      return id;
    }

    function parseRegistrationId(
      searchInput
    ) {
      const params =
        new URLSearchParams(
          String(searchInput || "")
        );

      return requireId(
        params.get("registrationId"),
        "Registration"
      );
    }

    function timestampToMillis(value) {
      if (value instanceof Date) {
        const millis =
          value.getTime();

        return Number.isFinite(millis)
          ? millis
          : null;
      }

      if (
        value &&
        typeof value.toMillis ===
          "function"
      ) {
        const millis =
          Number(
            value.toMillis()
          );

        return Number.isFinite(millis)
          ? millis
          : null;
      }

      if (
        value &&
        Number.isFinite(
          Number(value.seconds)
        )
      ) {
        const seconds =
          Number(value.seconds);

        const nanos =
          Number(
            value.nanoseconds ||
            value._nanoseconds ||
            0
          );

        return (
          seconds * 1000 +
          Math.floor(nanos / 1000000)
        );
      }

      if (
        value &&
        Number.isFinite(
          Number(value._seconds)
        )
      ) {
        const seconds =
          Number(value._seconds);

        const nanos =
          Number(
            value._nanoseconds ||
            0
          );

        return (
          seconds * 1000 +
          Math.floor(nanos / 1000000)
        );
      }

      if (
        typeof value === "number" &&
        Number.isFinite(value)
      ) {
        return value;
      }

      if (typeof value === "string") {
        const millis =
          Date.parse(value);

        return Number.isFinite(millis)
          ? millis
          : null;
      }

      return null;
    }

    function formatRemaining(
      remainingMs
    ) {
      const seconds =
        Math.max(
          0,
          Math.ceil(
            Number(remainingMs || 0) /
            1000
          )
        );

      const minutes =
        Math.floor(
          seconds / 60
        );

      const rest =
        seconds % 60;

      return (
        String(minutes).padStart(2, "0") +
        ":" +
        String(rest).padStart(2, "0")
      );
    }

    function normalizeQuestions(
      questionsInput
    ) {
      if (
        !Array.isArray(questionsInput) ||
        questionsInput.length === 0
      ) {
        throw new Error(
          "A tentativa não possui questões disponíveis."
        );
      }

      return questionsInput.map(
        questionInput => {
          const question =
            questionInput || {};

          const id =
            requireId(
              question.id,
              "Questão"
            );

          const prompt =
            String(
              question.prompt || ""
            ).trim();

          if (!prompt) {
            throw new Error(
              `Enunciado ausente para ${id}.`
            );
          }

          if (
            !question.alternatives ||
            typeof question.alternatives !==
              "object" ||
            Array.isArray(
              question.alternatives
            )
          ) {
            throw new Error(
              `Alternativas inválidas para ${id}.`
            );
          }

          const alternatives = {};

          for (
            const label of LABELS
          ) {
            if (
              Object.prototype.hasOwnProperty.call(
                question.alternatives,
                label
              )
            ) {
              const text =
                String(
                  question.alternatives[
                    label
                  ] || ""
                ).trim();

              if (!text) {
                throw new Error(
                  `Alternativa ${label} inválida para ${id}.`
                );
              }

              alternatives[label] =
                text;
            }
          }

          if (
            Object.keys(
              alternatives
            ).length < 2
          ) {
            throw new Error(
              `Questão ${id} possui alternativas insuficientes.`
            );
          }

          return Object.freeze({
            id,
            prompt,
            alternatives:
              Object.freeze(
                alternatives
              ),
            media:
              Object.freeze({
                imageUrl:
                  question.media?.imageUrl ||
                  null,
                videoUrl:
                  question.media?.videoUrl ||
                  null
              })
          });
        }
      );
    }

    function buildAnswerPayload(
      questionsInput,
      answersInput = {}
    ) {
      const questions =
        normalizeQuestions(
          questionsInput
        );

      if (
        !answersInput ||
        typeof answersInput !==
          "object" ||
        Array.isArray(answersInput)
      ) {
        throw new Error(
          "Estado local de respostas inválido."
        );
      }

      const allowed =
        new Set(
          questions.map(
            question =>
              question.id
          )
        );

      const result = {};

      for (
        const [
          questionIdInput,
          answerInput
        ] of Object.entries(
          answersInput
        )
      ) {
        const questionId =
          requireId(
            questionIdInput,
            "Questão"
          );

        if (
          !allowed.has(
            questionId
          )
        ) {
          throw new Error(
            "Resposta local pertence a uma questão fora da tentativa."
          );
        }

        if (
          answerInput === null ||
          answerInput === undefined ||
          String(answerInput).trim() ===
            ""
        ) {
          continue;
        }

        const answer =
          String(answerInput)
            .trim()
            .toUpperCase();

        if (
          !LABELS.includes(
            answer
          )
        ) {
          throw new Error(
            `Resposta inválida para ${questionId}.`
          );
        }

        result[questionId] =
          answer;
      }

      return result;
    }

    function resultPercentage(
      scoreBps
    ) {
      const value =
        Number(scoreBps);

      if (
        !Number.isSafeInteger(value) ||
        value < 0 ||
        value > 10000
      ) {
        return null;
      }

      return value / 100;
    }

    async function resolveAuth() {
      if (
        root?.__BJJ_EXAMS_AUTH__
      ) {
        return root.__BJJ_EXAMS_AUTH__;
      }

      const [
        { getApps },
        { getAuth }
      ] =
        await Promise.all([
          import(
            "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js"
          ),
          import(
            "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js"
          )
        ]);

      const apps =
        getApps();

      if (!apps.length) {
        throw new Error(
          "Firebase Auth ainda não foi inicializado."
        );
      }

      return getAuth(
        apps[0]
      );
    }

    function createController(
      options = {}
    ) {
      const api =
        options.api ||
        root?.BjjExamsBeltExam;

      const document =
        options.document ||
        root?.document;

      const location =
        options.location ||
        root?.location;

      if (!api) {
        throw new Error(
          "Cliente canônico de exames não configurado."
        );
      }

      if (!document) {
        throw new Error(
          "Documento indisponível para execução da prova."
        );
      }

      const state = {
        registrationId:
          options.registrationId ||
          parseRegistrationId(
            location?.search ||
            ""
          ),
        item:
          null,
        attempt:
          null,
        questions:
          [],
        answers:
          {},
        currentIndex:
          0,
        timer:
          null,
        submitting:
          false
      };

      function byId(id) {
        return document.getElementById(id);
      }

      function showOnly(id) {
        for (
          const sectionId of [
            "exam-loading",
            "exam-ready",
            "exam-active",
            "exam-result",
            "exam-error"
          ]
        ) {
          const node =
            byId(sectionId);

          if (node) {
            node.classList.toggle(
              "hidden",
              sectionId !== id
            );
          }
        }
      }

      function setText(id, value) {
        const node =
          byId(id);

        if (node) {
          node.textContent =
            value == null
              ? ""
              : String(value);
        }
      }

      async function callableOptions() {
        const auth =
          await resolveAuth();

        if (
          typeof auth.authStateReady ===
            "function"
        ) {
          await auth.authStateReady();
        }

        const hostname =
          String(
            location?.hostname ||
            ""
          );

        const expected =
          api.projectIdForEnvironment(
            "staging",
            { hostname }
          );

        const actual =
          String(
            auth.app?.options?.projectId ||
            ""
          ).trim();

        if (actual !== expected) {
          const error =
            new Error(
              `Operação bloqueada: Auth ativo pertence a ${actual || "projeto desconhecido"}, esperado ${expected}.`
            );

          error.code =
            "ENVIRONMENT_MISMATCH";

          throw error;
        }

        if (!auth.currentUser) {
          throw new Error(
            "Faça login novamente para acessar a prova."
          );
        }

        return {
          hostname,
          getIdToken:
            () =>
              auth.currentUser
                .getIdToken()
        };
      }

      function renderError(error) {
        clearTimer();

        setText(
          "exam-error-message",
          error?.message ||
          "Não foi possível acessar esta prova."
        );

        showOnly(
          "exam-error"
        );
      }

      function renderReady() {
        const item =
          state.item;

        setText(
          "exam-ready-title",
          item?.canResumeExam
            ? "Retomar prova oficial"
            : "Iniciar prova oficial"
        );

        setText(
          "exam-ready-copy",
          item?.canResumeExam
            ? "O prazo original continua em andamento. Retomar a prova não reinicia o cronômetro."
            : "O cronômetro será iniciado pelo servidor somente quando você confirmar o início."
        );

        const button =
          byId(
            "exam-start-button"
          );

        if (button) {
          button.textContent =
            item?.canResumeExam
              ? "Retomar prova"
              : "Iniciar prova";

          button.disabled =
            false;
        }

        showOnly(
          "exam-ready"
        );
      }

      function renderResult(result) {
        clearTimer();

        const percentage =
          resultPercentage(
            result?.scoreBps
          );

        setText(
          "exam-result-status",
          result?.status ===
            "passed"
            ? "Aprovado"
            : result?.status ===
                "failed"
              ? "Não aprovado"
              : "Resultado disponível"
        );

        setText(
          "exam-result-score",
          percentage === null
            ? "Nota indisponível"
            : `${percentage.toFixed(2).replace(".", ",")}%`
        );

        setText(
          "exam-result-detail",
          Number.isSafeInteger(
            Number(
              result?.correctCount
            )
          ) &&
          Number.isSafeInteger(
            Number(
              result?.totalQuestions
            )
          )
            ? `${result.correctCount} de ${result.totalQuestions} questões corretas`
            : ""
        );

        showOnly(
          "exam-result"
        );
      }

      function renderQuestion() {
        const question =
          state.questions[
            state.currentIndex
          ];

        if (!question) {
          throw new Error(
            "Questão atual indisponível."
          );
        }

        setText(
          "exam-question-counter",
          `Questão ${state.currentIndex + 1} de ${state.questions.length}`
        );

        setText(
          "exam-question-prompt",
          question.prompt
        );

        const progress =
          byId(
            "exam-progress"
          );

        if (progress) {
          progress.style.width =
            `${
              (
                (
                  state.currentIndex +
                  1
                ) /
                state.questions.length
              ) *
              100
            }%`;
        }

        const container =
          byId(
            "exam-alternatives"
          );

        if (container) {
          container.replaceChildren();

          for (
            const [
              label,
              text
            ] of Object.entries(
              question.alternatives
            )
          ) {
            const button =
              document.createElement(
                "button"
              );

            button.type =
              "button";

            button.className =
              state.answers[
                question.id
              ] === label
                ? "w-full text-left border border-cyan-300 bg-cyan-400/10 rounded-2xl p-4 transition"
                : "w-full text-left border border-slate-700 bg-slate-900/50 hover:border-cyan-400 rounded-2xl p-4 transition";

            const labelNode =
              document.createElement(
                "strong"
              );

            labelNode.className =
              "inline-flex w-8 h-8 mr-3 items-center justify-center rounded-full border border-slate-600";

            labelNode.textContent =
              label;

            const textNode =
              document.createElement(
                "span"
              );

            textNode.textContent =
              text;

            button.append(
              labelNode,
              textNode
            );

            button.addEventListener(
              "click",
              () => {
                state.answers[
                  question.id
                ] =
                  label;

                renderQuestion();
              }
            );

            container.appendChild(
              button
            );
          }
        }

        const previous =
          byId("exam-previous");

        const next =
          byId("exam-next");

        if (previous) {
          previous.disabled =
            state.currentIndex ===
              0;
        }

        if (next) {
          next.disabled =
            state.currentIndex >=
            state.questions.length -
              1;
        }
      }

      function clearTimer() {
        if (state.timer) {
          root.clearInterval(
            state.timer
          );

          state.timer =
            null;
        }
      }

      function updateTimer() {
        const expiresAt =
          timestampToMillis(
            state.attempt?.expiresAt
          );

        const timerNode =
          byId(
            "exam-timer"
          );

        const submit =
          byId(
            "exam-submit"
          );

        if (!expiresAt) {
          if (timerNode) {
            timerNode.textContent =
              "--:--";
          }

          if (submit) {
            submit.disabled =
              true;
          }

          return;
        }

        const remaining =
          expiresAt -
          Date.now();

        if (timerNode) {
          timerNode.textContent =
            formatRemaining(
              remaining
            );
        }

        if (remaining <= 0) {
          clearTimer();

          if (submit) {
            submit.disabled =
              true;
          }

          setText(
            "exam-expiry-message",
            "O prazo desta tentativa terminou. Atualize seus exames para consultar o estado canônico."
          );
        }
      }

      function startTimer() {
        clearTimer();

        updateTimer();

        state.timer =
          root.setInterval(
            updateTimer,
            1000
          );
      }

      function renderAttempt(
        response
      ) {
        const attempt =
          response?.attempt;

        if (
          !attempt ||
          attempt.status !==
            "in_progress"
        ) {
          throw new Error(
            "Tentativa retornada em estado inválido."
          );
        }

        state.attempt =
          Object.freeze({
            ...attempt
          });

        state.questions =
          normalizeQuestions(
            response?.questions
          );

        state.answers =
          {};

        state.currentIndex =
          0;

        setText(
          "exam-expiry-message",
          ""
        );

        showOnly(
          "exam-active"
        );

        renderQuestion();
        startTimer();
      }

      async function startOrResume() {
        const button =
          byId(
            "exam-start-button"
          );

        if (button) {
          button.disabled =
            true;
        }

        try {
          const callable =
            await callableOptions();

          const response =
            state.item
              ?.canResumeExam
              ? await api
                  .resumeOfficialExam(
                    state.registrationId,
                    callable
                  )
              : await api
                  .startOfficialExam(
                    state.registrationId,
                    callable
                  );

          renderAttempt(
            response
          );

          return response;
        } catch (error) {
          if (button) {
            button.disabled =
              false;
          }

          renderError(
            error
          );

          throw error;
        }
      }

      async function submit() {
        if (
          state.submitting ||
          !state.attempt
        ) {
          return null;
        }

        const answers =
          buildAnswerPayload(
            state.questions,
            state.answers
          );

        const answered =
          Object.keys(
            answers
          ).length;

        if (
          answered <
            state.questions.length &&
          typeof root.confirm ===
            "function"
        ) {
          const missing =
            state.questions.length -
            answered;

          const confirmed =
            root.confirm(
              `Ainda faltam ${missing} questão(ões). Deseja enviar mesmo assim?`
            );

          if (!confirmed) {
            return null;
          }
        }

        state.submitting =
          true;

        const submitButton =
          byId(
            "exam-submit"
          );

        if (submitButton) {
          submitButton.disabled =
            true;
        }

        try {
          const callable =
            await callableOptions();

          const response =
            await api
              .finalizeOfficialExam(
                state.attempt
                  .attemptId,
                answers,
                callable
              );

          if (!response?.result) {
            throw new Error(
              "Resultado oficial não retornado."
            );
          }

          renderResult(
            response.result
          );

          return response;
        } catch (error) {
          renderError(
            error
          );

          throw error;
        } finally {
          state.submitting =
            false;
        }
      }

      async function load() {
        showOnly(
          "exam-loading"
        );

        try {
          const callable =
            await callableOptions();

          const items =
            await api.listMyExams(
              100,
              callable
            );

          state.item =
            items.find(
              item =>
                item.registrationId ===
                state.registrationId
            ) ||
            null;

          if (!state.item) {
            throw new Error(
              "Esta inscrição de exame não pertence ao usuário autenticado."
            );
          }

          if (
            state.item.result
          ) {
            renderResult(
              state.item.result
            );

            return state.item;
          }

          if (
            state.item.canStartExam !==
              true &&
            state.item.canResumeExam !==
              true
          ) {
            throw new Error(
              "Este exame ainda não está disponível para execução."
            );
          }

          renderReady();

          return state.item;
        } catch (error) {
          renderError(
            error
          );

          return null;
        }
      }

      function install() {
        byId(
          "exam-start-button"
        )?.addEventListener(
          "click",
          () => {
            startOrResume()
              .catch(
                error =>
                  root.console?.error?.(
                    "BJJ Exams official exam start:",
                    error
                  )
              );
          }
        );

        byId(
          "exam-previous"
        )?.addEventListener(
          "click",
          () => {
            if (
              state.currentIndex >
              0
            ) {
              state.currentIndex -=
                1;

              renderQuestion();
            }
          }
        );

        byId(
          "exam-next"
        )?.addEventListener(
          "click",
          () => {
            if (
              state.currentIndex <
              state.questions.length -
                1
            ) {
              state.currentIndex +=
                1;

              renderQuestion();
            }
          }
        );

        byId(
          "exam-submit"
        )?.addEventListener(
          "click",
          () => {
            submit()
              .catch(
                error =>
                  root.console?.error?.(
                    "BJJ Exams official exam submit:",
                    error
                  )
              );
          }
        );

        return true;
      }

      return Object.freeze({
        state,
        load,
        install,
        startOrResume,
        submit,
        renderQuestion
      });
    }

    let autoController =
      null;

    function autoInstall() {
      if (
        !root?.document ||
        !root?.location
      ) {
        return null;
      }

      const path =
        String(
          root.location.pathname ||
          ""
        ).toLowerCase();

      if (
        !path.endsWith(
          "/exame.html"
        ) &&
        !path.endsWith(
          "exame.html"
        )
      ) {
        return null;
      }

      const start = () => {
        if (autoController) {
          return autoController;
        }

        try {
          autoController =
            createController();

          autoController
            .install();

          root.__bjjOfficialExamControllerV12 =
            autoController;

          autoController
            .load()
            .catch(
              error =>
                root.console?.error?.(
                  "BJJ Exams official exam load:",
                  error
                )
            );

          return autoController;
        } catch (error) {
          root.console?.error?.(
            "BJJ Exams official exam bootstrap:",
            error
          );

          return null;
        }
      };

      if (
        root.document.readyState ===
          "complete"
      ) {
        return start();
      }

      root.addEventListener(
        "load",
        start,
        {
          once: true
        }
      );

      return null;
    }

    return Object.freeze({
      LABELS,
      parseRegistrationId,
      timestampToMillis,
      formatRemaining,
      normalizeQuestions,
      buildAnswerPayload,
      resultPercentage,
      createController,
      autoInstall
    });
  }
);