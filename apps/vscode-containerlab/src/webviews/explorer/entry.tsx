import React from "react";
import { createRoot } from "react-dom/client";

import { ContainerlabExplorerView } from "@containerlab/clab-ui/explorer";
import {
  ClabUiRuntimeProvider,
  createClabUiRuntime,
  createWindowClabUiHost
} from "@containerlab/clab-ui/host";
import { MuiThemeProvider } from "@containerlab/clab-ui/theme";

const runtime = createClabUiRuntime({ host: createWindowClabUiHost() });

function bootstrap(): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Explorer root element not found");
  }

  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ClabUiRuntimeProvider runtime={runtime}>
        <MuiThemeProvider>
          <ContainerlabExplorerView />
        </MuiThemeProvider>
      </ClabUiRuntimeProvider>
    </React.StrictMode>
  );
}

bootstrap();
