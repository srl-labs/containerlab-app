/**
 * Deployment state checker for React TopoViewer.
 * Queries containerlab inspect data to determine if a lab is deployed.
 */

import * as inspector from "../../../treeView/inspector";
import { connectionOf, viewLabPath } from "../../../backend/labBackends";
import type { LabConnection } from "../../../backend/connections";
import type { DeploymentState } from "@containerlab/clab-ui/session";

import { formatErrorMessage, log } from "./logger";

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Checks deployment state of containerlab labs by querying inspect data.
 */
class DeploymentStateChecker {
  /**
   * Check if a lab is deployed by querying containerlab.
   */
  async checkDeploymentState(
    labName: string,
    topoFilePath: string | undefined,
    updateLabName?: (newLabName: string) => void
  ): Promise<DeploymentState> {
    try {
      // Only the lab's own connection; a slow lab host does not hold up a local lab.
      await inspector.updateOne(connectionOf(topoFilePath ?? ""));
      return this.resolveFromCache(labName, topoFilePath, updateLabName);
    } catch (err) {
      log.warn(`Failed to check deployment state: ${formatErrorMessage(err)}`);
      return "unknown";
    }
  }

  /**
   * Resolve deployment state from already-fetched inspect data without
   * triggering a refresh. Returns "unknown" when no inspect data is cached
   * yet (e.g. right after activation).
   */
  resolveFromCache(
    labName: string,
    topoFilePath: string | undefined,
    updateLabName?: (newLabName: string) => void
  ): DeploymentState {
    // The lab runs where its topology is: this machine, or the lab host of its URI.
    const connection = connectionOf(topoFilePath ?? "");
    const inspectData = inspector.labsOf(connection.id);
    if (!inspectData) {
      return "unknown";
    }

    if (labName in inspectData) {
      return "deployed";
    }

    if (topoFilePath !== undefined && topoFilePath.length > 0) {
      const matchedLabName = this.findLabByTopoFile(connection, inspectData, topoFilePath);
      if (matchedLabName !== null && matchedLabName.length > 0) {
        if (updateLabName !== undefined && matchedLabName !== labName) {
          log.info(
            `Updating lab name from '${labName}' to '${matchedLabName}' based on topo-file match`
          );
          updateLabName(matchedLabName);
        }
        return "deployed";
      }
    }

    return "undeployed";
  }

  /**
   * Find a lab by its topo-file path and return the lab name if found.
   */
  private findLabByTopoFile(
    connection: LabConnection,
    inspectData: Record<string, unknown[]>,
    topoFilePath: string
  ): string | null {
    const normalizedYamlPath = topoFilePath.replace(/\\/g, "/");

    for (const [deployedLabName, labData] of Object.entries(inspectData)) {
      const topo: unknown = Reflect.get(labData, "topo-file");
      if (!hasNonEmptyString(topo)) {
        continue;
      }
      // On a lab host, the topology's workspace URI when the host lists it
      const normalizedTopoFile = viewLabPath(connection, topo).replace(/\\/g, "/");
      if (normalizedTopoFile === normalizedYamlPath) {
        return deployedLabName;
      }
    }

    return null;
  }
}

// Export a singleton instance
export const deploymentStateChecker = new DeploymentStateChecker();
