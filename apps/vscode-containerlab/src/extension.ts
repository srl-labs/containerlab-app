import * as path from "path";
import * as os from "os";

import * as vscode from "vscode";
import Docker from "dockerode";
import { detectLocalEnvironment, findBinary } from "@srl-labs/containerlab-lab-backend/local";

import {
  clusterBackendOptions,
  connectionOf,
  disposeLabBackends,
  getConnections,
  getLocalBackend,
  initConnections,
  labPathOf,
  pickConnection,
  remoteUri
} from "./backend/labBackends";
import {
  isClusterConnection,
  LOCAL_CONNECTION,
  type ConnectionManager,
  type LabConnection
} from "./backend/connections";
import { RemoteLabFileSystem } from "./backend/remoteFileSystem";

import * as cmd from "./commands";
import * as utils from "./utils";
import {
  outputChannel,
  containerlabBinaryPath,
  runningLabsProvider,
  localLabsProvider,
  extensionContext,
  setOutputChannel,
  setUsername,
  setDockerClient,
  setContainerlabBinaryPath,
  setExtensionContext,
  setFavoriteLabs,
  setLocalLabsProvider,
  setRunningLabsProvider,
  setHideNonOwnedLabsState
} from "./globals";
import { WelcomePage } from "./welcomePage";
import { registerClabImageCompletion } from "./yaml/imageCompletion";
import * as ins from "./treeView/inspector";
import * as c from "./treeView/common";
import {
  LocalLabTreeDataProvider,
  RunningLabTreeDataProvider,
  HelpFeedbackProvider,
  isPollingMode
} from "./treeView";
import {
  refreshSshxSessions,
  refreshGottySessions,
  onEventsDataChanged,
  onContainerStateChanged,
  onFallbackDataChanged
} from "./services";
import { ContainerlabExplorerViewProvider } from "./webviews/explorer/containerlabExplorerViewProvider";

import { refreshSettingsPanel, registerSettings } from "./webviews/settings/settingsPanel";
import { registerAppearanceUpdates } from "./webviews/shared/appearance";
import { registerRenderedTopologyProvider } from "./commands/renderedTopology";
import { openLabsOverview } from "./commands/labsOverview";

let explorerViewProvider: ContainerlabExplorerViewProvider | undefined;

function isE2ESmokeTest(): boolean {
  return process.env.VSCODE_CONTAINERLAB_E2E === "1";
}

async function promptToInstallContainerlab(): Promise<void> {
  const installChoice = await vscode.window.showWarningMessage(
    "Containerlab is not installed. Would you like to install it?",
    "Install",
    "Cancel"
  );
  if (installChoice === "Install") {
    utils.installContainerlab();
    vscode.window
      .showInformationMessage(
        "Please complete the installation in the terminal, then reload the window.",
        "Reload Window"
      )
      .then((choice) => {
        if (choice === "Reload Window") {
          vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      });
  }
}

async function ensureContainerlabBinary(
  e2eSmokeTest: boolean,
  hasLabServers: boolean
): Promise<boolean> {
  if (containerlabBinaryPath !== "containerlab") {
    return true;
  }

  if (e2eSmokeTest) {
    outputChannel.warn("Containerlab binary not found; continuing in E2E smoke mode.");
    return true;
  }

  if (hasLabServers) {
    outputChannel.warn("Containerlab binary not found; only labs on lab hosts are available.");
    return false;
  }
  void promptToInstallContainerlab();
  return false;
}

async function validateUserPermissions(
  e2eSmokeTest: boolean,
  hasLabServers: boolean
): Promise<boolean> {
  outputChannel.debug(`Starting user permissions check`);
  const userInfo = await utils.getUserInfo();
  setUsername(userInfo.username);
  if (userInfo.hasPermission) {
    outputChannel.debug(
      `Permission check success for user '${userInfo.username}' (id:${userInfo.uid})`
    );
    return true;
  }

  outputChannel.error(
    `User '${userInfo.username}' (id:${userInfo.uid}) has insufficient permissions`
  );

  if (e2eSmokeTest) {
    outputChannel.warn("Continuing despite insufficient permissions in E2E smoke mode.");
    return true;
  }
  if (hasLabServers) {
    return false;
  }

  const runtime = utils.getConfig<string>("runtime", "docker");
  const requiredGroups = runtime === "podman" ? "'clab_admins'" : "'clab_admins' and 'docker'";
  vscode.window.showErrorMessage(
    `Extension activation failed. Insufficient permissions.\nEnsure ${userInfo.username} is in the ${requiredGroups} group(s).`
  );
  return false;
}

async function connectDockerSocket(
  e2eSmokeTest: boolean,
  hasLabServers: boolean
): Promise<boolean | undefined> {
  try {
    const socketPath = utils.getConfig<string>("dockerSocketPath", "/var/run/docker.sock");
    const docker = new Docker({ socketPath });
    setDockerClient(docker);
    await docker.ping();
    outputChannel.info("Successfully connected to Docker socket");
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    outputChannel.error(`Failed to connect to Docker socket: ${message}`);
    if (e2eSmokeTest) {
      outputChannel.warn("Continuing without Docker in E2E smoke mode.");
      return false;
    }
    if (hasLabServers) {
      return undefined;
    }
    vscode.window.showErrorMessage(
      `Failed to connect to Docker. Ensure Docker is running and you have proper permissions.`
    );
    return undefined;
  }
}

async function runFullStartupTasks(
  context: vscode.ExtensionContext,
  config: vscode.WorkspaceConfiguration,
  dockerAvailable: boolean,
  e2eSmokeTest: boolean,
  localReady: boolean
): Promise<void> {
  const skipUpdateCheck = config.get<boolean>("skipUpdateCheck", false);
  if (!skipUpdateCheck && !e2eSmokeTest && localReady) {
    utils.checkAndUpdateClabIfNeeded(outputChannel, context).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.error(`Update check error: ${message}`);
    });
  }

  // The image lists of this machine and the lab hosts, for the image pickers.
  void utils.refreshDockerImages();
  if (dockerAvailable) {
    utils.startDockerImageEventMonitor(context);
  }

  if (e2eSmokeTest) {
    return;
  }

  const welcomePage = new WelcomePage(context);
  await welcomePage.show();
}

