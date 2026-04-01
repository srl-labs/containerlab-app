import { createExplorerController } from "@srl-labs/clab-ui/host";
import type {
  ExplorerIncomingMessage,
  ExplorerSnapshotProviders,
  ExplorerUiState
} from "@srl-labs/clab-ui/explorer";
import type { TopologyRef } from "@srl-labs/clab-ui/session";

import { type NetemFields, createTopologyFile } from "./runtimeApi";
import { deleteTopologyFileFlow, saveConfigsFlow } from "./components/RuntimeActionDialogs";
import { runtimeUiActions } from "./stores/runtimeUiStore";
import { useAuthStore } from "./stores/authStore";
import type { LabState } from "./stores/labStore";
import type { LifecycleApiCallResult } from "./standaloneLifecycle";
import type {
  DeploymentState,
  ExplorerTreeItem,
  LifecycleCommandEndpoint,
  TopologyFileEntry
} from "./standaloneHostShared";
import {
  TREE_ITEM_COLLAPSED,
  TREE_ITEM_NONE,
  SimpleExplorerProvider,
  firstArgAsTopologyRef,
  firstArgAsTreeItem,
  isTopologyRunning,
  normalizeLabName,
  normalizePathValue,
  safeFilename,
  topologyPathsLikelyMatch,
  topologyEntryLabName
} from "./standaloneHostShared";

const SHOW_NON_OWNED_LABS_STORAGE_KEY = "clab-standalone-show-non-owned-labs";

function loadShowNonOwnedLabsSetting(): boolean {
  try {
    const raw = localStorage.getItem(SHOW_NON_OWNED_LABS_STORAGE_KEY);
    return raw !== "false";
  } catch {
    return true;
  }
}

function persistShowNonOwnedLabsSetting(nextValue: boolean): void {
  try {
    localStorage.setItem(SHOW_NON_OWNED_LABS_STORAGE_KEY, String(nextValue));
  } catch {
    // Ignore persistence failures.
  }
}

let showNonOwnedLabs = loadShowNonOwnedLabsSetting();

interface StandaloneExplorerBridgeOptions {
  debounceMs: number;
  getLabs: () => Map<string, LabState>;
  invalidateTopologyFileListCache: () => void;
  invokeLifecycleApi: (
    endpoint: LifecycleCommandEndpoint,
    topologyRef: TopologyRef,
    cleanup: boolean,
    options?: { sessionId?: string; signal?: AbortSignal }
  ) => Promise<LifecycleApiCallResult>;
  listTopologyFiles: () => Promise<TopologyFileEntry[]>;
  loadTopologyFile: (
    topologyRef: TopologyRef,
    options?: { deploymentState?: DeploymentState }
  ) => Promise<void>;
  resolveApiTopologyPath: (args: unknown[]) => Promise<string | undefined>;
  resolveDeploymentState: (topologyRef: TopologyRef) => Promise<DeploymentState | undefined>;
  resolveTopologyRef: (args: unknown[]) => Promise<TopologyRef | undefined>;
}

export interface StandaloneExplorerBridge {
  explorer: {
    connect: () => void;
    invokeAction: (actionRef: string) => Promise<void>;
    persistUiState: (state: ExplorerUiState) => void;
    setFilter: (filterText: string) => void;
    subscribe: (handler: (message: ExplorerIncomingMessage) => void) => () => void;
  };
  scheduleSnapshot: (delay?: number) => void;
}

function filterTreeItems(items: ExplorerTreeItem[], filterText: string): ExplorerTreeItem[] {
  const query = filterText.trim().toLowerCase();
  if (query.length === 0) return items;

  const visit = (item: ExplorerTreeItem): ExplorerTreeItem | null => {
    const filteredChildren = (item.children ?? [])
      .map((child) => visit(child))
      .filter((child): child is ExplorerTreeItem => child !== null);
    const haystack = [item.label, item.description, item.tooltip]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toLowerCase();
    if (haystack.includes(query) || filteredChildren.length > 0) {
      return { ...item, children: filteredChildren };
    }
    return null;
  };

  return items
    .map((item) => visit(item))
    .filter((item): item is ExplorerTreeItem => item !== null);
}

