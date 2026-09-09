import type {
  TopologyHostCommand,
  TopologyHostResponseMessage,
  TopologySnapshot
} from "../core/types/messages";
import type { ExplorerIncomingMessage, ExplorerUiState } from "../explorer/shared/explorer/types";
import { TOPOLOGY_HOST_PROTOCOL_VERSION } from "../core/types/messages";
import {
  createTopologySessionClient,
  type TopologySessionClient
} from "../session/client";
import { resolveWindowVsCodeApi, type WindowVsCodeApiLike } from "../utils/vscodeApi";
import type {
  ClabUiExplorerHost,
  ClabUiHost,
  ClabUiImageHost,
  ClabUiTopoViewerEvent,
  ClabUiTopoViewerHost,
  TopologyUiContext,
  TopologyUiRequestOptions,
  TopoViewerLifecycleAction,
  TopoViewerNodeAction,
  TopoViewerSvgExportPayload
} from "./contracts";
import type { ClabUiExtensions, ClabUiRuntime } from "./runtimeContext";
import { isRecord } from "../core/utilities/typeHelpers";
export * from "./controllers";
export * from "./contracts";
export * from "./runtimeContext";
type FetchLike = typeof fetch;
type TopologyHostMessageType =
  | "topology-host:snapshot"
  | "topology-host:ack"
  | "topology-host:reject"
  | "topology-host:error";

interface PendingTopologyRequest {
  resolve: (value: TopologyHostResponseMessage | TopologySnapshot) => void;
  reject: (err: Error) => void;
  expectedType: "snapshot" | "command";
  timeoutId: ReturnType<typeof setTimeout>;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => {
      postMessage(message: unknown): void;
      getState?(): unknown;
      setState?(state: unknown): void;
    };
  }
}

interface WindowHostOptions {
  targetWindow?: Window;
  vscodeApi?: WindowVsCodeApiLike;
  postMessage?: (message: unknown) => void;
  explorer?: ClabUiExplorerHost;
  images?: ClabUiImageHost;
  topoViewer?: ClabUiTopoViewerHost;
  topology?: ClabUiHost["topology"];
  meta?: ClabUiHost["meta"];
}

