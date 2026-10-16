import * as vscode from "vscode";

import { isInternalInterfaceName, nodeNamespaceInterfaceName } from "@containerlab/clab-ui/session";

import { outputChannel, dockerClient, extensionContext, username } from "../globals";
import * as utils from "../utils";
import type {
  ClabContainerGroupTreeNode,
  ClabContainerTreeNode,
  ClabInterfaceTreeNode
} from "../treeView/common";
import {
  genPacketflixURI,
  getHostname,
  isHostNetnsInterface,
  setSessionHostname
} from "../utils/packetflix";
import type { ImagePullPolicy } from "../utils/consts";
import { WIRESHARK_VNC_PANEL, createPanelWebviewHtml } from "../webviews/shared/webviewPanels";
import { getLabBackend } from "../backend/labBackends";
import { isRemoteNode, remoteHostname, remoteLabNameOf } from "../backend/remoteNode";
import { startVncProxy } from "../backend/vncProxy";
import {
  DEFAULT_WIRESHARK_VNC_DOCKER_IMAGE,
  DEFAULT_WIRESHARK_VNC_DOCKER_PULL_POLICY,
  WIRESHARK_VNC_CTR_NAME_PREFIX
} from "../utils/consts";

export { getHostname, setSessionHostname };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Begin packet capture on an interface.
 */
export async function captureInterface(
  node: ClabInterfaceTreeNode,
  allSelectedNodes?: ClabInterfaceTreeNode[]
) {
  outputChannel.debug(
    `captureInterface() called for node=${node.parentName}, interface=${node.name}`
  );
  outputChannel.debug(
    `remoteName = ${vscode.env.remoteName ?? "(none)"}; isOrbstack=${utils.isOrbstack()}`
  );

  // Settings override
  const preferredCaptureMethod = vscode.workspace
    .getConfiguration("containerlab")
    .get<string>("capture.preferredAction");
  switch (preferredCaptureMethod) {
    case "Edgeshark":
      return captureInterfaceWithPacketflix(node, allSelectedNodes);
    case "Wireshark VNC":
      return captureEdgesharkVNC(node, allSelectedNodes);
  }

  // Default to VNC capture
  return captureEdgesharkVNC(node, allSelectedNodes);
}

const MANAGEMENT_INTERFACE_NAMES = new Set(["eth0", "mgmt0"]);
const INTERFACE_NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true });

/** Last interface selection per container, for this VS Code session. */
const rememberedCaptureSelections = new Map<string, string[]>();

interface InterfaceQuickPickItem extends vscode.QuickPickItem {
  /** Interface as listed in the explorer. */
  source: ClabInterfaceTreeNode;
  /** Interface as captured. */
  iface: ClabInterfaceTreeNode;
}

/** Name the user knows: host-side link interfaces (clab-s-*) carry the node's port name as alias. */
function interfaceDisplayName(iface: ClabInterfaceTreeNode): string {
  return isHostNetnsInterface(iface.name) && iface.alias ? iface.alias : iface.name;
}

type CaptureNode = ClabContainerTreeNode | ClabContainerGroupTreeNode;

function isContainerGroup(node: CaptureNode): node is ClabContainerGroupTreeNode {
  return Array.isArray((node as Partial<ClabContainerGroupTreeNode>).children);
}

/**
 * Interfaces of a node. A distributed node (e.g. SR-SIM with line cards) is a
 * group whose sub-containers share one network namespace and list the same
 * ports, so each interface name is kept once, primary container first.
 */
function nodeInterfaces(node: CaptureNode): ClabInterfaceTreeNode[] {
  if (!isContainerGroup(node)) return node.interfaces;
  const children = [...node.children].sort(
    (left, right) => Number(right.name === node.name) - Number(left.name === node.name)
  );
  const byName = new Map<string, ClabInterfaceTreeNode>();
  for (const iface of children.flatMap((child) => child.interfaces)) {
    if (!byName.has(iface.name)) byName.set(iface.name, iface);
  }
  return [...byName.values()];
}

function capturableInterfaces(node: CaptureNode): ClabInterfaceTreeNode[] {
  return nodeInterfaces(node)
    .filter(
      (iface) =>
        iface.name.length > 0 &&
        iface.name !== "lo" &&
        iface.state !== "unknown" &&
        !isInternalInterfaceName(node.kind, iface.name)
    )
    .sort((left, right) => {
      const leftMgmt = MANAGEMENT_INTERFACE_NAMES.has(left.name);
      const rightMgmt = MANAGEMENT_INTERFACE_NAMES.has(right.name);
      if (leftMgmt !== rightMgmt) return leftMgmt ? -1 : 1;
      return INTERFACE_NAME_COLLATOR.compare(
        interfaceDisplayName(left),
        interfaceDisplayName(right)
      );
    });
}

