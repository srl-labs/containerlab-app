import type * as vscode from "vscode";

import {
  EXPLORER_SECTION_LABELS,
  EXPLORER_SECTION_ORDER,
  type ExplorerAction,
  type ExplorerNode,
  type ExplorerSectionId,
  type ExplorerSectionSnapshot,
  type ExplorerSnapshotMessage,
  type ExplorerUiState
} from "./shared/explorer/types";

interface ExplorerTreeProvider {
  getChildren(element?: unknown): vscode.ProviderResult<vscode.TreeItem[] | undefined>;
}

type RunningLabTreeDataProvider = ExplorerTreeProvider;
type LocalLabTreeDataProvider = ExplorerTreeProvider;
type HelpFeedbackProvider = ExplorerTreeProvider;

type ExplorerTreeItemLike = vscode.TreeItem & {
  id?: string;
  contextValue?: string;
  endpointId?: string;
  hasChildren?: boolean;
  state?: string;
  status?: string;
  link?: string;
};

interface LabShareInfo {
  kind: "sshx" | "gotty";
  url: string;
}

export interface ExplorerSnapshotProviders {
  runningProvider: RunningLabTreeDataProvider;
  localProvider: LocalLabTreeDataProvider;
  fileProvider?: ExplorerTreeProvider;
  helpProvider: HelpFeedbackProvider;
}

export interface ExplorerSnapshotOptions {
  hideNonOwnedLabs: boolean;
  isLocalCaptureAllowed: boolean;
  commandMetadata?: ExplorerCommandMetadata;
  hiddenCommandIds?: readonly string[];
  sectionOrder?: readonly ExplorerSectionId[];
  expandedBySection?: ExplorerUiState["expandedBySection"];
}

export interface ExplorerActionInvocation {
  commandId: string;
  args: unknown[];
  disabled?: boolean;
}

export interface ExplorerContributedMenuItem {
  commandId: string;
  contextValues?: readonly string[];
  destructive?: boolean;
  label?: string;
  iconId?: string;
}

export interface ExplorerCommandMetadata {
  contributedContainerActions?: readonly ExplorerContributedMenuItem[];
  contributedEndpointActions?: readonly ExplorerContributedMenuItem[];
  contributedFileActions?: readonly ExplorerContributedMenuItem[];
  contributedLabActions?: readonly ExplorerContributedMenuItem[];
  contributedSectionContextActions?: Partial<Record<ExplorerSectionId, readonly ExplorerContributedMenuItem[]>>;
  contributedToolbarActions?: Partial<Record<ExplorerSectionId, readonly ExplorerContributedMenuItem[]>>;
  commandLabels?: ReadonlyMap<string, string>;
  commandIcons?: ReadonlyMap<string, string>;
}

export interface ExplorerSnapshotBuildResult {
  snapshot: ExplorerSnapshotMessage;
  actionBindings: Map<string, ExplorerActionInvocation>;
}

