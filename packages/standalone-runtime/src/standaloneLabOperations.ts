import {
  parseExecResponse,
  parseHostScriptResponse,
  parseInspectDetails,
  parseLabOperationSupport,
  parseSaveConfigsResponse,
  parseSnapshotSaveResponse,
  type ClabUiLabOperationsHost,
  type TopoViewerNodesAction
} from "@containerlab/clab-ui/host";
import { runtimeUiActions } from "@containerlab/clab-ui/workspace/state";

import { requestLabOperation, type RuntimeTargetRequest } from "./runtimeApi";

type TargetResolver = () => RuntimeTargetRequest | null;

function requireTarget(getTarget: TargetResolver): RuntimeTargetRequest {
  const target = getTarget();
  if (!target) throw new Error("No active topology session is available.");
  return target;
}

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
    runHostScript: async ({ outputTitle, ...request }) => {
      const target = requireTarget(getTarget);
      const result = parseHostScriptResponse(
        await requestLabOperation("host-script", { ...target, ...request })
      );
      if (outputTitle !== undefined) {
        const output = [result.stdout, result.stderr].filter((text) => text.trim() !== "").join("\n");
        const status = result.timedOut ? "timed out" : `exited with ${result.exitCode ?? "a signal"}`;
        runtimeUiActions.openTerminal({
          endpointId: target.endpointId,
          sessionId: `script-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          topologyRef: target.topologyRef,
          nodeName: outputTitle,
          protocol: "output",
          title: outputTitle,
          initialOutput: `${output.trim() || "(no output)"}\n\n[${status}]`
        });
      }
      return result;
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
