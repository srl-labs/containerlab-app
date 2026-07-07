import { useTopoViewerStore } from "@srl-labs/clab-ui";
import { createLifecycleCommandController } from "@srl-labs/clab-ui/host";
import {
  MSG_LAB_LIFECYCLE_LOG,
  MSG_LAB_LIFECYCLE_STATUS,
  MSG_CANCEL_LAB_LIFECYCLE,
  type LifecycleCommand as ExtensionLifecycleCommand,
  type TopologyRef
} from "@srl-labs/clab-ui/session";

import { refreshTopologyDirtyState } from "./standaloneDirtyState";
import { standaloneServerUrl } from "./standaloneServerOrigin";
import type {
  DeploymentState,
  LifecycleCommandEndpoint,
  LifecycleCommandStream,
  LifecycleCommandType
} from "./standaloneHostShared";

type StandaloneLifecycleCommand =
  | ExtensionLifecycleCommand
  | "applyLab"
  | "startLab"
  | "stopLab"
  | "restartLab";
type UiProcessingMode = "deploy" | "destroy" | "apply" | "start" | "stop" | "restart";

const LIFECYCLE_STATE_WAIT_TIMEOUT_MS = 120_000;
const LIFECYCLE_STATE_WAIT_POLL_MS = 750;
const LIFECYCLE_TIMESTAMP_LEVEL_PATTERN =
  /^(?:\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) (INFO|WARN|ERRO|ERROR|FATAL|PANIC)\b/;

interface LifecycleStreamEvent {
  type?: unknown;
  line?: unknown;
  stream?: unknown;
  message?: unknown;
  error?: unknown;
}

interface LifecycleCommandConfig {
  commandType: LifecycleCommandType;
  endpoint: LifecycleCommandEndpoint;
  cleanup: boolean;
  label: string;
}

interface ActiveLifecycleRequest {
  commandType: LifecycleCommandType;
  sessionId?: string;
  signal: AbortSignal;
  topologyRef: TopologyRef;
  isCurrent(): boolean;
  isCancelled(): boolean;
}

interface StandaloneLifecycleManagerOptions {
  getCurrentSessionId: () => string | null;
  getCurrentTopologyRef: () => TopologyRef | null;
  invalidateTopologyFileListCache: () => void;
  removeLabFromRuntimeStore: (topologyRef: Pick<TopologyRef, "labName" | "topologyId" | "yamlPath">) => void;
  refreshRuntimeStore?: (target: {
    sessionId?: string;
    topologyRef: TopologyRef;
  }) => Promise<void>;
  scheduleExplorerSnapshot: (delay?: number) => void;
  scheduleTopologySnapshotRefresh: (delay?: number) => void;
  syncHostContext: (options?: {
    mode?: "edit" | "view";
    deploymentState?: DeploymentState;
  }) => void;
}

export interface StandaloneLifecycleManager {
  cancel(): boolean;
  run(command: StandaloneLifecycleCommand): Promise<void>;
  runTarget(
    endpoint: LifecycleCommandEndpoint,
    topologyRef: TopologyRef,
    cleanup: boolean
  ): Promise<void>;
}

const LIFECYCLE_COMMAND_CONFIG: Record<StandaloneLifecycleCommand, LifecycleCommandConfig> = {
  deployLab: {
    commandType: "deploy",
    endpoint: "deploy",
    cleanup: false,
    label: "deploy"
  },
  deployLabCleanup: {
    commandType: "deploy",
    endpoint: "deploy",
    cleanup: true,
    label: "deploy (cleanup)"
  },
  destroyLab: {
    commandType: "destroy",
    endpoint: "destroy",
    cleanup: false,
    label: "destroy"
  },
  destroyLabCleanup: {
    commandType: "destroy",
    endpoint: "destroy",
    cleanup: true,
    label: "destroy (cleanup)"
  },
  redeployLab: {
    commandType: "redeploy",
    endpoint: "redeploy",
    cleanup: false,
    label: "redeploy"
  },
  redeployLabCleanup: {
    commandType: "redeploy",
    endpoint: "redeploy",
    cleanup: true,
    label: "redeploy (cleanup)"
  },
  applyLab: {
    commandType: "apply",
    endpoint: "apply",
    cleanup: false,
    label: "apply"
  },
  startLab: {
    commandType: "start",
    endpoint: "start",
    cleanup: false,
    label: "start"
  },
  stopLab: {
    commandType: "stop",
    endpoint: "stop",
    cleanup: false,
    label: "stop"
  },
  restartLab: {
    commandType: "restart",
    endpoint: "restart",
    cleanup: false,
    label: "restart"
  }
};