const COMMAND_LABELS: Record<string, string> = {
  "containerlab.lab.openFile": "Edit Topology",
  "containerlab.editor.topoViewerEditor.open": "Edit Topology (TopoViewer)",
  "containerlab.lab.copyPath": "Copy File Path",
  "containerlab.lab.addToWorkspace": "Add To Workspace",
  "containerlab.lab.openFolderInNewWindow": "Open Folder In New Window",
  "containerlab.lab.toggleFavorite": "Toggle Favorite",
  "containerlab.lab.deploy": "Deploy",
  "containerlab.lab.deploy.cleanup": "Deploy (Cleanup)",
  "containerlab.lab.apply": "Apply Topology",
  "containerlab.lab.destroy": "Destroy",
  "containerlab.lab.destroy.cleanup": "Destroy (Cleanup)",
  "containerlab.lab.redeploy": "Redeploy",
  "containerlab.lab.redeploy.cleanup": "Redeploy (Cleanup)",
  "containerlab.lab.start": "Start Nodes",
  "containerlab.lab.stop": "Stop Nodes",
  "containerlab.lab.restart": "Restart Nodes",
  "containerlab.lab.save": "Save Configs",
  "containerlab.lab.delete": "Delete Lab File",
  "containerlab.lab.sshToAllNodes": "SSH To All Nodes",
  "containerlab.inspectOneLab": "Inspect",
  "containerlab.lab.sshx.attach": "Attach SSHX Session",
  "containerlab.lab.sshx.detach": "Detach SSHX Session",
  "containerlab.lab.sshx.reattach": "Reattach SSHX Session",
  "containerlab.lab.gotty.attach": "Attach GoTTY Session",
  "containerlab.lab.gotty.detach": "Detach GoTTY Session",
  "containerlab.lab.gotty.reattach": "Reattach GoTTY Session",
  "containerlab.lab.sshx.copyLink": "Copy SSHX Link",
  "containerlab.lab.gotty.copyLink": "Copy GoTTY Link",
  "containerlab.lab.graph.topoViewer": "Open TopoViewer",
  "containerlab.lab.graph.drawio.horizontal": "Graph (draw.io, Horizontal)",
  "containerlab.lab.graph.drawio.vertical": "Graph (draw.io, Vertical)",
  "containerlab.lab.graph.drawio.interactive": "Graph (draw.io, Interactive)",
  "containerlab.node.start": "Start Node",
  "containerlab.node.stop": "Stop Node",
  "containerlab.node.restart": "Restart Node",
  "containerlab.node.pause": "Pause Node",
  "containerlab.node.unpause": "Unpause Node",
  "containerlab.node.save": "Save Node Config",
  "containerlab.node.attachShell": "Attach Shell",
  "containerlab.node.ssh": "SSH",
  "containerlab.node.telnet": "Telnet",
  "containerlab.node.showLogs": "Show Logs",
  "containerlab.node.manageImpairments": "Manage Impairments",
  "containerlab.node.openBrowser": "Open Browser",
  "containerlab.node.copyName": "Copy Node Name",
  "containerlab.node.copyID": "Copy Node ID",
  "containerlab.node.copyIPv4Address": "Copy IPv4 Address",
  "containerlab.node.copyIPv6Address": "Copy IPv6 Address",
  "containerlab.node.copyKind": "Copy Node Kind",
  "containerlab.node.copyImage": "Copy Node Image",
  "containerlab.interface.capture": "Capture",
  "containerlab.interface.captureWithEdgeshark": "Capture With Edgeshark",
  "containerlab.interface.captureWithEdgesharkVNC": "Capture With Edgeshark VNC",
  "containerlab.interface.setDelay": "Set Delay",
  "containerlab.interface.setJitter": "Set Jitter",
  "containerlab.interface.setLoss": "Set Loss",
  "containerlab.interface.setRate": "Set Rate",
  "containerlab.interface.setCorruption": "Set Corruption",
  "containerlab.interface.copyMACAddress": "Copy MAC Address",
  "containerlab.lab.fcli.bgpPeers": "Run fcli bgp-peers",
  "containerlab.lab.fcli.bgpRib": "Run fcli bgp-rib",
  "containerlab.lab.fcli.ipv4Rib": "Run fcli ipv4-rib",
  "containerlab.lab.fcli.lldp": "Run fcli lldp",
  "containerlab.lab.fcli.mac": "Run fcli mac",
  "containerlab.lab.fcli.ni": "Run fcli ni",
  "containerlab.lab.fcli.subif": "Run fcli subif",
  "containerlab.lab.fcli.sysInfo": "Run fcli sys-info",
  "containerlab.lab.fcli.custom": "Run Custom fcli",
  "containerlab.lab.deploy.specificFile": "Deploy Lab File",
  "containerlab.images.manage": "Manage Images",
  "containerlab.inspectAll": "Inspect All Labs",
  "containerlab.treeView.runningLabs.hideNonOwnedLabs": "Hide Non-Owned Labs",
  "containerlab.treeView.runningLabs.showNonOwnedLabs": "Show Non-Owned Labs",
  "containerlab.editor.topoViewerEditor": "New Topology File",
  "containerlab.lab.cloneRepo": "Clone Repository",
  "containerlab.install.edgeshark": "Install EdgeShark",
  "containerlab.uninstall.edgeshark": "Uninstall EdgeShark",
  "containerlab.capture.killAllWiresharkVNC": "Kill All Wireshark VNC Sessions",
  "containerlab.set.sessionHostname": "Configure Session Hostname",
  "containerlab.endpoint.reconnect": "Reconnect Endpoint",
  "containerlab.endpoint.remove": "Remove Endpoint",
  "containerlab.endpoint.copyUrl": "Copy Endpoint URL",
  "containerlab.file.open": "Open File",
  "containerlab.file.openTopology": "Open Topology",
  "containerlab.file.newFile": "New File",
  "containerlab.file.newFolder": "New Folder",
  "containerlab.file.rename": "Rename",
  "containerlab.file.delete": "Delete",
  "containerlab.file.copyPath": "Copy Path"
};

const DESTRUCTIVE_COMMANDS = new Set<string>([
  "containerlab.file.delete",
  "containerlab.lab.delete",
  "containerlab.lab.destroy",
  "containerlab.lab.destroy.cleanup",
  "containerlab.lab.sshx.detach",
  "containerlab.lab.gotty.detach",
  "containerlab.uninstall.edgeshark",
  "containerlab.capture.killAllWiresharkVNC"
]);
const SECTION_BUILD_TIMEOUT_MS = 4000;
const TREE_ITEM_COLLAPSIBLE_NONE = 0;
const LAB_LABEL_LINK_PREFIX_REGEX = /^🔗\s*/u;
const BUILTIN_CONTAINER_ACTION_COMMANDS: readonly string[] = [
  "containerlab.node.showLogs",
  "containerlab.node.attachShell",
  "containerlab.node.ssh",
  "containerlab.node.telnet",
  "containerlab.node.openBrowser",
  "containerlab.node.start",
  "containerlab.node.stop",
  "containerlab.node.restart",
  "containerlab.node.pause",
  "containerlab.node.unpause",
  "containerlab.node.save",
  "containerlab.node.manageImpairments",
  "containerlab.node.copyName",
  "containerlab.node.copyID",
  "containerlab.node.copyIPv4Address",
  "containerlab.node.copyIPv6Address",
  "containerlab.node.copyKind",
  "containerlab.node.copyImage"
];
const STOPPED_CONTAINER_ENABLED_COMMANDS = new Set<string>([
  "containerlab.node.showLogs",
  "containerlab.node.start",
  "containerlab.node.copyName",
  "containerlab.node.copyID",
  "containerlab.node.copyIPv4Address",
  "containerlab.node.copyIPv6Address",
  "containerlab.node.copyKind",
  "containerlab.node.copyImage"
]);
const EMPTY_PROVIDER: ExplorerTreeProvider = {
  getChildren() {
    return [];
  }
};

