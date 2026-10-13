// Wires the Wireshark launcher to this window, the runtime API and the app's notifications.
import { runtimeUiActions } from "@containerlab/clab-ui/workspace/state";

import { publicAssetUrl } from "./publicAssetUrl";
import {
  closeWiresharkVncSession,
  createWiresharkVncSessions,
  type RuntimeTargetRequest
} from "./runtimeApi";
import { launchWiresharkCapture, type WiresharkCaptureRequest } from "./wiresharkCaptureLauncher";

function openCaptureWindow(url: string): Window | null {
  // No "noopener": it makes window.open return null, and the window is needed to load the sessions.
  const opened = window.open(url, "_blank");
  if (opened) {
    opened.opener = null;
  }
  return opened;
}

/**
 * Opens the requested captures in one Wireshark window. Call it synchronously
 * from the click; resolves to the number of sessions shown.
 */
export function openWiresharkCaptureWindow(
  requests: readonly WiresharkCaptureRequest[],
  target: RuntimeTargetRequest,
  theme: "light" | "dark"
): Promise<number> {
  return launchWiresharkCapture(
    requests,
    { theme, ...(target.endpointId !== undefined ? { endpointId: target.endpointId } : {}) },
    {
      desktop: window.containerlabDesktop !== undefined,
      pageUrl: (search) => `${publicAssetUrl("wireshark.html")}?${search}`,
      openWindow: openCaptureWindow,
      async createSessions(request) {
        const response = await createWiresharkVncSessions({
          ...target,
          targets: request.targets,
          theme
        });
        return response.sessions ?? [];
      },
      closeSession(sessionId) {
        void closeWiresharkVncSession(sessionId, target.endpointId).catch(() => {});
      },
      notify: (message, severity) => runtimeUiActions.notify(message, severity)
    }
  );
}