export function isStandaloneLifecycleCommand(command: string): command is StandaloneLifecycleCommand {
  return Object.prototype.hasOwnProperty.call(LIFECYCLE_COMMAND_CONFIG, command);
}

function postWebviewMessage(data: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function postLifecycleLogMessage(
  commandType: LifecycleCommandType,
  line: string,
  stream: LifecycleCommandStream
): void {
  postWebviewMessage({
    type: MSG_LAB_LIFECYCLE_LOG,
    data: { commandType, line, stream }
  });
}

function postLifecycleStatusMessage(
  commandType: LifecycleCommandType,
  status: "success" | "error",
  errorMessage?: string
): void {
  postWebviewMessage({
    type: MSG_LAB_LIFECYCLE_STATUS,
    data: { commandType, status, errorMessage }
  });
}

async function readLifecycleError(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (body.trim().length === 0) {
    return `${response.status} ${response.statusText}`.trim();
  }
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    if (typeof parsed.error === "string" && parsed.error.trim().length > 0) {
      return parsed.error;
    }
    if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
      return parsed.message;
    }
  } catch {
    // Fall back to raw body text for non-JSON responses.
  }
  return body;
}

function inferLifecycleLogStream(line: string): LifecycleCommandStream {
  const upper = line.toUpperCase();
  if (upper.includes(" ERROR ") || upper.includes(" FATAL ") || upper.includes("PANIC")) {
    return "stderr";
  }
  return "stdout";
}

function shouldDisplayLifecycleLogLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (LIFECYCLE_TIMESTAMP_LEVEL_PATTERN.test(trimmed)) {
    if (trimmed.includes(" username=")) {
      return false;
    }
    return true;
  }
  return (
    trimmed.startsWith("notice=") ||
    trimmed.startsWith("│") ||
    trimmed.startsWith("╭") ||
    trimmed.startsWith("├") ||
    trimmed.startsWith("╰") ||
    trimmed.startsWith("🎉=") ||
    trimmed.startsWith("deprecated type=")
  );
}

async function queryLabRunningState(target: {
  sessionId?: string;
  topologyRef: TopologyRef;
}): Promise<boolean> {
  const payload: { sessionId?: string; topologyRef: TopologyRef } = {
    topologyRef: target.topologyRef
  };
  if (target.sessionId) {
    payload.sessionId = target.sessionId;
  }
  const response = await fetch(standaloneServerUrl("/api/lab/status"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readLifecycleError(response));
  }
  const body = (await response.json()) as { running?: unknown };
  return body.running === true;
}

async function waitForExpectedLabRunningState(
  request: ActiveLifecycleRequest,
  expectedRunning: boolean
): Promise<boolean> {
  const deadline = Date.now() + LIFECYCLE_STATE_WAIT_TIMEOUT_MS;
  let previousRunningState: boolean | undefined;

  while (Date.now() < deadline) {
    if (!request.isCurrent() || request.isCancelled()) {
      return false;
    }

    let running: boolean;
    try {
      running = await queryLabRunningState({
        sessionId: request.sessionId,
        topologyRef: request.topologyRef
      });
    } catch (error) {
      if (!request.isCurrent() || request.isCancelled()) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      postLifecycleLogMessage(request.commandType, `Status check failed: ${message}`, "stderr");
      await new Promise((resolve) => {
        window.setTimeout(resolve, LIFECYCLE_STATE_WAIT_POLL_MS);
      });
      continue;
    }

    if (running !== previousRunningState) {
      previousRunningState = running;
      postLifecycleLogMessage(
        request.commandType,
        `Runtime state observed: ${running ? "deployed" : "undeployed"}`,
        "stdout"
      );
    }

    if (running === expectedRunning) {
      return true;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, LIFECYCLE_STATE_WAIT_POLL_MS);
    });
  }

  return false;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

