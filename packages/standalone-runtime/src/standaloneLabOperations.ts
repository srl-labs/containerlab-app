import {
  parseHostValidation,
  parseLabCaptureInterfaces,
  parseManifestExport,
  parseNodeLocations,
  parseExecResponse,
  hostScriptOutcome,
  parseHostScriptDescription,
  parseHostScriptResponse,
  parseInspectDetails,
  parseLabOperationSupport,
  parseSaveConfigsResponse,
  parseSnapshotSaveResponse,
  type ClabUiLabOperationsHost,
  type TopoViewerNodesAction
} from "@containerlab/clab-ui/host";
import { runtimeUiActions } from "@containerlab/clab-ui/workspace/state";

import { requestLabOperation, streamHostScript, type RuntimeTargetRequest } from "./runtimeApi";
import { readLabSettings, writeLabSettings } from "./standaloneLabSettings";
import { loadLabHostInfo } from "./stores/labHostStore";

type TargetResolver = () => RuntimeTargetRequest | null;

function requireTarget(getTarget: TargetResolver): RuntimeTargetRequest {
  const target = getTarget();
  if (!target) throw new Error("No active topology session is available.");
  return target;
}

/** The output a dialog or notification keeps of a script, per stream. */
const MAX_DIALOG_OUTPUT_CHARS = 512 * 1024;

/** Lab operations of the open topology, straight to the app server. */
export function createStandaloneLabOperations(getTarget: TargetResolver): ClabUiLabOperationsHost {
  const run = (route: Parameters<typeof requestLabOperation>[0], body: object = {}) =>
    requestLabOperation(route, { ...requireTarget(getTarget), ...body });
  return {
    support: async () => parseLabOperationSupport(await run("support")),
    exec: async (request) =>
      parseExecResponse(await run("exec", request), request.nodeNames ?? []),
    saveSnapshots: async (request) => parseSnapshotSaveResponse(await run("snapshots", request)),
    saveConfigs: async (request) => parseSaveConfigsResponse(await run("save", request)),
    inspectDetails: async () => parseInspectDetails(await run("inspect-details")),
    describeHostScript: async (source) =>
      parseHostScriptDescription(await run("host-script/describe", source)),
    runHostScript: async ({ outputTitle, ...request }, options) => {
      const target = requireTarget(getTarget);
      // Dialog and notification output collects from the stream too, so Stop works the same.
      const controller = new AbortController();
      const stopScript = () => controller.abort();
      options?.signal?.addEventListener("abort", stopScript, { once: true });
      if (outputTitle === undefined) {
        const output = { stdout: "", stderr: "" };
        try {
          const result = parseHostScriptResponse(
            await streamHostScript(
              { ...target, ...request },
              (text, stream) => {
                output[stream] = `${output[stream]}${text}`.slice(-MAX_DIALOG_OUTPUT_CHARS);
              },
              controller.signal
            )
          );
          return { ...result, ...output };
        } finally {
          options?.signal?.removeEventListener("abort", stopScript);
        }
      }
      // Terminal output: open the pane now and fill it while the script runs.
      const paneId = runtimeUiActions.openTerminal({
        endpointId: target.endpointId,
        sessionId: `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        topologyRef: target.topologyRef,
        nodeName: outputTitle,
        protocol: "output",
        title: outputTitle,
        streaming: true
      });
      // Closing the pane stops the script.
      const unwatchPane = runtimeUiActions.onTerminalPaneClosed(paneId, stopScript);
      try {
        const result = parseHostScriptResponse(
          await streamHostScript(
            { ...target, ...request },
            (text) => runtimeUiActions.appendTerminalOutput(paneId, text),
            controller.signal
          )
        );
        const seconds = Math.round(result.durationMs / 100) / 10;
        runtimeUiActions.appendTerminalOutput(paneId, `\n[${hostScriptOutcome(result)} after ${seconds}s]\n`);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        runtimeUiActions.appendTerminalOutput(paneId, `\n[failed: ${message}]\n`);
        throw error;
      } finally {
        unwatchPane();
        options?.signal?.removeEventListener("abort", stopScript);
      }
    },
    hostInfo: async () => {
      const endpointId = getTarget()?.endpointId;
      return endpointId ? await loadLabHostInfo(endpointId) : undefined;
    },
    nodeLocations: async () => parseNodeLocations(await run("node-locations")),
    captureInterfaces: async () => parseLabCaptureInterfaces(await run("capture-interfaces")),
    exportManifests: async () => parseManifestExport(await run("manifests")),
    validate: async () => parseHostValidation(await run("validate")),
    // Lab settings stay in this browser, by lab host and topology file.
    labSettings: async () => readLabSettings(getTarget() ?? {}),
    saveLabSettings: async (settings) => {
      writeLabSettings(requireTarget(getTarget), settings);
    }
  };
}

/** Start, stop or restart several nodes of the open lab in one call. */
export async function controlNodesLifecycle(
  target: RuntimeTargetRequest,
  action: TopoViewerNodesAction,
  nodeNames: string[]
): Promise<string | undefined> {
  const result = await requestLabOperation(`nodes/${action}`, { ...target, nodeNames });
  return typeof result === "object" && result !== null && "message" in result
    ? String((result as { message?: unknown }).message ?? "") || undefined
    : undefined;
}
