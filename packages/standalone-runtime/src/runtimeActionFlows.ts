export * from "@containerlab/clab-ui/workspace/state";
import { confirmRuntimeAction, runtimeUiActions } from "@containerlab/clab-ui/workspace/state";
import { deleteTopologyFile, saveLabConfigs, type RuntimeTargetRequest } from "./runtimeApi";

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
  },
  successLabel: string
): Promise<void> {
  try {
    const response = await saveLabConfigs(target);
    runtimeUiActions.notify(response.message || successLabel, "success");
  } catch (error) {
    runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
