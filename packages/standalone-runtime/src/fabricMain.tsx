/** A lab's Fabric view in its own window, in the web and desktop apps. */
import { FabricApp } from "@containerlab/clab-ui/fabric";
import {
  ClabUiRuntimeProvider,
  createClabUiRuntime,
  createWindowClabUiHost
} from "@containerlab/clab-ui/host";
import {
  applyStandaloneAppearance,
  parseStandaloneTheme,
  watchStandaloneAppearance
} from "@containerlab/clab-ui/workspace/state";
import React from "react";
import { createRoot } from "react-dom/client";

import { installDesktopChrome } from "./desktopChrome";
import { createStandaloneFabricClient } from "./fabricClient";

function main(): void {
  const query = new URLSearchParams(window.location.search);
  const labName = query.get("labName")?.trim() ?? "";
  const endpointId = query.get("endpointId") ?? undefined;
  const theme = parseStandaloneTheme(query.get("theme") ?? undefined);
  applyStandaloneAppearance(undefined, theme);
  watchStandaloneAppearance(() => applyStandaloneAppearance(undefined, theme));
  document.title = labName ? `Fabric: ${labName}` : "Fabric";
  installDesktopChrome();

  const root = document.getElementById("root");
  if (!root) throw new Error("Fabric view root element not found");
  if (!labName) {
    root.textContent = "No lab was named for this Fabric view.";
    return;
  }
  const runtime = createClabUiRuntime({
    host: createWindowClabUiHost({ targetWindow: window, postMessage() {} })
  });
  createRoot(root).render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <FabricApp client={createStandaloneFabricClient(labName, endpointId)} labName={labName} />
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
}

main();