/**
 * The interface as captured: link ports reported by their host-side end
 * (clab-s-*) are captured under their name inside the node when the kind's
 * naming is known, so they share one stream with eth0 and the other ports.
 */
function toCaptureInterface(kind: string, iface: ClabInterfaceTreeNode): ClabInterfaceTreeNode {
  const nodeName = nodeNamespaceInterfaceName(kind, iface);
  return nodeName === undefined || nodeName === iface.name
    ? iface
    : ({ ...iface, name: nodeName } as ClabInterfaceTreeNode);
}

function toInterfaceQuickPickItem(
  kind: string,
  iface: ClabInterfaceTreeNode,
  picked: ReadonlySet<string>
): InterfaceQuickPickItem {
  const isUp = iface.state.toLowerCase() === "up";
  const label = interfaceDisplayName(iface);
  const captured = toCaptureInterface(kind, iface);
  const details = [
    captured.name !== label && !isHostNetnsInterface(captured.name) ? captured.name : undefined,
    !isHostNetnsInterface(iface.name) && iface.alias && iface.alias !== label
      ? iface.alias
      : undefined,
    MANAGEMENT_INTERFACE_NAMES.has(iface.name) ? "management" : undefined,
    iface.state || undefined
  ].filter((part): part is string => part !== undefined);
  return {
    label: `$(${isUp ? "circle-filled" : "circle-outline"}) ${label}`,
    description: details.join(" · "),
    picked: picked.has(iface.name),
    source: iface,
    iface: captured
  };
}

const SEPARATE_SESSIONS_KEY = "containerlab.capture.separateSessions";

interface OpenModeItem extends vscode.QuickPickItem {
  separate: boolean;
}

/** Captures a combined pick opens: one per container and network namespace. */
function combinedSessionCount(selected: ClabInterfaceTreeNode[]): number {
  return new Set(selected.map((iface) => `${iface.parentName}|${isHostNetnsInterface(iface.name)}`))
    .size;
}

/**
 * Second step for several interfaces: one Wireshark for all, or one each.
 * The last choice comes first, so Enter repeats it.
 */
async function pickOpenMode(
  nodeLabel: string,
  selected: ClabInterfaceTreeNode[]
): Promise<boolean | undefined> {
  const count = selected.length;
  const sessions = combinedSessionCount(selected);
  const combined: OpenModeItem = {
    label: "$(layers) One Wireshark",
    description:
      sessions > 1
        ? `${count} interfaces in ${sessions} Wiresharks: some ports can only be captured on the host side`
        : `all ${count} interfaces together`,
    separate: false
  };
  const perInterface: OpenModeItem = {
    label: "$(multiple-windows) One Wireshark per interface",
    description: `${count} separate windows`,
    separate: true
  };
  const lastSeparate =
    extensionContext?.globalState.get<boolean>(SEPARATE_SESSIONS_KEY, false) ?? false;
  const choice = await vscode.window.showQuickPick(
    lastSeparate ? [perInterface, combined] : [combined, perInterface],
    {
      title: `Capture packets on ${nodeLabel} · ${count} interfaces`,
      placeHolder: "Open the captures as"
    }
  );
  if (!choice) return undefined;
  void extensionContext?.globalState.update(SEPARATE_SESSIONS_KEY, choice.separate);
  return choice.separate;
}

/**
 * Pick one, several or all interfaces of a node, then capture them in one
 * Wireshark or in one Wireshark per interface.
 */
