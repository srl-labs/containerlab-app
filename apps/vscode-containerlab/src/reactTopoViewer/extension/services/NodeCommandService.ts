/**
 * Node command service for React TopoViewer.
 * Handles SSH, shell attach, and log commands for container nodes.
 */

import * as vscode from "vscode";

import {
  type ClabContainerTreeNode,
  type ClabInterfaceTreeNode,
  type ClabLabTreeNode,
  flattenContainers
} from "../../../treeView/common";
import { runningLabsProvider } from "../../../globals";
import type { EndpointResult } from "@containerlab/clab-ui/session";

import { formatErrorMessage, log } from "./logger";

/**
 * Type guard to check if a value is a valid ClabLabTreeNode.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? Object.fromEntries(Object.entries(value)) : {};
}

function isClabLabTreeNode(value: unknown): value is ClabLabTreeNode {
  if (!isRecord(value)) {
    return false;
  }
  const obj = asRecord(value);
  const labPath = obj.labPath;
  if (!isRecord(labPath)) {
    return false;
  }
  const labPathRecord = asRecord(labPath);
  return typeof labPathRecord.absolute === "string" && labPathRecord.absolute.length > 0;
}

function labelToString(label: vscode.TreeItemLabel | string | undefined): string {
  if (typeof label === "string") return label;
  if (label !== undefined && typeof label.label === "string") return label.label;
  return "";
}

/**
 * Creates a default container node object when no matching container is found.
 */
function createDefaultContainerNode(nodeName: string): ClabContainerTreeNode {
  return {
    label: nodeName,
    name: nodeName,
    name_short: nodeName,
    cID: nodeName,
    state: "",
    kind: "",
    image: "",
    interfaces: [],
    labPath: { absolute: "", relative: "" },
    IPv4Address: "",
    IPv6Address: ""
  };
}

/**
 * Creates an interface object for capture command execution.
 */
function createInterfaceObject(
  nodeName: string,
  interfaceName: string,
  alias?: string
): ClabInterfaceTreeNode {
  return {
    label: interfaceName,
    parentName: nodeName,
    cID: nodeName,
    name: interfaceName,
    type: "",
    alias: alias ?? "",
    mac: "",
    mtu: 0,
    ifIndex: 0,
    state: ""
  };
}

/**
 * Service for handling node and interface command operations.
 * Executes VS Code commands for SSH, shell attach, and logs.
 */
class NodeCommandService {
  /**
   * Gets a container node by name from the running labs.
   */
  async getContainerNode(
    nodeName: string,
    yamlFilePath: string
  ): Promise<ClabContainerTreeNode | undefined> {
    const labsData = await runningLabsProvider.discoverInspectLabs();
    if (labsData === undefined || yamlFilePath.length === 0) {
      return undefined;
    }

    // Only search in the current lab
    const currentLab = Object.values(labsData).find((lab) => {
      if (!isClabLabTreeNode(lab)) {
        return false;
      }
      return lab.labPath.absolute === yamlFilePath;
    });

    if (currentLab === undefined || !isClabLabTreeNode(currentLab)) {
      return undefined;
    }

    const containers: ClabContainerTreeNode[] = flattenContainers(currentLab.containers);
    const directMatch = containers.find(
      (c: ClabContainerTreeNode) =>
        c.name === nodeName || c.name_short === nodeName || labelToString(c.label) === nodeName
    );
    if (directMatch) {
      return directMatch;
    }

    // Check for distributed SROS container
    return this.resolveDistributedSrosContainer(containers, nodeName);
  }

  /**
   * Resolves distributed SROS containers by finding the appropriate component.
   */
  private resolveDistributedSrosContainer(
    containers: ClabContainerTreeNode[],
    nodeName: string
  ): ClabContainerTreeNode | undefined {
    const normalizedTarget = nodeName.toLowerCase();
    const candidates = containers
      .filter((container) => container.kind === "nokia_srsim")
      .map((container) => ({ container, info: this.extractSrosComponentInfo(container) }))
      .filter(
        (
          entry
        ): entry is { container: ClabContainerTreeNode; info: { base: string; slot: string } } => {
          return !!entry.info && entry.info.base.toLowerCase() === normalizedTarget;
        }
      );

    if (!candidates.length) {
      return undefined;
    }

    candidates.sort((a, b) => {
      const slotOrder = this.srosSlotPriority(a.info.slot) - this.srosSlotPriority(b.info.slot);
      if (slotOrder !== 0) {
        return slotOrder;
      }
      return a.info.slot.localeCompare(b.info.slot, undefined, { sensitivity: "base" });
    });

    return candidates[0].container;
  }

