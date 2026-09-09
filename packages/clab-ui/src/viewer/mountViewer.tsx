import React from "react";
import { createRoot, type Root } from "react-dom/client";

import { App } from "../App";
import { defaultSchemaData } from "../core/schema";
import { createClabUiRuntime } from "../host";
import { applyThemeVars } from "../theme";
import "../styles/global.css";

import { createViewerHost, type ViewerHostInput } from "./createViewerHost";

export interface MountViewerOptions extends ViewerHostInput {
  theme?: "light" | "dark";
}

// Renders a read-only clab-ui topology viewer into `container`. Returns the React root so callers
// can unmount. The graph is built from the given clab YAML (+ optional annotations.json) in view
// mode — no editor chrome, no lifecycle.
export function mountViewer(container: Element, options: MountViewerOptions): Root {
  const host = createViewerHost({ yaml: options.yaml, annotations: options.annotations });
  const runtime = createClabUiRuntime({
    host,
    initialContext: {
      mode: "view",
      deploymentState: "undeployed",
      path: "/lab/topology.clab.yml",
      sessionId: "clab-viewer"
    }
  });

  const initialData = {
    schemaData: defaultSchemaData,
    dockerImages: [],
    customNodes: [],
    defaultNode: "",
    customIcons: []
  };

  const win = window as unknown as { __SCHEMA_DATA__?: unknown; __DOCKER_IMAGES__?: string[] };
  win.__SCHEMA_DATA__ = defaultSchemaData;
  win.__DOCKER_IMAGES__ = [];

  applyThemeVars(options.theme ?? "dark");

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <App initialData={initialData} runtime={runtime} chrome="viewer" />
    </React.StrictMode>
  );
  return root;
}