function stopRealtimeBackgroundWorkers(): void {
  ins.resetForConnectionChange();
}

function registerProcessShutdownHooks(context: vscode.ExtensionContext): void {
  const handleBeforeExit = () => stopRealtimeBackgroundWorkers();
  const handleExit = () => stopRealtimeBackgroundWorkers();
  const handleDisconnect = () => stopRealtimeBackgroundWorkers();
  const handleSigterm = () => stopRealtimeBackgroundWorkers();
  const handleSigint = () => stopRealtimeBackgroundWorkers();
  const handleSighup = () => stopRealtimeBackgroundWorkers();

  process.once("beforeExit", handleBeforeExit);
  process.once("exit", handleExit);
  process.once("disconnect", handleDisconnect);
  process.once("SIGTERM", handleSigterm);
  process.once("SIGINT", handleSigint);
  process.once("SIGHUP", handleSighup);

  context.subscriptions.push({
    dispose: () => {
      process.removeListener("beforeExit", handleBeforeExit);
      process.removeListener("exit", handleExit);
      process.removeListener("disconnect", handleDisconnect);
      process.removeListener("SIGTERM", handleSigterm);
      process.removeListener("SIGINT", handleSigint);
      process.removeListener("SIGHUP", handleSighup);
      stopRealtimeBackgroundWorkers();
    }
  });
}

