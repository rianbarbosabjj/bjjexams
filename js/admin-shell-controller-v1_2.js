"use strict";

(function initAdminShellController(root, factory) {
  const api = factory(root);

  if (
    typeof module === "object" &&
    module.exports
  ) {
    module.exports = api;
  }

  if (root) {
    root.BjjExamsAdminShellController = api;
  }
})(
  typeof globalThis !== "undefined"
    ? globalThis
    : this,

  function buildAdminShellController(root) {
    const SHELL_STATES =
      Object.freeze({
        loading: "loading",
        ready: "ready",
        denied: "denied",
        error: "error"
      });

    function freezeViewModel(
      value
    ) {
      return Object.freeze(
        value
      );
    }

    function loadingViewModel() {
      return freezeViewModel({
        state:
          SHELL_STATES.loading,

        title:
          "Carregando ambiente administrativo",

        message:
          "Validando autenticacao e permissoes."
      });
    }

    function deniedViewModel(
      message =
        "Sua conta nao possui acesso administrativo disponivel."
    ) {
      return freezeViewModel({
        state:
          SHELL_STATES.denied,

        title:
          "Acesso administrativo indisponivel",

        message
      });
    }

    function errorViewModel(
      message =
        "Nao foi possivel carregar o ambiente administrativo."
    ) {
      return freezeViewModel({
        state:
          SHELL_STATES.error,

        title:
          "Falha ao carregar o ambiente",

        message
      });
    }

    function findRoute(
      sections,
      route
    ) {
      for (
        const section of
        sections
      ) {
        const item =
          section.items.find(
            candidate =>
              candidate.route ===
              route
          );

        if (item) {
          return {
            sectionId:
              section.id,

            sectionLabel:
              section.label,

            item
          };
        }
      }

      return null;
    }

    function readyViewModel(
      context,
      navigationApi,
      requestedRoute = null
    ) {
      if (
        !navigationApi ||
        typeof navigationApi.buildNavigation !==
          "function" ||
        typeof navigationApi.canNavigateTo !==
          "function" ||
        typeof navigationApi.firstAllowedRoute !==
          "function"
      ) {
        throw new TypeError(
          "Navigation API invalida."
        );
      }

      const sections =
        navigationApi
          .buildNavigation(
            context
          );

      if (
        !Array.isArray(
          sections
        ) ||
        sections.length === 0
      ) {
        return deniedViewModel();
      }

      const requested =
        String(
          requestedRoute || ""
        ).trim();

      const activeRoute =
        requested &&
        navigationApi.canNavigateTo(
          context,
          requested
        )
          ? requested
          : navigationApi
              .firstAllowedRoute(
                context
              );

      if (!activeRoute) {
        return deniedViewModel();
      }

      const active =
        findRoute(
          sections,
          activeRoute
        );

      if (!active) {
        return deniedViewModel();
      }

      return freezeViewModel({
        state:
          SHELL_STATES.ready,

        user:
          freezeViewModel({
            id:
              String(
                context.userId ||
                ""
              ),

            displayName:
              String(
                context.displayName ||
                "Administrador"
              )
          }),

        environment:
          String(
            context.environment ||
            ""
          ),

        sections,

        activeRoute,

        activeLabel:
          active.item.label,

        activeSectionId:
          active.sectionId,

        activeSectionLabel:
          active.sectionLabel
      });
    }

    function setVisible(
      element,
      visible
    ) {
      if (!element) {
        return;
      }

      element.hidden =
        !visible;
    }

    function text(
      element,
      value
    ) {
      if (!element) {
        return;
      }

      element.textContent =
        String(value ?? "");
    }

    function createController(
      options = {}
    ) {
      const document =
        options.document ||
        root?.document;

      const navigationApi =
        options.navigationApi ||
        root?.BjjExamsAdminShellNavigation;

      if (
        !document ||
        typeof document.querySelector !==
          "function" ||
        typeof document.createElement !==
          "function"
      ) {
        throw new TypeError(
          "Document invalido."
        );
      }

      if (
        !navigationApi ||
        typeof navigationApi.buildNavigation !==
          "function"
      ) {
        throw new TypeError(
          "Navigation API indisponivel."
        );
      }

      const elements = {
        root:
          document.querySelector(
            "[data-admin-shell-root]"
          ),

        loading:
          document.querySelector(
            "[data-admin-state-loading]"
          ),

        denied:
          document.querySelector(
            "[data-admin-state-denied]"
          ),

        error:
          document.querySelector(
            "[data-admin-state-error]"
          ),

        errorMessage:
          document.querySelector(
            "[data-admin-error-message]"
          ),

        ready:
          document.querySelector(
            "[data-admin-state-ready]"
          ),

        navigation:
          document.querySelector(
            "[data-admin-navigation]"
          ),

        userName:
          document.querySelector(
            "[data-admin-user-name]"
          ),

        environment:
          document.querySelector(
            "[data-admin-environment]"
          ),

        routeTitle:
          document.querySelector(
            "[data-admin-route-title]"
          ),

        routeSection:
          document.querySelector(
            "[data-admin-route-section]"
          ),

        routePlaceholder:
          document.querySelector(
            "[data-admin-route-placeholder]"
          )
      };

      if (
        !elements.root ||
        !elements.loading ||
        !elements.denied ||
        !elements.error ||
        !elements.ready ||
        !elements.navigation
      ) {
        throw new Error(
          "Estrutura HTML do shell administrativo incompleta."
        );
      }

      let currentContext =
        null;

      let currentViewModel =
        loadingViewModel();

      function renderNavigation(
        viewModel
      ) {
        elements.navigation
          .replaceChildren();

        for (
          const section of
          viewModel.sections
        ) {
          const sectionNode =
            document.createElement(
              "section"
            );

          sectionNode.className =
            "shell-nav-section";

          sectionNode.dataset
            .section =
            section.id;

          const heading =
            document.createElement(
              "p"
            );

          heading.className =
            "shell-nav-heading";

          heading.textContent =
            section.label;

          sectionNode.appendChild(
            heading
          );

          for (
            const item of
            section.items
          ) {
            const button =
              document.createElement(
                "button"
              );

            button.type =
              "button";

            button.className =
              "shell-nav-item";

            button.dataset.route =
              item.route;

            button.textContent =
              item.label;

            if (
              item.route ===
              viewModel.activeRoute
            ) {
              button.classList.add(
                "is-active"
              );

              button.setAttribute(
                "aria-current",
                "page"
              );
            }

            button.addEventListener(
              "click",
              () => {
                navigate(
                  item.route
                );
              }
            );

            sectionNode.appendChild(
              button
            );
          }

          elements.navigation
            .appendChild(
              sectionNode
            );
        }
      }

      function render(
        viewModel
      ) {
        currentViewModel =
          viewModel;

        elements.root.dataset
          .state =
          viewModel.state;

        setVisible(
          elements.loading,
          viewModel.state ===
            SHELL_STATES.loading
        );

        setVisible(
          elements.denied,
          viewModel.state ===
            SHELL_STATES.denied
        );

        setVisible(
          elements.error,
          viewModel.state ===
            SHELL_STATES.error
        );

        setVisible(
          elements.ready,
          viewModel.state ===
            SHELL_STATES.ready
        );

        if (
          viewModel.state ===
          SHELL_STATES.error
        ) {
          text(
            elements.errorMessage,
            viewModel.message
          );
        }

        if (
          viewModel.state !==
          SHELL_STATES.ready
        ) {
          elements.navigation
            .replaceChildren();

          return viewModel;
        }

        text(
          elements.userName,
          viewModel
            .user
            .displayName
        );

        text(
          elements.environment,
          viewModel.environment
        );

        text(
          elements.routeTitle,
          viewModel.activeLabel
        );

        text(
          elements.routeSection,
          viewModel.activeSectionLabel
        );

        text(
          elements.routePlaceholder,
          `${viewModel.activeLabel}: superficie preparada. ` +
          "Os dados e comandos deste dominio serao adicionados " +
          "nos proximos gates."
        );

        renderNavigation(
          viewModel
        );

        return viewModel;
      }

      function showLoading() {
        currentContext =
          null;

        return render(
          loadingViewModel()
        );
      }

      function showDenied(
        message
      ) {
        currentContext =
          null;

        return render(
          deniedViewModel(
            message
          )
        );
      }

      function showError(
        message
      ) {
        currentContext =
          null;

        return render(
          errorViewModel(
            message
          )
        );
      }

      function mountContext(
        context,
        requestedRoute = null
      ) {
        currentContext =
          context;

        return render(
          readyViewModel(
            context,
            navigationApi,
            requestedRoute
          )
        );
      }

      function navigate(
        route
      ) {
        if (!currentContext) {
          return false;
        }

        if (
          !navigationApi
            .canNavigateTo(
              currentContext,
              route
            )
        ) {
          return false;
        }

        render(
          readyViewModel(
            currentContext,
            navigationApi,
            route
          )
        );

        return true;
      }

      function getState() {
        return currentViewModel;
      }

      return Object.freeze({
        showLoading,
        showDenied,
        showError,
        mountContext,
        navigate,
        getState
      });
    }

    return Object.freeze({
      SHELL_STATES,
      loadingViewModel,
      deniedViewModel,
      errorViewModel,
      readyViewModel,
      createController
    });
  }
);
