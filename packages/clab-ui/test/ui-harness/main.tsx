import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "../../src/App";
import { defaultSchemaData } from "../../src/core/schema";
import { createClabUiRuntime } from "../../src/host";
import { applyThemeVars } from "../../src/theme";
import "../../src/styles/global.css";

import { createFakeClabUiHost } from "./fakeHost";

type HarnessWindow = Window & {
  __DEV__?: Record<string, unknown>;
  __INITIAL_DATA__?: Record<string, unknown>;
  __SCHEMA_DATA__?: unknown;
  __DOCKER_IMAGES__?: string[];
};

const harnessWindow = window as HarnessWindow;
const params = new URLSearchParams(window.location.search);
const host = createFakeClabUiHost(params.get("fixture"));
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
harnessWindow.__SCHEMA_DATA__ = defaultSchemaData;
harnessWindow.__DOCKER_IMAGES__ = [];

applyThemeVars(params.get("theme") === "light" ? "light" : "dark");

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

createRoot(container).render(
  <React.StrictMode>
    <App initialData={initialData} runtime={runtime} />
  </React.StrictMode>
);
