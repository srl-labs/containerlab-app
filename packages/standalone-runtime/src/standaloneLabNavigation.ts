import { isTopologyTemplateFileName } from "@containerlab/clab-ui/host";
import { MSG_FOCUS_NODE, type TopologyRef } from "@containerlab/clab-ui/session";
import {
  runtimeUiActions,
  type LabOverviewCard,
  type LabThumbnailSources
} from "@containerlab/clab-ui/workspace/state";

import type { StandaloneLabsOverviewActions } from "./components/StandaloneLabsOverview";
import { parseLabDeepLink, type LabDeepLink } from "./labDeepLink";
import { confirmRuntimeAction } from "./runtimeActionFlows";
import { readFileExplorerFile } from "./runtimeApi";
import {
  findTopologyFileEntryByPath,
  normalizePathValue,
  stripTopologySuffix,
  topologyPathsLikelyMatch,
  type TopologyFileEntry
} from "./standaloneHostShared";
import type { EndpointConfig } from "./stores/endpointStore";

type ReadFile = (endpointId: string, path: string) => Promise<{ content: string }>;

/** Topology files of overview thumbnails, fetched once until the files change. */
export function createOverviewSourceCache(readFile: ReadFile = readFileExplorerFile) {
  const entries = new Map<string, { endpointId: string; path: string; sources: Promise<LabThumbnailSources | undefined> }>();

  async function read(card: LabOverviewCard & { path: string }): Promise<LabThumbnailSources | undefined> {
    const yaml = await readFile(card.endpointId, card.path);
    const annotations = card.annotationsPath
      ? await readFile(card.endpointId, card.annotationsPath).catch(() => undefined)
      : undefined;
    return { yaml: yaml.content, ...(annotations ? { annotations: annotations.content } : {}) };
  }

  return {
    load(card: LabOverviewCard): Promise<LabThumbnailSources | undefined> {
      // containerlab alone renders templates; their cards show the running nodes or an icon.
      if (!card.path || isTopologyTemplateFileName(card.path)) return Promise.resolve(undefined);
      const key = `${card.endpointId}::${card.path}`;
      const cached = entries.get(key);
      if (cached) return cached.sources;
      const sources = read({ ...card, path: card.path }).catch(() => {
        entries.delete(key);
        return undefined;
      });
      entries.set(key, { endpointId: card.endpointId, path: card.path, sources });
      return sources;
    },
    /** Forgets the files of one lab host, or only those a changed path belongs to. */
    invalidate(endpointId?: string, changedPath?: string): void {
      const topologyPath = changedPath ? stripTopologySuffix(normalizePathValue(changedPath).replace(/\.annotations\.json$/i, "")) : "";
      for (const [key, entry] of entries) {
        if (endpointId !== undefined && entry.endpointId !== endpointId) continue;
        if (topologyPath && !topologyPathsLikelyMatch(stripTopologySuffix(entry.path), topologyPath)) continue;
        entries.delete(key);
      }
    }
  };
}

function commandItem(card: LabOverviewCard) {
  return {
    endpointId: card.endpointId,
    labName: card.name,
    topologyRef: card.topologyRef,
    description: card.path,
    contextValue: card.state === "undeployed" ? "containerlabLabUndeployed" : "containerlabLabDeployed"
  };
}

