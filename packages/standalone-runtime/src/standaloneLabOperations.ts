import {
  parseHostValidation,
  parseManifestExport,
  parseNodeLocations,
  parseExecResponse,
  parseInspectDetails,
  parseLabOperationSupport,
  parseSaveConfigsResponse,
  parseSnapshotSaveResponse,
  type ClabUiLabOperationsHost,
  type TopoViewerNodesAction
} from "@containerlab/clab-ui/host";

import { requestLabOperation, type RuntimeTargetRequest } from "./runtimeApi";
import { loadLabHostInfo } from "./stores/labHostStore";

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
    hostInfo: async () => {
      const endpointId = getTarget()?.endpointId;
      return endpointId ? await loadLabHostInfo(endpointId) : undefined;
    },
    nodeLocations: async () => parseNodeLocations(await run("node-locations")),
    exportManifests: async () => parseManifestExport(await run("manifests")),
    validate: async () => parseHostValidation(await run("validate"))
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
