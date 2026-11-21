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
import { connectionOf } from "../../../backend/labBackends";
import { isClusterConnection } from "../../../backend/connections";
import type { EndpointResult } from "@containerlab/clab-ui/session";
import { shellTerminalName } from "../../../commands/nodeExec";

import { formatErrorMessage, log } from "./logger";

/** How long a shell Attach Shell just opened gets to connect and start its CLI. */
const NEW_SHELL_SETTLE_MS = 3000;
/** Between typed lines, so an interactive CLI answers one before the next. */
const LINE_INTERVAL_MS = 300;
const SHELL_OPEN_TIMEOUT_MS = 5000;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openTerminalNamed(name: string): vscode.Terminal | undefined {
  return vscode.window.terminals.find(
    (terminal) => terminal.name === name && terminal.exitStatus === undefined
  );
}

async function waitForTerminal(name: string): Promise<vscode.Terminal | undefined> {
  for (let waited = 0; waited < SHELL_OPEN_TIMEOUT_MS; waited += 100) {
    const terminal = openTerminalNamed(name);
    if (terminal) return terminal;
    await wait(100);
  }
  return openTerminalNamed(name);
}

/** The text as lines to type; trailing empty lines go. */
function inputLines(text: string): string[] {
  const body = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return body === "" ? [] : body.split("\n");
}

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

/** A port the canvas names, matched to a running container of the lab when there is one. */
interface ResolvedInterface {
  /** The interface in the container, e.g. a host-side link end (clab-s-*). */
  name: string;
  /** The port name users know, e.g. the SR OS port 1/1/c1/1. */
  alias: string;
  container?: ClabContainerTreeNode;
}

/**
 * Creates an interface object for capture command execution. It names the
 * container the port is in, as Edgeshark and the capture stream look it up.
 */
function createInterfaceObject(
  nodeName: string,
  intf: ResolvedInterface,
  requestedName: string
): ClabInterfaceTreeNode {
  const { container } = intf;
  return {
    label: intf.name,
    parentName: container?.name ?? nodeName,
    cID: container?.cID ?? nodeName,
    name: intf.name,
    type: "",
    alias: intf.alias || (requestedName !== intf.name ? requestedName : ""),
    mac: "",
    mtu: 0,
    ifIndex: 0,
    state: "",
    ...(container?.labName !== undefined && container.labName !== ""
      ? { labName: container.labName }
      : {})
  };
}

/**
 * Interfaces of a topology that runs on a Kubernetes cluster carry the
 * cluster's connection, so the capture goes through its capture stream.
 */
function onTopologyHost(iface: ClabInterfaceTreeNode, yamlFilePath: string): ClabInterfaceTreeNode {
  const connection = connectionOf(yamlFilePath);
  return isClusterConnection(connection)
    ? Object.assign(iface, { connectionId: connection.id })
    : iface;
}

/**
 * Service for handling node and interface command operations.
 * Executes VS Code commands for SSH, shell attach, and logs.
 */
class NodeCommandService {
  /** Containers of the lab the topology file runs as; none when it is not running. */
  private async labContainers(yamlFilePath: string): Promise<ClabContainerTreeNode[]> {
    if (yamlFilePath.length === 0) {
      return [];
    }
    const labsData = await runningLabsProvider.discoverInspectLabs();
    if (labsData === undefined) {
      return [];
    }
    const currentLab = Object.values(labsData).find(
      (lab) => isClabLabTreeNode(lab) && lab.labPath.absolute === yamlFilePath
    );
    return currentLab !== undefined && isClabLabTreeNode(currentLab)
      ? flattenContainers(currentLab.containers)
      : [];
  }

  /**
   * Containers a node name from the canvas stands for, the likeliest first:
   * the container itself, else the components of a distributed SR-SIM node.
   */
  private matchContainers(
    containers: ClabContainerTreeNode[],
    nodeName: string
  ): ClabContainerTreeNode[] {
    const direct = containers.filter(
      (c) => c.name === nodeName || c.name_short === nodeName || labelToString(c.label) === nodeName
    );
    return direct.length > 0 ? direct : this.distributedSrosContainers(containers, nodeName);
  }

  /**
   * Gets a container node by name from the running labs.
   */
  async getContainerNode(
    nodeName: string,
    yamlFilePath: string
  ): Promise<ClabContainerTreeNode | undefined> {
    return this.matchContainers(await this.labContainers(yamlFilePath), nodeName).at(0);
  }

  /**
   * Components of a distributed SR-SIM node, CPM A first. The node is named as
   * in the topology (sr1) or with the lab's container prefix (clab-lab-sr1).
   */
  private distributedSrosContainers(
    containers: ClabContainerTreeNode[],
    nodeName: string
  ): ClabContainerTreeNode[] {
    const target = nodeName.toLowerCase();
    const candidates = containers.flatMap((container) => {
      if (container.kind !== "nokia_srsim") {
        return [];
      }
      const info = [container.name_short, container.name]
        .map((name) => this.extractSrosComponentInfo(name))
        .find((entry) => entry?.base.toLowerCase() === target);
      return info ? [{ container, slot: info.slot }] : [];
    });

    candidates.sort(
      (a, b) =>
        this.srosSlotPriority(a.slot) - this.srosSlotPriority(b.slot) ||
        a.slot.localeCompare(b.slot, undefined, { sensitivity: "base" })
    );
    return candidates.map((entry) => entry.container);
  }

