/**
 * Lightweight standalone entry point.
 *
 * Installs the in-browser sandbox shim, then boots the full TopoViewer runtime.
 * The public sandbox always runs against a single fixed in-browser endpoint, so
 * there is no login/connect step — the editor mounts immediately.
 */
import { useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { installPagesSandboxRuntime } from "./pagesSandboxRuntime";
import type * as StandaloneAppModule from "./standaloneApp";

let bootstrapRoot: Root | null = null;
let standaloneMountStarted = false;
let standaloneRuntimeModulePromise: Promise<typeof StandaloneAppModule> | null = null;

installPagesSandboxRuntime();

function LoadingScreen() {
  return (
    <div style={{
      alignItems: "center",
      background: "#1e1e1e",
      color: "#d4d4d4",
      display: "flex",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      height: "100vh",
      justifyContent: "center"
    }}>
      containerlab
    </div>
  );
}

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
  useEffect(() => {
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
  }, []);

  return <LoadingScreen />;
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Root element not found");
}

bootstrapRoot = createRoot(container);
bootstrapRoot.render(<BootstrapApp />);