export async function captureNodeInterfaces(node: CaptureNode) {
  const interfaces = capturableInterfaces(node);
  const nodeLabel = isContainerGroup(node) ? node.rootNodeName : node.name_short || node.name;
  if (interfaces.length === 0) {
    vscode.window.showWarningMessage(
      `No interfaces to capture on ${nodeLabel}. Is the node running?`
    );
    return;
  }

  const available = new Set(interfaces.map((iface) => iface.name));
  const remembered = (rememberedCaptureSelections.get(node.name) ?? []).filter((name) =>
    available.has(name)
  );
  // Without a previous pick, start from the data interfaces: containerlab creates them for links.
  const initial = new Set(
    remembered.length > 0
      ? remembered
      : interfaces
          .filter((iface) => !MANAGEMENT_INTERFACE_NAMES.has(iface.name))
          .map((iface) => iface.name)
  );

  const picked = await vscode.window.showQuickPick(
    interfaces.map((iface) => toInterfaceQuickPickItem(node.kind, iface, initial)),
    {
      canPickMany: true,
      matchOnDescription: true,
      title: `Capture packets on ${nodeLabel}`,
      placeHolder: "Select the interfaces to capture"
    }
  );
  if (!picked || picked.length === 0) {
    return;
  }

  const selected = picked.map((item) => item.iface);
  const separate = selected.length > 1 ? await pickOpenMode(nodeLabel, selected) : false;
  if (separate === undefined) {
    return;
  }
  rememberedCaptureSelections.set(
    node.name,
    picked.map((item) => item.source.name)
  );
  if (separate) {
    for (const iface of selected) {
      await captureInterface(iface);
    }
    return;
  }
  return captureInterface(selected[0], selected);
}

async function buildPacketflixUri(
  node: ClabInterfaceTreeNode,
  allSelectedNodes?: ClabInterfaceTreeNode[],
  forVNC?: boolean
): Promise<[string, string] | undefined> {
  const selected = allSelectedNodes && allSelectedNodes.length > 0 ? allSelectedNodes : [node];

  // One Edgeshark stream covers one network namespace: split the selection per
  // container, and keep host-side link interfaces apart from the node's own.
  // Host-side ends of several nodes, e.g. both ends of a link, share one stream.
  const groups = new Map<string, ClabInterfaceTreeNode[]>();
  for (const iface of selected) {
    const key = isHostNetnsInterface(iface.name) ? "host" : `${iface.parentName}|node`;
    groups.set(key, [...(groups.get(key) ?? []), iface]);
  }
  if (groups.size > 1) {
    outputChannel.debug(
      `Edgeshark multi selection => ${groups.size} containers or namespaces => one capture each`
    );
    for (const group of groups.values()) {
      if (forVNC === true) {
        await captureEdgesharkVNC(group[0], group);
      } else {
        await captureInterfaceWithPacketflix(group[0], group);
      }
    }
    return undefined;
  }

  return await genPacketflixURI(selected, forVNC);
}

/**
 * Start capture on an interface using edgeshark/packetflix.
 * This method builds a 'packetflix:' URI that calls edgeshark.
 */
export async function captureInterfaceWithPacketflix(
  node: ClabInterfaceTreeNode,
  allSelectedNodes?: ClabInterfaceTreeNode[] // [CHANGED]
) {
  if (isRemoteNode()) {
    return captureRemote(node, allSelectedNodes, "packetflix");
  }
  const packetflixUri = await buildPacketflixUri(node, allSelectedNodes);
  if (!packetflixUri) {
    return;
  }

  vscode.env.openExternal(vscode.Uri.parse(packetflixUri[0]));
}

function isDarkModeEnabled(themeSetting?: string): boolean {
  switch (themeSetting) {
    case "Dark":
      return true;
    case "Light":
      return false;
    default: {
      const vscThemeKind = vscode.window.activeColorTheme.kind;
      return (
        vscThemeKind === vscode.ColorThemeKind.Dark ||
        vscThemeKind === vscode.ColorThemeKind.HighContrast
      );
    }
  }
}

async function getEdgesharkNetwork(): Promise<string> {
  try {
    // List containers using edgeshark as name filter
    const containers = await dockerClient.listContainers({
      filters: { name: ["edgeshark"] }
    });

    if (containers.length === 0) {
      return "";
    }

    // get info of the 0th ctr
    const container = dockerClient.getContainer(containers[0].Id);
    const containerInfo = await container.inspect();

    const networks = containerInfo.NetworkSettings.Networks;
    const networkIds = Object.values(networks)
      .map((net) => (net as { NetworkID?: string }).NetworkID)
      .filter((id): id is string => Boolean(id));

    if (networkIds.length === 0) {
      return "";
    }

    const networkId: string = networkIds[0];

    // Get network name from network ID
    const network = dockerClient.getNetwork(networkId);
    const networkInfo = await network.inspect();
    const netName = networkInfo.Name;

    if (netName) {
      return `--network ${netName}`;
    }
  } catch {
    // ignore
  }
  return "";
}

