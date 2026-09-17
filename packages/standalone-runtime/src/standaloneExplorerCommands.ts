import type { TopologyRef } from "@containerlab/clab-ui/session";
import { dispatchEndpointUiAction } from "./endpointActions";
import {
  buildPacketflixCapture,
  closeAllWiresharkVncSessions,
  controlNodeLifecycle,
  createFileExplorerDirectory,
  createTopologyFile,
  deleteFileExplorerPath,
  deployLabFromUrl,
  downloadFileExplorerFile,
  downloadLabArchive,
  importTopologyFromUrl,
  fetchNodeBrowserPorts,
  generateDrawioGraph,
  installEdgeShark,
  readFileExplorerFile,
  renameFileExplorerPath,
  runFcliCommand,
  createWiresharkVncSessions,
  uninstallEdgeShark,
  uploadFileExplorerFile,
  writeFileExplorerFile,
  type NetemFields
} from "./runtimeApi";
import {
  confirmRuntimeAction,
  deleteTopologyFileFlow,
  normalizeTopologyFileNameForCreate,
  promptForCloneRepo,
  promptForCreateTopology,
  promptForOptionSelection,
  promptForTextInput,
  saveConfigsFlow,
  type CloneRepoDialogTarget
} from "./runtimeActionFlows";
import { publicAssetUrl } from "./publicAssetUrl";
import { runtimeUiActions } from "./stores/runtimeUiStore";
import {
  getSessionHostnameOverride,
  loadCapturePreferences,
  setSessionHostnameOverride
} from "./runtimeCaptureSettings";
import type { LifecycleCommandEndpoint } from "./standaloneHostShared";
import {
  findLabStateForTopology,
  firstArgAsTopologyRef,
  firstArgAsTreeItem,
  normalizeLabName,
  normalizePathValue,
  safeFilename
} from "./standaloneHostShared";
import { resolveStandaloneTheme } from "./standaloneTheme";
import { toggleStandaloneFavorite } from "./standaloneFavorites";
import {
  type ShareActionKind,
  type ShareLifecycleAction,
  persistShowNonOwnedLabsSetting,
  explorerPreferences,
  findEndpointConfig,
  resolveExplorerActionTopologyRef,
  resolveExplorerActionEndpointId,
  resolveExplorerTargetLabel,
  resolveEndpointForExplorerAction,
  sortedRunningContainers,
  topologyRefForNodeActions,
  sshOpenedNotification,
  runLabShareAction,
  persistShareLink,
  handleShareActionLink,
  deploymentStateFromContext,
  nodeAccessProtocol,
  nodeAccessTitlePrefix,
  fetchPopularRepos,
  pickPopularRepo,
  triggerTextDownload,
  triggerBlobDownload,
  pickTransferFiles,
  promptArchiveFormat,
  resolveArchiveLabFolder,
  extractFirstHttpLink,
  describeBrowserPort,
  fileParentPath,
  joinWorkspacePath,
  type StandaloneExplorerBridgeOptions
} from "./standaloneExplorerActions";

interface ExplorerCommandContext {
  options: StandaloneExplorerBridgeOptions;
  postExplorerError: (message: string) => void;
  clearFileExplorerCache: (endpointId?: string) => void;
  scheduleSnapshot: (delay?: number) => void;
  sshxLinksByLab: Map<string, string>;
  gottyLinksByLab: Map<string, string>;
}

