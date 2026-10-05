import React from "react";
import { createRoot } from "react-dom/client";

import { ContainerlabExplorerView } from "../../src/explorer/containerlabExplorerView.webview";
import type { ExplorerIncomingMessage } from "../../src/explorer/shared/explorer/types";
import { ClabUiRuntimeProvider, createClabUiRuntime, createWindowClabUiHost } from "../../src/host";
import { MuiThemeProvider } from "../../src/theme/MuiThemeProvider";
import { applyThemeVars } from "../../src/theme/devTheme";
import "../../src/styles/global.css";

import { buildExplorerFixture, FIXTURE_EXPANDED, type ExplorerFixtureMode } from "./explorerFixture";

const params = new URLSearchParams(location.search);
const mode = (params.get("mode") ?? "standalone") as ExplorerFixtureMode;
const theme = params.get("theme") === "light" ? "light" : "dark";
applyThemeVars(theme);
Object.assign(window, {
  __CLAB_APPEARANCE__: { colorScheme: theme, fontSize: 0, fontFamily: "", reduceMotion: false }
});

const subscribers = new Set<(message: ExplorerIncomingMessage) => void>();
const emit = (message: ExplorerIncomingMessage) => {
  for (const subscriber of subscribers) subscriber(message);
};

const host = createWindowClabUiHost({
  explorer: {
    connect() {
      emit({ command: "filterState", filterText: "" });
      emit({
        command: "uiState",
        state: { expandedBySection: { runningLabs: FIXTURE_EXPANDED, localLabs: FIXTURE_EXPANDED, fileExplorer: FIXTURE_EXPANDED } }
      });
      emit(buildExplorerFixture(mode));
    },
    setFilter() {},
    invokeAction() {},
    persistUiState() {},
    subscribe(handler) {
      subscribers.add(handler);
      return () => {
        subscribers.delete(handler);
      };
    }
  }
});
const runtime = createClabUiRuntime({ host });

const width = Number(params.get("width") ?? 300);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClabUiRuntimeProvider runtime={runtime}>
      <MuiThemeProvider>
        <div
          style={{
            width,
            height: "100%",
            borderRight: "1px solid var(--vscode-panel-border)",
            background: "var(--vscode-sideBar-background)"
          }}
        >
          <ContainerlabExplorerView visibleSectionIds={mode === "files" ? ["fileExplorer"] : undefined} />
        </div>
      </MuiThemeProvider>
    </ClabUiRuntimeProvider>
  </React.StrictMode>
);
