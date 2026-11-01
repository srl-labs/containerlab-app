/**
 * Exec, VM snapshots, config save, inspect details and multi-node
 * start/stop/restart for the lab open in the topology view.
 */

import {
  normalizeLabSettings,
  type LabExecRequest,
  type LabOperationName,
  type LabSaveConfigsRequest,
  type LabSnapshotSaveRequest,
  type TopoViewerNodesAction
} from "@containerlab/clab-ui/host";

import { describeLabHost } from "@srl-labs/containerlab-lab-backend";

import { hostOfLabPath, labNameForPath, resolveLab } from "../../../backend/labBackends";
import { labHostIdentity } from "../../../backend/hostIdentity";
import { labSettingsFor, rememberLabSettings } from "../../../backend/labSettings";
import { runWithProgress } from "../../../commands/command";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isOperationName(value: unknown): value is LabOperationName {
  return (
    value === "support" ||
    value === "exec" ||
    value === "saveSnapshots" ||
    value === "saveConfigs" ||
    value === "inspectDetails" ||
    value === "hostInfo" ||
    value === "nodeLocations" ||
    value === "captureInterfaces" ||
    value === "exportManifests" ||
    value === "validate" ||
    value === "labSettings" ||
    value === "saveLabSettings"
  );
}

class LabOperationsService {
  /** Runs one operation for the topology at `labPath`; the raw lab host result. */
  async run(labPath: string, operation: unknown, rawRequest: unknown): Promise<unknown> {
    if (!isOperationName(operation)) {
      throw new Error(`Unknown lab operation "${String(operation)}".`);
    }
    const request = isRecord(rawRequest) ? rawRequest : {};
    const { backend, target } = await resolveLab(labPath);
    switch (operation) {
      case "support":
        return backend.labOperationSupport();
      case "exec": {
        const exec: LabExecRequest = {
          command: optionalString(request.command) ?? "",
          nodeNames: stringList(request.nodeNames),
          labels: stringList(request.labels)
        };
        return backend.exec(target, exec);
      }
      case "saveSnapshots": {
        const snapshots: LabSnapshotSaveRequest = {
          nodeNames: stringList(request.nodeNames),
          outputDir: optionalString(request.outputDir),
          timeout: optionalString(request.timeout)
        };
        return backend.saveSnapshots(target, snapshots);
      }
      case "saveConfigs": {
        const save: LabSaveConfigsRequest = {
          nodeNames: stringList(request.nodeNames),
          copyDir: optionalString(request.copyDir)
        };
        const nodeFilter = save.nodeNames?.join(",");
        return backend.save(target, {
          ...(nodeFilter ? { nodeFilter } : {}),
          ...(save.copyDir ? { copyDir: save.copyDir } : {})
        });
      }
      case "inspectDetails":
        return backend.inspectLabDetails(target);
      case "hostInfo":
        return { ...(await describeLabHost(backend)), host: labHostIdentity(labPath) };
      case "nodeLocations":
        // The inspect records; on c9s they say where each node runs.
        return backend.inspectLab(target.labName || labNameForPath(labPath));
      case "captureInterfaces":
        return backend.captureInterfaces(target.labName || labNameForPath(labPath));
      case "exportManifests":
        return backend.exportManifests({
          ...target,
          labName: target.labName || labNameForPath(labPath)
        });
      case "validate":
        return backend.validate({ ...target, labName: target.labName || labNameForPath(labPath) });
      case "labSettings":
        return labSettingsFor(hostOfLabPath(labPath).id, labPath) ?? null;
      case "saveLabSettings":
        await rememberLabSettings(
          hostOfLabPath(labPath).id,
          labPath,
          normalizeLabSettings(request.settings)
        );
        return null;
    }
  }

  /** `containerlab <action> --node a,b` with the usual progress notification. */
  async nodesAction(
    labPath: string,
    action: TopoViewerNodesAction,
    nodeNames: string[]
  ): Promise<void> {
    const nodes = nodeNames.join(", ");
    const past = { start: "Started", stop: "Stopped", restart: "Restarted" }[action];
    await runWithProgress(
      async ({ output }) => {
        const { backend, target } = await resolveLab(labPath);
        const result = await backend.nodesAction(target, nodeNames, action);
        for (const line of result.logs ?? []) output(line, "stdout");
      },
      {
        spinnerMsg: {
          progressMsg: `Running ${action} on ${nodes}...`,
          successMsg: `${past} ${nodes}`
        },
        actionName: action
      }
    );
  }
}

export const labOperationsService = new LabOperationsService();