interface ApiHostOptions extends WindowHostOptions {
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

type ImageManagerRequestAction = keyof ClabUiImageHost;

interface PendingImageRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface ImageManagerResponseMessage {
  type: "image-manager:response";
  requestId: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

function isExplorerIncomingMessage(value: unknown): value is ExplorerIncomingMessage {
  if (!isRecord(value) || typeof value.command !== "string") {
    return false;
  }

  switch (value.command) {
    case "snapshot":
      return typeof value.filterText === "string" && Array.isArray(value.sections);
    case "filterState":
      return typeof value.filterText === "string";
    case "uiState":
      return isRecord(value.state) || value.state === undefined;
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
}

function toModeChangedEvent(
  value: Record<string, unknown>
): Extract<ClabUiTopoViewerEvent, { type: "modeChanged" }> | null {
  const data = isRecord(value.data) ? value.data : undefined;
  const mode = data?.mode;
  const deploymentState = data?.deploymentState;

  let normalizedMode: "editor" | "viewer" | null = null;
  if (mode === "editor") {
    normalizedMode = "editor";
  } else if (mode === "viewer" || mode === "view") {
    normalizedMode = "viewer";
  }
  if (normalizedMode === null) {
    return null;
  }
  if (
    deploymentState !== "deployed" &&
    deploymentState !== "undeployed" &&
    deploymentState !== "unknown"
  ) {
    return null;
  }

  return {
    type: "modeChanged",
    mode: normalizedMode,
    deploymentState,
    ...(typeof data?.dirty === "boolean" ? { dirty: data.dirty } : {})
  };
}

function toPanelActionEvent(
  value: Record<string, unknown>
): Extract<ClabUiTopoViewerEvent, { type: "panelAction" }> | null {
  if (typeof value.action !== "string") {
    return null;
  }
  return {
    type: "panelAction",
    action: value.action,
    ...(typeof value.nodeId === "string" ? { nodeId: value.nodeId } : {}),
    ...(typeof value.edgeId === "string" ? { edgeId: value.edgeId } : {})
  };
}

function toCustomNodesUpdatedEvent(
  value: Record<string, unknown>
): Extract<ClabUiTopoViewerEvent, { type: "customNodesUpdated" }> {
  return {
    type: "customNodesUpdated",
    customNodes: Array.isArray(value.customNodes) ? value.customNodes : [],
    defaultNode: typeof value.defaultNode === "string" ? value.defaultNode : ""
  };
}

function toCustomNodeErrorEvent(
  value: Record<string, unknown>
): Extract<ClabUiTopoViewerEvent, { type: "customNodeError" }> | null {
  return typeof value.error === "string"
    ? {
      type: "customNodeError",
      error: value.error
    }
    : null;
}

function toIconListEvent(
  value: Record<string, unknown>
): Extract<ClabUiTopoViewerEvent, { type: "iconList" }> {
  return {
    type: "iconList",
    icons: Array.isArray(value.icons) ? value.icons : []
  };
}

function toLifecycleLogEvent(
  value: Record<string, unknown>
): Extract<ClabUiTopoViewerEvent, { type: "lifecycleLog" }> | null {
  const data = isRecord(value.data) ? value.data : undefined;
  if (typeof data?.line !== "string") {
    return null;
  }
  return {
    type: "lifecycleLog",
    line: data.line,
    stream: data.stream === "stderr" ? "stderr" : "stdout"
  };
}

function toLifecycleStatusEvent(
  value: Record<string, unknown>
): Extract<ClabUiTopoViewerEvent, { type: "lifecycleStatus" }> | null {
  const data = isRecord(value.data) ? value.data : undefined;
  if (data?.status !== "success" && data?.status !== "error") {
    return null;
  }

  return {
    type: "lifecycleStatus",
    status: data.status,
    ...(typeof data.errorMessage === "string" ? { errorMessage: data.errorMessage } : {})
  };
}

function toSvgExportResultEvent(
  value: Record<string, unknown>
): Extract<ClabUiTopoViewerEvent, { type: "svgExportResult" }> | null {
  if (typeof value.requestId !== "string" || typeof value.success !== "boolean") {
    return null;
  }
  return {
    type: "svgExportResult",
    requestId: value.requestId,
    success: value.success,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(Array.isArray(value.files)
      ? { files: value.files.filter((entry): entry is string => typeof entry === "string") }
      : {})
  };
}

function toTopoViewerEvent(value: unknown): ClabUiTopoViewerEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  switch (value.type) {
    case "topo-mode-changed":
      return toModeChangedEvent(value);
    case "panel-action":
      return toPanelActionEvent(value);
    case "custom-nodes-updated":
      return toCustomNodesUpdatedEvent(value);
    case "custom-node-error":
      return toCustomNodeErrorEvent(value);
    case "icon-list-response":
      return toIconListEvent(value);
    case "lab-lifecycle-log":
      return toLifecycleLogEvent(value);
    case "lab-lifecycle-status":
      return toLifecycleStatusEvent(value);
    case "fit-viewport":
      return { type: "fitViewport" };
    case "svg-export-result":
      return toSvgExportResultEvent(value);
    default:
      return null;
  }
}

function isTopologyHostMessageType(value: unknown): value is TopologyHostMessageType {
  return (
    value === "topology-host:snapshot" ||
    value === "topology-host:ack" ||
    value === "topology-host:reject" ||
    value === "topology-host:error"
  );
}

function isTopologyHostResponseMessage(value: unknown): value is TopologyHostResponseMessage {
  return (
    isRecord(value) &&
    isTopologyHostMessageType(value.type) &&
    typeof value.requestId === "string" &&
    typeof value.protocolVersion === "number"
  );
}

function isTopologySnapshot(value: unknown): value is TopologySnapshot {
  return (
    isRecord(value) &&
    typeof value.revision === "number" &&
    Array.isArray(value.nodes) &&
    Array.isArray(value.edges) &&
    isRecord(value.annotations)
  );
}

function isImageManagerResponseMessage(value: unknown): value is ImageManagerResponseMessage {
  return (
    isRecord(value) &&
    value.type === "image-manager:response" &&
    typeof value.requestId === "string" &&
    typeof value.success === "boolean"
  );
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function appendSessionId(path: string, sessionId?: string): string {
  if (!sessionId) return path;
  const delimiter = path.includes("?") ? "&" : "?";
  return `${path}${delimiter}sessionId=${encodeURIComponent(sessionId)}`;
}

function resolveTopologyPath(context: TopologyUiContext): string | undefined {
  return context.path ?? context.topologyRef?.yamlPath;
}

function createMessageSubscription(targetWindow: Window) {
  return (handler: (event: MessageEvent<unknown>) => void): (() => void) => {
    const listener = (event: Event) => {
      handler(event as MessageEvent<unknown>);
    };
    targetWindow.addEventListener("message", listener);
    return () => {
      targetWindow.removeEventListener("message", listener);
    };
  };
}

export function createWindowClabUiHost(options: WindowHostOptions = {}): ClabUiHost {
  const targetWindow = options.targetWindow ?? window;
  const resolvedVsCodeApi = options.vscodeApi ?? resolveWindowVsCodeApi(targetWindow);
  const postMessage =
    options.postMessage ?? ((message: unknown) => resolvedVsCodeApi?.postMessage(message));
  const subscribe = createMessageSubscription(targetWindow);

  const explorer =
    options.explorer ??
    {
      connect(): void {
        postMessage({ command: "ready" });
      },
      setFilter(filterText: string): void {
        postMessage({ command: "setFilter", value: filterText });
      },
      invokeAction(actionRef: string): void {
        postMessage({ command: "invokeAction", actionRef });
      },
      persistUiState(state: ExplorerUiState): void {
        postMessage({ command: "persistUiState", state });
      },
      subscribe(handler: (message: ExplorerIncomingMessage) => void): () => void {
        return subscribe((event) => {
          if (isExplorerIncomingMessage(event.data)) {
            handler(event.data);
          }
        });
      }
    };

  const topoViewer =
    options.topoViewer ??
    {
      runLifecycle(action: TopoViewerLifecycleAction): void {
        postMessage({ command: action });
      },
      cancelLifecycle(): void {
        postMessage({ command: "cancelLabLifecycle" });
      },
      toggleSplitView(): void {
        postMessage({ command: "topo-toggle-split-view" });
      },
      runNodeAction(action: TopoViewerNodeAction, nodeName: string): void {
        let command = "clab-node-view-logs";
        if (action === "ssh") {
          command = "clab-node-connect-ssh";
        } else if (action === "shell") {
          command = "clab-node-attach-shell";
        } else if (action === "start") {
          command = "clab-node-start";
        } else if (action === "stop") {
          command = "clab-node-stop";
        } else if (action === "restart") {
          command = "clab-node-restart";
        }
        postMessage({ command, nodeName });
      },
      captureInterface(nodeName: string, interfaceName: string): void {
        postMessage({ command: "clab-interface-capture", nodeName, interfaceName });
      },
      setLinkImpairment(nodeName: string, interfaceName: string, data: unknown): void {
        postMessage({ command: "clab-link-impairment", nodeName, interfaceName, data });
      },
      saveCustomNode(data: Record<string, unknown>): void {
        postMessage({ command: "save-custom-node", ...data });
      },
      deleteCustomNode(nodeName: string): void {
        postMessage({ command: "delete-custom-node", name: nodeName });
      },
      setDefaultCustomNode(nodeName: string): void {
        postMessage({ command: "set-default-custom-node", name: nodeName });
      },
      importCustomNodes(): void {
        postMessage({ command: "import-custom-nodes" });
      },
      requestIconList(): void {
        postMessage({ command: "icon-list" });
      },
      uploadIcon(): void {
        postMessage({ command: "icon-upload" });
      },
      deleteIcon(iconName: string): void {
        postMessage({ command: "icon-delete", iconName });
      },
      reconcileIcons(usedIcons: string[]): void {
        postMessage({ command: "icon-reconcile", usedIcons });
      },
      exportGrafanaBundle(payload: TopoViewerSvgExportPayload): void {
        postMessage({ command: "export-svg-grafana-bundle", ...payload });
      },
      dumpCssVars(vars: Record<string, string>): void {
        postMessage({ command: "dump-css-vars", vars });
      },
      subscribe(handler: (event: ClabUiTopoViewerEvent) => void): () => void {
        return subscribe((event) => {
          const topoViewerEvent = toTopoViewerEvent(event.data);
          if (topoViewerEvent) {
            handler(topoViewerEvent);
          }
        });
      }
    };

  const images =
    options.images ??
    (() => {
      const pending = new Map<string, PendingImageRequest>();
      let listenerStarted = false;

      const ensureListener = (): void => {
        if (listenerStarted) return;
        subscribe((event) => {
          if (!isImageManagerResponseMessage(event.data)) {
            return;
          }

          const request = pending.get(event.data.requestId);
          if (!request) {
            return;
          }

          clearTimeout(request.timeoutId);
          pending.delete(event.data.requestId);
          if (event.data.success) {
            request.resolve(event.data.result);
          } else {
            request.reject(new Error(event.data.error || "Image manager request failed"));
          }
        });
        listenerStarted = true;
      };

      const sendImageRequest = <T>(
        action: ImageManagerRequestAction,
        payload?: unknown,
        timeoutMs = 30_000
      ): Promise<T> => {
        ensureListener();
        const requestId = globalThis.crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            if (!pending.has(requestId)) {
              return;
            }
            pending.delete(requestId);
            reject(new Error("Image manager request timed out"));
          }, timeoutMs);
          pending.set(requestId, { resolve: (value) => resolve(value as T), reject, timeoutId });
          postMessage({
            command: "image-manager:request",
            requestId,
            action,
            payload
          });
        });
      };