function registerUnsupportedViews(context: vscode.ExtensionContext) {
  let warningShown = false;
  const showWarningOnce = () => {
    if (warningShown) {
      return;
    }
    warningShown = true;
    vscode.window.showWarningMessage(
      "The Containerlab extension is only supported on Linux or WSL. Features are disabled on this platform."
    );
  };

  const unsupportedProvider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView) {
      webviewView.webview.options = {
        enableScripts: false,
        enableCommandUris: ["containerlab.connection.add"]
      };
      webviewView.webview.html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    html, body {
      margin: 0;
      padding: 0;
      font-family: sans-serif;
      color: inherit;
      background: transparent;
    }
    .wrap {
      padding: 12px;
    }
    a {
      color: inherit;
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h3>Work with labs on a lab host</h3>
    <p>Containerlab runs labs on Linux. From this computer, you can work with the labs on a Linux lab host that runs clab-api-server.</p>
    <p><a href="command:containerlab.connection.add">Add Lab Host…</a></p>
    <p><a href="https://srl-labs.github.io/containerlab-app/docs/install/vscode/#work-with-labs-on-a-lab-host">How to set up a lab host</a></p>
  </div>
</body>
</html>`;

      context.subscriptions.push(
        webviewView.onDidChangeVisibility(() => {
          if (webviewView.visible) {
            showWarningOnce();
          }
        })
      );
    }
  };

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ContainerlabExplorerViewProvider.viewType,
      unsupportedProvider
    )
  );
}

/**
 * Checks containerlab on this machine. Problems block activation no longer:
 * the user may run labs on a lab host instead.
 */
async function prepareLocalContainerlab(
  e2eSmokeTest: boolean,
  hasLabServers: boolean
): Promise<boolean> {
  if (!(await setClabBinPath())) {
    outputChannel.error("Error setting containerlab binary. Labs on this machine are unavailable.");
    return false;
  }
  if (!(await ensureContainerlabBinary(e2eSmokeTest, hasLabServers))) {
    return false;
  }
  outputChannel.info("Containerlab extension activated.");
  return validateUserPermissions(e2eSmokeTest, hasLabServers);
}

/**
 * Whether containerlab can run labs on this machine. What is missing shows on
 * Local's root in the explorer, with the commands that fix it.
 */
async function checkLocalConnection(connections: ConnectionManager): Promise<boolean> {
  if (!connections.localAvailable) return false;
  const environment = await detectLocalEnvironment(getLocalBackend().options).catch(
    (err: unknown) => ({
      available: false,
      problems: [err instanceof Error ? err.message : String(err)],
      containerlabVersion: undefined,
      username: undefined
    })
  );
  connections.setLocalStatus({
    available: environment.available,
    problems: environment.problems,
    ...(environment.containerlabVersion !== undefined
      ? { containerlabVersion: environment.containerlabVersion }
      : {}),
    ...(environment.username !== undefined ? { username: environment.username } : {})
  });
  return environment.available;
}

/**
 * Whether containerlab reaches each Kubernetes cluster lab host: the context,
 * clabernetes and the user's rights. What is missing shows on the cluster's root.
 */
async function checkClusterConnections(connections: ConnectionManager): Promise<void> {
  await Promise.all(
    connections
      .list()
      .filter(isClusterConnection)
      .map(async (connection) => {
        const environment = await detectLocalEnvironment(clusterBackendOptions(connection)).catch(
          (err: unknown) => ({
            available: false,
            problems: [err instanceof Error ? err.message : String(err)]
          })
        );
        connections.setProblem(
          connection,
          environment.available ? undefined : environment.problems.join(" ")
        );
      })
  );
}

// Session refresh functions are available from ./services/sessionRefresh directly

function showOutputChannel() {
  outputChannel.show(true);
}

function manageImpairments(node: c.ClabContainerTreeNode) {
  return cmd.manageNodeImpairments(node, extensionContext);
}

function graphTopoViewer(node?: c.ClabLabTreeNode) {
  return cmd.graphTopoviewer(node, extensionContext);
}

async function openTopoViewerEditorCommand(node?: c.ClabLabTreeNode) {
  // Just delegate to graphTopoViewer which handles everything
  return graphTopoViewer(node);
}

/**
 * Creates a topology from a template and opens it in the TopoViewer: in this
 * workspace, or in the workspace of a lab host (the explorer node it was run
 * on, or the one the user picks).
 */
async function createTopoViewerTemplateFileCommand(target?: unknown) {
  const connections = getConnections();
  let connection: LabConnection | undefined = LOCAL_CONNECTION;
  if (target !== undefined) {
    connection = connectionOf(target);
  } else if (connections?.grouped === true) {
    connection = await pickConnection("New topology on");
  }
  if (!connection) {
    return;
  }
  const remote = connection.kind === "api";
  const uri = await vscode.window.showSaveDialog({
    title: remote
      ? `New topology on ${connection.label}`
      : "Enter containerlab topology template file name",
    defaultUri: remote
      ? remoteUri(connection, "new-lab.clab.yml")
      : vscode.workspace.workspaceFolders?.[0]?.uri,
    saveLabel: "Create Containerlab topology template file",
    filters: { "Containerlab YAML": ["clab.yml", "clab.yaml"], YAML: ["yaml", "yml"] }
  });
  if (!uri) {
    vscode.window.showWarningMessage("No file path selected. Operation canceled.");
    return;
  }

  // Ensure the file has .clab.yml extension
  let fileUri = uri;
  if (!/\.clab\.(yml|yaml)$/i.test(uri.path)) {
    // Replace .yml/.yaml with .clab.yml, or append if no extension
    fileUri = uri.with({ path: uri.path.replace(/\.(yml|yaml)$/i, "") + ".clab.yml" });
  }
  const filePath = labPathOf(fileUri);

  // Create a starter template file with example nodes
  const baseName = path.posix.basename(fileUri.path);
  const labName = baseName.replace(/\.clab\.(yml|yaml)$/i, "").replace(/\.(yml|yaml)$/i, "");
  const template = `name: ${labName}

topology:
  nodes:
    srl1:
      kind: nokia_srlinux
      type: ixr-d1
      image: ghcr.io/nokia/srlinux:latest
    client1:
      kind: linux
      image: ghcr.io/srl-labs/network-multitool:latest

  links:
    - endpoints: [ "srl1:e1-1", "client1:eth1" ]
`;
  // Files on a lab host are written through its workspace file system.
  await vscode.workspace.fs.writeFile(fileUri, Buffer.from(template, "utf8"));

  // Open the file in the editor
  const doc = await vscode.workspace.openTextDocument(fileUri);
  await vscode.window.showTextDocument(doc);

  // Open the TopoViewer
  const node = c.onConnection(
    new c.ClabLabTreeNode(
      labName,
      vscode.TreeItemCollapsibleState.None,
      { absolute: filePath, relative: baseName },
      labName
    ),
    connection.id
  );
  return graphTopoViewer(node);
}

function updateHideNonOwnedLabs(hide: boolean) {
  setHideNonOwnedLabsState(hide);
}

function hideNonOwnedLabsCommand() {
  runningLabsProvider.refreshWithoutDiscovery();
  updateHideNonOwnedLabs(true);
}

function showNonOwnedLabsCommand() {
  runningLabsProvider.refreshWithoutDiscovery();
  updateHideNonOwnedLabs(false);
}

function onDidChangeConfiguration(e: vscode.ConfigurationChangeEvent) {
  if (e.affectsConfiguration("containerlab.autoSync")) {
    // Setting changed; no action required here
  }
}

function registerCommands(context: vscode.ExtensionContext) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const commands: Array<[string, (...args: any[]) => unknown]> = [
    ["containerlab.lab.openFile", cmd.openLabFile],
    ["containerlab.lab.addToWorkspace", cmd.addLabFolderToWorkspace],
    ["containerlab.lab.openFolderInNewWindow", cmd.openFolderInNewWindow],
    ["containerlab.lab.copyPath", cmd.copyLabPath],
    ["containerlab.lab.cloneRepo", cmd.cloneRepo],
    ["containerlab.lab.clonePopularRepo", cmd.clonePopularRepo],
    ["containerlab.lab.toggleFavorite", cmd.toggleFavorite],
    ["containerlab.lab.delete", cmd.deleteLab],
    ["containerlab.lab.deploy", cmd.deploy],
    ["containerlab.lab.deploy.cleanup", cmd.deployCleanup],
    ["containerlab.lab.deploy.specificFile", cmd.deploySpecificFile],
    ["containerlab.lab.deployPopular", cmd.deployPopularLab],
    ["containerlab.lab.redeploy", cmd.redeploy],
    ["containerlab.lab.redeploy.cleanup", cmd.redeployCleanup],
    ["containerlab.lab.apply", cmd.apply],
    ["containerlab.lab.destroy", cmd.destroy],
    ["containerlab.lab.destroy.cleanup", cmd.destroyCleanup],
    ["containerlab.lab.start", cmd.startLab],
    ["containerlab.lab.stop", cmd.stopLab],
    ["containerlab.lab.restart", cmd.restartLab],
    ["containerlab.lab.save", cmd.saveLab],
    ["containerlab.lab.saveCopy", cmd.saveLabCopy],
    ["containerlab.lab.sshx.attach", cmd.sshxAttach],
    ["containerlab.lab.sshx.detach", cmd.sshxDetach],
    ["containerlab.lab.sshx.reattach", cmd.sshxReattach],
    ["containerlab.lab.sshx.copyLink", cmd.sshxCopyLink],
    ["containerlab.lab.gotty.attach", cmd.gottyAttach],
    ["containerlab.lab.gotty.detach", cmd.gottyDetach],
    ["containerlab.lab.gotty.reattach", cmd.gottyReattach],
    ["containerlab.lab.gotty.copyLink", cmd.gottyCopyLink],
    ["containerlab.lab.sshToAllNodes", cmd.sshToLab],
    ["containerlab.lab.graph.drawio.horizontal", cmd.graphDrawIOHorizontal],
    ["containerlab.lab.graph.drawio.vertical", cmd.graphDrawIOVertical],
    ["containerlab.lab.graph.drawio.interactive", cmd.graphDrawIOInteractive],
    ["containerlab.lab.graph.mermaid", cmd.graphMermaid],
    ["containerlab.lab.graph.dot", cmd.graphDot],
    ["containerlab.lab.validate", cmd.validateLab],
    ["containerlab.lab.generate", (target?: unknown) => cmd.generateClosTopology(context, target)],
    ["containerlab.node.start", cmd.startNode],
    ["containerlab.node.stop", cmd.stopNode],
    ["containerlab.node.restart", cmd.restartNode],
    ["containerlab.node.pause", cmd.pauseNode],
    ["containerlab.node.unpause", cmd.unpauseNode],
    ["containerlab.node.save", cmd.saveNode],
    ["containerlab.node.attachShell", cmd.attachShell],
    ["containerlab.node.ssh", cmd.sshToNode],
    ["containerlab.node.telnet", cmd.telnetToNode],
    ["containerlab.node.showLogs", cmd.showLogs],
    ["containerlab.node.openBrowser", cmd.openBrowser],
    ["containerlab.node.copyIPv4Address", cmd.copyContainerIPv4Address],
    ["containerlab.node.copyIPv6Address", cmd.copyContainerIPv6Address],
    ["containerlab.node.copyName", cmd.copyContainerName],
    ["containerlab.node.copyID", cmd.copyContainerID],
    ["containerlab.node.copyKind", cmd.copyContainerKind],
    ["containerlab.node.copyImage", cmd.copyContainerImage],
    ["containerlab.interface.capture", cmd.captureInterface],
    ["containerlab.interface.captureWithEdgeshark", cmd.captureInterfaceWithPacketflix],
    ["containerlab.interface.captureWithEdgesharkVNC", cmd.captureEdgesharkVNC],
    ["containerlab.node.captureInterfaces", cmd.captureNodeInterfaces],
    ["containerlab.interface.setDelay", cmd.setLinkDelay],
    ["containerlab.interface.setJitter", cmd.setLinkJitter],
    ["containerlab.interface.setLoss", cmd.setLinkLoss],
    ["containerlab.interface.setRate", cmd.setLinkRate],
    ["containerlab.interface.setCorruption", cmd.setLinkCorruption],
    ["containerlab.interface.setImpairment", cmd.setImpairment],
    ["containerlab.interface.copyMACAddress", cmd.copyMACAddress],
    ["containerlab.install.edgeshark", cmd.installEdgeshark],
    ["containerlab.uninstall.edgeshark", cmd.uninstallEdgeshark],
    ["containerlab.capture.killAllWiresharkVNC", cmd.killAllWiresharkVNCCtrs],
    ["containerlab.set.sessionHostname", cmd.setSessionHostname],
    ["containerlab.openLink", cmd.openLink],
    ["containerlab.lab.fcli.bgpPeers", cmd.fcliBgpPeers],
    ["containerlab.lab.fcli.bgpRib", cmd.fcliBgpRib],
    ["containerlab.lab.fcli.ipv4Rib", cmd.fcliIpv4Rib],
    ["containerlab.lab.fcli.lldp", cmd.fcliLldp],
    ["containerlab.lab.fcli.mac", cmd.fcliMac],
    ["containerlab.lab.fcli.ni", cmd.fcliNi],
    ["containerlab.lab.fcli.subif", cmd.fcliSubif],
    ["containerlab.lab.fcli.sysInfo", cmd.fcliSysInfo],
    ["containerlab.lab.fcli.custom", cmd.fcliCustom],
    ["containerlab.images.manage", (target?: unknown) => cmd.manageImages(context, target)]
  ];
  commands.forEach(([name, handler]) => {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  });
  context.subscriptions.push(
    vscode.commands.registerCommand("containerlab.viewLogs", showOutputChannel)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("containerlab.node.manageImpairments", manageImpairments)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("containerlab.lab.graph.topoViewer", graphTopoViewer)
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "containerlab.editor.topoViewerEditor.open",
      openTopoViewerEditorCommand
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "containerlab.editor.topoViewerEditor",
      createTopoViewerTemplateFileCommand
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("containerlab.inspectAll", () =>
      cmd.inspectAllLabs(extensionContext)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("containerlab.inspectOneLab", (node: c.ClabLabTreeNode) =>
      cmd.inspectOneLab(node, extensionContext)
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "containerlab.treeView.runningLabs.hideNonOwnedLabs",
      hideNonOwnedLabsCommand
    )
  );
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "containerlab.treeView.runningLabs.showNonOwnedLabs",
      showNonOwnedLabsCommand
    )
  );
}

function registerConnectionCommands(context: vscode.ExtensionContext) {
  const commands: Array<[string, (target?: unknown) => unknown]> = [
    ["containerlab.connection.add", cmd.addConnection],
    ["containerlab.connection.signIn", cmd.signInToLabServer],
    ["containerlab.connection.signOut", cmd.signOutOfLabServer],
    ["containerlab.connection.remove", cmd.removeConnection],
    ["containerlab.connection.openWorkspace", cmd.openRemoteWorkspace],
    ["containerlab.connection.manage", cmd.manageConnections],
    // Actions of the lab host roots in the explorer.
    ["containerlab.endpoint.reconnect", cmd.reconnectConnection],
    ["containerlab.endpoint.remove", cmd.removeConnection],
    ["containerlab.endpoint.copyUrl", cmd.copyConnectionUrl]
  ];
  for (const [name, handler] of commands) {
    context.subscriptions.push(vscode.commands.registerCommand(name, handler));
  }
}

/**
 * Lab hosts report workspace changes; new and removed topologies show up in
 * the explorer without polling. One watch per signed-in host.
 */
function watchRemoteWorkspaces(connections: ConnectionManager): vscode.Disposable {
  const watches = new Map<string, AbortController>();
  const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const scheduleRefresh = (connection: LabConnection) => {
    const pending = refreshTimers.get(connection.id);
    if (pending) clearTimeout(pending);
    refreshTimers.set(
      connection.id,
      setTimeout(() => {
        refreshTimers.delete(connection.id);
        void connections
          .remoteTopologies(connection, 0)
          .catch(() => [])
          .then(() => localLabsProvider.forceRefresh());
      }, 300)
    );
  };
  const watch = (connection: LabConnection) => {
    const backend = connections.apiBackend(connection);
    if (!backend) return;
    const controller = new AbortController();
    watches.set(connection.id, controller);
    void (async () => {
      try {
        for await (const event of await backend.fs.watch(controller.signal)) {
          // Temp and backup files of a save are dot files; they change no topology.
          if (path.posix.basename(event.path).startsWith(".")) continue;
          if (event.kind !== "file" || /\.clab\.ya?ml$/i.test(event.path))
            scheduleRefresh(connection);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          outputChannel.debug(
            `[connections] Workspace events of ${connection.label} stopped: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      } finally {
        if (watches.get(connection.id) === controller) watches.delete(connection.id);
      }
    })();
  };
  const sync = () => {
    const signedIn = new Map(
      connections
        .list()
        .filter((connection) => connections.apiBackend(connection) !== undefined)
        .map((connection) => [connection.id, connection])
    );
    for (const [id, controller] of watches) {
      if (!signedIn.has(id)) {
        controller.abort();
        watches.delete(id);
      }
    }
    for (const [id, connection] of signedIn) {
      if (!watches.has(id)) watch(connection);
    }
  };
  sync();
  const subscription = connections.onDidChange(sync);
  return new vscode.Disposable(() => {
    subscription.dispose();
    for (const controller of watches.values()) controller.abort();
    for (const timer of refreshTimers.values()) clearTimeout(timer);
  });
}

