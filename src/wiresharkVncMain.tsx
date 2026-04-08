import { bootstrapWiresharkVncWebview } from "@srl-labs/clab-ui/wireshark-vnc";
import { createClabUiRuntime, createWindowClabUiHost } from "@srl-labs/clab-ui/host";
import { applyThemeVars } from "@srl-labs/clab-ui/theme";

import { closeWiresharkVncSession, fetchWiresharkVncSessionReady } from "./runtimeApi";
import { parseStandaloneTheme, resolveStandaloneTheme } from "./standaloneTheme";

interface WiresharkVncInitialData {
  iframeUrl: string;
  showVolumeTip: boolean;
}

interface RetryCheckMessage {
  type: "retry-check";
}

function isRetryCheckMessage(value: unknown): value is RetryCheckMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "retry-check"
  );
}

function postIncomingMessage(message: unknown): void {
  window.postMessage(message, window.location.origin);
}

function withEndpointParam(urlPath: string, endpointId?: string): string {
  if (!endpointId) {
    return urlPath;
  }
  const separator = urlPath.includes("?") ? "&" : "?";
  return `${urlPath}${separator}endpointId=${encodeURIComponent(endpointId)}`;
}

function closeCaptureSessionBestEffort(sessionId: string, endpointId?: string): void {
  const closePath = withEndpointParam(
    `/api/runtime/capture/wireshark-vnc-sessions/${encodeURIComponent(sessionId)}/close`,
    endpointId
  );

  let beaconQueued = false;
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      beaconQueued = navigator.sendBeacon(closePath, "");
    } catch {
      beaconQueued = false;
    }
  }

  if (beaconQueued) {
    return;
  }

  void fetch(closePath, {
    method: "POST",
    keepalive: true,
    credentials: "same-origin"
  }).catch(() => {});
}

function parseQuery(): {
  endpointId?: string;
  sessionId?: string;
  showVolumeTip: boolean;
  theme?: "light" | "dark";
} {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("sessionId")?.trim();
  const endpointId = params.get("endpointId")?.trim();
  const showVolumeTip = params.get("showVolumeTip") !== "0";
  const theme = parseStandaloneTheme(params.get("theme")?.trim());
  return {
    sessionId: sessionId && sessionId.length > 0 ? sessionId : undefined,
    endpointId: endpointId && endpointId.length > 0 ? endpointId : undefined,
    showVolumeTip,
    theme
  };
}

function renderFatalError(message: string): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error(message);
  }
  root.textContent = message;
  root.style.padding = "16px";
  root.style.color = "var(--vscode-editor-foreground, #ddd)";
  root.style.background = "var(--vscode-editor-background, #1e1e1e)";
  root.style.fontFamily = "monospace";
}

async function main(): Promise<void> {
  const { sessionId, endpointId, showVolumeTip, theme } = parseQuery();
  const resolvedTheme = theme ?? resolveStandaloneTheme();
  document.documentElement.classList.toggle("light", resolvedTheme === "light");
  applyThemeVars(resolvedTheme);

  if (!sessionId) {
    renderFatalError("Missing capture session id.");
    return;
  }

  const fallbackVncPath = `/api/runtime/capture/wireshark-vnc-sessions/${encodeURIComponent(sessionId)}/vnc/`;
  const initialData: WiresharkVncInitialData = {
    iframeUrl: withEndpointParam(fallbackVncPath, endpointId),
    showVolumeTip
  };
  (window as unknown as { __INITIAL_DATA__?: WiresharkVncInitialData }).__INITIAL_DATA__ = initialData;

  let activeCheckToken = 0;

  const runReadinessLoop = async () => {
    const token = ++activeCheckToken;
    const maxAttempts = 60;
    const delayMs = 1000;
    postIncomingMessage({ type: "vnc-progress", attempt: 0, maxAttempts });

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (token !== activeCheckToken) {
        return;
      }

      try {
        const readyPayload = await fetchWiresharkVncSessionReady(sessionId, endpointId);
        if (token !== activeCheckToken) {
          return;
        }

        const vncUrl = withEndpointParam(readyPayload.url || fallbackVncPath, endpointId);
        if (readyPayload.ready) {
          postIncomingMessage({ type: "vnc-ready", url: vncUrl });
          return;
        }
      } catch {
        // Keep retrying.
      }

      postIncomingMessage({ type: "vnc-progress", attempt, maxAttempts });
      await new Promise((resolve) => window.setTimeout(resolve, delayMs));
    }

    if (token === activeCheckToken) {
      postIncomingMessage({
        type: "vnc-timeout",
        url: withEndpointParam(fallbackVncPath, endpointId)
      });
    }
  };

  const runtime = createClabUiRuntime({
    host: createWindowClabUiHost({
      targetWindow: window,
      postMessage(message) {
        if (isRetryCheckMessage(message)) {
          void runReadinessLoop();
        }
      }
    })
  });

  let closeTriggered = false;
  const closeSession = () => {
    if (closeTriggered) {
      return;
    }
    closeTriggered = true;
    closeCaptureSessionBestEffort(sessionId, endpointId);
    void closeWiresharkVncSession(sessionId, endpointId).catch(() => {});
  };

  window.addEventListener("pagehide", closeSession);
  window.addEventListener("beforeunload", closeSession);
  window.addEventListener("unload", closeSession);

  bootstrapWiresharkVncWebview(runtime);
}

void main();
