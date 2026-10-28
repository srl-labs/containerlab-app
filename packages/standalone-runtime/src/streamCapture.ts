/**
 * Captures on lab hosts that capture lab links as one stream (c9s): the
 * picker lists the lab-link interfaces, and the capture goes where the user
 * chose: Wireshark on this machine (desktop), Wireshark in a window (VNC on
 * a clab-api-server, or for a cluster used from this machine a VNC container
 * on this machine's Docker), a `packetflix:` link, or a `.pcapng` download.
 */
import type { CaptureTarget } from "@srl-labs/containerlab-lab-backend";
import {
  CAPTURE_DURATIONS,
  linkCaptureKey,
  parseLabCaptureInterfaces
} from "@containerlab/clab-ui/host";
import {
  loadCapturePreferences,
  resolveStandaloneTheme,
  runtimeUiActions,
  type RuntimeStreamCapture
} from "@containerlab/clab-ui/workspace/state";

import {
  createCaptureDownload,
  createCaptureTicket,
  openLocalWiresharkCapture,
  requestLabOperation,
  type RuntimeTargetRequest
} from "./runtimeApi";
import { useAuthStore } from "./stores/authStore";
import { streamCaptureDeliveries, unavailableStreamCaptureDeliveries } from "./streamCaptureDeliveries";
import { loadLabHostInfo, useLabHostStore } from "./stores/labHostStore";
import { resolveStandaloneServerOrigin } from "./standaloneServerOrigin";
import { openWiresharkCaptureWindow } from "./wiresharkCaptureWindow";

function durationLabel(duration: string | undefined): string {
  return CAPTURE_DURATIONS.find((entry) => entry.value === duration)?.label ?? duration ?? "";
}

function captureTargets(capture: RuntimeStreamCapture): CaptureTarget[] {
  return capture.targets.map((target) => ({ containerName: target.node, interfaceName: target.interface }));
}

function notifyError(error: unknown): void {
  runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
}

/** Starts a browser download of `url`, an app server path with its base path, as `fileName`. */
function startDownload(url: string, fileName: string): void {
  const link = document.createElement("a");
  link.href = new URL(url, resolveStandaloneServerOrigin()).toString();
  link.download = fileName;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Sends one capture where the user chose. Call it from the click: Wireshark
 * in a window needs the click's pop-up allowance.
 */
function runStreamCapture(
  target: RuntimeTargetRequest,
  capture: RuntimeStreamCapture,
  theme: "light" | "dark"
): Promise<void> {
  const targets = captureTargets(capture);
  const request = { ...target, targets, ...(capture.duration !== undefined ? { duration: capture.duration } : {}) };
  switch (capture.delivery) {
    case "wireshark-vnc":
      return openWiresharkCaptureWindow([{ targets, label: capture.label }], target, theme).then((opened) => {
        if (opened > 0) runtimeUiActions.notify("Opened Wireshark.", "success");
      });
    case "local-wireshark":
      return openLocalWiresharkCapture({ ...request, title: capture.label }).then(
        () =>
          runtimeUiActions.notify(
            capture.duration !== undefined
              ? `Wireshark captures ${capture.label} for ${durationLabel(capture.duration)}.`
              : `Wireshark captures ${capture.label} until you stop it or close Wireshark.`,
            "success"
          ),
        notifyError
      );
    case "packetflix":
      return createCaptureTicket(request).then((ticket) => {
        window.open(ticket.packetflixUri, "_blank", "noopener,noreferrer");
        runtimeUiActions.notify(
          "Opening Wireshark through its packetflix: link. It needs cshargextcap; the link works once and only for a minute.",
          "info"
        );
      }, notifyError);
    case "download":
      return createCaptureDownload(request).then((download) => {
        startDownload(download.url, download.fileName);
        runtimeUiActions.notify(
          `Capturing ${capture.label} for ${durationLabel(capture.duration)}; ${download.fileName} downloads while it runs.`,
          "info"
        );
      }, notifyError);
  }
}

/** Whether a lab host captures lab links as one stream, as far as it already answered. */
export function hostCapturesStreams(endpointId: string | undefined): boolean {
  if (endpointId === undefined) return false;
  return useLabHostStore.getState().hosts.get(endpointId)?.support.captureStream === true;
}

/** The topology node of a container name on a c9s lab host: `<lab>-<node>`, or the node itself. */
export function topologyNodeOf(labName: string | undefined, containerName: string): string {
  for (const prefix of labName ? [`clab-${labName}-`, `${labName}-`] : []) {
    if (containerName.startsWith(prefix) && containerName.length > prefix.length) {
      return containerName.slice(prefix.length);
    }
  }
  return containerName;
}

/** The nodes and ticked `<node>:<interface>` keys of the stream dialog for capture targets. */
export function streamCaptureSelection(
  labName: string | undefined,
  targets: readonly CaptureTarget[]
): { nodes: string[]; initialSelection: string[] } {
  const keys = targets.map((target) => ({
    node: topologyNodeOf(labName, target.containerName),
    key: linkCaptureKey(topologyNodeOf(labName, target.containerName), target.interfaceName)
  }));
  return { nodes: [...new Set(keys.map((entry) => entry.node))], initialSelection: keys.map((entry) => entry.key) };
}

export interface StreamCaptureDialogRequest {
  target: RuntimeTargetRequest;
  /** Topology nodes whose lab-link interfaces the dialog offers. */
  nodes: string[];
  /** `<node>:<interface>` keys to tick. */
  initialSelection?: string[];
  title: string;
}

/**
 * Opens the capture dialog of a lab host with capture streams. Resolves
 * false, and opens nothing, when the lab host has none: it captures with
 * Edgeshark then.
 */
export async function openStreamCaptureDialog(request: StreamCaptureDialogRequest): Promise<boolean> {
  const endpointId = request.target.endpointId;
  const info = endpointId !== undefined ? await loadLabHostInfo(endpointId) : undefined;
  if (info?.support.captureStream !== true) return false;
  const deliveries = streamCaptureDeliveries(info.support, {
    localWireshark: useAuthStore.getState().localWireshark,
    desktop: window.containerlabDesktop !== undefined,
    preferLinks: loadCapturePreferences(endpointId).preferredAction === "edgeshark"
  });
  runtimeUiActions.openCapture({
    ...request.target,
    nodeName: request.nodes[0] ?? "",
    title: request.title,
    onCapture: () => {},
    stream: {
      nodes: request.nodes,
      ...(request.initialSelection ? { initialSelection: request.initialSelection } : {}),
      deliveries,
      unavailable: unavailableStreamCaptureDeliveries(info),
      loadInterfaces: async () =>
        parseLabCaptureInterfaces(await requestLabOperation("capture-interfaces", { ...request.target })),
      onCapture: (capture) => {
        void runStreamCapture(request.target, capture, resolveStandaloneTheme());
      }
    }
  });
  return true;
}
