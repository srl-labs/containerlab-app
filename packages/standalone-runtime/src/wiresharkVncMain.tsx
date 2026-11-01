import { runtimeFetch } from "./backend";
import { installDesktopChrome } from "./desktopChrome";
import {
  bootstrapWiresharkVncTabs,
  bootstrapWiresharkVncWebview
} from "@containerlab/clab-ui/wireshark-vnc";
import { createClabUiRuntime, createWindowClabUiHost } from "@containerlab/clab-ui/host";

import { fetchWiresharkVncSessionReady } from "./runtimeApi";
import { resolveStandaloneServerOrigin, standaloneServerUrl } from "./standaloneServerOrigin";
import {
  buildEmbeddedWiresharkPageSearch,
  parseWiresharkPageSearch,
  sessionTabLabels,
  wiresharkPageTitle,
  type WiresharkPageQuery
} from "./wiresharkCaptureLauncher";
import {
  applyStandaloneAppearance,
  parseStandaloneTheme,
  watchStandaloneAppearance
} from "@containerlab/clab-ui/workspace/state";

interface WiresharkVncInitialData {
  iframeUrl: string;
  showVolumeTip: boolean;
  initialStatus?: string;
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

/**
 * Closes the window's sessions with one request that outlives the page. The
 * window closes them, not the frame of each session: as a browser quits, the
 * requests of only some frames may still go out.
 */
function closeCaptureSessionsOnLeave(sessionIds: readonly string[], endpointId?: string): void {
  const params = new URLSearchParams();
  for (const sessionId of sessionIds) params.append("sessionId", sessionId);
  if (endpointId) params.set("endpointId", endpointId);
  const closePath = `${standaloneServerUrl("/api/runtime/capture/wireshark-vnc-sessions/close")}?${params.toString()}`;

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

  void runtimeFetch(closePath, {
    method: "POST",
    keepalive: true,
    credentials: "same-origin"
  }).catch(() => {});
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

function setInitialData(initialData: WiresharkVncInitialData): void {
  (window as unknown as { __INITIAL_DATA__?: WiresharkVncInitialData }).__INITIAL_DATA__ = initialData;
}

/** Opened before its sessions exist: the loading look until the final page replaces it. */
function renderPending(showVolumeTip: boolean): void {
  setInitialData({ iframeUrl: "", showVolumeTip, initialStatus: "Starting capture session…" });
  const runtime = createClabUiRuntime({
    host: createWindowClabUiHost({ targetWindow: window, postMessage() {} })
  });
  bootstrapWiresharkVncWebview(runtime);
}

/**
 * Several sessions: one tab each. Every tab embeds this page for its own
 * session, which then checks its readiness; this page closes them all.
 */
function renderSessionTabs(query: WiresharkPageQuery): void {
  const labels = sessionTabLabels(query.sessions);
  bootstrapWiresharkVncTabs(
    query.sessions.map((session, index) => ({
      id: session.sessionId,
      label: labels[index] ?? session.sessionId,
      src: `${window.location.pathname}?${buildEmbeddedWiresharkPageSearch(session.sessionId, query)}`
    }))
  );
}

async function main(): Promise<void> {
  const query = parseWiresharkPageSearch(window.location.search);
  const { endpointId, showVolumeTip } = query;
  const theme = parseStandaloneTheme(query.theme);
  // A theme in the URL pins light or dark to match the capture session.
  applyStandaloneAppearance(undefined, theme);
  watchStandaloneAppearance(() => applyStandaloneAppearance(undefined, theme));
  if (!query.embedded) {
    // The multi-session page draws the window chrome for the pages it embeds.
    document.title = wiresharkPageTitle(query.sessions);
    installDesktopChrome();
  }

  if (query.pending) {
    renderPending(showVolumeTip);
    return;
  }
  if (!query.embedded && query.sessions.length > 0) {
    let closed = false;
    const closeSessions = () => {
      if (closed) return;
      closed = true;
      closeCaptureSessionsOnLeave(
        query.sessions.map((session) => session.sessionId),
        endpointId
      );
    };
    window.addEventListener("pagehide", closeSessions);
  }
  if (query.sessions.length > 1) {
    renderSessionTabs(query);
    return;
  }
  const sessionId = query.sessions[0]?.sessionId;
  if (!sessionId) {
    renderFatalError("Missing capture session id.");
    return;
  }

  const fallbackVncPath = standaloneServerUrl(`/api/runtime/capture/wireshark-vnc-sessions/${encodeURIComponent(sessionId)}/vnc/`);
  setInitialData({
    iframeUrl: withEndpointParam(fallbackVncPath, endpointId),
    showVolumeTip
  });

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

        const vncUrl = withEndpointParam(
          new URL(readyPayload.url || fallbackVncPath, resolveStandaloneServerOrigin()).toString(),
          endpointId
        );
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

  bootstrapWiresharkVncWebview(runtime);
}

void main();