function labelToText(label: string | vscode.TreeItemLabel | undefined): string {
  if (!label) {
    return "";
  }
  return typeof label === "string" ? label : label.label;
}

function descriptionToText(description: string | boolean | undefined): string | undefined {
  if (typeof description === "string" && description.trim().length > 0) {
    return description;
  }
  return undefined;
}

function tooltipToText(tooltip: vscode.MarkdownString | string | undefined): string | undefined {
  if (typeof tooltip === "string") {
    return tooltip;
  }
  if (
    tooltip &&
    typeof tooltip === "object" &&
    "value" in tooltip &&
    typeof (tooltip as { value?: unknown }).value === "string"
  ) {
    return (tooltip as { value: string }).value;
  }
  return undefined;
}

function commandLabel(commandId: string, fallback?: string): string {
  return fallback || COMMAND_LABELS[commandId] || commandId;
}

function isLabContext(contextValue: string | undefined): boolean {
  return typeof contextValue === "string" && contextValue.includes("containerlabLab");
}

function isDeployedLab(contextValue: string | undefined): boolean {
  return typeof contextValue === "string" && contextValue.includes("containerlabLabDeployed");
}

function isUndeployedLab(contextValue: string | undefined): boolean {
  return typeof contextValue === "string" && contextValue.includes("containerlabLabUndeployed");
}

function isFavoriteLab(contextValue: string | undefined): boolean {
  return typeof contextValue === "string" && contextValue.includes("Favorite");
}

function isRunningContainerStatus(status: string): boolean {
  return status === "running" || status === "up" || status.startsWith("up ");
}

function isStoppedContainerItem(item: ExplorerTreeItemLike): boolean {
  const state = String(item.state ?? "").trim().toLowerCase();
  if (state.length > 0) {
    return state !== "running";
  }

  const status = String(item.status ?? "").trim().toLowerCase();
  if (status.length === 0) {
    return false;
  }
  return !isRunningContainerStatus(status);
}

function isContainerActionDisabled(commandId: string, item: ExplorerTreeItemLike): boolean {
  return isStoppedContainerItem(item) && !STOPPED_CONTAINER_ENABLED_COMMANDS.has(commandId);
}

function shouldHideNodeDescription(contextValue: string | undefined): boolean {
  return isLabContext(contextValue);
}

function collectContainerIndicators(children: ExplorerNode[]): ExplorerNode["statusIndicator"][] {
  const indicators: ExplorerNode["statusIndicator"][] = [];
  for (const child of children) {
    if (child.contextValue === "containerlabContainer") {
      indicators.push(child.statusIndicator);
    } else if (child.contextValue === "containerlabContainerGroup") {
      // Recurse into group children to get actual container indicators
      indicators.push(...collectContainerIndicators(child.children));
    }
  }
  return indicators;
}

function aggregateStatusFromIndicators(indicators: ExplorerNode["statusIndicator"][]): ExplorerNode["statusIndicator"] {
  if (indicators.length === 0) {
    return undefined;
  }

  let healthyRunning = 0;
  let notRunning = 0;
  let unhealthyRunning = 0;

  for (const indicator of indicators) {
    if (indicator === "green") {
      healthyRunning += 1;
      continue;
    }
    if (indicator === "yellow") {
      unhealthyRunning += 1;
      continue;
    }
    notRunning += 1;
  }

  if (healthyRunning === indicators.length) {
    return "green";
  }
  if (healthyRunning > 0 && notRunning > 0 && unhealthyRunning === 0) {
    return "yellow";
  }
  return "red";
}

function getStatusIndicator(item: ExplorerTreeItemLike): ExplorerNode["statusIndicator"] {
  const context = item.contextValue;
  if (context === "containerlabEndpoint") {
    const state = String(item.state ?? "").toLowerCase();
    if (state === "connected") {
      return "green";
    }
    if (state === "session_expired") {
      return "yellow";
    }
    if (state === "offline") {
      return "red";
    }
    return "gray";
  }
  if (context === "containerlabInterfaceUp") {
    return "green";
  }
  if (context === "containerlabInterfaceDown") {
    return "red";
  }
  if (context === "containerlabContainer") {
    const state = String(item.state ?? "").toLowerCase();
    const status = String(item.status ?? "").toLowerCase();
    if (state === "running" && (status.includes("unhealthy") || status.includes("health: starting"))) {
      return "yellow";
    }
    if (state === "running") {
      return "green";
    }
    return "red";
  }
  return undefined;
}

function stableActionValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => stableActionValue(entry, seen));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableActionValue(entry, seen)])
  );
}