function buildContainerTooltip(input: {
  id: string;
  image: string;
  ipv4?: string;
  ipv6?: string;
  kind: string;
  name: string;
  state: string;
  status: string;
}): string {
  const lines = [
    `Name: ${input.name}`,
    `State: ${input.state}`,
    `Status: ${input.status}`,
    `Kind: ${input.kind}`,
    `Image: ${input.image}`,
    `ID: ${input.id}`
  ];
  if (input.ipv4 && input.ipv4 !== "N/A") lines.push(`IPv4: ${input.ipv4}`);
  if (input.ipv6 && input.ipv6 !== "N/A") lines.push(`IPv6: ${input.ipv6}`);
  return lines.join("\n");
}

function buildInterfaceTooltip(input: {
  alias: string;
  mac: string;
  mtu: string;
  name: string;
  rxBps?: string;
  state: string;
  txBps?: string;
  type: string;
}): string {
  const lines = [
    `Name: ${input.name}`,
    `Alias: ${input.alias || "N/A"}`,
    `State: ${input.state || "unknown"}`,
    `Type: ${input.type || "N/A"}`,
    `MAC: ${input.mac || "N/A"}`,
    `MTU: ${input.mtu || "N/A"}`
  ];
  if (input.rxBps) lines.push(`RX: ${input.rxBps} bps`);
  if (input.txBps) lines.push(`TX: ${input.txBps} bps`);
  return lines.join("\n");
}

function getInterfaceContextValue(state: string): string {
  return state.toLowerCase() === "up" ? "containerlabInterfaceUp" : "containerlabInterfaceDown";
}

const HELP_LINKS = [
  { label: "Containerlab Documentation", url: "https://containerlab.dev/" },
  { label: "VS Code Extension Documentation", url: "https://containerlab.dev/manual/vsc-extension/" },
  { label: "Browse Labs on GitHub (srl-labs)", url: "https://github.com/srl-labs/" },
  { label: "Join our Discord server", url: "https://discord.gg/vAyddtaEV9" }
] as const;

function getLabOwner(lab: LabState): string {
  if (lab.owner.trim().length > 0) {
    return lab.owner.trim();
  }
  return lab.containers.values().next().value?.owner?.trim() ?? "";
}

function shouldShowRunningLab(lab: LabState): boolean {
  if (showNonOwnedLabs) {
    return true;
  }

  const currentUsername = useAuthStore.getState().username;
  const owner = getLabOwner(lab);
  if (!currentUsername || !owner) {
    return true;
  }

  return normalizeLabName(owner) === normalizeLabName(currentUsername);
}

function findTopologyEntryForRunningLab(lab: LabState, files: TopologyFileEntry[]): TopologyFileEntry | undefined {
  const pathHints = new Set<string>();
  const normalizedTopologyPath = normalizePathValue(lab.topologyPath);
  if (normalizedTopologyPath) {
    pathHints.add(normalizedTopologyPath);
  }
  for (const container of lab.containers.values()) {
    const containerPath = normalizePathValue(container.labPath);
    if (!containerPath) {
      continue;
    }
    pathHints.add(containerPath);
    const exact = files.find((entry) => normalizePathValue(entry.path) === containerPath);
    if (exact) {
      return exact;
    }
  }

  const loosePathMatches = files.filter((entry) => {
    const entryPath = normalizePathValue(entry.path);
    for (const pathHint of pathHints) {
      if (topologyPathsLikelyMatch(entryPath, pathHint)) {
        return true;
      }
    }
    return false;
  });
  if (loosePathMatches.length === 1) {
    return loosePathMatches[0];
  }

  const normalizedLabName = normalizeLabName(lab.name);
  if (!normalizedLabName) {
    return undefined;
  }
  const nameMatches = files.filter(
    (entry) => normalizeLabName(topologyEntryLabName(entry)) === normalizedLabName
  );
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }
  if (nameMatches.length > 1 && loosePathMatches.length > 0) {
    const combinedMatches = nameMatches.filter((entry) =>
      loosePathMatches.some((candidate) => candidate.path === entry.path)
    );
    if (combinedMatches.length === 1) {
      return combinedMatches[0];
    }
  }
  return undefined;
}