  /**
   * Extracts SROS component info from container name.
   */
  private extractSrosComponentInfo(
    container: ClabContainerTreeNode
  ): { base: string; slot: string } | undefined {
    const rawLabel = (container.name_short || container.name || "").trim();
    if (!rawLabel) {
      return undefined;
    }

    const lastDash = rawLabel.lastIndexOf("-");
    if (lastDash === -1) {
      return undefined;
    }

    const base = rawLabel.slice(0, lastDash);
    const slot = rawLabel.slice(lastDash + 1);
    if (!base || !slot) {
      return undefined;
    }

    return { base, slot };
  }

  /**
   * Returns priority for SROS slot ordering (A=0, B=1, other=2).
   */
  private srosSlotPriority(slot: string): number {
    const normalized = slot.toLowerCase();
    if (normalized === "a") {
      return 0;
    }
    if (normalized === "b") {
      return 1;
    }
    return 2;
  }

  /**
   * Handles node-related endpoint commands (SSH, shell, logs).
   */
  async handleNodeEndpoint(
    endpointName: string,
    nodeName: string,
    yamlFilePath: string
  ): Promise<EndpointResult> {
    let result: unknown = null;
    let error: string | null = null;

    switch (endpointName) {
      case "clab-node-connect-ssh": {
        try {
          const containerNode =
            (await this.getContainerNode(nodeName, yamlFilePath)) ??
            createDefaultContainerNode(nodeName);
          await vscode.commands.executeCommand("containerlab.node.ssh", containerNode);
          result = `SSH connection executed for ${nodeName}`;
        } catch (innerError) {
          error = `Error executing SSH connection: ${formatErrorMessage(innerError)}`;
          log.error(`Error executing SSH connection: ${JSON.stringify(innerError, null, 2)}`);
        }
        break;
      }

      case "clab-node-attach-shell": {
        try {
          const node =
            (await this.getContainerNode(nodeName, yamlFilePath)) ??
            createDefaultContainerNode(nodeName);
          await vscode.commands.executeCommand("containerlab.node.attachShell", node);
          result = `Attach shell executed for ${nodeName}`;
        } catch (innerError) {
          error = `Error executing attach shell: ${formatErrorMessage(innerError)}`;
          log.error(`Error executing attach shell: ${JSON.stringify(innerError, null, 2)}`);
        }
        break;
      }

      case "clab-node-view-logs": {
        try {
          const node =
            (await this.getContainerNode(nodeName, yamlFilePath)) ??
            createDefaultContainerNode(nodeName);
          await vscode.commands.executeCommand("containerlab.node.showLogs", node);
          result = `Show logs executed for ${nodeName}`;
        } catch (innerError) {
          error = `Error executing show logs: ${formatErrorMessage(innerError)}`;
          log.error(`Error executing show logs: ${JSON.stringify(innerError, null, 2)}`);
        }
        break;
      }

      case "clab-node-start":
      case "clab-node-stop":
      case "clab-node-restart": {
        const action = endpointName.replace("clab-node-", "");
        try {
          const node = await this.getContainerNode(nodeName, yamlFilePath);
          if (node === undefined) {
            throw new Error(`Node "${nodeName}" was not found in the running lab.`);
          }
          await vscode.commands.executeCommand(`containerlab.node.${action}`, node);
          result = `${action} executed for ${nodeName}`;
        } catch (innerError) {
          error = `Error executing ${action}: ${formatErrorMessage(innerError)}`;
          log.error(`Error executing ${action}: ${JSON.stringify(innerError, null, 2)}`);
        }
        break;
      }

      default: {
        error = `Unknown endpoint "${endpointName}".`;
        log.error(error);
      }
    }

    return { result, error };
  }

  /**
   * Resolves the actual interface name from a logical name using the running labs data.
   */
  async resolveInterfaceName(
    nodeName: string,
    interfaceName: string,
    yamlFilePath: string
  ): Promise<string> {
    const [resolved] = await this.resolveInterfaces(nodeName, [interfaceName], yamlFilePath);
    return resolved.name;
  }