function hashActionRef(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

class ExplorerActionRegistry {
  private readonly bindings = new Map<string, ExplorerActionInvocation>();
  private readonly actionRefCounts = new Map<string, number>();

  public createAction(
    commandId: string,
    label: string,
    args: unknown[] = [],
    destructive = false,
    iconId?: string,
    disabled = false
  ): ExplorerAction {
    const stablePayload = JSON.stringify(stableActionValue({ commandId, label, args, destructive, iconId }));
    const baseActionRef = `action:${hashActionRef(stablePayload)}`;
    const count = this.actionRefCounts.get(baseActionRef) ?? 0;
    this.actionRefCounts.set(baseActionRef, count + 1);
    const actionRef = count === 0 ? baseActionRef : `${baseActionRef}:${count}`;
    this.bindings.set(actionRef, { commandId, args, disabled });
    return {
      id: `${commandId}:${label}:${actionRef}`,
      actionRef,
      label,
      commandId,
      iconId,
      destructive,
      disabled
    };
  }

  public getBindings(): Map<string, ExplorerActionInvocation> {
    return this.bindings;
  }
}

function pushAction(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  commandId: string,
  args: unknown[] = [],
  label?: string,
  destructive?: boolean,
  iconId?: string,
  disabled?: boolean
): void {
  const resolvedLabel = commandLabel(commandId, label);
  const key = `${commandId}:${resolvedLabel}`;
  if (seen.has(key)) {
    return;
  }

  seen.add(key);
  actions.push(
    registry.createAction(
      commandId,
      resolvedLabel,
      args,
      destructive ?? DESTRUCTIVE_COMMANDS.has(commandId),
      iconId,
      disabled
    )
  );
}

function applyCommandIcons(
  actions: ExplorerAction[],
  commandIcons: ReadonlyMap<string, string>
): ExplorerAction[] {
  for (const action of actions) {
    if (action.iconId !== undefined) {
      continue;
    }
    const iconId = commandIcons.get(action.commandId);
    if (iconId !== undefined && iconId.length > 0) {
      action.iconId = iconId;
    }
  }
  return actions;
}

function appendContributedActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike | undefined,
  contributedActions: readonly ExplorerContributedMenuItem[],
  commandLabels: ReadonlyMap<string, string>,
  commandIcons: ReadonlyMap<string, string>,
  disabledResolver?: (commandId: string, item: ExplorerTreeItemLike) => boolean
): void {
  const existingCommands = new Set(actions.map((action) => action.commandId));
  for (const contributedAction of contributedActions) {
    if (existingCommands.has(contributedAction.commandId)) {
      continue;
    }
    if (
      item &&
      contributedAction.contextValues &&
      !contributedAction.contextValues.includes(item.contextValue ?? "")
    ) {
      continue;
    }

    pushAction(
      actions,
      seen,
      registry,
      contributedAction.commandId,
      item ? [item] : [],
      commandLabels.get(contributedAction.commandId) ?? contributedAction.label,
      contributedAction.destructive,
      commandIcons.get(contributedAction.commandId) ?? contributedAction.iconId,
      item && disabledResolver ? disabledResolver(contributedAction.commandId, item) : undefined
    );
    existingCommands.add(contributedAction.commandId);
  }
}

function filterHiddenActions(
  actions: ExplorerAction[],
  options: ExplorerSnapshotOptions
): ExplorerAction[] {
  const hiddenCommandIds = options.hiddenCommandIds ?? [];
  if (hiddenCommandIds.length === 0) {
    return actions;
  }

  const hidden = new Set(hiddenCommandIds);
  return actions.filter((action) => !hidden.has(action.commandId));
}

function getLinkArgument(item: ExplorerTreeItemLike): string | undefined {
  const link = item.link;
  if (typeof link === "string" && link.length > 0) {
    return link;
  }
  return undefined;
}

function isShareLinkNode(contextValue: string | undefined): boolean {
  return contextValue === "containerlabSSHXLink" || contextValue === "containerlabGottyLink";
}

function getLabShareInfo(childrenItems: ExplorerTreeItemLike[]): LabShareInfo | undefined {
  let sshxUrl: string | undefined;
  let gottyUrl: string | undefined;

  for (const child of childrenItems) {
    const contextValue = child.contextValue;
    if (contextValue === "containerlabSSHXLink") {
      sshxUrl = getLinkArgument(child);
      continue;
    }
    if (contextValue === "containerlabGottyLink") {
      gottyUrl = getLinkArgument(child);
    }
  }

  if (sshxUrl) {
    return { kind: "sshx", url: sshxUrl };
  }
  if (gottyUrl) {
    return { kind: "gotty", url: gottyUrl };
  }
  return undefined;
}

function appendLabActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  sectionId: ExplorerSectionId,
  item: ExplorerTreeItemLike,
  contributedActions: readonly ExplorerContributedMenuItem[],
  commandLabels: ReadonlyMap<string, string>,
  commandIcons: ReadonlyMap<string, string>
): void {
  const contextValue = item.contextValue;
  const isDeployed = isDeployedLab(contextValue);
  const isUndeployed = isUndeployedLab(contextValue);
  const isFavorite = isFavoriteLab(contextValue);

  pushAction(actions, seen, registry, "containerlab.lab.openFile", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.copyPath", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.openFolderInNewWindow", [item]);

  if (isUndeployed) {
    pushAction(
      actions,
      seen,
      registry,
      "containerlab.editor.topoViewerEditor.open",
      [item],
      "Edit Topology (TopoViewer)"
    );
  }

  if (contextValue === "containerlabLabDeployed") {
    pushAction(actions, seen, registry, "containerlab.lab.addToWorkspace", [item]);
  }

  pushAction(
    actions,
    seen,
    registry,
    "containerlab.lab.toggleFavorite",
    [item],
    isFavorite ? "Remove From Favorites" : "Add To Favorites"
  );

  if (isUndeployed) {
    pushAction(actions, seen, registry, "containerlab.lab.apply", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.deploy", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.deploy.cleanup", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.delete", [item], undefined, true);
  }

  if (isDeployed) {
    pushAction(actions, seen, registry, "containerlab.lab.apply", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.destroy", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.lab.destroy.cleanup", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.lab.redeploy", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.redeploy.cleanup", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.start", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.stop", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.restart", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.save", [item]);
    pushAction(actions, seen, registry, "containerlab.inspectOneLab", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.sshToAllNodes", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.sshx.attach", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.sshx.detach", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.lab.sshx.reattach", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.gotty.attach", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.gotty.detach", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.lab.gotty.reattach", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.bgpPeers", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.bgpRib", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.ipv4Rib", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.lldp", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.mac", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.ni", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.subif", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.sysInfo", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.fcli.custom", [item]);
  }

  pushAction(actions, seen, registry, "containerlab.lab.graph.drawio.horizontal", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.graph.drawio.vertical", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.graph.drawio.interactive", [item]);
  pushAction(actions, seen, registry, "containerlab.lab.graph.topoViewer", [item]);

  if (sectionId === "localLabs" && !isDeployed && !isUndeployed) {
    // Keep local section behavior consistent for edge nodes without known lab context.
    pushAction(actions, seen, registry, "containerlab.lab.openFile", [item]);
  }

  appendContributedActions(actions, seen, registry, item, contributedActions, commandLabels, commandIcons);
}

function appendContainerActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike,
  contributedActions: readonly ExplorerContributedMenuItem[],
  commandLabels: ReadonlyMap<string, string>,
  commandIcons: ReadonlyMap<string, string>
): void {
  for (const commandId of BUILTIN_CONTAINER_ACTION_COMMANDS) {
    pushAction(
      actions,
      seen,
      registry,
      commandId,
      [item],
      undefined,
      undefined,
      undefined,
      isContainerActionDisabled(commandId, item)
    );
  }
  appendContributedActions(
    actions,
    seen,
    registry,
    item,
    contributedActions,
    commandLabels,
    commandIcons,
    isContainerActionDisabled
  );
}

function appendInterfaceActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike,
  isLocalCaptureAllowed: boolean
): void {
  if (isLocalCaptureAllowed) {
    pushAction(actions, seen, registry, "containerlab.interface.capture", [item]);
  }
  pushAction(actions, seen, registry, "containerlab.interface.captureWithEdgeshark", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.captureWithEdgesharkVNC", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setDelay", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setJitter", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setLoss", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setRate", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.setCorruption", [item]);
  pushAction(actions, seen, registry, "containerlab.interface.copyMACAddress", [item]);
}

function appendLinkActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike
): void {
  const linkArg = getLinkArgument(item);
  if (item.contextValue === "containerlabSSHXLink" && linkArg) {
    pushAction(actions, seen, registry, "containerlab.lab.sshx.copyLink", [linkArg]);
  } else if (item.contextValue === "containerlabGottyLink" && linkArg) {
    pushAction(actions, seen, registry, "containerlab.lab.gotty.copyLink", [linkArg]);
  }
}

function appendHelpFeedbackActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike
): void {
  const linkArg = getLinkArgument(item);
  if (!linkArg) {
    return;
  }
  pushAction(actions, seen, registry, "containerlab.openLink", [linkArg], "Open Link");
}

function appendEndpointActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike,
  contributedActions: readonly ExplorerContributedMenuItem[],
  commandLabels: ReadonlyMap<string, string>,
  commandIcons: ReadonlyMap<string, string>
): void {
  const normalizedState = String(item.state ?? "").toLowerCase();
  if (normalizedState === "connected") {
    pushAction(actions, seen, registry, "containerlab.editor.topoViewerEditor", [item]);
    pushAction(actions, seen, registry, "containerlab.lab.cloneRepo", [item]);
    pushAction(actions, seen, registry, "containerlab.install.edgeshark", [item]);
    pushAction(actions, seen, registry, "containerlab.uninstall.edgeshark", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.capture.killAllWiresharkVNC", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.set.sessionHostname", [item]);
  }
  pushAction(actions, seen, registry, "containerlab.endpoint.reconnect", [item]);
  pushAction(actions, seen, registry, "containerlab.endpoint.remove", [item], undefined, true);
  pushAction(actions, seen, registry, "containerlab.endpoint.copyUrl", [item]);
  appendContributedActions(actions, seen, registry, item, contributedActions, commandLabels, commandIcons);
}

function isFileExplorerContext(contextValue: string | undefined): boolean {
  return (
    contextValue === "containerlabFileExplorerRoot" ||
    contextValue === "containerlabFileFolder" ||
    contextValue === "containerlabFile" ||
    contextValue === "containerlabFileTopology"
  );
}

