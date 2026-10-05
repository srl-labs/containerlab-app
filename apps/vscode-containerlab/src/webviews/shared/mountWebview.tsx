import React from "react";
import { createRoot } from "react-dom/client";

import {
  createClabUiRuntime,
  createWindowClabUiHost,
  type ClabUiRuntime
} from "@containerlab/clab-ui/host";

/** Creates the window-backed runtime and hands it to a clab-ui bootstrap function. */
export function mountWebview(bootstrap: (runtime: ClabUiRuntime) => void): void {
  bootstrap(createClabUiRuntime({ host: createWindowClabUiHost() }));
}

/** Renders an element into the webview root in strict mode. */
export function renderWebview(element: React.ReactNode): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Webview root element not found");
  }
  createRoot(container).render(<React.StrictMode>{element}</React.StrictMode>);
}