function getLifecycleTypeFromProcessingMode(): LifecycleCommandType {
  const processingMode = String(useTopoViewerStore.getState().processingMode ?? "");
  switch (processingMode) {
    case "destroy":
    case "redeploy":
    case "apply":
    case "start":
    case "stop":
    case "restart":
      return processingMode;
    case "deploy":
    default:
      return "deploy";
  }
}

function lifecycleCommandForTarget(
  endpoint: LifecycleCommandEndpoint,
  cleanup: boolean
): StandaloneLifecycleCommand {
  if (endpoint === "deploy") {
    return cleanup ? "deployLabCleanup" : "deployLab";
  }
  if (endpoint === "destroy") {
    return cleanup ? "destroyLabCleanup" : "destroyLab";
  }
  if (endpoint === "redeploy") {
    return cleanup ? "redeployLabCleanup" : "redeployLab";
  }
  if (endpoint === "apply") {
    return "applyLab";
  }
  if (endpoint === "start") {
    return "startLab";
  }
  if (endpoint === "stop") {
    return "stopLab";
  }
  if (endpoint === "restart") {
    return "restartLab";
  }
  return cleanup ? "redeployLabCleanup" : "redeployLab";
}

function processingModeForLifecycle(commandType: LifecycleCommandType): UiProcessingMode {
  if (commandType === "destroy") {
    return "destroy";
  }
  if (
    commandType === "apply" ||
    commandType === "start" ||
    commandType === "stop" ||
    commandType === "restart"
  ) {
    return commandType;
  }
  return "deploy";
}

function shouldWaitForLabRunningState(commandType: LifecycleCommandType): boolean {
  return (
    commandType === "deploy" ||
    commandType === "destroy" ||
    commandType === "redeploy" ||
    commandType === "apply"
  );
}

function expectedRunningState(commandType: LifecycleCommandType): boolean {
  return commandType !== "destroy";
}