function appendFileExplorerActions(
  actions: ExplorerAction[],
  seen: Set<string>,
  registry: ExplorerActionRegistry,
  item: ExplorerTreeItemLike,
  contributedActions: readonly ExplorerContributedMenuItem[],
  commandLabels: ReadonlyMap<string, string>,
  commandIcons: ReadonlyMap<string, string>
): void {
  const contextValue = item.contextValue;
  const isRoot = contextValue === "containerlabFileExplorerRoot";
  const isFolder = contextValue === "containerlabFileFolder";
  const isFile =
    contextValue === "containerlabFile" || contextValue === "containerlabFileTopology";

  if (isFile) {
    pushAction(actions, seen, registry, "containerlab.file.open", [item]);
  }
  if (isRoot || isFolder) {
    pushAction(actions, seen, registry, "containerlab.file.newFile", [item]);
    pushAction(actions, seen, registry, "containerlab.file.newFolder", [item]);
  }
  if (!isRoot) {
    pushAction(actions, seen, registry, "containerlab.file.rename", [item]);
    pushAction(actions, seen, registry, "containerlab.file.delete", [item], undefined, true);
    pushAction(actions, seen, registry, "containerlab.file.copyPath", [item]);
  }
  appendContributedActions(actions, seen, registry, item, contributedActions, commandLabels, commandIcons);
}

function appendNodeActionsForContext(
  actions: ExplorerAction[],
  seen: Set<string>,
  sectionId: ExplorerSectionId,
  item: ExplorerTreeItemLike,
  registry: ExplorerActionRegistry,
  options: ExplorerSnapshotOptions,
  contributedActions: readonly ExplorerContributedMenuItem[],
  commandLabels: ReadonlyMap<string, string>,
  commandIcons: ReadonlyMap<string, string>
): void {
  const contextValue = item.contextValue;
  if (isFileExplorerContext(contextValue)) {
    appendFileExplorerActions(
      actions,
      seen,
      registry,
      item,
      options.commandMetadata?.contributedFileActions ?? [],
      commandLabels,
      commandIcons
    );
    return;
  }
  if (contextValue === "containerlabEndpoint") {
    appendEndpointActions(
      actions,
      seen,
      registry,
      item,
      options.commandMetadata?.contributedEndpointActions ?? [],
      commandLabels,
      commandIcons
    );
    return;
  }
  if (isLabContext(contextValue)) {
    appendLabActions(
      actions,
      seen,
      registry,
      sectionId,
      item,
      options.commandMetadata?.contributedLabActions ?? [],
      commandLabels,
      commandIcons
    );
    return;
  }
  if (contextValue === "containerlabContainer" || contextValue === "containerlabContainerGroup") {
    appendContainerActions(
      actions,
      seen,
      registry,
      item,
      contributedActions,
      commandLabels,
      commandIcons
    );
    return;
  }
  if (contextValue === "containerlabInterfaceUp") {
    appendInterfaceActions(actions, seen, registry, item, options.isLocalCaptureAllowed);
    return;
  }
  if (contextValue === "containerlabSSHXLink" || contextValue === "containerlabGottyLink") {
    appendLinkActions(actions, seen, registry, item);
  }
}

function getNodeActions(
  sectionId: ExplorerSectionId,
  item: ExplorerTreeItemLike,
  registry: ExplorerActionRegistry,
  options: ExplorerSnapshotOptions
): ExplorerAction[] {
  const actions: ExplorerAction[] = [];
  const seen = new Set<string>();
  const commandMetadata = options.commandMetadata;
  const contributedActions = commandMetadata?.contributedContainerActions ?? [];
  const commandLabels = commandMetadata?.commandLabels ?? new Map<string, string>();
  const commandIcons = commandMetadata?.commandIcons ?? new Map<string, string>();

  if (sectionId === "helpFeedback") {
    appendHelpFeedbackActions(actions, seen, registry, item);
    return filterHiddenActions(applyCommandIcons(actions, commandIcons), options);
  }

  appendNodeActionsForContext(
    actions,
    seen,
    sectionId,
    item,
    registry,
    options,
    contributedActions,
    commandLabels,
    commandIcons
  );

  return filterHiddenActions(applyCommandIcons(actions, commandIcons), options);
}

function resolvePrimaryAction(
  contextValue: string | undefined,
  nodeActions: ExplorerAction[],
  nodeState?: string
): ExplorerAction | undefined {
  if (contextValue === "containerlabFileTopology") {
    return nodeActions.find((action) => action.commandId === "containerlab.file.open");
  }
  if (contextValue === "containerlabFile") {
    return nodeActions.find((action) => action.commandId === "containerlab.file.open");
  }
  if (
    contextValue === "containerlabFileExplorerRoot" ||
    contextValue === "containerlabFileFolder"
  ) {
    return undefined;
  }

  if (contextValue === "containerlabEndpoint") {
    const normalizedState = String(nodeState ?? "").toLowerCase();
    if (normalizedState !== "connected") {
      return nodeActions.find((action) => action.commandId === "containerlab.endpoint.reconnect");
    }
    return undefined;
  }

  if (isLabContext(contextValue)) {
    return nodeActions.find((action) => action.commandId === "containerlab.lab.graph.topoViewer");
  }

  if (
    contextValue === "containerlabContainer" ||
    contextValue === "containerlabContainerGroup" ||
    contextValue === "containerlabInterfaceUp" ||
    contextValue === "containerlabInterfaceDown" ||
    isShareLinkNode(contextValue)
  ) {
    return undefined;
  }

  return nodeActions.length > 0 ? nodeActions[0] : undefined;
}