  /**
   * Splits an SR-SIM component container name into node and slot (sr1-a).
   */
  private extractSrosComponentInfo(
    containerName: string | undefined
  ): { base: string; slot: string } | undefined {
    const rawLabel = (containerName ?? "").trim();
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

  /** Guide text each node's shell is still being given, so the next block waits its turn. */
  private readonly terminalInputs = new Map<string, Promise<unknown>>();

  /**
   * Types a lab guide's terminal block into the node's shell, opening it first
   * as Attach Shell does. VS Code cannot read what a terminal prints, so a new
   * shell gets a moment to start and the lines go out at a typing pace.
   *
   * Blocks for one node go out one after the other: a second block would
   * otherwise find the shell the first just opened and type into it before
   * the first block, while the shell is still starting.
   */
  sendTerminalInput(nodeName: string, text: string, yamlFilePath: string): Promise<EndpointResult> {
    const key = `${yamlFilePath}\n${nodeName}`;
    const typed = (this.terminalInputs.get(key) ?? Promise.resolve()).then(() =>
      this.typeIntoShell(nodeName, text, yamlFilePath)
    );
    this.terminalInputs.set(key, typed);
    void typed.then(() => {
      if (this.terminalInputs.get(key) === typed) this.terminalInputs.delete(key);
    });
    return typed;
  }

  private async typeIntoShell(
    nodeName: string,
    text: string,
    yamlFilePath: string
  ): Promise<EndpointResult> {
    try {
      const node =
        (await this.getContainerNode(nodeName, yamlFilePath)) ??
        createDefaultContainerNode(nodeName);
      const name = shellTerminalName(node);
      const wasOpen = openTerminalNamed(name) !== undefined;
      await vscode.commands.executeCommand("containerlab.node.attachShell", node);
      const terminal = await waitForTerminal(name);
      if (!terminal) {
        return { result: null, error: `No shell opened on ${nodeName}.` };
      }
      if (!wasOpen) await wait(NEW_SHELL_SETTLE_MS);
      const lines = inputLines(text);
      for (const [index, line] of lines.entries()) {
        if (index > 0) await wait(LINE_INTERVAL_MS);
        // The shell may have closed while the lines went out.
        if (terminal.exitStatus !== undefined) {
          return {
            result: null,
            error: `The shell on ${nodeName} closed before the text was typed.`
          };
        }
        terminal.sendText(line, true);
      }
      return {
        result: `Typed ${lines.length} line${lines.length === 1 ? "" : "s"} into the shell of ${nodeName}`,
        error: null
      };
    } catch (error) {
      return {
        result: null,
        error: `Error typing into the shell of ${nodeName}: ${formatErrorMessage(error)}`
      };
    }
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
   * Resolves logical names (e.g. aliases) to the node's live interfaces in one inspect pass.
   * Each result keeps the alias, the port name users know for host-side link interfaces,
   * and the container the port is in: a distributed SR-SIM node is several containers.
   * With `nodeNamespace` the names are ports inside the node and stay as they are.
   */
  async resolveInterfaces(
    nodeName: string,
    interfaceNames: string[],
    yamlFilePath: string,
    nodeNamespace = false
  ): Promise<ResolvedInterface[]> {
    const containers = this.matchContainers(await this.labContainers(yamlFilePath), nodeName);
    return interfaceNames.map((interfaceName) => {
      if (!nodeNamespace) {
        for (const container of containers) {
          const intf = container.interfaces.find(
            (i: ClabInterfaceTreeNode) => i.name === interfaceName || i.alias === interfaceName
          );
          if (intf) return { name: intf.name, alias: intf.alias, container };
        }
      }
      const container = containers.at(0);
      return { name: interfaceName, alias: "", ...(container ? { container } : {}) };
    });
  }

  /**
   * Captures ports of several nodes. Each is resolved in its own node; the
   * capture command then streams ports that share a namespace together.
   */
  private async captureTargets(
    targets: Array<{ nodeName: string; interfaceName: string }>,
    yamlFilePath: string
  ): Promise<EndpointResult> {
    const ifaces: ClabInterfaceTreeNode[] = [];
    for (const target of targets) {
      const [intf] = await this.resolveInterfaces(
        target.nodeName,
        [target.interfaceName],
        yamlFilePath
      );
      ifaces.push(
        onTopologyHost(
          createInterfaceObject(target.nodeName, intf, target.interfaceName),
          yamlFilePath
        )
      );
    }
    await vscode.commands.executeCommand("containerlab.interface.capture", ifaces[0], ifaces);
    return {
      result: `Capture executed for ${ifaces.map((intf) => `${intf.parentName}/${intf.name}`).join(", ")}`,
      error: null
    };
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
      /** Ports of several nodes, e.g. both ends of a link, in as few sessions as possible. */
      targets?: Array<{ nodeName: string; interfaceName: string }>;
      data?: Record<string, unknown>;
    },
    yamlFilePath: string
  ): Promise<EndpointResult> {
    switch (endpointName) {
      case "clab-interface-capture": {
        try {
          if (payloadObj.targets && payloadObj.targets.length > 0) {
            return await this.captureTargets(payloadObj.targets, yamlFilePath);
          }
          const { nodeName, interfaceName } = payloadObj;
          const requested =
            payloadObj.interfaceNames && payloadObj.interfaceNames.length > 0
              ? payloadObj.interfaceNames
              : [interfaceName];
          const resolved = await this.resolveInterfaces(
            nodeName,
            requested,
            yamlFilePath,
            payloadObj.nodeNamespace === true
          );
          const ifaces = resolved.map((intf, index) =>
            onTopologyHost(createInterfaceObject(nodeName, intf, requested[index]), yamlFilePath)
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
            result: `Capture executed for ${ifaces.map((intf) => `${intf.parentName}/${intf.name}`).join(", ")}`,
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

          const [intf] = await this.resolveInterfaces(nodeName, [interfaceName], yamlFilePath);
          const iface = createInterfaceObject(nodeName, intf, interfaceName);
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