/** The overview's card actions run the explorer's own commands for the same lab. */
export function createLabsOverviewActions(deps: {
  executeCommand: (commandId: string, args: unknown[]) => Promise<void>;
  createTopologyFile: () => Promise<void>;
  listTopologyFiles: () => Promise<TopologyFileEntry[]>;
  loadSources: (card: LabOverviewCard) => Promise<LabThumbnailSources | undefined>;
  close: () => void;
}): StandaloneLabsOverviewActions {
  const run = (commandId: string, card: LabOverviewCard) => {
    void deps.executeCommand(commandId, [commandItem(card)]).catch((error: unknown) => {
      runtimeUiActions.notify(error instanceof Error ? error.message : String(error), "error");
    });
  };
  return {
    listTopologyFiles: deps.listTopologyFiles,
    loadSources: deps.loadSources,
    // Opening a tab reports its own errors.
    onOpen: (card) => {
      void deps.executeCommand("containerlab.lab.graph.topoViewer", [commandItem(card)]).catch(() => {});
    },
    onDeploy: (card) => run("containerlab.lab.deploy", card),
    onDestroy: (card) => {
      void confirmRuntimeAction({
        title: "Destroy Lab",
        message: `Destroy "${card.name}" on ${card.endpointLabel}? Its nodes stop and are removed.`,
        confirmLabel: "Destroy",
        severity: "error"
      }).then((confirmed) => {
        if (confirmed) run("containerlab.lab.destroy", card);
      });
    },
    onCopyLink: (card) => {
      if (!card.link) return;
      navigator.clipboard.writeText(card.link).then(
        () => runtimeUiActions.notify(`Copied a link to ${card.name}.`, "success"),
        () => runtimeUiActions.notify("The link could not be copied.", "error")
      );
    },
    onCreateLab: () => {
      void deps.createTopologyFile();
    },
    onClose: deps.close
  };
}

/** Asks the canvas to select a node and center on it once the lab shows it. */
export function requestNodeFocus(nodeName: string): void {
  window.dispatchEvent(new MessageEvent("message", { data: { type: MSG_FOCUS_NODE, nodeId: nodeName } }));
}

interface DeepLinkDeps {
  getEndpoints: () => EndpointConfig[];
  listTopologyFilesForEndpoint: (endpointId: string) => Promise<TopologyFileEntry[]>;
  openLab: (target: { endpointId: string; topologyRef: TopologyRef }) => Promise<void>;
  focusNode: (nodeName: string) => void;
}

async function findLinkedFile(
  link: LabDeepLink,
  deps: DeepLinkDeps
): Promise<{ endpointId: string; entry: TopologyFileEntry } | "wait" | undefined> {
  const endpoints = deps.getEndpoints();
  const endpoint = endpoints.find((candidate) => candidate.id === link.endpointId);
  if (endpoint) {
    if (endpoint.status !== "connected") return "wait";
    const entry = findTopologyFileEntryByPath(await deps.listTopologyFilesForEndpoint(endpoint.id), link.path);
    return entry ? { endpointId: endpoint.id, entry } : undefined;
  }
  // Each browser names its lab hosts; a link from elsewhere matches by path when only one host has the file.
  const matches: Array<{ endpointId: string; entry: TopologyFileEntry }> = [];
  for (const candidate of endpoints.filter((entry) => entry.status === "connected")) {
    const entry = findTopologyFileEntryByPath(await deps.listTopologyFilesForEndpoint(candidate.id), link.path);
    if (entry) matches.push({ endpointId: candidate.id, entry });
  }
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Opens the lab of a `?lab=` link once its lab host is connected. Opening another
 * tab first drops the link, so a lab host that answers late never takes over.
 */
export function createLabDeepLinkLauncher(deps: DeepLinkDeps) {
  let pending: LabDeepLink | null = null;
  let opening = false;
  return {
    start(search: string): void {
      pending = parseLabDeepLink(search);
    },
    isPending: (): boolean => pending !== null,
    cancel(): void {
      if (!opening) pending = null;
    },
    async resume(): Promise<void> {
      const link = pending;
      if (!link || opening) return;
      opening = true;
      try {
        const found = await findLinkedFile(link, deps);
        if (found === "wait") return;
        pending = null;
        if (!found) {
          runtimeUiActions.notify(`The linked lab ${link.path} is not on any connected lab host.`, "warning");
          return;
        }
        await deps.openLab({ endpointId: found.endpointId, topologyRef: found.entry.topologyRef });
        if (link.node) deps.focusNode(link.node);
      } catch {
        // Opening the tab reported why it failed.
        pending = null;
      } finally {
        opening = false;
      }
    }
  };
}
