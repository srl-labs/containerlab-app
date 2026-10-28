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
import type { SchemaData } from "../core/schema";
import type {
  ClabUiEditorDataHost,
  ClabUiExplorerHost,
  ClabUiHost,
  ClabUiImageHost,
  ClabUiTopoViewerEvent,
  ClabUiTopoViewerHost,
  CaptureInterfacesOptions,
  CaptureTargetRef,
  TopologyUiContext,
  TopologyUiRequestOptions,
  TopoViewerLifecycleAction,
  TopoViewerNodeAction,
  TopoViewerNodesAction,
  TopoViewerSvgExportPayload
} from "./contracts";
import type { ClabUiExtensions, ClabUiRuntime } from "./runtimeContext";
import type { LabLifecycleOptions } from "./lifecycleOptions";
import { parseApplyPlan, type ApplyPlan } from "./applyPlan";
import { parseTailscaleStatus, type TailscaleStatus } from "./tailscaleStatus";
import { isRecord } from "../core/utilities/typeHelpers";
import {
  MSG_LAB_OPERATION,
  MSG_OPEN_LAB_FILE,
  MSG_PLAN_APPLY_LAB,
  MSG_TAILSCALE_STATUS,
  MSG_VALIDATE_TOPOLOGY
} from "../core/messages/extension";
import {
  MSG_APPLY_PLAN_RESULT,
  MSG_LAB_OPERATION_RESULT,
  MSG_TAILSCALE_STATUS_RESULT
} from "../core/messages/webview";
import { createLabOperationsRequester } from "./labOperations";
export * from "./applyPlan";
export * from "./controllers";
export * from "./contracts";
export * from "./labFiles";
export * from "./labHostSupport";
export * from "./labOperations";
export * from "./lifecycleOptions";
export * from "./runtimeContext";
export * from "./runtimeModel";
export * from "./tailscaleStatus";
export * from "./topologyVariables";
export {
  resolveNodeCredentialsFromYaml,
  type CredentialsLevel,
  type ResolvedNodeCredentials
} from "../core/parsing/NodeCredentials";
export {
  DEFAULT_EXEC_COMMANDS_BY_KIND,
  DEFAULT_SSH_USERS_BY_KIND
} from "../core/constants/nodeKindDefaults";

function newId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
}

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
  editorData?: ClabUiEditorDataHost;
  /** Bootstrap data for the window-backed editor data; defaults to the page's injected initial data. */
  initialData?: { schemaData?: SchemaData; dockerImages?: string[] };
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
    case "focus-node":
      return typeof value.nodeId === "string" && value.nodeId.trim()
        ? { type: "focusNode", nodeId: value.nodeId.trim() }
        : null;
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function isSchemaData(value: unknown): value is SchemaData {
  return isRecord(value) && Array.isArray(value.kinds) && isRecord(value.typesByKind);
}