/** Updates the views when a lab host signs in or out, or the list of hosts changes. */
function registerConnectionUpdates(
  context: vscode.ExtensionContext,
  connections: ConnectionManager
) {
  const setHostsContext = () =>
    vscode.commands.executeCommand(
      "setContext",
      "containerlab:hasLabHosts",
      connections.list().some((connection) => connection.kind === "api")
    );
  void setHostsContext();
  let reloading: Promise<void> = Promise.resolve();
  const reload = (connection: LabConnection | undefined) => {
    reloading = reloading.then(async () => {
      await setHostsContext();
      if (connection && connections.status(connection) !== "connected") {
        ins.forgetConnection(connection.id);
      }
      await runningLabsProvider.refresh().catch((err: unknown) => {
        outputChannel.warn(
          `[connections] Refreshing running labs failed: ${err instanceof Error ? err.message : String(err)}`
        );
      });
      localLabsProvider.forceRefresh();
      if (connection?.kind === "api" && connections.status(connection) === "connected") {
        void utils.refreshDockerImages(connection);
      }
    });
  };
  context.subscriptions.push(
    connections.onDidChange((connection) => {
      reload(connection);
      refreshSettingsPanel();
    }),
    watchRemoteWorkspaces(connections)
  );
}

function registerRealtimeUpdates(context: vscode.ExtensionContext) {
  // Common handler for data changes (used by both events and fallback)
  const handleDataChanged = () => {
    ins.refreshFromEventStream();
    runningLabsProvider.softRefresh().catch((err: unknown) => {
      console.error("[containerlab extension]: realtime refresh failed", err);
    });
  };

  // Register BOTH listeners - isPollingMode() will dynamically check which one applies
  // This handles the case where events fail and we fall back to polling mid-session

  // Events of any connection, and polls of connections without events
  const disposeEventsRealtime = onEventsDataChanged(handleDataChanged);
  context.subscriptions.push({ dispose: disposeEventsRealtime });
  const disposeFallbackRealtime = onFallbackDataChanged(handleDataChanged);
  context.subscriptions.push({ dispose: disposeFallbackRealtime });

  // Register listener for container state changes (only relevant in events mode)
  const disposeStateChange = onContainerStateChanged((containerShortId, newState, connectionId) => {
    if (!isPollingMode(connectionId)) {
      runningLabsProvider.refreshContainer(containerShortId, newState).catch((err: unknown) => {
        outputChannel.debug(
          `Failed to refresh container ${containerShortId}: ${err instanceof Error ? err.message : String(err)}`
        );
      });
    }
  });
  context.subscriptions.push({ dispose: disposeStateChange });

  // Event streams that stop: lab hosts show as not reachable, Local starts again
  const disposeStreamLoss = ins.watchStreamLoss(handleDataChanged);
  context.subscriptions.push({ dispose: disposeStreamLoss });

  // Stop realtime background workers on deactivate
  context.subscriptions.push({
    dispose: () => {
      stopRealtimeBackgroundWorkers();
    }
  });

  ins.refreshFromEventStream();
}