async function getProviderChildren(
  provider: ExplorerTreeProvider,
  element?: ExplorerTreeItemLike
): Promise<ExplorerTreeItemLike[]> {
  const result = await Promise.resolve(provider.getChildren(element));
  if (!Array.isArray(result)) {
    return [];
  }
  return result as ExplorerTreeItemLike[];
}

function shouldResolveChildren(item: ExplorerTreeItemLike): boolean {
  return item.collapsibleState !== TREE_ITEM_COLLAPSIBLE_NONE;
}

function shouldResolveNodeChildren(
  item: ExplorerTreeItemLike,
  sectionId: ExplorerSectionId,
  options: ExplorerSnapshotOptions,
  nodeId: string
): boolean {
  if (!shouldResolveChildren(item)) {
    return false;
  }
  if (sectionId !== "fileExplorer") {
    return true;
  }
  return (options.expandedBySection?.fileExplorer ?? []).includes(nodeId);
}

function resolveNodeStatusIndicator(
  contextValue: string | undefined,
  item: ExplorerTreeItemLike,
  children: ExplorerNode[]
): ExplorerNode["statusIndicator"] {
  if (contextValue === "containerlabEndpoint") {
    return getStatusIndicator(item);
  }
  if (isDeployedLab(contextValue) || contextValue === "containerlabContainerGroup") {
    return aggregateStatusFromIndicators(collectContainerIndicators(children));
  }
  return getStatusIndicator(item);
}

async function buildNode(
  provider: ExplorerTreeProvider,
  item: ExplorerTreeItemLike,
  sectionId: ExplorerSectionId,
  options: ExplorerSnapshotOptions,
  registry: ExplorerActionRegistry,
  pathId: string
): Promise<ExplorerNode> {
  const contextValue = item.contextValue;
  const nodeId = item.id || pathId;
  const rawLabel = labelToText(item.label);
  const label = isLabContext(contextValue) ? rawLabel.replace(LAB_LABEL_LINK_PREFIX_REGEX, "") : rawLabel;
  const description = shouldHideNodeDescription(contextValue)
    ? undefined
    : descriptionToText(item.description);
  const tooltip = tooltipToText(item.tooltip);
  const rawChildrenItems = shouldResolveNodeChildren(item, sectionId, options, nodeId)
    ? await getProviderChildren(provider, item)
    : [];
  const shareInfo = isLabContext(contextValue) ? getLabShareInfo(rawChildrenItems) : undefined;
  const childrenItems = isLabContext(contextValue)
    ? rawChildrenItems.filter((child) => !isShareLinkNode(child.contextValue))
    : rawChildrenItems;
  const children = await Promise.all(
    childrenItems.map((child, index) =>
      buildNode(provider, child, sectionId, options, registry, `${pathId}/${index}`)
    )
  );
  const nodeActions = getNodeActions(sectionId, item, registry, options);
  if (shareInfo) {
    const copyCommandId =
      shareInfo.kind === "sshx" ? "containerlab.lab.sshx.copyLink" : "containerlab.lab.gotty.copyLink";
    const hasCopyAction = nodeActions.some((action) => action.commandId === copyCommandId);
    if (!hasCopyAction) {
      nodeActions.push(
        registry.createAction(
          copyCommandId,
          commandLabel(copyCommandId),
          [shareInfo.url],
          DESTRUCTIVE_COMMANDS.has(copyCommandId)
        )
      );
    }
  }
  let shareAction: ExplorerAction | undefined;
  if (shareInfo) {
    const label = shareInfo.kind === "sshx" ? "Open Shared Terminal" : "Open Web Terminal";
    shareAction = registry.createAction("containerlab.openLink", label, [shareInfo.url]);
  } else {
    shareAction = undefined;
  }
  const primaryAction = resolvePrimaryAction(contextValue, nodeActions, item.state);
  const statusIndicator = resolveNodeStatusIndicator(contextValue, item, children);
  const hasChildren =
    children.length > 0 ||
    Boolean(item.hasChildren) ||
    (sectionId === "fileExplorer" && item.collapsibleState !== TREE_ITEM_COLLAPSIBLE_NONE);

  return {
    id: nodeId,
    label,
    description,
    tooltip,
    contextValue,
    endpointId: item.endpointId,
    state: item.state,
    statusIndicator,
    statusDescription: description,
    primaryAction,
    shareAction,
    hasChildren,
    actions: nodeActions,
    children
  };
}

async function buildSectionNodes(
  provider: ExplorerTreeProvider,
  sectionId: ExplorerSectionId,
  options: ExplorerSnapshotOptions,
  registry: ExplorerActionRegistry
): Promise<ExplorerNode[]> {
  const roots = await getProviderChildren(provider);
  return Promise.all(
    roots.map((item, index) => buildNode(provider, item, sectionId, options, registry, `${sectionId}/${index}`))
  );
}

function countNodes(nodes: ExplorerNode[], predicate: (node: ExplorerNode) => boolean): number {
  let total = 0;
  for (const node of nodes) {
    if (predicate(node)) {
      total += 1;
    }
    total += countNodes(node.children, predicate);
  }
  return total;
}