export function createStandaloneLifecycleManager(
  options: StandaloneLifecycleManagerOptions
): StandaloneLifecycleManager {
  const lifecycleController = createLifecycleCommandController<StandaloneLifecycleCommand>({
    isAbortError,
    onCancel(action) {
      const config = LIFECYCLE_COMMAND_CONFIG[action];
      postLifecycleLogMessage(config.commandType, "Lifecycle command cancelled by user.", "stderr");
      postLifecycleStatusMessage(
        config.commandType,
        "error",
        "Lifecycle command cancelled by user."
      );
    }
  });

  async function invokeLifecycleApiStream(
    endpoint: LifecycleCommandEndpoint,
    topologyRef: TopologyRef,
    cleanup: boolean,
    invokeOptions: {
      sessionId?: string;
      signal?: AbortSignal;
      onLog: (line: string, stream: LifecycleCommandStream) => void;
    }
  ): Promise<{ message?: string }> {
    const payload: { cleanup?: boolean; sessionId?: string; topologyRef: TopologyRef } = {
      topologyRef
    };
    if (cleanup) {
      payload.cleanup = true;
    }
    if (invokeOptions.sessionId) {
      payload.sessionId = invokeOptions.sessionId;
    }

    const response = await fetch(standaloneServerUrl(`/api/lab/${endpoint}/stream`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
      signal: invokeOptions.signal
    });

    if (!response.ok) {
      throw new Error(await readLifecycleError(response));
    }
    if (!response.body) {
      throw new Error("Lifecycle stream response has no body.");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let completionMessage: string | undefined;

    const processLine = (raw: string): void => {
      const trimmed = raw.trim();
      if (!trimmed) {
        return;
      }

      let event: LifecycleStreamEvent;
      try {
        event = JSON.parse(trimmed) as LifecycleStreamEvent;
      } catch {
        return;
      }

      if (event.type === "log" && typeof event.line === "string") {
        if (!shouldDisplayLifecycleLogLine(event.line)) {
          return;
        }
        const stream = event.stream === "stderr" ? "stderr" : inferLifecycleLogStream(event.line);
        invokeOptions.onLog(event.line, stream);
        return;
      }

      if (event.type === "done") {
        if (typeof event.message === "string" && event.message.trim().length > 0) {
          completionMessage = event.message;
        }
        return;
      }

      if (event.type === "error") {
        let errorMessage = "Lifecycle command failed.";
        if (typeof event.error === "string" && event.error.trim().length > 0) {
          errorMessage = event.error;
        } else if (typeof event.message === "string" && event.message.trim().length > 0) {
          errorMessage = event.message;
        }
        throw new Error(errorMessage);
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          processLine(line);
        }
      }
      const remainder = decoder.decode();
      if (remainder) {
        buffer += remainder;
      }
      if (buffer.trim().length > 0) {
        processLine(buffer);
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    return { message: completionMessage };
  }

  function syncActiveTopologyAfterLifecycle(
    commandType: LifecycleCommandType,
    topologyRef: TopologyRef
  ): void {
    const currentTopologyRef = options.getCurrentTopologyRef();
    if (!currentTopologyRef) {
      return;
    }
    if (currentTopologyRef.topologyId !== topologyRef.topologyId) {
      return;
    }

    options.syncHostContext({
      deploymentState: commandType === "destroy" ? "undeployed" : "deployed"
    });
    options.scheduleTopologySnapshotRefresh(0);
  }

  function createActiveLifecycleRequest(
    config: LifecycleCommandConfig,
    topologyRef: TopologyRef,
    execution: {
      signal: AbortSignal;
      isCurrent(): boolean;
      isCancelled(): boolean;
    },
    sessionId?: string
  ): ActiveLifecycleRequest {
    return {
      commandType: config.commandType,
      sessionId,
      signal: execution.signal,
      topologyRef,
      isCurrent: execution.isCurrent,
      isCancelled: execution.isCancelled
    };
  }

  function postLifecycleStart(config: LifecycleCommandConfig, label: string): void {
    postLifecycleLogMessage(
      config.commandType,
      `Starting ${config.label} for "${label}"...`,
      "stdout"
    );
    if (config.endpoint === "deploy" && config.cleanup) {
      postLifecycleLogMessage(
        config.commandType,
        "Cleanup is not supported by deploy API; running a standard deploy.",
        "stdout"
      );
    }
  }

  async function invokeConfiguredLifecycleStream(
    config: LifecycleCommandConfig,
    request: ActiveLifecycleRequest
  ): Promise<{ message?: string }> {
    postLifecycleLogMessage(config.commandType, `Sending ${config.label} request to API...`, "stdout");
    return await invokeLifecycleApiStream(config.endpoint, request.topologyRef, config.cleanup, {
      sessionId: request.sessionId,
      signal: request.signal,
      onLog: (line, stream) => {
        postLifecycleLogMessage(config.commandType, line, stream);
      }
    });
  }

  function handleLifecycleTimeout(
    config: LifecycleCommandConfig,
    topologyRef: TopologyRef,
    label: string,
    expectedRunning: boolean
  ): void {
    if (config.commandType === "destroy") {
      options.removeLabFromRuntimeStore(topologyRef);
      options.invalidateTopologyFileListCache();
      options.scheduleExplorerSnapshot(0);
    }
    postLifecycleStatusMessage(
      config.commandType,
      "error",
      `Timed out waiting for topology "${label}" to become ${expectedRunning ? "deployed" : "undeployed"}.`
    );
  }

  function completeLifecycleSuccess(config: LifecycleCommandConfig, topologyRef: TopologyRef): void {
    if (config.commandType === "destroy") {
      options.removeLabFromRuntimeStore(topologyRef);
    }

    options.invalidateTopologyFileListCache();
    options.scheduleExplorerSnapshot(0);
    syncActiveTopologyAfterLifecycle(config.commandType, topologyRef);
    refreshDirtyStateAfterLifecycle(config.commandType, topologyRef);
    postLifecycleLogMessage(config.commandType, `${config.label} completed.`, "stdout");
    postLifecycleStatusMessage(config.commandType, "success");
  }

  function refreshDirtyStateAfterLifecycle(
    commandType: LifecycleCommandType,
    topologyRef: TopologyRef
  ): void {
    if (commandType !== "deploy" && commandType !== "redeploy" && commandType !== "apply") {
      return;
    }
    const currentTopologyRef = options.getCurrentTopologyRef();
    if (!currentTopologyRef || currentTopologyRef.topologyId !== topologyRef.topologyId) {
      return;
    }
    // Dry-run apply confirms the runtime is in sync and stamps the result on
    // the server-side topology sessions as well.
    void refreshTopologyDirtyState({
      sessionId: options.getCurrentSessionId() ?? undefined,
      topologyRef
    });
  }

  async function refreshRuntimeStoreAfterLifecycle(
    config: LifecycleCommandConfig,
    request: ActiveLifecycleRequest
  ): Promise<void> {
    if (config.commandType === "destroy" || !options.refreshRuntimeStore) {
      return;
    }
    try {
      await options.refreshRuntimeStore({
        sessionId: request.sessionId,
        topologyRef: request.topologyRef
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      postLifecycleLogMessage(config.commandType, `Runtime refresh failed: ${message}`, "stderr");
    }
  }

  async function executeLifecycleCommand(
    config: LifecycleCommandConfig,
    topologyRef: TopologyRef,
    sessionId: string | undefined,
    execution: {
      signal: AbortSignal;
      isCurrent(): boolean;
      isCancelled(): boolean;
    }
  ): Promise<void> {
    const label = topologyRef.labName || topologyRef.yamlPath;
    const request = createActiveLifecycleRequest(config, topologyRef, execution, sessionId);
    postLifecycleStart(config, label);

    try {
      const lifecycleResponse = await invokeConfiguredLifecycleStream(config, request);
      if (!request.isCurrent() || request.isCancelled()) {
        return;
      }
      if (lifecycleResponse.message) {
        postLifecycleLogMessage(
          config.commandType,
          lifecycleResponse.message,
          inferLifecycleLogStream(lifecycleResponse.message)
        );
      }

      if (!shouldWaitForLabRunningState(config.commandType)) {
        await refreshRuntimeStoreAfterLifecycle(config, request);
        completeLifecycleSuccess(config, topologyRef);
        return;
      }

      const expectedRunning = expectedRunningState(config.commandType);
      postLifecycleLogMessage(
        config.commandType,
        `Request accepted. Waiting for runtime to become ${expectedRunning ? "deployed" : "undeployed"}...`,
        "stdout"
      );
      const reachedExpectedState = await waitForExpectedLabRunningState(request, expectedRunning);
      if (!request.isCurrent() || request.isCancelled()) {
        return;
      }
      if (!reachedExpectedState) {
        handleLifecycleTimeout(config, topologyRef, label, expectedRunning);
        return;
      }

      await refreshRuntimeStoreAfterLifecycle(config, request);
      completeLifecycleSuccess(config, topologyRef);
    } catch (error) {
      if (!request.isCurrent() || request.isCancelled() || isAbortError(error)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      postLifecycleStatusMessage(config.commandType, "error", message);
    }
  }

  async function executeStandaloneLifecycleCommand(
    command: StandaloneLifecycleCommand,
    execution: {
      signal: AbortSignal;
      isCurrent(): boolean;
      isCancelled(): boolean;
    }
  ): Promise<void> {
    const config = LIFECYCLE_COMMAND_CONFIG[command];
    const currentTopologyRef = options.getCurrentTopologyRef();
    if (!currentTopologyRef) {
      postLifecycleStatusMessage(
        getLifecycleTypeFromProcessingMode(),
        "error",
        "No active topology selected for lifecycle command."
      );
      return;
    }

    await executeLifecycleCommand(
      config,
      currentTopologyRef,
      options.getCurrentSessionId() ?? undefined,
      execution
    );
  }

  return {
    cancel() {
      if (!lifecycleController.cancel("Lifecycle command cancelled by user.")) {
        postLifecycleStatusMessage(
          getLifecycleTypeFromProcessingMode(),
          "error",
          "No active lifecycle command to cancel."
        );
        return false;
      }
      return true;
    },
    async run(command) {
      await lifecycleController.run(command, (execution) =>
        executeStandaloneLifecycleCommand(command, execution)
      );
    },
    async runTarget(endpoint, topologyRef, cleanup) {
      const command = lifecycleCommandForTarget(endpoint, cleanup);
      const config = LIFECYCLE_COMMAND_CONFIG[command];
      (
        useTopoViewerStore.getState().setProcessing as (
          isProcessing: boolean,
          mode?: UiProcessingMode
        ) => void
      )(true, processingModeForLifecycle(config.commandType));
      await lifecycleController.run(command, (execution) =>
        executeLifecycleCommand(config, topologyRef, undefined, execution)
      );
    }
  };
}

export { MSG_CANCEL_LAB_LIFECYCLE };
