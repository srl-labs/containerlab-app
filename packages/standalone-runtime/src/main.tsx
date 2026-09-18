import { BootstrapLoginPage } from "@containerlab/clab-ui/workspace/bootstrap";
import { applyThemeVars } from "@containerlab/clab-ui/theme";
import { resolveStandaloneTheme } from "./standaloneTheme";
/**
 * Lightweight standalone entry point.
 *
 * Keep the first unauthenticated render free of the full TopoViewer runtime.
 * The heavy editor/runtime module is loaded only after an endpoint exists.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { createRoot, type Root } from "react-dom/client";

import { useAuth } from "./hooks/useAuth";
import { resolveStandaloneStartupScreen } from "./startupScreen";
import {
  type EndpointSessionDuration
} from "./stores/endpointStore";
import type * as StandaloneAppModule from "./standaloneApp";

let bootstrapRoot: Root | null = null;
let standaloneMountStarted = false;
let standaloneRuntimeModulePromise: Promise<typeof StandaloneAppModule> | null = null;

function preloadStandaloneRuntime(): Promise<typeof StandaloneAppModule> {
  standaloneRuntimeModulePromise ??= import("./standaloneApp");
  return standaloneRuntimeModulePromise;
}

async function mountStandaloneRuntime(): Promise<void> {
  if (standaloneMountStarted) {
    return;
  }
  standaloneMountStarted = true;
  const { mountStandaloneApp } = await preloadStandaloneRuntime();
  bootstrapRoot?.unmount();
  bootstrapRoot = null;
  document.getElementById("root")?.replaceChildren();
  mountStandaloneApp();
}

function BootstrapApp() {
  const {
    addEndpoint,
    defaultApiUrl,
    endpointList,
    error,
    exportEndpoints,
    importEndpoints,
    loading,
    refreshConfig
  } = useAuth();

  const startupScreen = useMemo(
    () => resolveStandaloneStartupScreen(endpointList),
    [endpointList]
  );

  useEffect(() => {
    if (!loading && startupScreen === "app") {
      let timer: number | null = null;
      const frame = window.requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          void mountStandaloneRuntime();
        }, 0);
      });
      return () => {
        window.cancelAnimationFrame(frame);
        if (timer !== null) {
          window.clearTimeout(timer);
        }
      };
    }
  }, [loading, startupScreen]);

  useEffect(() => {
    if (loading || startupScreen !== "login") {
      return;
    }
    let idleCallbackId: number | null = null;
    const preloadTimer = window.setTimeout(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleCallbackId = window.requestIdleCallback(
          () => {
            void preloadStandaloneRuntime();
          },
          { timeout: 2000 }
        );
        return;
      }
      void preloadStandaloneRuntime();
    }, 1200);
    return () => {
      window.clearTimeout(preloadTimer);
      if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleCallbackId);
      }
    };
  }, [loading, startupScreen]);

  const handleAddEndpoint = useCallback(
    async (input: {
      label?: string;
      password: string;
      sessionDuration: EndpointSessionDuration;
      url: string;
      username: string;
    }) => {
      await addEndpoint(input);
      await refreshConfig().catch(() => {});
    },
    [addEndpoint, refreshConfig]
  );

  if (loading || startupScreen === "app") {
    return null;
  }

  return (
    <BootstrapLoginPage
      defaultApiUrl={defaultApiUrl}
      error={error}
      onAddEndpoint={handleAddEndpoint}
      onExportEndpoints={exportEndpoints}
      onImportEndpoints={importEndpoints}
    />
  );
}

applyThemeVars(resolveStandaloneTheme());
const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

bootstrapRoot = createRoot(container);
bootstrapRoot.render(<BootstrapApp />);