  /**
   * Resolves logical names (e.g. aliases) to the node's live interfaces in one inspect pass.
   * Each result keeps the alias, the port name users know for host-side link interfaces.
   */
  async resolveInterfaces(
    nodeName: string,
    interfaceNames: string[],
    yamlFilePath: string
  ): Promise<Array<{ name: string; alias: string }>> {
    const unresolved = interfaceNames.map((name) => ({ name, alias: "" }));
    const treeData = await runningLabsProvider.discoverInspectLabs();
    if (!treeData) return unresolved;

    const currentLab = Object.values(treeData).find((lab) => {
      if (!isClabLabTreeNode(lab)) {
        return false;
      }
      return lab.labPath.absolute === yamlFilePath;
    });

    if (currentLab === undefined || !isClabLabTreeNode(currentLab)) {
      return unresolved;
    }

    const container = flattenContainers(currentLab.containers).find(
      (c) => c.name === nodeName || c.name_short === nodeName || labelToString(c.label) === nodeName
    );
    return interfaceNames.map((interfaceName) => {
      const intf = container?.interfaces.find(
        (i: ClabInterfaceTreeNode) => i.name === interfaceName || i.alias === interfaceName
      );
      return intf ? { name: intf.name, alias: intf.alias } : { name: interfaceName, alias: "" };
    });
  }

  /**
   * Handles interface-related endpoint commands (capture).
   */
  async handleInterfaceEndpoint(
    endpointName: string,
    payloadObj: {
      nodeName: string;
      interfaceName: string;
      /** Several interfaces of the node, captured together in one session. */
      interfaceNames?: string[];
      /** The names are ports inside the node: capture them there, unresolved. */
      nodeNamespace?: boolean;
      data?: Record<string, unknown>;
    },
    yamlFilePath: string
  ): Promise<EndpointResult> {
    switch (endpointName) {
      case "clab-interface-capture": {
        try {
          const { nodeName, interfaceName } = payloadObj;
          const requested =
            payloadObj.interfaceNames && payloadObj.interfaceNames.length > 0
              ? payloadObj.interfaceNames
              : [interfaceName];
          const resolved = payloadObj.nodeNamespace
            ? requested.map((name) => ({ name, alias: "" }))
            : await this.resolveInterfaces(nodeName, requested, yamlFilePath);
          const actualNames = resolved.map((intf) => intf.name);
          const ifaces = resolved.map((intf, index) =>
            createInterfaceObject(
              nodeName,
              intf.name,
              intf.alias || (requested[index] !== intf.name ? requested[index] : "")
            )
          );
          if (ifaces.length > 1) {
            await vscode.commands.executeCommand(
              "containerlab.interface.capture",
              ifaces[0],
              ifaces
            );
          } else {
            await vscode.commands.executeCommand("containerlab.interface.capture", ifaces[0]);
          }
          return {
            result: `Capture executed for ${nodeName}/${actualNames.join(", ")}`,
            error: null
          };
        } catch (innerError) {
          const errorMsg = `Error executing capture: ${formatErrorMessage(innerError)}`;
          log.error(`Error executing capture: ${JSON.stringify(innerError, null, 2)}`);
          return { result: null, error: errorMsg };
        }
      }
      case "clab-link-impairment": {
        try {
          const { nodeName, interfaceName, data } = payloadObj;
          if (!data || !(data instanceof Object))
            return { result: null, error: `Invalid netem data: ${data}` };

          const actualInterfaceName = await this.resolveInterfaceName(
            nodeName,
            interfaceName,
            yamlFilePath
          );
          const iface = createInterfaceObject(
            nodeName,
            actualInterfaceName,
            interfaceName !== actualInterfaceName ? interfaceName : ""
          );
          await vscode.commands.executeCommand("containerlab.interface.setImpairment", iface, data);
          return { result: `Link impairment set for ${nodeName}:${interfaceName}`, error: null };
        } catch (innerError) {
          const errorMsg = `Error executing capture: ${formatErrorMessage(innerError)}`;
          log.error(`Error executing capture: ${JSON.stringify(innerError, null, 2)}`);
          return { result: null, error: errorMsg };
        }
      }
      default: {
        const errorMsg = `Unknown interface endpoint "${endpointName}".`;
        log.error(errorMsg);
        return { result: null, error: errorMsg };
      }
    }
  }
}

// Export a singleton instance
export const nodeCommandService = new NodeCommandService();