function countForSection(sectionId: ExplorerSectionId, nodes: ExplorerNode[]): number {
  if (sectionId === "runningLabs") {
    return countNodes(nodes, (node) => isDeployedLab(node.contextValue));
  }
  if (sectionId === "localLabs") {
    return countNodes(nodes, (node) => isUndeployedLab(node.contextValue));
  }
  return nodes.length;
}

function toolbarActionsForSection(
  sectionId: ExplorerSectionId,
  registry: ExplorerActionRegistry,
  options: ExplorerSnapshotOptions
): ExplorerAction[] {
  const actions: ExplorerAction[] = [];
  const seen = new Set<string>();
  const commandLabels = options.commandMetadata?.commandLabels ?? new Map<string, string>();
  const commandIcons = options.commandMetadata?.commandIcons ?? new Map<string, string>();

  if (sectionId === "runningLabs") {
    pushAction(actions, seen, registry, "containerlab.lab.deploy.specificFile");
    pushAction(actions, seen, registry, "containerlab.images.manage");
    pushAction(actions, seen, registry, "containerlab.inspectAll");
    if (options.hideNonOwnedLabs) {
      pushAction(actions, seen, registry, "containerlab.treeView.runningLabs.showNonOwnedLabs");
    } else {
      pushAction(actions, seen, registry, "containerlab.treeView.runningLabs.hideNonOwnedLabs");
    }
  }

  if (sectionId === "localLabs") {
    pushAction(actions, seen, registry, "containerlab.editor.topoViewerEditor");
    pushAction(actions, seen, registry, "containerlab.lab.cloneRepo");
    pushAction(actions, seen, registry, "containerlab.images.manage");
  }

  appendContributedActions(
    actions,
    seen,
    registry,
    undefined,
    options.commandMetadata?.contributedToolbarActions?.[sectionId] ?? [],
    commandLabels,
    commandIcons
  );

  return filterHiddenActions(applyCommandIcons(actions, commandIcons), options);
}

function contextActionsForSection(
  sectionId: ExplorerSectionId,
  registry: ExplorerActionRegistry,
  options: ExplorerSnapshotOptions
): ExplorerAction[] {
  const actions: ExplorerAction[] = [];
  const seen = new Set<string>();
  const commandLabels = options.commandMetadata?.commandLabels ?? new Map<string, string>();
  const commandIcons = options.commandMetadata?.commandIcons ?? new Map<string, string>();

  appendContributedActions(
    actions,
    seen,
    registry,
    undefined,
    options.commandMetadata?.contributedSectionContextActions?.[sectionId] ?? [],
    commandLabels,
    commandIcons
  );

  return filterHiddenActions(applyCommandIcons(actions, commandIcons), options);
}

async function buildSectionSnapshot(
  sectionId: ExplorerSectionId,
  provider: ExplorerTreeProvider,
  options: ExplorerSnapshotOptions,
  registry: ExplorerActionRegistry
): Promise<ExplorerSectionSnapshot> {
  const nodes = await buildSectionNodes(provider, sectionId, options, registry);
  return {
    id: sectionId,
    label: EXPLORER_SECTION_LABELS[sectionId],
    count: countForSection(sectionId, nodes),
    nodes,
    toolbarActions: toolbarActionsForSection(sectionId, registry, options),
    contextActions: contextActionsForSection(sectionId, registry, options)
  };
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function buildSectionSnapshotSafe(
  sectionId: ExplorerSectionId,
  provider: ExplorerTreeProvider,
  options: ExplorerSnapshotOptions,
  registry: ExplorerActionRegistry
): Promise<ExplorerSectionSnapshot> {
  try {
    return await withTimeout(
      buildSectionSnapshot(sectionId, provider, options, registry),
      SECTION_BUILD_TIMEOUT_MS,
      `Timed out while building section '${sectionId}'`
    );
  } catch (error: unknown) {
    console.error(`[containerlab explorer] failed to build section '${sectionId}'`, error);
    return {
      id: sectionId,
      label: EXPLORER_SECTION_LABELS[sectionId],
      count: 0,
      nodes: [],
      toolbarActions: toolbarActionsForSection(sectionId, registry, options),
      contextActions: contextActionsForSection(sectionId, registry, options)
    };
  }
}

export async function buildExplorerSnapshot(
  providers: ExplorerSnapshotProviders,
  filterText: string,
  options: ExplorerSnapshotOptions
): Promise<ExplorerSnapshotBuildResult> {
  const registry = new ExplorerActionRegistry();
  const providersBySection: Record<ExplorerSectionId, ExplorerTreeProvider> = {
    runningLabs: providers.runningProvider,
    localLabs: providers.localProvider,
    fileExplorer: providers.fileProvider ?? EMPTY_PROVIDER,
    helpFeedback: providers.helpProvider
  };
  const sectionOrder = options.sectionOrder ?? EXPLORER_SECTION_ORDER;

  const sections = await Promise.all(
    sectionOrder.map((sectionId) =>
      buildSectionSnapshotSafe(sectionId, providersBySection[sectionId], options, registry)
    )
  );

  return {
    snapshot: {
      command: "snapshot",
      filterText,
      sections
    },
    actionBindings: registry.getBindings()
  };
}