function createWindowEditorData(
  targetWindow: Window,
  subscribe: (handler: (event: MessageEvent<unknown>) => void) => () => void,
  options: WindowHostOptions
): ClabUiEditorDataHost {
  const injected = (targetWindow as Window & { __INITIAL_DATA__?: unknown }).__INITIAL_DATA__;
  const initialData: Record<string, unknown> =
    options.initialData ?? (isRecord(injected) ? injected : {});
  const schema = isSchemaData(initialData.schemaData) ? initialData.schemaData : undefined;
  let dockerImages = isStringArray(initialData.dockerImages) ? initialData.dockerImages : undefined;
  const handlers = new Set<(images: string[]) => void>();

  subscribe((event) => {
    const message = event.data;
    if (
      !isRecord(message) ||
      message.type !== "docker-images-updated" ||
      !isStringArray(message.dockerImages)
    ) {
      return;
    }
    dockerImages = message.dockerImages;
    for (const handler of handlers) {
      handler(message.dockerImages);
    }
  });

  return {
    getSchema: () => schema,
    getDockerImages: () => dockerImages,
    subscribeDockerImages(handler) {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }
  };
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

/** A dry run reads the whole lab from the runtime, which can take a while on big labs. */
const APPLY_PLAN_TIMEOUT_MS = 120_000;
/** The status runs `tailscale status` in every Tailscale container of the lab. */
const TAILSCALE_STATUS_TIMEOUT_MS = 60_000;

interface PendingHostRequest<T> {
  resolve: (value: T) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface HostRequestSpec<T> {
  /** Command posted to the host, with a `requestId` */
  command: string;
  /** `type` of the answer, which carries the same `requestId` */
  resultType: string;
  timeoutMs: number;
  timeoutMessage: string;
  /** Reads the answer; throws to reject the request. */
  read: (message: Record<string, unknown>) => T;
}

/** A request answered by one message from the host, matched by `requestId`. */
function createHostRequester<T>(
  postMessage: (message: unknown) => void,
  subscribe: (handler: (event: MessageEvent<unknown>) => void) => () => void,
  spec: HostRequestSpec<T>
): () => Promise<T> {
  const pending = new Map<string, PendingHostRequest<T>>();
  let listenerStarted = false;

  const ensureListener = (): void => {
    if (listenerStarted) return;
    subscribe((event) => {
      const message = event.data;
      if (!isRecord(message) || message.type !== spec.resultType) return;
      const requestId = typeof message.requestId === "string" ? message.requestId : "";
      const request = pending.get(requestId);
      if (!request) return;
      clearTimeout(request.timeoutId);
      pending.delete(requestId);
      try {
        request.resolve(spec.read(message));
      } catch (error) {
        request.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    listenerStarted = true;
  };

  return () => {
    ensureListener();
    const requestId = newId();
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (!pending.delete(requestId)) return;
        reject(new Error(spec.timeoutMessage));
      }, spec.timeoutMs);
      pending.set(requestId, { resolve, reject, timeoutId });
      postMessage({ command: spec.command, requestId });
    });
  };
}

function messageError(message: Record<string, unknown>, fallback: string): Error {
  const error = typeof message.error === "string" && message.error ? message.error : "";
  return new Error(error || fallback);
}

function createApplyPlanRequester(
  postMessage: (message: unknown) => void,
  subscribe: (handler: (event: MessageEvent<unknown>) => void) => () => void
): () => Promise<ApplyPlan> {
  return createHostRequester(postMessage, subscribe, {
    command: MSG_PLAN_APPLY_LAB,
    resultType: MSG_APPLY_PLAN_RESULT,
    timeoutMs: APPLY_PLAN_TIMEOUT_MS,
    timeoutMessage: "The dry run timed out",
    read: (message) => {
      const plan = message.success === true ? parseApplyPlan(message.plan) : undefined;
      if (!plan) throw messageError(message, "The dry run returned no plan");
      return plan;
    }
  });
}

function createTailscaleStatusRequester(
  postMessage: (message: unknown) => void,
  subscribe: (handler: (event: MessageEvent<unknown>) => void) => () => void
): () => Promise<TailscaleStatus | undefined> {
  return createHostRequester(postMessage, subscribe, {
    command: MSG_TAILSCALE_STATUS,
    resultType: MSG_TAILSCALE_STATUS_RESULT,
    timeoutMs: TAILSCALE_STATUS_TIMEOUT_MS,
    timeoutMessage: "The Tailscale status timed out",
    read: (message) => {
      if (message.success !== true) throw messageError(message, "Tailscale status failed");
      if (message.status === undefined || message.status === null) return undefined;
      const status = parseTailscaleStatus(message.status);
      if (!status) throw new Error("The lab host returned no Tailscale status");
      return status;
    }
  });
}

function postNodesAction(
  postMessage: (message: unknown) => void,
  action: TopoViewerNodesAction,
  nodeNames: string[]
): void {
  const first = nodeNames.at(0);
  if (first === undefined) return;
  // Hosts that predate `nodeNames` act on the first node.
  postMessage({ command: `clab-node-${action}`, nodeName: first, nodeNames });
}

function lifecycleMessage(
  action: TopoViewerLifecycleAction,
  options: LabLifecycleOptions | undefined
): Record<string, unknown> {
  return options ? { command: action, options } : { command: action };
}

export function createWindowClabUiHost(options: WindowHostOptions = {}): ClabUiHost {
  const targetWindow = options.targetWindow ?? window;
  const resolvedVsCodeApi = options.vscodeApi ?? resolveWindowVsCodeApi(targetWindow);
  const postMessage =
    options.postMessage ?? ((message: unknown) => resolvedVsCodeApi?.postMessage(message));
  const subscribe = createMessageSubscription(targetWindow);
  const labOperations = createLabOperationsRequester({
    postMessage,
    subscribe,
    requestMessage: MSG_LAB_OPERATION,
    resultMessage: MSG_LAB_OPERATION_RESULT,
    newId
  });

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
      runLifecycle(action: TopoViewerLifecycleAction, lifecycleOptions?: LabLifecycleOptions): void {
        postMessage(lifecycleMessage(action, lifecycleOptions));
      },
      planApply: createApplyPlanRequester(postMessage, subscribe),
      tailscaleStatus: createTailscaleStatusRequester(postMessage, subscribe),
      cancelLifecycle(): void {
        postMessage({ command: "cancelLabLifecycle" });
      },
      validateTopology(): void {
        postMessage({ command: MSG_VALIDATE_TOPOLOGY });
      },
      toggleSplitView(): void {
        postMessage({ command: "topo-toggle-split-view" });
      },
      openLabFile(request): void {
        postMessage({ command: MSG_OPEN_LAB_FILE, path: request.path, create: request.create === true });
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
      runNodesAction(action: TopoViewerNodesAction, nodeNames: string[]): void {
        postNodesAction(postMessage, action, nodeNames);
      },
      labOperations,
      labHost: () => labOperations.hostInfo(),
      captureInterface(
        nodeName: string,
        interfaceName: string,
        options: Pick<CaptureInterfacesOptions, "label"> = {}
      ): void {
        postMessage({
          command: "clab-interface-capture",
          nodeName,
          interfaceName,
          ...(options.label !== undefined ? { captureLabel: options.label } : {})
        });
      },
      captureInterfaces(
        nodeName: string,
        interfaceNames: string[],
        options: CaptureInterfacesOptions = {}
      ): void {
        if (interfaceNames.length === 0) return;
        postMessage({
          command: "clab-interface-capture",
          nodeName,
          interfaceName: interfaceNames[0],
          interfaceNames,
          ...(options.nodeNamespace === true ? { nodeNamespace: true } : {}),
          ...(options.label !== undefined ? { captureLabel: options.label } : {})
        });
      },
      captureTargets(
        targets: CaptureTargetRef[],
        options: Pick<CaptureInterfacesOptions, "label"> = {}
      ): void {
        const first = targets.at(0);
        if (!first) return;
        postMessage({
          command: "clab-interface-capture",
          // Hosts that predate targets capture the first one.
          nodeName: first.nodeName,
          interfaceName: first.interfaceName,
          targets,
          ...(options.label !== undefined ? { captureLabel: options.label } : {})
        });
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
        const requestId = newId();
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
        const requestId = newId();
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
    editorData: options.editorData ?? createWindowEditorData(targetWindow, subscribe, options),
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

  const postJson = async <T>(path: string, payload: unknown, readOnly = false): Promise<T> => {
    const sendRequest = () => fetchImpl(buildUrl(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    let response: Response;
    try {
      response = await sendRequest();
    } catch (error) {
      // Lab network changes can briefly invalidate browser connections. Snapshot
      // reads are safe to retry; commands may already have been applied.
      if (!readOnly || !(error instanceof TypeError)) throw error;
      response = await sendRequest();
    }

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
          },
          true
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
