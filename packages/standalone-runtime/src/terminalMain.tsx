import { WorkspaceHostProvider } from "@containerlab/clab-ui/workspace";
import {
  applyStandaloneAppearance,
  loadTerminalPreferences,
  persistTerminalPreferences,
  runtimeUiActions,
  useRuntimeUiStore,
  type RuntimeTerminalPane,
  type TerminalPreferences,
  watchStandaloneAppearance
} from "@containerlab/clab-ui/workspace/state";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MuiThemeProvider } from "@containerlab/clab-ui/theme";

import { installDesktopChrome } from "./desktopChrome";
import { workspaceHost } from "./workspaceHost";
import { DetachedTerminalView } from "./components/RuntimeTerminalWindows";
import { detachedTerminalTargetFromLocation } from "./runtimeDetachedTerminal";

function terminalPaneById(panes: RuntimeTerminalPane[], paneId: string | null): RuntimeTerminalPane | undefined {
  return (paneId ? panes.find((pane) => pane.id === paneId) : undefined) ?? panes[0];
}

function DetachedTerminalApp() {
  const [target] = useState(() => detachedTerminalTargetFromLocation());
  const [terminalPreferences, setTerminalPreferences] =
    useState<TerminalPreferences>(() => loadTerminalPreferences());
  const openedPaneIdRef = useRef<string | null>(null);
  const groups = useRuntimeUiStore((state) => state.terminals);
  const panes = groups.flatMap((group) => group.panes);
  const pane = terminalPaneById(panes, openedPaneIdRef.current);

  useEffect(() => {
    if (!target || openedPaneIdRef.current !== null) {
      return;
    }
    document.title = target.title;
    openedPaneIdRef.current = runtimeUiActions.openTerminal(target);
  }, [target]);

  const handleSaveTerminalPreferences = useCallback(
    (
      next: TerminalPreferences,
      _options?: {
        notify?: boolean;
      }
    ) => {
      setTerminalPreferences(persistTerminalPreferences(next));
    },
    []
  );

  let message = "Opening terminal...";
  if (!target) {
    message = "Missing or invalid terminal target.";
  } else if (openedPaneIdRef.current) {
    message = "Terminal closed.";
  }

  return (
    <DetachedTerminalView
      pane={pane}
      message={message}
      onSaveTerminalPreferences={handleSaveTerminalPreferences}
      terminalPreferences={terminalPreferences}
    />
  );
}

function main(): void {
  applyStandaloneAppearance();
  watchStandaloneAppearance(() => applyStandaloneAppearance());
  installDesktopChrome();

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element not found");
  }

  createRoot(rootElement).render(
    <MuiThemeProvider>
      <WorkspaceHostProvider host={workspaceHost}>
        <DetachedTerminalApp />
      </WorkspaceHostProvider>
    </MuiThemeProvider>
  );
}

main();