      return {
        listImages(options) {
          return sendImageRequest("listImages", options);
        },
        listImageReferences(options) {
          return sendImageRequest("listImageReferences", options);
        },
        pullImage(request) {
          return sendImageRequest("pullImage", request, 30 * 60_000);
        },
        removeImage(request) {
          return sendImageRequest("removeImage", request);
        }
      } satisfies ClabUiImageHost;
    })();

  const topology =
    options.topology ??
    (() => {
      const pending = new Map<string, PendingTopologyRequest>();
      let listenerStarted = false;

      const ensureListener = (): void => {
        if (listenerStarted) return;
        subscribe((event) => {
          if (!isRecord(event.data) || !isTopologyHostMessageType(event.data.type)) {
            return;
          }

          const requestId = event.data.requestId;
          if (typeof requestId !== "string" || requestId.length === 0) {
            return;
          }

          const request = pending.get(requestId);
          if (!request) {
            return;
          }

          if (event.data.type === "topology-host:snapshot") {
            if (request.expectedType !== "snapshot" || !isTopologySnapshot(event.data.snapshot)) {
              clearTimeout(request.timeoutId);
              request.reject(new Error("Unexpected snapshot response"));
              pending.delete(requestId);
              return;
            }

            clearTimeout(request.timeoutId);
            request.resolve(event.data.snapshot);
            pending.delete(requestId);
            return;
          }

          if (request.expectedType !== "command" || !isTopologyHostResponseMessage(event.data)) {
            clearTimeout(request.timeoutId);
            request.reject(new Error("Unexpected command response"));
            pending.delete(requestId);
            return;
          }

          clearTimeout(request.timeoutId);
          request.resolve(event.data);
          pending.delete(requestId);
        });
        listenerStarted = true;
      };

      const sendRequest = (
        message: Record<string, unknown>,
        expectedType: "snapshot" | "command",
        timeoutMs = 30_000
      ): Promise<TopologyHostResponseMessage | TopologySnapshot> => {
        ensureListener();
        const requestId = globalThis.crypto.randomUUID();
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => {
            if (!pending.has(requestId)) {
              return;
            }
            pending.delete(requestId);
            reject(
              new Error(
                `${expectedType === "snapshot" ? "Snapshot" : "Command"} request timed out`
              )
            );
          }, timeoutMs);
          pending.set(requestId, { resolve, reject, expectedType, timeoutId });
          postMessage({ ...message, requestId });
        });
      };

      return {
        async requestSnapshot(
          _context: TopologyUiContext,
          options: TopologyUiRequestOptions = {}
        ): Promise<TopologySnapshot> {
          return (await sendRequest(
            {
              type: "topology-host:get-snapshot",
              protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
              externalChange: options.externalChange ?? false
            },
            "snapshot"
          )) as TopologySnapshot;
        },

        async dispatchCommand(
          _context: TopologyUiContext,
          revision: number,
          command: TopologyHostCommand
        ): Promise<TopologyHostResponseMessage> {
          return (await sendRequest(
            {
              type: "topology-host:command",
              protocolVersion: TOPOLOGY_HOST_PROTOCOL_VERSION,
              baseRevision: revision,
              command
            },
            "command"
          )) as TopologyHostResponseMessage;
        }
      };
    })();

  return {
    postMessage,
    subscribe,
    meta: {
      isDevMock: options.meta?.isDevMock ?? resolvedVsCodeApi?.__isDevMock__ === true,
      disableDevMockTraffic:
        options.meta?.disableDevMockTraffic ??
        resolvedVsCodeApi?.__disableDevMockTraffic__ === true
    },
    explorer,
    images,
    topoViewer,
    topology
  };
}