async function setClabBinPath(): Promise<boolean> {
  const configPath = vscode.workspace
    .getConfiguration("containerlab")
    .get<string>("binaryPath", "");

  // if empty fall back to resolving from PATH
  if (!configPath || configPath.trim() === "") {
    const resolvedPath = await findBinary("containerlab");
    if (resolvedPath !== undefined) {
      setContainerlabBinaryPath(resolvedPath);
      outputChannel.info(`Resolved containerlab binary from sys PATH as: ${resolvedPath}`);
    } else {
      outputChannel.warn("Could not resolve the containerlab binary from PATH");
      setContainerlabBinaryPath("containerlab");
    }
    return true;
  }

  if ((await findBinary(configPath)) !== undefined) {
    setContainerlabBinaryPath(configPath);
    outputChannel.info(`Using user configured containerlab binary: ${configPath}`);
    return true;
  }

  outputChannel.error(`Invalid containerlab.binaryPath "${configPath}": not an executable file`);
  vscode.window.showErrorMessage(
    `Configured containerlab binary path "${configPath}" is invalid or not executable.`
  );
  return false;
}

/**
 * Checks containerlab, the user's groups and Docker on this machine, then
 * starts the event stream and the share session lists. Runs after activation
 * so the explorer does not wait for it.
 */
