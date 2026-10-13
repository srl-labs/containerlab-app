import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "../../src/App";
import { defaultSchemaData } from "../../src/core/schema";
import type { CustomIconInfo } from "../../src/core/types/icons";
import { isDevExplorerDisabledByUrl } from "../../src/hooks/app/useDevExplorerPane";
import { createClabUiRuntime } from "../../src/host";
import { applyThemeVars } from "../../src/theme";
import { WorkspaceHostProvider, WorkspaceSidebar } from "../../src/workspace";
import { applyStandaloneAppearance, readStandaloneAppearance } from "../../src/workspace/state/themePreferences";
import "../../src/styles/global.css";

import type { HarnessDevApi } from "./devApi";
import { createFakeClabUiHost } from "./fakeHost";
import { HARNESS_HOST_LAYOUTS } from "./harnessExplorer";
import { createHarnessWorkspaceHost } from "./harnessWorkspaceHost";

type HarnessWindow = Window & {
  __DEV__?: HarnessDevApi;
  __INITIAL_DATA__?: Record<string, unknown>;
};
type ColorScheme = "light" | "dark";

const harnessWindow = window as HarnessWindow;
const params = new URLSearchParams(window.location.search);
// ?host=web|sandbox|vscode picks whose explorer surrounds the editor; ?devExplorer=0 keeps the bare editor.
const hostLayout = HARNESS_HOST_LAYOUTS.find((layout) => layout === params.get("host")) ?? "web";
const showWorkspaceSidebar = hostLayout !== "vscode" && !isDevExplorerDisabledByUrl();
const lifecycleParam = params.get("lifecycleActions");
const lifecycleActionsAvailable =
  lifecycleParam === null ? hostLayout !== "sandbox" : lifecycleParam !== "false";
const host = createFakeClabUiHost(params.get("fixture"), hostLayout);
const runtime = createClabUiRuntime({
  host,
  initialContext: {
    mode: "edit",
    deploymentState: "undeployed",
    path: host.harness.getCurrentFile(),
    sessionId: "ui-harness"
  }
});

const initialData = {
  schemaData: defaultSchemaData,
  dockerImages: [],
  customNodes: [],
  defaultNode: "",
  customIcons: []
};

harnessWindow.__DEV__ = {
  setCustomIcons: (icons: CustomIconInfo[]) => host.harness.setCustomIcons(icons),
  getCurrentFile: () => host.harness.getCurrentFile(),
  getHostSnapshot: () => host.getSnapshot(),
  getYamlFromFile: (filename: string) => host.harness.readYamlFile(filename),
  getAnnotationsFromFile: (filename: string) => host.harness.readAnnotationsFile(filename),
  listTopologyFiles: () => host.harness.listTopologyFiles(),
  loadTopologyFile: (filename: string) => host.harness.loadTopologyFile(filename),
  resetFiles: () => host.harness.resetFiles(),
  emitCurrentSnapshot: () => host.harness.emitCurrentSnapshot(),
  writeYamlFile: (filename: string, content: string) => host.harness.writeYamlFile(filename, content),
  writeAnnotationsFile: (filename: string, content: unknown) =>
    host.harness.writeAnnotationsFile(filename, content)
};
harnessWindow.__INITIAL_DATA__ = initialData;

// Web and sandbox paint with the app themes; VS Code and the bare editor keep the VS Code variables.
function applyColorScheme(scheme: ColorScheme): void {
  if (showWorkspaceSidebar) {
    applyStandaloneAppearance(readStandaloneAppearance(), scheme);
  } else {
    applyThemeVars(scheme);
  }
}

const initialColorScheme: ColorScheme = params.get("theme") === "light" ? "light" : "dark";
applyColorScheme(initialColorScheme);
const workspaceHost = createHarnessWorkspaceHost(hostLayout === "web");

function HarnessApp() {
  const [colorScheme, setColorScheme] = React.useState(initialColorScheme);
  const changeColorScheme = (scheme: ColorScheme) => {
    applyColorScheme(scheme);
    setColorScheme(scheme);
  };
  const app = (
    <App
      initialData={initialData}
      runtime={runtime}
      lifecycleActionsAvailable={lifecycleActionsAvailable}
      slots={
        showWorkspaceSidebar
          ? {
              sidebar: (
                <WorkspaceSidebar
                  colorScheme={colorScheme}
                  onColorSchemeChange={changeColorScheme}
                  onOpenSettings={() => {}}
                />
              )
            }
          : undefined
      }
    />
  );
  return showWorkspaceSidebar ? <WorkspaceHostProvider host={workspaceHost}>{app}</WorkspaceHostProvider> : app;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

createRoot(container).render(
  <React.StrictMode>
    <HarnessApp />
  </React.StrictMode>
);
