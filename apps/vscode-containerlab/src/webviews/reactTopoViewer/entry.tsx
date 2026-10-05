import React from "react";
import { createRoot } from "react-dom/client";

import { App, log } from "@containerlab/clab-ui";
import { createClabUiRuntime, createWindowClabUiHost } from "@containerlab/clab-ui/host";
import "@containerlab/clab-ui/styles/global.css";

type TopoViewerWindow = Window & {
  __INITIAL_DATA__?: unknown;
};

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const initialDataSource = (window as TopoViewerWindow).__INITIAL_DATA__;
const initialData = isRecord(initialDataSource) ? initialDataSource : {};

const customNodeCount = Array.isArray(initialData.customNodes) ? initialData.customNodes.length : 0;
const iconCount = Array.isArray(initialData.customIcons) ? initialData.customIcons.length : 0;
log.info(
  `[ReactTopoViewer] Bootstrap data loaded (customNodes: ${customNodeCount}, customIcons: ${iconCount})`
);

function bootstrap(): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Root element not found");
  }

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App initialData={initialData} runtime={runtime} />
    </React.StrictMode>
  );
}

bootstrap();
