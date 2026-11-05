/**
 * The Fabric view: what fcling's engine knows about a lab's SR Linux fabric,
 * in every host. Standalone pages render `FabricApp` with a client of their own;
 * a VS Code webview uses `bootstrapFabricWebview`, which goes through the extension host.
 */
import Box from "@mui/material/Box";
import useMediaQuery from "@mui/material/useMediaQuery";
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import type { FabricClient, FabricWebviewInitialData } from "../../fabric/engine";
import { createWebviewFabricClient } from "../../fabric/webviewClient";
import { ClabUiRuntimeProvider, type ClabUiRuntime } from "../../host";
import { MuiThemeProvider } from "../../theme/index";
import { overlayShadow } from "../../theme/surfaces";

import { FabricEngineGate } from "./FabricEngineGate";
import { FabricHeader, FabricPastBanner } from "./FabricHeader";
import { FabricHistoryView } from "./FabricHistoryView";
import { FabricIncidentsView } from "./FabricIncidentsView";
import { FabricLensView } from "./FabricLensView";
import { FabricNav, NAV_RAIL_WIDTH } from "./FabricNav";
import { FabricNodesView } from "./FabricNodesView";
import { FabricReportView } from "./FabricReportView";
import { FabricTopologyView } from "./FabricTopologyView";
import { FabricProvider, useFabric } from "./fabricContext";
import { ErrorNote } from "./fabricUi";

const NAV_PREFERENCE_KEY = "clab.fabric.navCollapsed";

function readNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_PREFERENCE_KEY) === "1";
  } catch {
    return false;
  }
}

function persistNavCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(NAV_PREFERENCE_KEY, collapsed ? "1" : "0");
  } catch {
    // Storage can be disabled.
  }
}

function CurrentView(): React.JSX.Element {
  const { route } = useFabric();
  switch (route.view) {
    case "nodes":
      return <FabricNodesView />;
    case "incidents":
      return <FabricIncidentsView />;
    case "history":
      return <FabricHistoryView />;
    case "lens":
      return <FabricLensView key={route.name} name={route.name ?? "where"} />;
    case "report":
      return <FabricReportView key={route.name} name={route.name ?? ""} />;
    default:
      return <FabricTopologyView />;
  }
}

/** The fabric could not be read while live; in the past the banner says so. */
function CoreError(): React.JSX.Element | null {
  const { coreError, at } = useFabric();
  if (!coreError || at !== undefined) return null;
  return <ErrorNote sx={{ m: 1, mb: 0 }}>{coreError}</ErrorNote>;
}

/** Wide, the navigation sits beside the page; narrow, it is a rail that opens over the page. */
function FabricShell(): React.JSX.Element {
  const narrow = useMediaQuery("(max-width: 760px)");
  const [collapsed, setCollapsed] = useState(readNavCollapsed);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const toggle = () => {
    if (narrow) {
      setOverlayOpen((open) => !open);
      return;
    }
    persistNavCollapsed(!collapsed);
    setCollapsed(!collapsed);
  };
  return (
    <>
      <FabricHeader onToggleNav={toggle} />
      <FabricPastBanner />
      <Box sx={{ position: "relative", display: "flex", flex: 1, minHeight: 0 }}>
        {narrow ? (
          <>
            <FabricNav collapsed onExpand={() => setOverlayOpen(true)} onNavigate={() => undefined} />
            {overlayOpen ? (
              <Box sx={{ position: "absolute", left: 0, top: 0, bottom: 0, zIndex: 5, boxShadow: overlayShadow }}>
                <FabricNav collapsed={false} onExpand={() => undefined} onNavigate={() => setOverlayOpen(false)} />
              </Box>
            ) : null}
          </>
        ) : (
          <FabricNav
            collapsed={collapsed}
            onExpand={() => {
              persistNavCollapsed(false);
              setCollapsed(false);
            }}
            onNavigate={() => undefined}
          />
        )}
        <Box
          component="main"
          data-testid="fabric-main"
          // The rail stays, so a page never jumps when the panel opens over it.
          sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", ...(narrow ? { maxWidth: `calc(100% - ${NAV_RAIL_WIDTH}px)` } : {}) }}
        >
          <CoreError />
          <CurrentView />
        </Box>
      </Box>
    </>
  );
}

export function FabricApp({ client, labName }: { client: FabricClient; labName: string }): React.JSX.Element {
  useEffect(() => {
    document.title = `Fabric: ${labName}`;
  }, [labName]);
  return (
    <MuiThemeProvider>
      <Box
        data-testid="fabric-app"
        sx={{
          position: "fixed", inset: 0, display: "flex", flexDirection: "column", minHeight: 0,
          bgcolor: "background.default", color: "text.primary"
        }}
      >
        <FabricEngineGate client={client} labName={labName}>
          {({ stop, check }) => (
            <FabricProvider client={client} labName={labName} onStreamClosed={check} stopEngine={stop}>
              <FabricShell />
            </FabricProvider>
          )}
        </FabricEngineGate>
      </Box>
    </MuiThemeProvider>
  );
}

export function bootstrapFabricWebview(runtime: ClabUiRuntime): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Fabric webview root element not found");
  }
  const initialData = (window.__INITIAL_DATA__ ?? {}) as unknown as FabricWebviewInitialData;
  const client = createWebviewFabricClient(runtime.host);
  createRoot(container).render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <FabricApp client={client} labName={initialData.labName ?? ""} />
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
}
