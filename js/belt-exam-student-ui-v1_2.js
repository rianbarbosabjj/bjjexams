"use strict";

(function initBeltExamStudentUi(root, factory) {
  const ui = factory(root);

  if (typeof module === "object" && module.exports) {
    module.exports = ui;
  }

  if (root) {
    root.BjjExamsBeltExamStudentUI = ui;
    ui.autoInstall();
  }
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function buildBeltExamStudentUi(root) {
    const STATE_META = Object.freeze({
      selected: Object.freeze({
        label: "Selecionado para exame",
        description: "Sua inscrição foi criada. Gere o PIX individual para confirmar a autorização.",
        className: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30"
      }),
      payment_pending: Object.freeze({
        label: "Aguardando pagamento",
        description: "Existe uma cobrança PIX pendente. Você pode recuperar a cobrança sem criar outra.",
        className: "bg-amber-500/10 text-amber-300 border-amber-500/30"
      }),
      authorized: Object.freeze({
        label: "Pagamento confirmado",
        description: "Seu exame está autorizado financeiramente. A execução da prova será liberada no Marco 6.",
        className: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
      }),
      cancelled: Object.freeze({
        label: "Autorização encerrada",
        description: "Esta inscrição não possui autorização ativa para realizar o exame.",
        className: "bg-slate-700/50 text-slate-300 border-slate-600"
      }),
      needs_reconciliation: Object.freeze({
        label: "Em revisão",
        description: "O estado financeiro precisa de revisão antes de qualquer nova ação.",
        className: "bg-rose-500/10 text-rose-300 border-rose-500/30"
      }),
      started_or_later: Object.freeze({
        label: "Histórico acadêmico existente",
        description: "Existe atividade acadêmica registrada. O histórico permanece preservado.",
        className: "bg-violet-500/10 text-violet-300 border-violet-500/30"
      })
    });

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

    function formatDate(value) {
      if (!value) return "Data a definir";
      let date;
      if (value instanceof Date) date = value;
      else if (typeof value?.toDate === "function") date = value.toDate();
      else if (Number.isFinite(value?.seconds)) date = new Date(value.seconds * 1000);
      else date = new Date(value);
      if (Number.isNaN(date.getTime())) return "Data a definir";
      return new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short"
      }).format(date);
    }

    function canonicalExamUrl(registrationIdInput) {
      const registrationId = String(registrationIdInput || "").trim();

      if (
        !registrationId ||
        registrationId.includes("/") ||
        registrationId.length > 200
      ) {
        return null;
      }

      return `exame.html?registrationId=${encodeURIComponent(registrationId)}`;
    }

    function canonicalCertificateUrl(
      certificateIdInput
    ) {
      const certificateId =
        String(
          certificateIdInput ||
          ""
        ).trim().toLowerCase();

      if (
        !/^[a-f0-9]{64}$/.test(
          certificateId
        )
      ) {
        return null;
      }

      return (
        `validar.html?cert=` +
        encodeURIComponent(
          certificateId
        )
      );
    }
    function examCardView(item = {}) {
      const state = String(item.state || "");
      const examState = String(item.examState || "");
      const meta = STATE_META[state] || {
        label: "Situação em análise",
        description: "Atualize a página em alguns instantes.",
        className: "bg-slate-800 text-slate-400 border-slate-700"
      };

      const registrationId = String(item.registrationId || "").trim();
      const examUrl = canonicalExamUrl(registrationId);

      const canStartOfficialExam =
        state === "authorized" &&
        examState === "not_started" &&
        item.canStartExam === true &&
        examUrl !== null;

      const canResumeOfficialExam =
        state === "started_or_later" &&
        examState === "in_progress" &&
        item.canResumeExam === true &&
        examUrl !== null;

      const hasAcademicResult =
        state === "started_or_later" &&
        item.result !== null &&
        item.result !== undefined &&
        typeof item.result === "object" &&
        !Array.isArray(item.result) &&
        examUrl !== null;

      const certificate =
        item.certificate &&
        typeof item.certificate ===
          "object" &&
        !Array.isArray(
          item.certificate
        )
          ? item.certificate
          : null;

      const certificateId =
        String(
          certificate?.certificateId ||
          ""
        ).trim();

      const certificateUrl =
        canonicalCertificateUrl(
          certificateId
        );

      const hasCertificate =
        examState === "certified" &&
        certificate !== null &&
        certificateUrl !== null;

      const canIssueCertificate =
        state ===
          "started_or_later" &&
        examState ===
          "passed" &&
        hasAcademicResult &&
        item.result?.status ===
          "passed" &&
        item.result
          ?.certificateEligible ===
          true &&
        certificate === null;
      const hasAcademicSignal =
        item.canStartExam === true ||
        item.canResumeExam === true ||
        (
          item.result !== null &&
          item.result !== undefined
        ) ||
        certificate !== null;

      let action = null;

      if (item.canStartCheckout === true) {
        action = "start_payment";
      } else if (item.canResumePayment === true) {
        action = "resume_payment";
      } else if (hasCertificate) {
        action = "view_certificate";
      } else if (canIssueCertificate) {
        action = "issue_certificate";
      } else if (hasAcademicResult) {
        action = "view_result";
      } else if (canResumeOfficialExam) {
        action = "resume_exam";
      } else if (canStartOfficialExam) {
        action = "start_exam";
      } else if (hasAcademicSignal) {
        action = "academic_unavailable";
      } else if (state === "authorized") {
        action = "authorized_wait";
      }

      let statusLabel = meta.label;
      let description = meta.description;
      let badgeClass = meta.className;

      if (action === "issue_certificate") {
        statusLabel =
          "Aprovado · certificado disponível";
        description =
          "Seu resultado foi aprovado. Emita agora o certificado oficial vinculado a este resultado.";
        badgeClass =
          "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
      } else if (action === "view_certificate") {
        if (
          certificate?.status ===
            "revoked"
        ) {
          statusLabel =
            "Certificado revogado";
          description =
            "O certificado permanece verificável, mas sua validade administrativa foi revogada.";
          badgeClass =
            "bg-rose-500/10 text-rose-300 border-rose-500/30";
        } else {
          statusLabel =
            "Certificado emitido";
          description =
            "Seu certificado oficial foi emitido e pode ser validado pelo código de autenticidade.";
          badgeClass =
            "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
        }
      } else if (action === "start_exam") {
        statusLabel = "Prova liberada";
        description =
          "Seu pagamento foi confirmado e a prova oficial está liberada. O cronômetro só começa depois da confirmação dentro da sala de prova.";
        badgeClass =
          "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
      } else if (action === "resume_exam") {
        statusLabel = "Prova em andamento";
        description =
          "Existe uma tentativa oficial em andamento. Retomar a prova não reinicia nem estende o prazo original.";
        badgeClass =
          "bg-cyan-500/10 text-cyan-300 border-cyan-500/30";
      } else if (action === "view_result") {
        statusLabel = "Resultado disponível";
        description =
          "O resultado acadêmico oficial já está disponível para consulta.";
        badgeClass =
          "bg-violet-500/10 text-violet-300 border-violet-500/30";
      } else if (action === "authorized_wait") {
        description =
          "Seu pagamento foi confirmado, mas a prova ainda não está liberada para execução. Atualize esta área posteriormente.";
      } else if (action === "academic_unavailable") {
        statusLabel = "Execução indisponível";
        description =
          "O estado acadêmico recebido não permite abrir a sala de prova com segurança. Atualize a página antes de tentar novamente.";
        badgeClass =
          "bg-rose-500/10 text-rose-300 border-rose-500/30";
      }

      return Object.freeze({
        registrationId,
        sessionId: String(item.sessionId || ""),
        organizationName: String(item.organization?.name || "Academia"),
        currentBelt: String(item.currentBelt || "-"),
        targetBelt: String(item.targetBelt || "-"),
        scheduledAt: item.scheduledAt || null,
        amountLabel: formatCurrency(item.price?.amountCents, item.price?.currency),
        state,
        examState,
        statusLabel,
        description,
        badgeClass,
        action,
        examUrl,
        canStartExam: canStartOfficialExam,
        canResumeExam: canResumeOfficialExam,
        hasResult: hasAcademicResult,
        canIssueCertificate,
        certificateId:
          hasCertificate
            ? certificateId
            : null,
        certificateStatus:
          hasCertificate
            ? String(
                certificate?.status ||
                ""
              )
            : null,
        certificateUrl:
          hasCertificate
            ? certificateUrl
            : null,
        resultStatus: hasAcademicResult
          ? String(item.result?.status || "")
          : null
      });
    }

    function normalizeError(error) {
      const status = String(error?.callableStatus || "").toUpperCase().replace(/-/g, "_");
      const domainCode = String(error?.domainCode || "").toUpperCase();
      if (error?.code === "BELT_EXAM_STAGING_ONLY") {
        return "Exames individuais v1.2 estão disponíveis somente no ambiente de staging.";
      }
      if (status === "UNAUTHENTICATED" || Number(error?.httpStatus) === 401) {
        return "Sua sessão expirou. Faça login novamente.";
      }
      if (status === "PERMISSION_DENIED" || Number(error?.httpStatus) === 403) {
        return "Seu vínculo não permite esta operação.";
      }
      if (
        status === "FAILED_PRECONDITION" ||
        domainCode.includes("NOT_RESUMABLE") ||
        domainCode.includes("ACTIVE_ORDER_CONFLICT")
      ) {
        return error?.message || "A cobrança não pode ser alterada neste estado.";
      }
      return error?.message || "Não foi possível concluir a operação agora.";
    }

    function textElement(document, tag, text, className = "") {
      const element = document.createElement(tag);
      element.textContent = text == null ? "" : String(text);
      if (className) element.className = className;
      return element;
    }

    function newIntentKey() {
      if (root?.crypto?.randomUUID) return `belt-exam-${root.crypto.randomUUID()}`;
      return `belt-exam-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      const location = options.location || root?.location;
      const hostname = options.hostname ?? location?.hostname ?? "";
      if (!api) throw new Error("Cliente canônico de exames não configurado.");
      if (!document) throw new Error("Documento indisponível para a interface de exames.");

      const state = {
        items: [],
        installed: false,
        originalTabSwitch: null,
        actionSessionId: null,
        actionRegistrationId: null
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
        if (!auth.currentUser) throw new Error("Faça login novamente para consultar seus exames.");
        return {
          hostname,
          getIdToken: () => auth.currentUser.getIdToken()
        };
      }

      function examTab() {
        return document.getElementById("sala-exame");
      }

      function canonicalContainer() {
        return document.getElementById("belt-exam-v12-student");
      }

      function legacyContainers() {
        return [
          document.getElementById("exame-bloqueado-container"),
          document.getElementById("pre-exame-container"),
          document.getElementById("prova-ativa-container")
        ].filter(Boolean);
      }

      function setCanonicalMode(active) {
        const canonical = canonicalContainer();
        if (canonical) canonical.classList.toggle("hidden", !active);
        for (const node of legacyContainers()) {
          if (active) node.style.display = "none";
          else node.style.removeProperty("display");
        }
        root.__BJJ_EXAMS_BELT_EXAM_CANONICAL_STUDENT_V12__ = active === true;
      }

      function buildShell() {
        const tab = examTab();
        if (!tab) return false;
        if (canonicalContainer()) return true;
        const section = document.createElement("section");
        section.id = "belt-exam-v12-student";
        section.className = "hidden space-y-6";

        const header = document.createElement("div");
        header.className = "bg-cardbg border border-slate-700 rounded-3xl p-6 sm:p-8 shadow-xl";
        const row = document.createElement("div");
        row.className = "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4";
        const copy = document.createElement("div");
        copy.append(
          textElement(document, "p", "Exames oficiais · v1.2", "text-[10px] text-neon uppercase tracking-[0.2em] font-black"),
          textElement(document, "h2", "Meus exames de faixa", "text-2xl font-black text-white mt-2"),
          textElement(document, "p", "Acompanhe seleção, pagamento e execução do seu exame oficial. Quando o backend liberar a prova, você poderá iniciar ou retomar a tentativa por esta área.", "text-sm text-slate-400 mt-2 max-w-3xl")
        );
        const refresh = textElement(document, "button", "Atualizar", "px-5 py-3 rounded-xl border border-slate-700 text-slate-300 text-xs font-black uppercase tracking-widest hover:border-neon hover:text-neon");
        refresh.type = "button";
        refresh.addEventListener("click", () => load().catch(showError));
        row.append(copy, refresh);
        header.appendChild(row);

        const grid = document.createElement("div");
        grid.id = "belt-exam-v12-student-grid";
        grid.className = "grid grid-cols-1 lg:grid-cols-2 gap-5";
        section.append(header, grid);
        tab.insertBefore(section, tab.firstChild);
        return true;
      }

      function renderLoading() {
        const grid = document.getElementById("belt-exam-v12-student-grid");
        if (!grid) return;
        grid.innerHTML = "";
        grid.appendChild(textElement(document, "div", "Carregando inscrições canônicas...", "col-span-full text-center py-10 text-sm text-slate-400"));
      }

      function actionButton(label, onClick, disabled = false) {
        const button = textElement(document, "button", label, disabled
          ? "w-full px-4 py-3 rounded-xl bg-slate-800 text-slate-500 text-xs font-black uppercase tracking-widest cursor-not-allowed"
          : "w-full px-4 py-3 rounded-xl bg-neon text-slate-950 text-xs font-black uppercase tracking-widest hover:bg-white transition");
        button.type = "button";
        button.disabled = disabled;
        if (!disabled) button.addEventListener("click", onClick);
        return button;
      }

      function openOfficialExam(registrationIdInput) {
        const registrationId = String(registrationIdInput || "").trim();
        const examUrl = canonicalExamUrl(registrationId);

        if (!examUrl) {
          throw new Error("Inscrição acadêmica inválida.");
        }

        const item = state.items.find(candidate =>
          String(candidate?.registrationId || "").trim() === registrationId
        );

        const view = item
          ? examCardView(item)
          : null;

        if (
          !view ||
          (
            !["start_exam", "resume_exam", "view_result"].includes(view.action) &&
            view.hasResult !== true
          ) ||
          view.examUrl !== examUrl
        ) {
          throw new Error(
            "Esta inscrição não possui uma ação acadêmica disponível."
          );
        }

        if (
          !location ||
          typeof location.assign !== "function"
        ) {
          throw new Error(
            "Navegação para a sala de prova indisponível."
          );
        }

        location.assign(examUrl);

        return examUrl;
      }

      function openCertificate(
        certificateIdInput
      ) {
        const certificateId =
          String(
            certificateIdInput ||
            ""
          ).trim().toLowerCase();

        const certificateUrl =
          canonicalCertificateUrl(
            certificateId
          );

        if (!certificateUrl) {
          throw new Error(
            "Certificado canônico inválido."
          );
        }

        const item =
          state.items.find(
            candidate =>
              String(
                candidate
                  ?.certificate
                  ?.certificateId ||
                ""
              )
                .trim()
                .toLowerCase() ===
              certificateId
          );

        const view =
          item
            ? examCardView(item)
            : null;

        if (
          !view ||
          view.action !==
            "view_certificate" ||
          view.certificateUrl !==
            certificateUrl
        ) {
          throw new Error(
            "Este certificado não está disponível para validação."
          );
        }

        if (
          !location ||
          typeof location.assign !==
            "function"
        ) {
          throw new Error(
            "Navegação para a validação indisponível."
          );
        }

        location.assign(
          certificateUrl
        );

        return certificateUrl;
      }
      function renderItems() {
        const grid = document.getElementById("belt-exam-v12-student-grid");
        if (!grid) return;
        grid.innerHTML = "";
        if (!state.items.length) return;

        for (const item of state.items) {
          const view = examCardView(item);
          const card = document.createElement("article");
          card.className = "bg-cardbg border border-slate-700 rounded-2xl p-6 flex flex-col gap-5 shadow-lg";
          card.dataset.sessionId = view.sessionId;
          card.appendChild(textElement(document, "span", view.statusLabel, `inline-flex w-max px-3 py-1 rounded-full border text-[9px] font-black uppercase tracking-widest ${view.badgeClass}`));
          const body = document.createElement("div");
          body.append(
            textElement(document, "h3", `Exame para faixa ${view.targetBelt}`, "text-xl font-black text-white"),
            textElement(document, "p", `${view.organizationName} · ${view.currentBelt} → ${view.targetBelt}`, "text-xs text-slate-400 mt-2"),
            textElement(document, "p", view.amountLabel, "text-2xl font-black text-neon mt-4"),
            textElement(document, "p", `Data prevista: ${formatDate(view.scheduledAt)}`, "text-xs text-slate-500 mt-1"),
            textElement(document, "p", view.description, "text-sm text-slate-300 mt-4 leading-relaxed")
          );
          card.appendChild(body);

          if (view.action === "start_payment") {
            card.appendChild(actionButton("Gerar PIX", () => startPayment(view.sessionId).catch(showError), state.actionSessionId === view.sessionId));
          } else if (view.action === "resume_payment") {
            card.appendChild(actionButton("Recuperar PIX pendente", () => resumePayment(view.sessionId).catch(showError), state.actionSessionId === view.sessionId));
          } else if (view.action === "start_exam") {
            card.appendChild(actionButton("Iniciar prova oficial", () => {
              try {
                openOfficialExam(view.registrationId);
              } catch (error) {
                void showError(error);
              }
            }));
          } else if (view.action === "resume_exam") {
            card.appendChild(actionButton("Retomar prova oficial", () => {
              try {
                openOfficialExam(view.registrationId);
              } catch (error) {
                void showError(error);
              }
            }));
          } else if (
            view.action ===
              "issue_certificate"
          ) {
            card.appendChild(
              actionButton(
                "Emitir certificado oficial",
                () =>
                  issueCertificate(
                    view.registrationId
                  ).catch(
                    showError
                  ),
                state.actionRegistrationId ===
                  view.registrationId
              )
            );

            if (view.hasResult) {
              card.appendChild(
                actionButton(
                  "Ver resultado oficial",
                  () => {
                    try {
                      openOfficialExam(
                        view.registrationId
                      );
                    } catch (error) {
                      void showError(
                        error
                      );
                    }
                  }
                )
              );
            }
          } else if (
            view.action ===
              "view_certificate"
          ) {
            card.appendChild(
              actionButton(
                view.certificateStatus ===
                  "revoked"
                  ? "Consultar certificado revogado"
                  : "Validar certificado oficial",
                () => {
                  try {
                    openCertificate(
                      view.certificateId
                    );
                  } catch (error) {
                    void showError(
                      error
                    );
                  }
                }
              )
            );

            if (view.hasResult) {
              card.appendChild(
                actionButton(
                  "Ver resultado oficial",
                  () => {
                    try {
                      openOfficialExam(
                        view.registrationId
                      );
                    } catch (error) {
                      void showError(
                        error
                      );
                    }
                  }
                )
              );
            }          } else if (view.action === "view_result") {
            card.appendChild(actionButton("Ver resultado oficial", () => {
              try {
                openOfficialExam(view.registrationId);
              } catch (error) {
                void showError(error);
              }
            }));
          } else if (view.action === "authorized_wait") {
            card.appendChild(actionButton("Pagamento confirmado · aguardando liberação", () => {}, true));
          } else if (view.action === "academic_unavailable") {
            card.appendChild(actionButton("Execução indisponível", () => {}, true));
          } else if (view.state === "needs_reconciliation") {
            card.appendChild(actionButton("Aguardando revisão", () => {}, true));
          }
          grid.appendChild(card);
        }
      }

      async function showError(error) {
        if (root?.console?.error) root.console.error("BJJ Exams belt_exam student:", error);
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

      async function showPix(result) {
        const pix = result?.pix || {};
        const payload = String(pix.payload || "").trim();
        const encodedImage = String(pix.encodedImage || "").trim();
        if (!root?.Swal) return;

        const wrapper = document.createElement("div");
        wrapper.className = "text-center";
        if (encodedImage) {
          const image = document.createElement("img");
          image.src = encodedImage.startsWith("data:")
            ? encodedImage
            : `data:image/png;base64,${encodedImage}`;
          image.alt = "QR Code PIX";
          image.className = "w-56 h-56 object-contain mx-auto bg-white p-3 rounded-2xl";
          wrapper.appendChild(image);
        }
        wrapper.appendChild(textElement(document, "p", "O pagamento só autoriza o exame depois da confirmação server-side do Asaas.", "text-xs text-slate-400 mt-4"));
        if (payload) {
          const textarea = document.createElement("textarea");
          textarea.value = payload;
          textarea.readOnly = true;
          textarea.className = "w-full mt-4 p-3 rounded-xl bg-slate-900 border border-slate-700 text-xs text-slate-300 break-all";
          textarea.rows = 4;
          wrapper.appendChild(textarea);
          const copy = textElement(document, "button", "Copiar PIX", "mt-3 px-5 py-3 rounded-xl bg-neon text-slate-950 text-xs font-black uppercase tracking-widest");
          copy.type = "button";
          copy.addEventListener("click", async () => {
            try {
              await root.navigator?.clipboard?.writeText(payload);
              copy.textContent = "PIX copiado";
            } catch (_) {
              textarea.focus();
              textarea.select();
            }
          });
          wrapper.appendChild(copy);
        }

        await root.Swal.fire({
          background: "var(--bg-card)",
          color: "var(--text-main)",
          title: result?.processing ? "Cobrança em processamento" : "PIX do exame",
          html: wrapper,
          confirmButtonText: "Fechar",
          confirmButtonColor: "var(--brand-color)"
        });
      }

      async function issueCertificate(
        registrationId
      ) {
        state.actionRegistrationId =
          registrationId;

        renderItems();

        try {
          const options =
            await callableOptions();

          await api.issueCertificate(
            registrationId,
            options
          );

          return await load();
        } finally {
          state.actionRegistrationId =
            null;

          renderItems();
        }
      }
      async function startPayment(sessionId) {
        state.actionSessionId = sessionId;
        renderItems();
        try {
          const options = await callableOptions();
          const result = await api.startCheckout(sessionId, newIntentKey(), options);
          await showPix(result);
          return await load();
        } finally {
          state.actionSessionId = null;
          renderItems();
        }
      }

      async function resumePayment(sessionId) {
        state.actionSessionId = sessionId;
        renderItems();
        try {
          const options = await callableOptions();
          const result = await api.resumeCheckout(sessionId, options);
          await showPix(result);
          return await load();
        } finally {
          state.actionSessionId = null;
          renderItems();
        }
      }

      async function load() {
        buildShell();
        renderLoading();
        try {
          const options = await callableOptions();
          state.items = await api.listMyExams(50, options);
          if (!state.items.length) {
            setCanonicalMode(false);
            return [];
          }
          setCanonicalMode(true);
          renderItems();
          return state.items;
        } catch (error) {
          setCanonicalMode(true);
          const grid = document.getElementById("belt-exam-v12-student-grid");
          if (grid) {
            grid.innerHTML = "";
            grid.appendChild(textElement(document, "div", normalizeError(error), "col-span-full border border-rose-500/30 bg-rose-500/10 rounded-2xl p-6 text-sm text-rose-200"));
          }
          return [];
        }
      }

      function installTabInterceptor() {
        if (state.originalTabSwitch || typeof root.mudarAba !== "function") return false;
        state.originalTabSwitch = root.mudarAba;
        root.mudarAba = function beltExamStudentTabSwitch(evt, tabName) {
          const result = state.originalTabSwitch.call(this, evt, tabName);
          if (tabName === "sala-exame") load().catch(showError);
          return result;
        };
        return true;
      }

      function install() {
        if (state.installed) return true;
        if (!buildShell()) return false;
        state.installed = true;
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
        startPayment,
        resumePayment,
        issueCertificate,
        openOfficialExam,
        openCertificate,
        setCanonicalMode
      });
    }

    let autoController = null;
    function autoInstall() {
      if (!root?.document || !root?.location) return null;
      const path = String(root.location.pathname || "").toLowerCase();
      if (!path.endsWith("/painel_aluno.html") && !path.endsWith("painel_aluno.html")) return null;
      const start = () => {
        if (autoController) return autoController;
        try {
          autoController = createController();
          autoController.install();
          root.__bjjBeltExamStudentControllerV12 = autoController;
          return autoController;
        } catch (error) {
          root.console?.error?.("BJJ Exams belt_exam student bootstrap:", error);
          return null;
        }
      };
      if (root.document.readyState === "complete") return start();
      root.addEventListener("load", start, { once: true });
      return null;
    }

    return Object.freeze({
      STATE_META,
      formatCurrency,
      formatDate,
      canonicalExamUrl,
      canonicalCertificateUrl,
      examCardView,
      normalizeError,
      newIntentKey,
      createController,
      autoInstall
    });
  }
);