async function startLocalServices(
  context: vscode.ExtensionContext,
  connections: ConnectionManager,
  options: {
    config: vscode.WorkspaceConfiguration;
    e2eSmokeTest: boolean;
    hasLabServers: boolean;
    isSupportedPlatform: boolean;
  }
): Promise<void> {
  const { config, e2eSmokeTest, hasLabServers, isSupportedPlatform } = options;
  const localReady =
    isSupportedPlatform && (await prepareLocalContainerlab(e2eSmokeTest, hasLabServers));
  if (!localReady && !isSupportedPlatform) {
    setUsername(os.userInfo().username);
  }
  // The owner of each lab is known now; "hide non-owned labs" can apply.
  runningLabsProvider.refreshWithoutDiscovery();
  if (!e2eSmokeTest) {
    // The running labs arrive through the event stream; start it right away.
    void ins.update();
  }
  if (isSupportedPlatform && !e2eSmokeTest) {
    // What is missing shows on Local's root; the version on the Lab Hosts page.
    void checkLocalConnection(connections);
  }
  if (!e2eSmokeTest) {
    void checkClusterConnections(connections);
    // Clusters added or changed in the settings are checked again.
    context.subscriptions.push(
      connections.onDidChange((connection) => {
        if (connection === undefined) void checkClusterConnections(connections);
      })
    );
  }
  if (!e2eSmokeTest) {
    // Share links of running labs; the explorer shows them once they are known.
    void Promise.all([refreshSshxSessions(), refreshGottySessions()]).then(() =>
      runningLabsProvider.softRefresh()
    );
  }
  const dockerAvailable =
    localReady && (await connectDockerSocket(e2eSmokeTest, hasLabServers)) === true;
  await runFullStartupTasks(context, config, dockerAvailable, e2eSmokeTest, localReady);
}

