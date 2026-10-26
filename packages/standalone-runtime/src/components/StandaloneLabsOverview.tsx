import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import {
  createLabUsageFeed,
  type LabOverviewCard,
  type LabOverviewHost,
  type LabThumbnailSources,
  type LabUsageFeed
} from "@containerlab/clab-ui/workspace/state";
import { getStandaloneBackend } from "../backend";
import { fetchEndpointHealthMetrics } from "../endpointHealth";
import { labDeepLinkUrl } from "../labDeepLink";
import { fetchBackendFeatures, streamLabStats } from "../runtimeApi";
import { labsEqualForExplorer, type TopologyFileEntry } from "../standaloneHostShared";
import { buildLabOverviewCards, type UptimeEstimates } from "../standaloneLabsOverview";
import { useEndpointStore } from "../stores/endpointStore";
import { useLabStore, type LabState } from "../stores/labStore";
import { useWorkspaceViewStore } from "../stores/workspaceViewStore";

const LabsOverview = lazy(async () => ({
  default: (await import("@containerlab/clab-ui/workspace/overview")).LabsOverview
}));

export interface StandaloneLabsOverviewActions {
  listTopologyFiles: () => Promise<TopologyFileEntry[]>;
  loadSources: (card: LabOverviewCard) => Promise<LabThumbnailSources | undefined>;
  onOpen: (card: LabOverviewCard) => void;
  onDeploy: (card: LabOverviewCard) => void;
  onDestroy: (card: LabOverviewCard) => void;
  onCopyLink: (card: LabOverviewCard) => void;
  onCreateLab: () => void;
  onClose: () => void;
}

/** Running labs, ignoring the interface counters that update every second. */
function useLabsForOverview(): Map<string, LabState> {
  const [labs, setLabs] = useState(() => useLabStore.getState().labs);
  useEffect(
    () => useLabStore.subscribe((state) => {
      setLabs((current) => (labsEqualForExplorer(current, state.labs) ? current : state.labs));
    }),
    []
  );
  return labs;
}

function linkFor(endpointId: string, path: string): string {
  return labDeepLinkUrl(window.location, { endpointId, path });
}

/** Lab usage for the cards while the overview is shown; none where labs cannot run. */
function useLabUsageFeed(lifecycle: boolean): LabUsageFeed | undefined {
  const [feed, setFeed] = useState<LabUsageFeed>();
  useEffect(() => {
    if (!lifecycle) return undefined;
    const next = createLabUsageFeed({
      streamLabStats,
      supportsNodeStats: async (endpointId) => (await fetchBackendFeatures(endpointId)).nodeStats
    });
    setFeed(next);
    return () => {
      next.dispose();
      setFeed(undefined);
    };
  }, [lifecycle]);
  return feed;
}

export function StandaloneLabsOverview({ actions }: { actions: StandaloneLabsOverviewActions }) {
  const endpoints = useEndpointStore((state) => state.endpoints);
  const filesRevision = useWorkspaceViewStore((state) => state.filesRevision);
  const labs = useLabsForOverview();
  const [files, setFiles] = useState<TopologyFileEntry[] | null>(null);
  const [uptimes] = useState<UptimeEstimates>(() => new Map());
  const { listTopologyFiles } = actions;

  useEffect(() => {
    let cancelled = false;
    void listTopologyFiles()
      .catch((): TopologyFileEntry[] => [])
      .then((next) => {
        if (!cancelled) setFiles(next);
      });
    return () => {
      cancelled = true;
    };
  }, [endpoints, filesRevision, listTopologyFiles]);

  const lifecycle = getStandaloneBackend().capabilities.lifecycle;
  const labHosts = useMemo(
    () => [...endpoints.values()].map((endpoint): LabOverviewHost => ({
      id: endpoint.id,
      label: endpoint.label,
      status: endpoint.status
    })),
    [endpoints]
  );
  const usageFeed = useLabUsageFeed(lifecycle);
  const cards = useMemo(
    () => buildLabOverviewCards({
      labs,
      files: files ?? [],
      endpoints: [...endpoints.values()],
      lifecycle,
      now: Date.now(),
      uptimes,
      linkFor
    }),
    [endpoints, files, labs, lifecycle, uptimes]
  );

  return (
    <Suspense fallback={null}>
      <LabsOverview
        cards={cards}
        loading={files === null}
        lifecycleAvailable={lifecycle}
        showEndpoints={endpoints.size > 1}
        labHosts={labHosts}
        fetchHostMetrics={fetchEndpointHealthMetrics}
        loadSources={actions.loadSources}
        sourcesRevision={filesRevision}
        watchUsage={usageFeed?.watch}
        onOpen={actions.onOpen}
        onDeploy={actions.onDeploy}
        onDestroy={actions.onDestroy}
        onCopyLink={actions.onCopyLink}
        onCreateLab={actions.onCreateLab}
        onClose={actions.onClose}
      />
    </Suspense>
  );
}
