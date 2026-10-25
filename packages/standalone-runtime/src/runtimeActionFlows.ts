export * from "@containerlab/clab-ui/workspace/state";
import { confirmRuntimeAction, runtimeUiActions } from "@containerlab/clab-ui/workspace/state";
import {
  deleteTopologyFile,
  requestLabOperation,
  saveLabConfigs,
  type RuntimeTargetRequest,
  type SaveConfigResponse
} from "./runtimeApi";

export async function deleteTopologyFileFlow(target: RuntimeTargetRequest): Promise<boolean> {
  const fileLabel = target.topologyRef?.yamlPath ?? "this topology file";
  const confirmed = await confirmRuntimeAction({
    title: "Delete Topology File",
    message: `Delete ${fileLabel}?`,
    confirmLabel: "Delete",
    severity: "error"
  });
  if (!confirmed) {
    return false;
  }

  try {
    await deleteTopologyFile(target);
    runtimeUiActions.notify(`Deleted ${fileLabel}.`, "success");
    return true;
  } catch (error) {
    runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
    return false;
  }
}

export async function saveConfigsFlow(
  target: {
    endpointId?: string;
    sessionId?: string;
    topologyRef?: RuntimeTargetRequest["topologyRef"];
    nodeName?: string;
    /** `save --copy`: goes through the lab operations route, which takes it. */
    copyDir?: string;
  },
  successLabel: string
): Promise<void> {
  try {
    const { copyDir, ...rest } = target;
    const response = copyDir
      ? ((await requestLabOperation("save", { ...rest, copyDir })) as SaveConfigResponse)
      : await saveLabConfigs(rest);
    runtimeUiActions.notify(response.message || successLabel, "success");
  } catch (error) {
    runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