export function createApiClabUiHost(options: ApiHostOptions = {}): ClabUiHost {
  const baseHost = createWindowClabUiHost(options);
  const baseUrl = trimTrailingSlash(options.baseUrl ?? "");
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);

  const buildUrl = (path: string): string => `${baseUrl}${path}`;

  const postJson = async <T>(path: string, payload: unknown): Promise<T> => {
    const response = await fetchImpl(buildUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const parsedBody: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message =
        isRecord(parsedBody) && typeof parsedBody.error === "string"
          ? parsedBody.error
          : `API host request failed: ${response.status} ${response.statusText}`;
      throw new Error(message);
    }

    return parsedBody as T;
  };

  return {
    ...baseHost,
    images: options.images ?? baseHost.images,
    topology: options.topology ?? {
      async requestSnapshot(
        context: TopologyUiContext,
        options: TopologyUiRequestOptions = {}
      ): Promise<TopologySnapshot> {
        const payload = await postJson<{ snapshot?: TopologySnapshot }>(
          appendSessionId("/api/topology/snapshot", context.sessionId),
          {
            sessionId: context.sessionId,
            topologyRef: context.topologyRef,
            path: resolveTopologyPath(context),
            mode: context.mode,
            deploymentState: context.deploymentState,
            runtimeContainers: context.runtimeContainers,
            externalChange: options.externalChange ?? false
          }
        );

        if (!isRecord(payload) || !isRecord(payload.snapshot)) {
          throw new Error("Snapshot response payload is invalid");
        }

        return payload.snapshot as TopologySnapshot;
      },

      async dispatchCommand(
        context: TopologyUiContext,
        revision: number,
        command: TopologyHostCommand
      ): Promise<TopologyHostResponseMessage> {
        const payload = await postJson<TopologyHostResponseMessage>(
          appendSessionId("/api/topology/command", context.sessionId),
          {
            sessionId: context.sessionId,
            topologyRef: context.topologyRef,
            path: resolveTopologyPath(context),
            baseRevision: revision,
            command,
            mode: context.mode,
            deploymentState: context.deploymentState,
            runtimeContainers: context.runtimeContainers
          }
        );

        if (!isRecord(payload) || typeof payload.type !== "string") {
          throw new Error("Command response payload is invalid");
        }

        return payload;
      }
    }
  };
}

export interface CreateClabUiRuntimeOptions extends ClabUiExtensions {
  host: ClabUiHost;
  session?: TopologySessionClient;
  initialContext?: TopologyUiContext;
}

export function createClabUiRuntime(options: CreateClabUiRuntimeOptions): ClabUiRuntime {
  // host/session/initialContext are runtime wiring; everything else is the
  // ClabUiExtensions surface, passed straight through so adding an extension
  // never means editing this function.
  const { host, session: providedSession, initialContext, ...extensions } = options;
  const session =
    providedSession ?? createTopologySessionClient({ host, initialContext });

  return { host, session, ...extensions };
}