export function createExplorerCommandHandler(context: ExplorerCommandContext) {
  const {
    options,
    postExplorerError,
    clearFileExplorerCache,
    scheduleSnapshot,
    sshxLinksByLab,
    gottyLinksByLab
  } = context;
  const lifecycleActionsAvailable = options.lifecycleActionsAvailable !== false;
  const unhandledCommands = new Set<string>();
  return async function executeExplorerCommand(commandId: string, args: unknown[]): Promise<void> {
    const requestedTopologyRef = firstArgAsTopologyRef(args);
    const item = firstArgAsTreeItem(args);
    const actionTopologyRef = requestedTopologyRef ?? (await options.resolveTopologyRef(args));
    const actionEndpointId = resolveExplorerActionEndpointId(item, actionTopologyRef);
    const endpoints = options.getEndpoints();
    const resolveEndpointForAction = async (
      actionDescription: string,
      preferredEndpointId?: string
    ): Promise<string | null> =>
      resolveEndpointForExplorerAction({
        actionDescription,
        endpoints,
        postError: postExplorerError,
        preferredEndpointId
      });
    const targetLabel = resolveExplorerTargetLabel(item, actionTopologyRef);
    const refreshWorkspaceAfterMutation = (endpointId?: string): void => {
      options.invalidateTopologyFileListCache(endpointId);
      clearFileExplorerCache(endpointId);
      scheduleSnapshot(0);
    };
    const resolveActionTopologyRef = (): TopologyRef | undefined =>
      resolveExplorerActionTopologyRef({
        actionEndpointId,
        actionTopologyRef,
        item,
        labs: options.getLabs(),
        targetLabel
      });
    const resolveCaptureTargets = (): Array<{
      containerName: string;
      interfaceName: string;
    }> => {
      const byKey = new Map<string, { containerName: string; interfaceName: string }>();

      const pushCandidate = (candidate: unknown): void => {
        if (!candidate || typeof candidate !== "object") {
          return;
        }
        const containerName =
          typeof (candidate as { containerName?: unknown }).containerName === "string"
            ? (candidate as { containerName: string }).containerName.trim()
            : "";
        const interfaceName =
          typeof (candidate as { name?: unknown }).name === "string"
            ? (candidate as { name: string }).name.trim()
            : "";
        if (!containerName || !interfaceName) {
          return;
        }
        byKey.set(`${containerName}::${interfaceName}`, {
          containerName,
          interfaceName
        });
      };

      for (const candidate of args) {
        if (Array.isArray(candidate)) {
          for (const nested of candidate) {
            pushCandidate(nested);
          }
          continue;
        }
        pushCandidate(candidate);
      }

      if (byKey.size === 0 && item) {
        pushCandidate(item);
      }

      return [...byKey.values()];
    };

    const runPacketflixCapture = async (): Promise<void> => {
      if (!actionTopologyRef) {
        postExplorerError("No canonical topology reference is available for this item.");
        return;
      }
      const targets = resolveCaptureTargets();
      if (targets.length === 0) {
        postExplorerError("Capture requires a running interface item.");
        return;
      }

      try {
        const captureResponse = await buildPacketflixCapture({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          targets,
          remoteHostname: getSessionHostnameOverride(actionEndpointId)
        });

        const captures = captureResponse.captures ?? [];
        if (captures.length === 0) {
          runtimeUiActions.notify("No packet capture targets were returned.", "warning");
          return;
        }

        for (const capture of captures) {
          const link = capture.packetflixUri?.trim();
          if (!link) {
            continue;
          }
          window.open(link, "_blank", "noopener,noreferrer");
        }

        runtimeUiActions.notify(
          captures.length > 1
            ? `Started ${captures.length} Edgeshark capture targets.`
            : `Started Edgeshark capture for ${captures[0]?.containerName ?? "interface"}.`,
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const runWiresharkVncCapture = async (): Promise<void> => {
      if (!actionTopologyRef) {
        postExplorerError("No canonical topology reference is available for this item.");
        return;
      }
      const targets = resolveCaptureTargets();
      if (targets.length === 0) {
        postExplorerError("Capture requires a running interface item.");
        return;
      }

      try {
        const theme = resolveStandaloneTheme();

        const sessionsResponse = await createWiresharkVncSessions({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          targets,
          theme
        });

        const sessions = sessionsResponse.sessions ?? [];
        if (sessions.length === 0) {
          runtimeUiActions.notify("No Wireshark sessions were created.", "warning");
          return;
        }

        for (const session of sessions) {
          const params = new URLSearchParams({
            sessionId: session.sessionId,
            theme
          });
          if (actionEndpointId) {
            params.set("endpointId", actionEndpointId);
          }
          if (session.showVolumeTip) {
            params.set("showVolumeTip", "1");
          }
          const capturePageUrl = `${publicAssetUrl("wireshark.html")}?${params.toString()}`;
          window.open(capturePageUrl, "_blank", "noopener,noreferrer");
        }

        runtimeUiActions.notify(
          sessions.length > 1
            ? `Opened ${sessions.length} Wireshark VNC sessions.`
            : "Opened Wireshark VNC session.",
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const runPreferredCapture = async (): Promise<void> => {
      const preferredAction = loadCapturePreferences(actionEndpointId).preferredAction;
      if (preferredAction === "edgeshark") {
        await runPacketflixCapture();
        return;
      }
      await runWiresharkVncCapture();
    };

    const cloneFromUrlFlow = async (
      endpointId: string,
      sourceUrl: string,
      cloneOptions?: {
        labNameOverride?: string;
        skipLabNamePrompt?: boolean;
        target?: CloneRepoDialogTarget;
      }
    ): Promise<void> => {
      const topologySourceUrl = sourceUrl.trim();
      if (!topologySourceUrl) {
        runtimeUiActions.notify("A repository or topology URL is required.", "error");
        return;
      }
      const target = cloneOptions?.target ?? "deploy";

      let labNameOverride: string | undefined;
      if (cloneOptions?.skipLabNamePrompt) {
        labNameOverride = cloneOptions.labNameOverride?.trim() || undefined;
      } else {
        const rawLabNameOverride = await promptForTextInput({
          title: "Lab Name Override",
          message: "Leave empty to use the default lab name.",
          label: "Lab name override",
          confirmLabel: "Continue",
          allowEmpty: true
        });
        if (rawLabNameOverride === undefined) {
          return;
        }
        labNameOverride = rawLabNameOverride.trim() || undefined;
      }

      try {
        if (target === "undeployed") {
          const response = await importTopologyFromUrl({
            endpointId,
            topologySourceUrl,
            labNameOverride
          });
          refreshWorkspaceAfterMutation(endpointId);
          runtimeUiActions.notify(`Cloned ${response.labName} to undeployed labs.`, "success");
          await options.loadTopologyFile(response.topologyRef, {
            deploymentState: "undeployed",
            endpointId
          });
          return;
        }

        const response = await deployLabFromUrl({
          endpointId,
          topologySourceUrl,
          labNameOverride
        });
        refreshWorkspaceAfterMutation(endpointId);
        const labNames = response.labNames ?? [];
        runtimeUiActions.notify(
          labNames.length > 0
            ? `Deployed ${labNames.join(", ")} from source URL.`
            : "Deployment from source URL finished successfully.",
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const openSshToAllNodes = (): void => {
      const lab = findLabStateForTopology(
        {
          yamlPath: actionTopologyRef?.yamlPath ?? "",
          topologyId: actionTopologyRef?.topologyId,
          labName: actionTopologyRef?.labName ?? item?.labName,
          endpointId: actionEndpointId
        },
        options.getLabs()
      );
      if (!lab) {
        postExplorerError("No running lab context is available for this action.");
        return;
      }

      const topologyRef = topologyRefForNodeActions(lab, actionTopologyRef);
      const containers = sortedRunningContainers(lab);
      if (containers.length === 0) {
        runtimeUiActions.notify(`No containers were found in lab "${lab.name}".`, "warning");
        return;
      }

      for (const container of containers) {
        const nodeName = container.nodeName || container.name;
        runtimeUiActions.openTerminal({
          endpointId: lab.endpointId,
          topologyRef,
          nodeName,
          protocol: "ssh",
          title: `SSH: ${nodeName}`
        });
      }
      runtimeUiActions.notify(sshOpenedNotification(containers), "success");
    };

    const shareLabKey = actionTopologyRef?.labName ?? item?.labName ?? "";
    const resolveShareLabKey = (): string => {
      const topologyRef = resolveActionTopologyRef();
      return topologyRef?.labName ?? shareLabKey;
    };

    const openCommandOutputTerminal = (
      title: string,
      commandLabel: string,
      output: string,
      topologyRef?: TopologyRef
    ): void => {
      const content = output.trim();
      runtimeUiActions.openTerminal({
        endpointId: actionEndpointId,
        sessionId: `cmd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        topologyRef,
        nodeName: commandLabel,
        protocol: "output",
        title,
        initialOutput: content || "(no output)"
      });
    };

    const resolveBrowserHost = (rawHost?: string): string => {
      const trimmed = (rawHost ?? "").trim().replace(/^\[|\]$/g, "");
      const lowered = trimmed.toLowerCase();
      if (
        trimmed &&
        lowered !== "localhost" &&
        lowered !== "127.0.0.1" &&
        lowered !== "::1" &&
        lowered !== "0.0.0.0" &&
        lowered !== "::"
      ) {
        return trimmed;
      }

      const endpoint = findEndpointConfig(endpoints, actionEndpointId);
      if (endpoint) {
        try {
          return new URL(endpoint.url).hostname;
        } catch {
          // Ignore malformed endpoint URLs.
        }
      }

      return trimmed || "localhost";
    };

    const runNodeLifecycle = async (
      action: "start" | "stop" | "restart" | "pause" | "unpause",
      successLabel: string
    ): Promise<void> => {
      if (!actionTopologyRef || !item?.name) {
        postExplorerError("Node action requires a running lab item.");
        return;
      }

      try {
        await controlNodeLifecycle({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          action
        });
        runtimeUiActions.notify(successLabel, "success");
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const openNodeBrowser = async (): Promise<void> => {
      if (!actionTopologyRef || !item?.name) {
        postExplorerError("Open Browser requires a running node item.");
        return;
      }

      try {
        const payload = await fetchNodeBrowserPorts({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name
        });
        const ports = payload.ports ?? [];
        if (ports.length === 0) {
          runtimeUiActions.notify(`No exposed ports were found for ${item.name}.`, "warning");
          return;
        }

        const candidates = ports.map((port) => {
          const host = resolveBrowserHost(port.hostIp);
          const hostForUrl = host.includes(":") ? `[${host}]` : host;
          const description = port.description || describeBrowserPort(port.containerPort);
          return {
            ...port,
            description,
            url: `http://${hostForUrl}:${port.hostPort}`
          };
        });

        if (candidates.length === 1) {
          window.open(candidates[0].url, "_blank", "noopener,noreferrer");
          runtimeUiActions.notify(`Opened ${candidates[0].url}.`, "success");
          return;
        }

        const selectedUrl = await promptForOptionSelection({
          title: "Open Browser Port",
          message: "Select a port to open in the browser.",
          label: "Port",
          confirmLabel: "Open",
          options: candidates.map((candidate) => ({
            label: `${candidate.hostPort}:${candidate.containerPort}/${candidate.protocol || "tcp"}`,
            description: candidate.description,
            value: candidate.url
          })),
          preferredValue: candidates[0]?.url
        });
        if (!selectedUrl) {
          return;
        }

        const target = candidates.find((candidate) => candidate.url === selectedUrl);
        if (!target) {
          runtimeUiActions.notify("Invalid port selection.", "error");
          return;
        }
        window.open(target.url, "_blank", "noopener,noreferrer");
        runtimeUiActions.notify(`Opened ${target.url}.`, "success");
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const runShareAction = async (
      kind: ShareActionKind,
      action: ShareLifecycleAction
    ): Promise<void> => {
      const topologyRef = resolveActionTopologyRef();
      if (!topologyRef) {
        postExplorerError("Sharing actions require a running lab item.");
        return;
      }

      try {
        runtimeUiActions.notify(
          `${kind.toUpperCase()} ${action} started. This may take a moment...`,
          "info"
        );

        const payload = await runLabShareAction({
          action,
          endpointId: actionEndpointId,
          kind,
          topologyRef
        });
        const link = payload.link?.trim() || extractFirstHttpLink(payload.output ?? "") || "";
        const labKey = normalizeLabName(topologyRef.labName || resolveShareLabKey());
        const bucket = kind === "sshx" ? sshxLinksByLab : gottyLinksByLab;
        persistShareLink({ action, bucket, labKey, link });
        scheduleSnapshot(0);

        await handleShareActionLink(kind, action, link);
        runtimeUiActions.notify(
          payload.message || `${kind.toUpperCase()} ${action} completed.`,
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const copyShareLink = async (kind: "sshx" | "gotty"): Promise<void> => {
      const argLink = typeof args[0] === "string" ? args[0].trim() : "";
      const bucket = kind === "sshx" ? sshxLinksByLab : gottyLinksByLab;
      const storedLabKey = normalizeLabName(resolveShareLabKey());
      const storedLink = storedLabKey ? (bucket.get(storedLabKey) ?? "") : "";
      const link = argLink || storedLink;
      if (!link) {
        runtimeUiActions.notify(
          `No ${kind.toUpperCase()} link is currently available for this lab.`,
          "warning"
        );
        return;
      }

      await navigator.clipboard.writeText(link).catch(() => {});
      runtimeUiActions.notify(`${kind.toUpperCase()} link copied to clipboard.`, "success");
    };

    const runFcli = async (command: string): Promise<void> => {
      const topologyRef = resolveActionTopologyRef();
      if (!topologyRef) {
        postExplorerError("fcli actions require a running lab item.");
        return;
      }

      try {
        runtimeUiActions.notify(
          `Running fcli "${command}"... image pull may take a while.`,
          "info"
        );
        const response = await runFcliCommand({
          endpointId: actionEndpointId,
          topologyRef,
          command
        });
        const content = response.output?.trim() || "(no output)";
        openCommandOutputTerminal(`fcli: ${command}`, `fcli ${command}`, content, topologyRef);
        if (/\bNo data\.\.\./i.test(content)) {
          runtimeUiActions.notify(
            `fcli "${command}" returned no data. Check lab state/filter and try a different command (for example sys-info).`,
            "warning"
          );
        } else {
          runtimeUiActions.notify(
            `fcli "${command}" finished. Output opened in terminal.`,
            "success"
          );
        }
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const runDrawio = async (layout: "horizontal" | "vertical" | "interactive"): Promise<void> => {
      const topologyRef = resolveActionTopologyRef();
      if (!topologyRef) {
        postExplorerError("Graph actions require a lab item.");
        return;
      }

      try {
        runtimeUiActions.notify(`Generating draw.io (${layout})...`, "info");
        const response = await generateDrawioGraph({
          endpointId: actionEndpointId,
          topologyRef,
          layout
        });

        triggerTextDownload(
          safeFilename(response.fileName || `${topologyRef.labName}.drawio`),
          response.content,
          "application/xml"
        );

        if (layout === "interactive") {
          const output = [response.output?.trim(), response.message?.trim()]
            .filter((value): value is string => Boolean(value && value.length > 0))
            .join("\n\n");
          openCommandOutputTerminal(
            `draw.io interactive: ${topologyRef.labName}`,
            "graph drawio -I",
            output || "Interactive draw.io output is unavailable.",
            topologyRef
          );
        }

        runtimeUiActions.notify(
          response.message || `Generated draw.io (${layout}) for ${topologyRef.labName}.`,
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const requireTopologyRef = (
      message = "No canonical topology reference is available for this item."
    ): TopologyRef | undefined => {
      if (!actionTopologyRef) {
        postExplorerError(message);
        return undefined;
      }
      return actionTopologyRef;
    };

    const runEndpointEdgeSharkAction = async (action: "install" | "uninstall"): Promise<void> => {
      const endpointId = await resolveEndpointForAction(`${action} EdgeShark`, actionEndpointId);
      if (!endpointId) {
        return;
      }
      if (
        action === "uninstall" &&
        !(await confirmRuntimeAction({
          title: "Uninstall EdgeShark",
          message: "Uninstall EdgeShark on this endpoint?",
          confirmLabel: "Uninstall",
          severity: "warning"
        }))
      ) {
        return;
      }
      try {
        await (action === "install"
          ? installEdgeShark(endpointId)
          : uninstallEdgeShark(endpointId));
        runtimeUiActions.notify(
          `${action === "install" ? "Installed" : "Uninstalled"} EdgeShark.`,
          "success"
        );
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const openTopologyFile = async (): Promise<void> => {
      const topologyRef = requireTopologyRef(
        targetLabel
          ? `No canonical topology reference is available for running lab "${targetLabel}".`
          : "No canonical topology reference is available for this item."
      );
      if (!topologyRef) {
        return;
      }
      const itemState = deploymentStateFromContext(item?.contextValue);
      const resolvedState = await options.resolveDeploymentState(topologyRef);
      await options.loadTopologyFile(topologyRef, {
        deploymentState: resolvedState ?? itemState,
        endpointId: actionEndpointId
      });
    };

    const createTopologyFileFlow = async (): Promise<void> => {
      const connectedEndpoints = endpoints.filter((endpoint) => endpoint.status === "connected");
      if (connectedEndpoints.length === 0) {
        postExplorerError("Connect an endpoint before trying to create a topology file.");
        return;
      }
      const preferredEndpoint = findEndpointConfig(endpoints, actionEndpointId);
      const createTopologyInput = await promptForCreateTopology({
        title: "Create Topology File",
        message: "Choose endpoint and file name for the new topology file.",
        confirmLabel: "Create",
        endpointOptions: connectedEndpoints.map((endpoint) => ({
          value: endpoint.id,
          label: endpoint.label,
          description: endpoint.url
        })),
        defaultEndpointId:
          preferredEndpoint?.status === "connected"
            ? preferredEndpoint.id
            : connectedEndpoints[0]?.id,
        defaultFileName: "new-lab.clab.yml"
      });
      if (!createTopologyInput) {
        return;
      }
      const fileName = normalizeTopologyFileNameForCreate(createTopologyInput.fileName);
      try {
        const created = await createTopologyFile({
          endpointId: createTopologyInput.endpointId,
          fileName
        });
        refreshWorkspaceAfterMutation(createTopologyInput.endpointId);
        runtimeUiActions.notify(`Created topology file "${fileName}".`, "success");
        await options.loadTopologyFile(created.topologyRef, {
          deploymentState: "undeployed",
          endpointId: createTopologyInput.endpointId
        });
      } catch (error) {
        runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
      }
    };

    const cloneRepositoryFlow = async (): Promise<void> => {
      const connectedEndpoints = endpoints.filter((endpoint) => endpoint.status === "connected");
      if (connectedEndpoints.length === 0) {
        postExplorerError("Connect an endpoint before trying to clone a repository.");
        return;
      }
      const preferredEndpoint = findEndpointConfig(endpoints, actionEndpointId);
      const popularRepos = (await fetchPopularRepos()).slice(0, 12);
      const cloneRepoInput = await promptForCloneRepo({
        title: "Clone Repository",
        message: "Choose endpoint, source, and target action.",
        confirmLabel: "Continue",
        endpointOptions: connectedEndpoints.map((endpoint) => ({
          value: endpoint.id,
          label: endpoint.label,
          description: endpoint.url
        })),
        popularOptions: popularRepos.map((repo) => ({
          value: repo.htmlUrl,
          label: `${repo.name} (⭐ ${repo.stars})`,
          description: repo.description
        })),
        defaultEndpointId:
          preferredEndpoint?.status === "connected"
            ? preferredEndpoint.id
            : connectedEndpoints[0]?.id,
        defaultMode: "url",
        defaultSourceUrl: "https://github.com/srl-labs/srl-telemetry-lab",
        defaultTarget: lifecycleActionsAvailable ? "deploy" : "undeployed"
      });
      if (cloneRepoInput) {
        await cloneFromUrlFlow(cloneRepoInput.endpointId, cloneRepoInput.sourceUrl, {
          labNameOverride: cloneRepoInput.labNameOverride,
          skipLabNamePrompt: true,
          target: cloneRepoInput.target
        });
      }
    };

    const clonePopularFlow = async (target: CloneRepoDialogTarget): Promise<void> => {
      const endpointId = await resolveEndpointForAction(
        target === "undeployed" ? "clone a popular lab" : "deploy a popular lab",
        actionEndpointId
      );
      const sourceUrl = endpointId
        ? await pickPopularRepo(
            target === "undeployed" ? "Clone popular lab" : "Deploy popular lab"
          )
        : undefined;
      if (endpointId && sourceUrl) {
        await cloneFromUrlFlow(endpointId, sourceUrl, { target });
      }
    };

    const runLabLifecycle = async (
      endpoint: LifecycleCommandEndpoint,
      cleanup = false
    ): Promise<void> => {
      if (!lifecycleActionsAvailable) {
        runtimeUiActions.notify(
          "Deploy and lifecycle actions are not available in GitHub Pages mode.",
          "warning"
        );
        return;
      }
      const topologyRef = requireTopologyRef();
      if (!topologyRef) {
        return;
      }
      try {
        await options.runLifecycle(endpoint, topologyRef, cleanup);
      } catch (error) {
        console.error(`[Standalone] ${endpoint} failed:`, error);
      }
    };

    const deleteTopologyFlow = async (): Promise<void> => {
      const topologyRef = requireTopologyRef();
      if (!topologyRef) {
        return;
      }
      const deleted = await deleteTopologyFileFlow({
        endpointId: actionEndpointId,
        topologyRef
      });
      if (deleted) {
        refreshWorkspaceAfterMutation(actionEndpointId);
      }
    };

    const toggleFavoriteFlow = (): void => {
      const topologyRef = requireTopologyRef();
      if (!topologyRef) {
        return;
      }
      const nextFavorite = toggleStandaloneFavorite({
        endpointId: actionEndpointId,
        topologyRef
      });
      scheduleSnapshot(0);
      runtimeUiActions.notify(
        nextFavorite ? "Added lab to favorites." : "Removed lab from favorites.",
        "success"
      );
    };

    const openNodeAccessTerminal = (): void => {
      if (!actionTopologyRef || !item?.name) {
        postExplorerError("Node access requires a running lab item.");
        return;
      }
      const protocol = nodeAccessProtocol(commandId);
      runtimeUiActions.openTerminal({
        endpointId: actionEndpointId,
        topologyRef: actionTopologyRef,
        nodeName: item.name,
        protocol,
        title: `${nodeAccessTitlePrefix(protocol)}: ${item.label || item.name}`
      });
    };

    const openInterfaceImpairments = (): void => {
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
        endpointId: actionEndpointId,
        topologyRef: actionTopologyRef,
        nodeName: item.containerName,
        preferredField: fieldByCommand[commandId],
        preferredInterfaceName: item.label || item.name,
        title: `Impairments: ${item.containerName}`
      });
    };

    const setSessionHostnameFlow = async (): Promise<void> => {
      const actionEndpointLabel =
        findEndpointConfig(endpoints, actionEndpointId)?.label ?? actionEndpointId ?? "default";
      const currentHostname = getSessionHostnameOverride(actionEndpointId) ?? "";
      const rawValue = await promptForTextInput({
        title: "Session Hostname Override",
        message: `Set the session hostname override for packet capture on "${actionEndpointLabel}". Leave empty to clear it.`,
        label: "Hostname override",
        defaultValue: currentHostname,
        confirmLabel: "Save",
        allowEmpty: true
      });
      if (rawValue === undefined) {
        return;
      }
      const nextValue = setSessionHostnameOverride(rawValue, actionEndpointId);
      runtimeUiActions.notify(
        nextValue
          ? `Session hostname override for "${actionEndpointLabel}" set to "${nextValue}".`
          : `Session hostname override for "${actionEndpointLabel}" cleared.`,
        "success"
      );
    };

    const copyText = async (value: string | undefined): Promise<void> => {
      if (value) {
        await navigator.clipboard.writeText(value).catch(() => {});
      }
    };

    const requireFileEndpointId = (): string | undefined => {
      const endpointId = item?.endpointId ?? actionEndpointId;
      if (!endpointId) {
        postExplorerError("No endpoint is associated with this file item.");
        return undefined;
      }
      return endpointId;
    };

    const requireFilePath = (): string | undefined => {
      const pathValue = item?.resourcePath;
      if (typeof pathValue !== "string" || pathValue.trim().length === 0) {
        postExplorerError("No file path is associated with this item.");
        return undefined;
      }
      return pathValue;
    };

    const selectedDirectoryPath = (): string => {
      if (item?.resourceKind === "directory") {
        return item.resourcePath ?? "";
      }
      return fileParentPath(item?.resourcePath ?? "");
    };

    const promptWorkspacePath = async (
      title: string,
      defaultPath: string
    ): Promise<string | undefined> => {
      const rawValue = await promptForTextInput({
        title,
        message: "Enter a path under the lab workspace.",
        label: "Path",
        defaultValue: defaultPath,
        confirmLabel: title.startsWith("Rename") ? "Rename" : "Create"
      });
      if (rawValue === undefined) {
        return undefined;
      }
      const normalized = normalizePathValue(rawValue);
      return normalized.length > 0 ? normalized : undefined;
    };

    const openFileEditor = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      const pathValue = requireFilePath();
      if (!endpointId || !pathValue) {
        return;
      }
      const document = await readFileExplorerFile(endpointId, pathValue);
      await options.openFileEditor({
        ...document,
        title: safeFilename(pathValue)
      });
    };

    const createWorkspaceFile = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      if (!endpointId) {
        return;
      }
      const parentPath = selectedDirectoryPath();
      const pathValue = await promptWorkspacePath(
        "New file path",
        joinWorkspacePath(parentPath, "untitled.txt")
      );
      if (!pathValue) {
        return;
      }
      await writeFileExplorerFile({ endpointId, path: pathValue, content: "" });
      refreshWorkspaceAfterMutation(endpointId);
      await options.openFileEditor({
        endpointId,
        path: pathValue,
        content: "",
        title: safeFilename(pathValue)
      });
      runtimeUiActions.notify(`Created ${pathValue}`, "success");
      scheduleSnapshot(0);
    };

    const createWorkspaceFolder = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      if (!endpointId) {
        return;
      }
      const parentPath = selectedDirectoryPath();
      const pathValue = await promptWorkspacePath(
        "New folder path",
        joinWorkspacePath(parentPath, "new-folder")
      );
      if (!pathValue) {
        return;
      }
      await createFileExplorerDirectory(endpointId, pathValue);
      refreshWorkspaceAfterMutation(endpointId);
      runtimeUiActions.notify(`Created ${pathValue}`, "success");
    };

    const renameWorkspaceItem = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      const oldPath = requireFilePath();
      if (!endpointId || !oldPath) {
        return;
      }
      const newPath = await promptWorkspacePath("Rename path", oldPath);
      if (!newPath || newPath === oldPath) {
        return;
      }
      await renameFileExplorerPath({ endpointId, oldPath, newPath });
      refreshWorkspaceAfterMutation(endpointId);
      runtimeUiActions.notify(`Renamed ${oldPath} to ${newPath}`, "success");
    };

    const deleteWorkspaceItem = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      const pathValue = requireFilePath();
      if (!endpointId || !pathValue) {
        return;
      }
      const isDirectory = item?.resourceKind === "directory";
      const kind = isDirectory ? "folder" : "file";
      const suffix = isDirectory ? " and everything inside it" : "";
      const confirmed = await confirmRuntimeAction({
        title: `Delete ${kind}`,
        message: `Delete ${kind} "Lab workspace/${pathValue}"${suffix}?`,
        confirmLabel: "Delete",
        severity: "error"
      });
      if (!confirmed) {
        return;
      }
      await deleteFileExplorerPath(endpointId, pathValue, {
        recursive: isDirectory
      });
      refreshWorkspaceAfterMutation(endpointId);
      runtimeUiActions.notify(`Deleted ${pathValue}`, "success");
    };

    const copyWorkspacePath = async (): Promise<void> => {
      const pathValue = requireFilePath();
      if (!pathValue) {
        return;
      }
      await copyText(pathValue);
      runtimeUiActions.notify(`Copied path for ${pathValue}.`, "success");
    };

    const downloadWorkspaceFile = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      const pathValue = requireFilePath();
      if (!endpointId || !pathValue) {
        return;
      }
      const download = await downloadFileExplorerFile(endpointId, pathValue);
      triggerBlobDownload(download.filename, download.blob);
      runtimeUiActions.notify(`Downloaded ${pathValue}.`, "success");
    };

    const uploadWorkspaceFile = async (): Promise<void> => {
      const endpointId = requireFileEndpointId();
      if (!endpointId) {
        return;
      }
      const files = await pickTransferFiles("", item?.resourceKind !== "file");
      if (files.length === 0) {
        return;
      }
      if (item?.resourceKind === "file") {
        const file = files[0];
        const targetPath = item.resourcePath ?? "";
        if (!targetPath) {
          postExplorerError("No upload target path is available.");
          return;
        }
        const confirmed = await confirmRuntimeAction({
          title: "Replace File",
          message: `Replace "Lab workspace/${targetPath}" with "${file.name}"?`,
          confirmLabel: "Replace",
          severity: "warning"
        });
        if (!confirmed) {
          return;
        }
        await uploadFileExplorerFile({
          endpointId,
          file,
          path: targetPath,
          targetKind: "file"
        });
        refreshWorkspaceAfterMutation(endpointId);
        runtimeUiActions.notify(`Uploaded ${targetPath}.`, "success");
        return;
      }

      const directoryPath = selectedDirectoryPath();
      await uploadFileExplorerFile({
        endpointId,
        files,
        path: directoryPath,
        targetKind: "directory"
      });
      refreshWorkspaceAfterMutation(endpointId);
      runtimeUiActions.notify(
        `Uploaded ${files.length} file${files.length === 1 ? "" : "s"} to lab workspace${directoryPath ? `/${directoryPath}` : ""}.`,
        "success"
      );
    };

    const downloadLabArchiveFlow = async (): Promise<void> => {
      const endpointId = await resolveEndpointForAction("download a lab archive", actionEndpointId);
      if (!endpointId) {
        return;
      }
      const labFolder = resolveArchiveLabFolder({
        item,
        topologyRef: resolveActionTopologyRef(),
        targetLabel
      });
      if (!labFolder) {
        postExplorerError("Select a lab folder before downloading an archive.");
        return;
      }
      const format = await promptArchiveFormat();
      if (!format) {
        return;
      }
      const download = await downloadLabArchive({
        endpointId,
        format,
        path: labFolder
      });
      triggerBlobDownload(download.filename, download.blob);
      runtimeUiActions.notify(`Downloaded archive for ${labFolder}.`, "success");
    };

    const commandHandlers: Record<string, () => Promise<void> | void> = {
      "containerlab.openLink": () => {
        const link = typeof args[0] === "string" ? args[0] : undefined;
        if (link) {
          window.open(link, "_blank", "noopener,noreferrer");
        }
      },
      "containerlab.endpoint.add": () => dispatchEndpointUiAction({ action: "add" }),
      "containerlab.endpoint.reconnect": () =>
        actionEndpointId
          ? dispatchEndpointUiAction({
              action: "reconnect",
              endpointId: actionEndpointId
            })
          : postExplorerError("No endpoint is associated with this item."),
      "containerlab.endpoint.remove": () =>
        actionEndpointId
          ? dispatchEndpointUiAction({
              action: "remove",
              endpointId: actionEndpointId
            })
          : postExplorerError("No endpoint is associated with this item."),
      "containerlab.endpoint.copyUrl": async () => {
        const endpoint = findEndpointConfig(endpoints, actionEndpointId);
        if (!actionEndpointId || !endpoint) {
          postExplorerError(
            actionEndpointId
              ? "Endpoint metadata is not available."
              : "No endpoint is associated with this item."
          );
          return;
        }
        await navigator.clipboard.writeText(endpoint.url).catch(() => {});
        runtimeUiActions.notify(`Copied endpoint URL for ${endpoint.label}.`, "success");
      },
      "containerlab.file.open": openFileEditor,
      "containerlab.file.openTopology": openFileEditor,
      "containerlab.file.newFile": createWorkspaceFile,
      "containerlab.file.newFolder": createWorkspaceFolder,
      "containerlab.file.rename": renameWorkspaceItem,
      "containerlab.file.delete": deleteWorkspaceItem,
      "containerlab.file.copyPath": copyWorkspacePath,
      "containerlab.file.download": downloadWorkspaceFile,
      "containerlab.file.upload": uploadWorkspaceFile,
      "containerlab.file.downloadArchive": downloadLabArchiveFlow,
      "containerlab.file.refresh": () => {
        refreshWorkspaceAfterMutation(actionEndpointId);
      },
      "containerlab.install.edgeshark": () => runEndpointEdgeSharkAction("install"),
      "containerlab.uninstall.edgeshark": () => runEndpointEdgeSharkAction("uninstall"),
      "containerlab.lab.graph.topoViewer": openTopologyFile,
      "containerlab.lab.openFile": openTopologyFile,
      "containerlab.editor.topoViewerEditor.open": openTopologyFile,
      "containerlab.lab.graph.drawio.horizontal": () => runDrawio("horizontal"),
      "containerlab.lab.graph.drawio.vertical": () => runDrawio("vertical"),
      "containerlab.lab.graph.drawio.interactive": () => runDrawio("interactive"),
      "containerlab.editor.topoViewerEditor": createTopologyFileFlow,
      "containerlab.lab.cloneRepo": cloneRepositoryFlow,
      "containerlab.lab.clonePopularRepo": () => clonePopularFlow("undeployed"),
      "containerlab.lab.deployPopular": () =>
        lifecycleActionsAvailable
          ? clonePopularFlow("deploy")
          : runtimeUiActions.notify("Deploy is not available in GitHub Pages mode.", "warning"),
      "containerlab.images.manage": runtimeUiActions.openImageManager,
      "containerlab.inspectAll": runtimeUiActions.openInspectAll,
      "containerlab.inspectOneLab": () => {
        const topologyRef = requireTopologyRef();
        if (topologyRef) {
          runtimeUiActions.openInspectLab(
            { endpointId: actionEndpointId, topologyRef },
            `Inspect: ${targetLabel ?? topologyRef.labName}`
          );
        }
      },
      "containerlab.lab.deploy": () => runLabLifecycle("deploy", false),
      "containerlab.lab.deploy.specificFile": () => runLabLifecycle("deploy", false),
      "containerlab.lab.deploy.cleanup": async () => {
        const confirmed = await confirmRuntimeAction({
          title: "Deploy With Cleanup",
          message:
            "Deploy (cleanup) may remove existing lab artifacts before deployment. Continue?",
          confirmLabel: "Deploy",
          severity: "warning"
        });
        if (confirmed) {
          await runLabLifecycle("deploy", true);
        }
      },
      "containerlab.lab.destroy": () => runLabLifecycle("destroy", false),
      "containerlab.lab.destroy.cleanup": () => runLabLifecycle("destroy", true),
      "containerlab.lab.redeploy": () => runLabLifecycle("redeploy", false),
      "containerlab.lab.redeploy.cleanup": () => runLabLifecycle("redeploy", true),
      "containerlab.lab.apply": () => runLabLifecycle("apply", false),
      "containerlab.lab.start": () => runLabLifecycle("start"),
      "containerlab.lab.stop": () => runLabLifecycle("stop"),
      "containerlab.lab.restart": () => runLabLifecycle("restart"),
      "containerlab.lab.save": async () => {
        const topologyRef = requireTopologyRef();
        if (topologyRef) {
          await saveConfigsFlow(
            { endpointId: actionEndpointId, topologyRef },
            `Saved configs for ${topologyRef.labName}.`
          );
        }
      },
      "containerlab.lab.delete": deleteTopologyFlow,
      "containerlab.lab.downloadArchive": downloadLabArchiveFlow,
      "containerlab.lab.toggleFavorite": toggleFavoriteFlow,
      "containerlab.lab.sshToAllNodes": openSshToAllNodes,
      "containerlab.lab.sshx.attach": () => runShareAction("sshx", "attach"),
      "containerlab.lab.sshx.detach": () => runShareAction("sshx", "detach"),
      "containerlab.lab.sshx.reattach": () => runShareAction("sshx", "reattach"),
      "containerlab.lab.gotty.attach": () => runShareAction("gotty", "attach"),
      "containerlab.lab.gotty.detach": () => runShareAction("gotty", "detach"),
      "containerlab.lab.gotty.reattach": () => runShareAction("gotty", "reattach"),
      "containerlab.lab.sshx.copyLink": () => copyShareLink("sshx"),
      "containerlab.lab.sshx.copylink": () => copyShareLink("sshx"),
      "containerlab.lab.gotty.copyLink": () => copyShareLink("gotty"),
      "containerlab.lab.gotty.copylink": () => copyShareLink("gotty"),
      "containerlab.lab.fcli.bgpPeers": () => runFcli("bgp-peers"),
      "containerlab.lab.fcli.bgpRib": () => runFcli("bgp-rib"),
      "containerlab.lab.fcli.ipv4Rib": () => runFcli("ipv4-rib"),
      "containerlab.lab.fcli.lldp": () => runFcli("lldp"),
      "containerlab.lab.fcli.mac": () => runFcli("mac"),
      "containerlab.lab.fcli.ni": () => runFcli("ni"),
      "containerlab.lab.fcli.subif": () => runFcli("subif"),
      "containerlab.lab.fcli.sysInfo": () => runFcli("sys-info"),
      "containerlab.lab.fcli.custom": async () => {
        const customCommand = await promptForTextInput({
          title: "Custom fcli Command",
          label: "fcli command",
          defaultValue: "bgp-peers",
          confirmLabel: "Run"
        });
        if (customCommand?.trim()) {
          await runFcli(customCommand.trim());
        }
      },
      "containerlab.capture.killAllWiresharkVNC": async () => {
        const endpointId = await resolveEndpointForAction(
          "close all Wireshark VNC sessions",
          actionEndpointId
        );
        if (
          endpointId &&
          (await confirmRuntimeAction({
            title: "Close Wireshark VNC Sessions",
            message: "Close all active Wireshark VNC sessions for this endpoint?",
            confirmLabel: "Close Sessions",
            severity: "warning"
          }))
        ) {
          try {
            const response = await closeAllWiresharkVncSessions(endpointId);
            runtimeUiActions.notify(
              response.message || "Closed Wireshark VNC sessions.",
              "success"
            );
          } catch (error) {
            runtimeUiActions.notify(
              error instanceof Error ? error.message : String(error),
              "error"
            );
          }
        }
      },
      "containerlab.treeView.runningLabs.hideNonOwnedLabs": () => {
        explorerPreferences.showNonOwnedLabs = false;
        persistShowNonOwnedLabsSetting(false);
        scheduleSnapshot(0);
      },
      "containerlab.treeView.runningLabs.showNonOwnedLabs": () => {
        explorerPreferences.showNonOwnedLabs = true;
        persistShowNonOwnedLabsSetting(true);
        scheduleSnapshot(0);
      },
      "containerlab.node.save": async () => {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node save requires a running lab item.");
          return;
        }
        await saveConfigsFlow(
          {
            endpointId: actionEndpointId,
            topologyRef: actionTopologyRef,
            nodeName: item.name
          },
          `Saved config for ${item.label || item.name}.`
        );
      },
      "containerlab.node.start": () =>
        runNodeLifecycle("start", `Started ${item?.label || item?.name || "node"}.`),
      "containerlab.node.stop": () =>
        runNodeLifecycle("stop", `Stopped ${item?.label || item?.name || "node"}.`),
      "containerlab.node.restart": () =>
        runNodeLifecycle("restart", `Restarted ${item?.label || item?.name || "node"}.`),
      "containerlab.node.pause": () =>
        runNodeLifecycle("pause", `Paused ${item?.label || item?.name || "node"}.`),
      "containerlab.node.unpause": () =>
        runNodeLifecycle("unpause", `Unpaused ${item?.label || item?.name || "node"}.`),
      "containerlab.node.openBrowser": openNodeBrowser,
      "containerlab.node.ssh": openNodeAccessTerminal,
      "containerlab.node.attachShell": openNodeAccessTerminal,
      "containerlab.node.telnet": openNodeAccessTerminal,
      "containerlab.node.showLogs": () => {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Node logs require a running lab item.");
          return;
        }
        runtimeUiActions.openLogs({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          title: `Logs: ${item.label || item.name}`
        });
      },
      "containerlab.node.manageImpairments": () => {
        if (!actionTopologyRef || !item?.name) {
          postExplorerError("Impairments require a running lab item.");
          return;
        }
        runtimeUiActions.openNetem({
          endpointId: actionEndpointId,
          topologyRef: actionTopologyRef,
          nodeName: item.name,
          title: `Impairments: ${item.label || item.name}`
        });
      },
      "containerlab.interface.setDelay": openInterfaceImpairments,
      "containerlab.interface.setJitter": openInterfaceImpairments,
      "containerlab.interface.setLoss": openInterfaceImpairments,
      "containerlab.interface.setRate": openInterfaceImpairments,
      "containerlab.interface.setCorruption": openInterfaceImpairments,
      "containerlab.interface.capture": runPreferredCapture,
      "containerlab.interface.captureWithEdgeshark": runPacketflixCapture,
      "containerlab.interface.captureWithEdgesharkVNC": runWiresharkVncCapture,
      "containerlab.set.sessionHostname": setSessionHostnameFlow,
      "containerlab.node.copyName": () => copyText(item?.name || item?.label),
      "containerlab.node.copyID": () => copyText(item?.cID),
      "containerlab.node.copyKind": () => copyText(item?.kind),
      "containerlab.node.copyImage": () => copyText(item?.image),
      "containerlab.node.copyIPv4Address": () => copyText(item?.v4Address),
      "containerlab.node.copyIPv6Address": () => copyText(item?.v6Address),
      "containerlab.interface.copyMACAddress": () => copyText(item?.mac),
      "containerlab.lab.copyPath": async () =>
        copyText(actionTopologyRef?.yamlPath ?? (await options.resolveApiTopologyPath(args)))
    };

    const handler = commandHandlers[commandId];
    if (handler) {
      await handler();
      return;
    }

    if (!unhandledCommands.has(commandId)) {
      unhandledCommands.add(commandId);
      console.warn(`[Standalone] Command not implemented: ${commandId}`);
    }
  };
}