async function getVolumeMount(nodeName: string): Promise<string> {
  try {
    const container = dockerClient.getContainer(nodeName);
    const containerInfo = await container.inspect();
    const labDir = containerInfo.Config.Labels["clab-node-lab-dir"];

    if (labDir.length > 0 && labDir !== "<no value>") {
      const pathParts = labDir.split("/");
      pathParts.pop();
      pathParts.pop();
      const labRootDir = pathParts.join("/");
      outputChannel.debug(`Mounting lab directory: ${labRootDir} as /pcaps`);
      return `-v "${labRootDir}:/pcaps"`;
    }
  } catch {
    // ignore
  }
  return "";
}

function adjustPacketflixHost(uri: string, edgesharkNetwork: string): string {
  if (uri.includes("localhost") || uri.includes("127.0.0.1")) {
    const vncCaptureHostname = vscode.workspace
      .getConfiguration("containerlab")
      .get<string>("capture.wireshark.vncCaptureHostname", "");

    if (vncCaptureHostname) {
      return uri.replace(/localhost|127\.0\.0\.1/g, vncCaptureHostname);
    }

    return edgesharkNetwork
      ? uri.replace(/localhost|127\.0\.0\.1/g, "edgeshark-edgeshark-1")
      : uri.replace(/localhost|127\.0\.0\.1/g, "host.docker.internal");
  }
  return uri;
}

const VOLUME_MOUNT_REGEX = /-v\s+"?([^"]+)"?/;

function buildVolumeBinds(volumeMount?: string): string[] {
  if (volumeMount == null || volumeMount.length === 0) {
    return [];
  }
  const match = VOLUME_MOUNT_REGEX.exec(volumeMount);
  return match ? [match[1]] : [];
}

function buildWiresharkEnvVars(packetflixLink: string, themeSetting?: string): string[] {
  const env = [`PACKETFLIX_LINK=${packetflixLink}`];
  if (isDarkModeEnabled(themeSetting)) {
    env.push("DARK_MODE=1");
  }
  return env;
}

type WiresharkContainerOptions = {
  dockerImage: string;
  dockerPullPolicy: ImagePullPolicy.Always | ImagePullPolicy.Missing | ImagePullPolicy.Never;
  edgesharkNetwork: string;
  volumeMount?: string;
  packetflixUri: string;
  themeSetting?: string;
  ctrName: string;
  port: number;
};

async function startWiresharkContainer(
  options: WiresharkContainerOptions
): Promise<string | undefined> {
  try {
    await utils.checkAndPullDockerImage(options.dockerImage, options.dockerPullPolicy);

    const networkName = options.edgesharkNetwork.replace("--network ", "").trim();
    const volumeBinds = buildVolumeBinds(options.volumeMount);
    const env = buildWiresharkEnvVars(options.packetflixUri, options.themeSetting);

    const container = await dockerClient.createContainer({
      Image: options.dockerImage,
      name: options.ctrName,
      Env: env,
      HostConfig: {
        AutoRemove: true,
        PortBindings: {
          "5800/tcp": [{ HostIp: "127.0.0.1", HostPort: options.port.toString() }]
        },
        NetworkMode: networkName || "bridge",
        Binds: volumeBinds.length > 0 ? volumeBinds : undefined
      }
    });
    await container.start();
    outputChannel.info(`Started Wireshark VNC container: ${container.id}`);
    return container.id;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Starting Wireshark: ${message}`);
    return undefined;
  }
}

/** Short interface list for a panel title, e.g. "e1-1, e1-2 +3". */
function formatPanelInterfaces(names: string[]): string {
  const shown = names.slice(0, 2).join(", ");
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}

// Capture using Edgeshark + Wireshark via VNC in a webview
export async function captureEdgesharkVNC(
  node: ClabInterfaceTreeNode,
  allSelectedNodes?: ClabInterfaceTreeNode[]
) {
  // Handle settings
  const wsConfig = vscode.workspace.getConfiguration("containerlab");
  const dockerImage = wsConfig.get<string>(
    "capture.wireshark.dockerImage",
    DEFAULT_WIRESHARK_VNC_DOCKER_IMAGE
  );
  const dockerPullPolicy = wsConfig.get<
    ImagePullPolicy.Always | ImagePullPolicy.Missing | ImagePullPolicy.Never
  >("capture.wireshark.pullPolicy", DEFAULT_WIRESHARK_VNC_DOCKER_PULL_POLICY);
  const wiresharkThemeSetting = wsConfig.get<string>("capture.wireshark.theme");
  const keepOpenInBackground = wsConfig.get<boolean>("capture.wireshark.stayOpenInBackground");
  if (isRemoteNode()) {
    return captureRemote(node, allSelectedNodes, "vnc");
  }

  const packetflixUri = await buildPacketflixUri(node, allSelectedNodes, true);
  if (!packetflixUri) {
    return;
  }
  const capturedNames = (
    allSelectedNodes && allSelectedNodes.length > 1 ? allSelectedNodes : [node]
  ).map(interfaceDisplayName);
  const edgesharkNetwork = await getEdgesharkNetwork();
  const volumeMount = await getVolumeMount(node.parentName);
  const modifiedPacketflixUri = adjustPacketflixHost(packetflixUri[0], edgesharkNetwork);

  const port = await utils.getFreePort();
  const ctrName = utils.sanitize(
    `${WIRESHARK_VNC_CTR_NAME_PREFIX}-${username}-${node.parentName}_${node.name}-${Date.now()}`
  );
  const containerId = await startWiresharkContainer({
    dockerImage,
    dockerPullPolicy,
    edgesharkNetwork,
    volumeMount,
    packetflixUri: modifiedPacketflixUri,
    themeSetting: wiresharkThemeSetting,
    ctrName,
    port
  });
  if (containerId == null || containerId.length === 0) {
    return;
  }

  await openWiresharkPanel({
    title: `Wireshark (${node.parentName}:${formatPanelInterfaces(capturedNames)})`,
    localUrl: `http://localhost:${port}`,
    showVolumeTip: Boolean(volumeMount),
    keepOpenInBackground,
    onDispose: async () => {
      try {
        const container = dockerClient.getContainer(containerId);
        await container.stop();
        outputChannel.info(`Stopped Wireshark VNC container: ${containerId}`);
      } catch {
        // ignore
      }
    }
  });
}