/**
 * Called when VSCode activates your extension.
 */
export async function activate(context: vscode.ExtensionContext) {
  // Create and register the output channel
  const channel = vscode.window.createOutputChannel("Containerlab", { log: true });
  setOutputChannel(channel);
  context.subscriptions.push(channel);
  registerSettings(context);
  registerAppearanceUpdates(context);
  const e2eSmokeTest = isE2ESmokeTest();
  outputChannel.info("Registered output channel sucessfully.");
  outputChannel.info(`Detected platform: ${process.platform}`);

  const config = vscode.workspace.getConfiguration("containerlab");
  const isSupportedPlatform = process.platform === "linux" || vscode.env.remoteName === "wsl";

  // clab-api-server lab hosts work from any platform. Labs on this machine and
  // on Kubernetes clusters need containerlab here, which runs on Linux (or WSL) only.
  const connections = initConnections(context, { localSupported: isSupportedPlatform });
  const ignoredClusters = connections.ignoredClusters();
  if (ignoredClusters !== undefined) outputChannel.warn(ignoredClusters);
  context.subscriptions.push(connections, RemoteLabFileSystem.register(connections));
  await connections.restoreAll();
  registerConnectionCommands(context);
  const hasLabServers = connections.list().some((connection) => connection.kind === "api");

  // Without a lab host, activate only on Linux or when connected via WSL.
  // Elsewhere the view offers to add a lab host; the window reloads once there is one.
  if (!isSupportedPlatform && !hasLabServers) {
    registerUnsupportedViews(context);
    context.subscriptions.push(
      connections.onDidChange(() => {
        if (connections.list().some((connection) => connection.kind === "api")) {
          void vscode.commands.executeCommand("workbench.action.reloadWindow");
        }
      })
    );
    return;
  }

  // The explorer and the commands come first. VS Code resolves the explorer
  // view only once activate() returns, so containerlab, the user's groups and
  // Docker are checked in the background below instead of before it.
  setExtensionContext(context);
  setFavoriteLabs(new Set(context.globalState.get<string[]>("favoriteLabs", [])));

  const newLocalProvider = new LocalLabTreeDataProvider();
  const newRunningProvider = new RunningLabTreeDataProvider(context);
  const newHelpProvider = new HelpFeedbackProvider();
  setLocalLabsProvider(newLocalProvider);
  setRunningLabsProvider(newRunningProvider);
  // Find the topology files while the rest starts up.
  newLocalProvider.prefetch();

  // Webview views are resolved lazily, so we keep a hidden tree view badge proxy
  // to show running lab count on the activity icon before the explorer is opened.
  const activityBadgeProxyProvider: vscode.TreeDataProvider<vscode.TreeItem> = {
    getTreeItem: (element: vscode.TreeItem) => element,
    getChildren: async () => []
  };
  const activityBadgeProxyView = vscode.window.createTreeView(
    "containerlabActivityBadgeProxyView",
    {
      treeDataProvider: activityBadgeProxyProvider,
      showCollapseAll: false
    }
  );
  const updateActivityBadgeProxy = async () => {
    try {
      const runningLabCount = await newRunningProvider.getRunningLabCount();
      activityBadgeProxyView.badge =
        runningLabCount > 0
          ? {
              value: runningLabCount,
              tooltip: runningLabCount === 1 ? "1 running lab" : `${runningLabCount} running labs`
            }
          : undefined;
    } catch {
      activityBadgeProxyView.badge = undefined;
    }
  };
  context.subscriptions.push(
    activityBadgeProxyView,
    newRunningProvider.onDidChangeTreeData(() => {
      void updateActivityBadgeProxy();
    })
  );
  if (!e2eSmokeTest) {
    void updateActivityBadgeProxy();
  }

  // Determine if local capture is allowed.
  const isLocalCaptureAllowed = vscode.env.remoteName !== "ssh-remote" && !utils.isOrbstack();
  void vscode.commands.executeCommand(
    "setContext",
    "containerlab:isLocalCaptureAllowed",
    isLocalCaptureAllowed
  );
  void vscode.commands.executeCommand("setContext", "containerlabExplorerVisible", false);

  explorerViewProvider = new ContainerlabExplorerViewProvider(context, {
    runningProvider: newRunningProvider,
    localProvider: newLocalProvider,
    helpProvider: newHelpProvider,
    isLocalCaptureAllowed
  });
  void vscode.commands.executeCommand(
    "setContext",
    "containerlabExplorerFilterActive",
    explorerViewProvider.isFilterActive()
  );
  context.subscriptions.push(
    explorerViewProvider,
    explorerViewProvider.onDidChangeVisibility((visible) => {
      void vscode.commands.executeCommand("setContext", "containerlabExplorerVisible", visible);
    }),
    vscode.window.registerWebviewViewProvider(
      ContainerlabExplorerViewProvider.viewType,
      explorerViewProvider,
      {
        webviewOptions: { retainContextWhenHidden: true }
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("containerlab.labsOverview.open", () =>
      openLabsOverview(context, {
        runningProvider: newRunningProvider,
        localProvider: newLocalProvider
      })
    )
  );

  registerRealtimeUpdates(context);
  registerConnectionUpdates(context, connections);
  registerProcessShutdownHooks(context);

  // Language features (YAML completion)
  registerClabImageCompletion(context);
  registerRenderedTopologyProvider(context);

  // Register commands
  registerCommands(context);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(onDidChangeConfiguration));

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "containerlab.connection.checkLocal",
      async (options?: unknown) => {
        const [ready] = await Promise.all([
          checkLocalConnection(connections),
          checkClusterConnections(connections)
        ]);
        await runningLabsProvider.refresh();
        localLabsProvider.forceRefresh();
        const quiet =
          typeof options === "object" && options !== null && Reflect.get(options, "quiet") === true;
        if (quiet) return;
        if (ready) {
          void vscode.window.showInformationMessage("containerlab is ready on this machine.");
        } else {
          void vscode.window.showWarningMessage(
            `Labs on this machine: ${connections.problem(LOCAL_CONNECTION) ?? "not ready"}`
          );
        }
      }
    )
  );

  const localStartup = startLocalServices(context, connections, {
    config,
    e2eSmokeTest,
    hasLabServers,
    isSupportedPlatform
  }).catch((err: unknown) => {
    outputChannel.error(`Startup failed: ${err instanceof Error ? err.message : String(err)}`);
  });
  // The E2E smoke tests drive the extension right after activation.
  if (e2eSmokeTest) {
    await localStartup;
  }

  // Expose a stable API surface for other extensions to access providers safely.
  return {
    getLocalLabsProvider: () => localLabsProvider,
    getRunningLabsProvider: () => runningLabsProvider,
    getConnections: () => connections
  };
}

export function deactivate() {
  explorerViewProvider = undefined;
  stopRealtimeBackgroundWorkers();
  void disposeLabBackends();
  outputChannel.info("Deactivating Containerlab extension.");
}