export function createStandaloneExplorerBridge(
  options: StandaloneExplorerBridgeOptions
): StandaloneExplorerBridge {
  let explorerFilterText = "";
  let explorerUiState: ExplorerUiState = {};
  const explorerSubscribers = new Set<(message: ExplorerIncomingMessage) => void>();
  const unhandledCommands = new Set<string>();

  function sendExplorerMessage(message: ExplorerIncomingMessage): void {
    for (const subscriber of explorerSubscribers) {
      subscriber(message);
    }
  }

  function postExplorerError(message: string): void {
    sendExplorerMessage({ command: "error", message });
  }

  function buildRunningLabItems(filterText: string, files: TopologyFileEntry[]): ExplorerTreeItem[] {
    const labs = options.getLabs();
    const items: ExplorerTreeItem[] = [];

    for (const lab of labs.values()) {
      if (!shouldShowRunningLab(lab)) {
        continue;
      }

      const labName = lab.name;
      const topologyEntry = findTopologyEntryForRunningLab(lab, files);
      const containers: ExplorerTreeItem[] = [];

      for (const [, container] of lab.containers) {
        const interfaces = [...container.interfaces.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .filter((iface) => {
            const state = iface.state.toLowerCase();
            return iface.name !== "lo" && state !== "unknown";
          })
          .map((iface) => {
            const state = iface.state.toLowerCase();
            const hasAlias = Boolean(iface.alias);
            const label = hasAlias ? iface.alias : iface.name;
            const stateText = state ? state.toUpperCase() : "";
            const description = hasAlias
              ? `${stateText || "UNKNOWN"} (${iface.name})`
              : (stateText || iface.type || undefined);

            return {
              id: `running-interface:${container.name}:${iface.name}`,
              label,
              description,
              tooltip: buildInterfaceTooltip({
                name: iface.name,
                alias: iface.alias,
                state: iface.state,
                type: iface.type,
                mac: iface.mac,
                mtu: iface.mtu,
                rxBps: iface.rxBps,
                txBps: iface.txBps
              }),
              contextValue: getInterfaceContextValue(state),
              collapsibleState: TREE_ITEM_NONE,
              cID: container.containerId,
              containerName: container.name,
              labName,
              name: iface.name,
              mac: iface.mac,
              topologyRef: topologyEntry?.topologyRef,
              children: []
            } satisfies ExplorerTreeItem;
          });

        containers.push({
          id: `running-container:${container.name}`,
          label: container.nodeName || container.name,
          description: container.status || container.state,
          tooltip: buildContainerTooltip({
            name: container.name,
            state: container.state,
            status: container.status,
            kind: container.kind,
            image: container.image,
            id: container.containerId,
            ipv4: container.ipv4Address,
            ipv6: container.ipv6Address
          }),
          contextValue: "containerlabContainer",
          state: container.state,
          status: container.status,
          labName,
          name: container.name,
          cID: container.containerId,
          kind: container.kind,
          image: container.image,
          topologyRef: topologyEntry?.topologyRef,
          v4Address: container.ipv4Address,
          v6Address: container.ipv6Address,
          collapsibleState: interfaces.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
          children: interfaces
        });
      }

      const labPath = topologyEntry?.path;
      const fallbackPathHint =
        lab.topologyPath || (lab.containers.values().next().value?.labPath as string | undefined);
      const pathHint = labPath ?? fallbackPathHint;
      const fallbackOwner = lab.containers.values().next().value?.owner as string | undefined;
      const owner = (lab.owner || fallbackOwner || "").trim();
      const labLabel = owner ? `${labName} (${owner})` : labName;
      const labItem: ExplorerTreeItem = {
        id: `running-lab:${labName}`,
        label: labLabel,
        description: pathHint || "No API topology file",
        tooltip: pathHint || `No API topology file available for running lab "${labName}"`,
        contextValue: "containerlabLabDeployed",
        collapsibleState: containers.length > 0 ? TREE_ITEM_COLLAPSED : TREE_ITEM_NONE,
        labName,
        topologyRef: topologyEntry?.topologyRef,
        children: containers
      };

      if (topologyEntry?.topologyRef) {
        labItem.command = {
          command: "containerlab.lab.graph.topoViewer",
          title: "Open TopoViewer",
          arguments: [labItem]
        };
      }

      items.push(labItem);
    }

    return filterTreeItems(items, filterText);
  }

  async function buildLocalLabItems(
    filterText: string,
    files: TopologyFileEntry[]
  ): Promise<ExplorerTreeItem[]> {
    const runningLabs = options.getLabs();
    const items = files
      .filter((file) => {
        return !isTopologyRunning(file.topologyRef, runningLabs);
      })
      .map((file) => {
        const labName = topologyEntryLabName(file);
        const item: ExplorerTreeItem = {
          id: `local-lab:${file.path}`,
          label: file.filename || safeFilename(file.path),
          description: file.path,
          tooltip: file.path,
          contextValue: "containerlabLabUndeployed",
          collapsibleState: TREE_ITEM_NONE,
          labName,
          topologyRef: file.topologyRef,
          children: []
        };
        item.command = {
          command: "containerlab.lab.graph.topoViewer",
          title: "Open TopoViewer",
          arguments: [item]
        };
        return item;
      });

    return filterTreeItems(items, filterText);
  }

  function buildHelpItems(): ExplorerTreeItem[] {
    return HELP_LINKS.map((link) => ({
      id: `help:${link.url}`,
      label: link.label,
      tooltip: link.url,
      collapsibleState: TREE_ITEM_NONE,
      command: {
        command: "containerlab.openLink",
        title: "Open Link",
        arguments: [link.url]
      },
      children: []
    }));
  }

  async function buildExplorerProviders(
    filterText: string = explorerFilterText
  ): Promise<ExplorerSnapshotProviders> {
    const files = await options.listTopologyFiles();
    const runningItems = buildRunningLabItems(filterText, files);
    const localItems = await buildLocalLabItems(filterText, files);
    const helpItems = buildHelpItems();

    return {
      runningProvider: new SimpleExplorerProvider(runningItems) as ExplorerSnapshotProviders["runningProvider"],
      localProvider: new SimpleExplorerProvider(localItems) as ExplorerSnapshotProviders["localProvider"],
      helpProvider: new SimpleExplorerProvider(helpItems) as ExplorerSnapshotProviders["helpProvider"]
    };
  }

  async function executeExplorerCommand(commandId: string, args: unknown[]): Promise<void> {
    const requestedTopologyRef = firstArgAsTopologyRef(args);
    const item = firstArgAsTreeItem(args);
    const actionTopologyRef = requestedTopologyRef ?? (await options.resolveTopologyRef(args));
    const targetLabel =
      actionTopologyRef?.labName ??
      item?.labName ??
      (typeof item?.label === "string" ? item.label : undefined);

    switch (commandId) {
      case "containerlab.openLink": {
        const link = typeof args[0] === "string" ? args[0] : undefined;
        if (link) window.open(link, "_blank", "noopener,noreferrer");
        return;
      }
      case "containerlab.lab.graph.topoViewer":
      case "containerlab.lab.openFile":
      case "containerlab.editor.topoViewerEditor.open": {
        if (!actionTopologyRef) {
          postExplorerError(
            targetLabel
              ? `No canonical topology reference is available for running lab "${targetLabel}".`
              : "No canonical topology reference is available for this item."
          );
          return;
        }
        const itemState =
          item?.contextValue === "containerlabLabDeployed"
            ? "deployed"
            : item?.contextValue === "containerlabLabUndeployed"
              ? "undeployed"
              : undefined;
        const resolvedState = actionTopologyRef
          ? await options.resolveDeploymentState(actionTopologyRef)
          : undefined;
        const deploymentState = resolvedState ?? itemState;
        await options.loadTopologyFile(actionTopologyRef, { deploymentState });
        return;
      }
      case "containerlab.editor.topoViewerEditor": {
        const rawFileName = window.prompt("New topology file name", "new-lab.clab.yml");
        if (!rawFileName) {
          return;
        }

        try {
          const created = await createTopologyFile({ fileName: rawFileName });
          options.invalidateTopologyFileListCache();
          controller.scheduleSnapshot(0);
          runtimeUiActions.notify(`Created topology file "${rawFileName}".`, "success");
          await options.loadTopologyFile(created.topologyRef, { deploymentState: "undeployed" });
          return;
        } catch (error) {
          runtimeUiActions.notify(
            error instanceof Error ? error.message : String(error),
            "error"
          );
          return;
        }
      }
      case "containerlab.inspectAll": {
        runtimeUiActions.openInspectAll();
        return;
      }
      case "containerlab.inspectOneLab": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        runtimeUiActions.openInspectLab(
          { topologyRef: actionTopologyRef },
          `Inspect: ${targetLabel ?? actionTopologyRef.labName}`
        );
        return;
      }
      case "containerlab.lab.deploy":
      case "containerlab.lab.deploy.specificFile": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        try {
          await options.invokeLifecycleApi("deploy", actionTopologyRef, false);
          options.invalidateTopologyFileListCache();
        } catch (error) {
          console.error("[Standalone] Deploy failed:", error);
        }
        return;
      }
      case "containerlab.lab.destroy":
      case "containerlab.lab.destroy.cleanup": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        try {
          const cleanup = commandId === "containerlab.lab.destroy.cleanup";
          await options.invokeLifecycleApi("destroy", actionTopologyRef, cleanup);
          options.invalidateTopologyFileListCache();
        } catch (error) {
          console.error("[Standalone] Destroy failed:", error);
        }
        return;
      }
      case "containerlab.lab.redeploy":
      case "containerlab.lab.redeploy.cleanup": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }
        try {
          const cleanup = commandId === "containerlab.lab.redeploy.cleanup";
          await options.invokeLifecycleApi("redeploy", actionTopologyRef, cleanup);
          options.invalidateTopologyFileListCache();
        } catch (error) {
          console.error("[Standalone] Redeploy failed:", error);
        }
        return;
      }
      case "containerlab.lab.save": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }

        try {
          await saveConfigsFlow(
            { topologyRef: actionTopologyRef },
            `Saved configs for ${actionTopologyRef.labName}.`
          );
        } catch (error) {
          console.error("[Standalone] Save failed:", error);
        }
        return;
      }
      case "containerlab.lab.delete": {
        if (!actionTopologyRef) {
          postExplorerError("No canonical topology reference is available for this item.");
          return;
        }

        const deleted = await deleteTopologyFileFlow({ topologyRef: actionTopologyRef });
        if (deleted) {
          options.invalidateTopologyFileListCache();
          controller.scheduleSnapshot(0);
        }
        return;
      }
      case "containerlab.treeView.runningLabs.hideNonOwnedLabs": {
        showNonOwnedLabs = false;
        persistShowNonOwnedLabsSetting(false);
        controller.scheduleSnapshot(0);
        runtimeUiActions.notify("Hiding non-owned labs.", "info");
        return;
      }
      case "containerlab.treeView.runningLabs.showNonOwnedLabs": {
        showNonOwnedLabs = true;
        persistShowNonOwnedLabsSetting(true);
        controller.scheduleSnapshot(0);
        runtimeUiActions.notify("Showing non-owned labs.", "info");
        return;
      }
      case "containerlab.node.save": {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node save requires a running lab item.");
          return;
        }

        await saveConfigsFlow(
          {
            topologyRef: actionTopologyRef,
            nodeName: item.name
          },
          `Saved config for ${item.label || item.name}.`
        );
        return;
      }
      case "containerlab.node.ssh":
      case "containerlab.node.attachShell":
      case "containerlab.node.telnet": {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node access requires a running lab item.");
          return;
        }

        const protocol =
          commandId === "containerlab.node.attachShell"
            ? "shell"
            : commandId === "containerlab.node.telnet"
              ? "telnet"
              : "ssh";
        const titlePrefix = protocol === "shell" ? "Shell" : protocol === "telnet" ? "Telnet" : "SSH";

        runtimeUiActions.openTerminal({
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          protocol,
          title: `${titlePrefix}: ${item.label || item.name}`
        });
        return;
      }
      case "containerlab.node.showLogs": {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node logs require a running lab item.");
          return;
        }

        runtimeUiActions.openLogs({
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          title: `Logs: ${item.label || item.name}`
        });
        return;
      }
      case "containerlab.node.manageImpairments": {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Impairments require a running lab item.");
          return;
        }

        runtimeUiActions.openNetem({
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          title: `Impairments: ${item.label || item.name}`
        });
        return;
      }
      case "containerlab.interface.setDelay":
      case "containerlab.interface.setJitter":
      case "containerlab.interface.setLoss":
      case "containerlab.interface.setRate":
      case "containerlab.interface.setCorruption": {
        if (!actionTopologyRef || !item?.containerName) {
          postExplorerError("Interface impairments require a running interface item.");
          return;
        }

        const fieldByCommand: Record<string, keyof NetemFields> = {
          "containerlab.interface.setDelay": "delay",
          "containerlab.interface.setJitter": "jitter",
          "containerlab.interface.setLoss": "loss",
          "containerlab.interface.setRate": "rate",
          "containerlab.interface.setCorruption": "corruption"
        };

        runtimeUiActions.openNetem({
          topologyRef: actionTopologyRef,
          nodeName: item.containerName,
          preferredField: fieldByCommand[commandId],
          preferredInterfaceName: item.label || item.name,
          title: `Impairments: ${item.containerName}`
        });
        return;
      }
      case "containerlab.node.copyName": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node) await navigator.clipboard.writeText(node.name || node.label || "").catch(() => {});
        return;
      }
      case "containerlab.node.copyID": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.cID) await navigator.clipboard.writeText(node.cID).catch(() => {});
        return;
      }
      case "containerlab.node.copyKind": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.kind) await navigator.clipboard.writeText(node.kind).catch(() => {});
        return;
      }
      case "containerlab.node.copyImage": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.image) await navigator.clipboard.writeText(node.image).catch(() => {});
        return;
      }
      case "containerlab.node.copyIPv4Address": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.v4Address) await navigator.clipboard.writeText(node.v4Address).catch(() => {});
        return;
      }
      case "containerlab.node.copyIPv6Address": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.v6Address) await navigator.clipboard.writeText(node.v6Address).catch(() => {});
        return;
      }
      case "containerlab.interface.copyMACAddress": {
        const node = args[0] as ExplorerTreeItem | undefined;
        if (node?.mac) await navigator.clipboard.writeText(node.mac).catch(() => {});
        return;
      }
      case "containerlab.lab.copyPath": {
        const apiLabPath = actionTopologyRef?.yamlPath ?? (await options.resolveApiTopologyPath(args));
        if (apiLabPath) await navigator.clipboard.writeText(apiLabPath).catch(() => {});
        return;
      }
      default: {
        if (!unhandledCommands.has(commandId)) {
          unhandledCommands.add(commandId);
          console.info(`[Standalone] Command not implemented: ${commandId}`);
        }
      }
    }
  }

  const controller = createExplorerController({
    initialFilterText: explorerFilterText,
    initialUiState: explorerUiState,
    debounceMs: options.debounceMs,
    buildProviders: buildExplorerProviders,
    executeAction: async (binding) => {
      await executeExplorerCommand(binding.commandId, binding.args ?? []);
    },
    publish: sendExplorerMessage,
    getSnapshotOptions() {
      return {
        hideNonOwnedLabs: !showNonOwnedLabs,
        isLocalCaptureAllowed: false
      };
    },
    onFilterTextChanged(filterText) {
      explorerFilterText = filterText;
    },
    onUiStateChanged(state) {
      explorerUiState = state ?? {};
    }
  });

  return {
    explorer: {
      connect() {
        controller.connect();
      },
      invokeAction(actionRef) {
        return controller.invokeAction(actionRef);
      },
      persistUiState(state) {
        void controller.persistUiState(state);
      },
      setFilter(filterText) {
        void controller.setFilter(filterText);
      },
      subscribe(handler) {
        explorerSubscribers.add(handler);
        return () => {
          explorerSubscribers.delete(handler);
        };
      }
    },
    scheduleSnapshot(delay = options.debounceMs) {
      controller.scheduleSnapshot(delay);
    }
  };
}