/**
 * Capture on a lab server: Edgeshark runs there, and so does the Wireshark
 * VNC container, whose page this window loads through a local proxy.
 */
async function captureRemote(
  node: ClabInterfaceTreeNode,
  allSelectedNodes: ClabInterfaceTreeNode[] | undefined,
  mode: "vnc" | "packetflix"
): Promise<void> {
  const selected = allSelectedNodes && allSelectedNodes.length > 0 ? allSelectedNodes : [node];
  const targets = selected.map((iface) => ({
    containerName: iface.parentName,
    interfaceName: iface.name,
    nodeNamespace: !isHostNetnsInterface(iface.name)
  }));
  try {
    const backend = getLabBackend();
    const labName = await remoteLabNameOf(backend, node.parentName, node.labName);
    if (mode === "packetflix") {
      const { captures } = await backend.capturePacketflix(labName, {
        targets,
        remoteHostname: remoteHostname()
      });
      for (const capture of captures) {
        await vscode.env.openExternal(vscode.Uri.parse(capture.packetflixUri));
      }
      return;
    }
    const config = vscode.workspace.getConfiguration("containerlab");
    const { sessions } = await backend.createWiresharkVnc(labName, {
      targets,
      theme: isDarkModeEnabled(config.get<string>("capture.wireshark.theme")) ? "dark" : "light"
    });
    for (const session of sessions) {
      const proxy = await startVncProxy(backend, session.sessionId);
      await openWiresharkPanel({
        title: `Wireshark (${session.containerName}:${formatPanelInterfaces(session.interfaceNames)})`,
        localUrl: proxy.url,
        showVolumeTip: session.showVolumeTip,
        keepOpenInBackground: config.get<boolean>("capture.wireshark.stayOpenInBackground"),
        onDispose: async () => {
          proxy.close();
          await backend.closeWiresharkVnc(session.sessionId).catch(() => {});
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`Capture failed: ${message}`);
  }
}

interface WiresharkPanelOptions {
  title: string;
  /** The noVNC page on this machine; VS Code forwards it when the window is remote. */
  localUrl: string;
  showVolumeTip: boolean;
  keepOpenInBackground?: boolean;
  onDispose: () => Promise<void> | void;
}

async function openWiresharkPanel(options: WiresharkPanelOptions): Promise<void> {
  // let vscode port forward for us
  const localUri = vscode.Uri.parse(options.localUrl);
  const externalUri = (await vscode.env.asExternalUri(localUri)).toString();
  const extensionUri = vscode.extensions.getExtension("srl-labs.vscode-containerlab")?.extensionUri;
  if (!extensionUri) {
    void vscode.window.showErrorMessage(
      "Unable to render Wireshark panel because extension resources are unavailable."
    );
    await options.onDispose();
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "clabWiresharkVNC",
    options.title,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: options.keepOpenInBackground,
      localResourceRoots: [
        vscode.Uri.joinPath(extensionUri, "dist"),
        vscode.Uri.joinPath(extensionUri, "resources")
      ]
    }
  );

  panel.onDidDispose(() => {
    void options.onDispose();
  });

  const iframeUrl = externalUri;

  // Show info about where to save pcap files if volume is mounted
  if (options.showVolumeTip) {
    vscode.window.showInformationMessage(
      `Wireshark started. Save pcap files to /pcaps to persist them in the lab directory.`
    );
  }

  panel.webview.html = createPanelWebviewHtml(WIRESHARK_VNC_PANEL, panel.webview, extensionUri, {
    iframeUrl,
    showVolumeTip: options.showVolumeTip
  });

  const readinessMonitor = createVncReadinessMonitor(panel, localUri.toString(), iframeUrl);

  panel.webview.onDidReceiveMessage((message) => {
    if (!isRecord(message)) {
      return;
    }

    if (message.type === "retry-check") {
      readinessMonitor.start(true);
    }
  });

  // Readiness checks are triggered by the webview via postMessage.
}

type VncMonitorToken = { cancelled: boolean };

function isTokenCancelled(token: VncMonitorToken): boolean {
  return token.cancelled;
}

function createVncReadinessMonitor(
  panel: vscode.WebviewPanel,
  localUrl: string,
  iframeUrl: string
) {
  let disposed = false;
  let currentToken: VncMonitorToken | undefined;

  panel.onDidDispose(() => {
    disposed = true;
    if (currentToken) {
      currentToken.cancelled = true;
    }
  });

  const start = (force = false) => {
    if (disposed) {
      return;
    }
    if (currentToken && !force) {
      return;
    }

    if (currentToken) {
      currentToken.cancelled = true;
    }

    const token: VncMonitorToken = { cancelled: false };
    currentToken = token;

    void runVncReadinessLoop(panel, localUrl, iframeUrl, token, () => disposed).finally(() => {
      if (currentToken === token) {
        currentToken = undefined;
      }
    });
  };

  return { start };
}

async function runVncReadinessLoop(
  panel: vscode.WebviewPanel,
  localUrl: string,
  iframeUrl: string,
  token: VncMonitorToken,
  isDisposed: () => boolean
): Promise<void> {
  const maxAttempts = 60;
  const delayMs = 1000;

  if (isDisposed() || isTokenCancelled(token)) {
    return;
  }

  await utils.tryPostMessage(panel, { type: "vnc-progress", attempt: 0, maxAttempts });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (isDisposed() || isTokenCancelled(token)) {
      return;
    }

    const ready = await utils.isHttpEndpointReady(localUrl);
    if (isDisposed() || isTokenCancelled(token)) {
      return;
    }

    if (ready) {
      await utils.tryPostMessage(panel, { type: "vnc-ready", url: iframeUrl });
      return;
    }

    await utils.tryPostMessage(panel, { type: "vnc-progress", attempt, maxAttempts });
    await utils.delay(delayMs);
  }

  if (!isDisposed() && !isTokenCancelled(token)) {
    await utils.tryPostMessage(panel, { type: "vnc-timeout", url: iframeUrl });
  }
}

export async function killAllWiresharkVNCCtrs() {
  if (isRemoteNode()) {
    try {
      const result = await getLabBackend().closeAllWiresharkVnc();
      outputChannel.info(result.message);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      vscode.window.showErrorMessage(`Failed to close Wireshark VNC sessions: ${message}`);
    }
    return;
  }
  const dockerImage = vscode.workspace
    .getConfiguration("containerlab")
    .get<string>("capture.wireshark.dockerImage", DEFAULT_WIRESHARK_VNC_DOCKER_IMAGE);
  try {
    const ctrNamePrefix = `${WIRESHARK_VNC_CTR_NAME_PREFIX}-${username}`;

    // List containers which have that name + use the configured image
    const containers = await dockerClient.listContainers({
      filters: {
        name: [ctrNamePrefix],
        ancestor: [dockerImage]
      }
    });

    if (containers.length > 0) {
      // equivalent of docker rm -f for each container
      await Promise.all(
        containers.map(async (containerInfo) => {
          try {
            const container = dockerClient.getContainer(containerInfo.Id);
            await container.remove({
              force: true
            });
            outputChannel.info(`Removed Wireshark VNC container: ${containerInfo.Id}`);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            outputChannel.warn(`Failed to remove container ${containerInfo.Id}: ${message}`);
          }
        })
      );
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to remove Wireshark VNC containers: ${message}`);
  }
}
