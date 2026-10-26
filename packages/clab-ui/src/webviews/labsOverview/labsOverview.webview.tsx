/**
 * The labs overview in its own editor tab (VS Code): the cards come from the
 * extension host, and so do the topology files for thumbnails and the usage
 * streams, over webview messages.
 */
import Box from "@mui/material/Box";
import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { ClabUiRuntimeProvider, useClabUiHost, type ClabUiRuntime } from "../../host";
import type { ClabUiHost, HostNodeStatsSample } from "../../host/contracts";
import { MuiThemeProvider } from "../../theme/index";
import { LabsOverview } from "../../workspace/components/LabsOverview";
import type { LabOverviewCard, LabThumbnailSources } from "../../workspace/state/labsOverview";
import { createLabUsageFeed, type LabUsageFeed, type LabUsageFeedDeps } from "../../workspace/state/labUsageFeed";
import { useMessageListener, usePostMessage } from "../shared/hooks";

import type {
  LabsOverviewAction,
  LabsOverviewIncomingMessage,
  LabsOverviewOutgoingMessage,
  LabsOverviewWebviewInitialData,
  LabsOverviewWebviewState
} from "./types";

type UsageMessage = Extract<LabsOverviewIncomingMessage, { type: "labs-overview:usage" }>;

interface LabsOverviewBridge {
  loadSources(card: LabOverviewCard): Promise<LabThumbnailSources | undefined>;
  streamLabStats: LabUsageFeedDeps["streamLabStats"];
  dispose(): void;
}

function streamError(message: UsageMessage): Error {
  return Object.assign(new Error(message.error ?? "The usage stream failed"), { status: message.status });
}

/** Requests to the extension host, answered by messages with the same id. */
function createLabsOverviewBridge(host: ClabUiHost): LabsOverviewBridge {
  const post = (message: LabsOverviewOutgoingMessage) => host.postMessage(message);
  let nextId = 1;
  const sourceRequests = new Map<number, (sources: LabThumbnailSources | undefined) => void>();
  const streams = new Map<number, (message: UsageMessage) => void>();

  const unsubscribe = host.subscribe((event) => {
    const message = event.data as LabsOverviewIncomingMessage | undefined;
    if (message?.type === "labs-overview:sources") {
      sourceRequests.get(message.requestId)?.(message.sources);
      sourceRequests.delete(message.requestId);
    } else if (message?.type === "labs-overview:usage") {
      streams.get(message.streamId)?.(message);
    }
  });

  async function* streamLabStats(input: Parameters<LabUsageFeedDeps["streamLabStats"]>[0]): AsyncGenerator<HostNodeStatsSample> {
    const { signal } = input;
    const streamId = nextId++;
    const queue: HostNodeStatsSample[] = [];
    let ended = false;
    let failure: Error | undefined;
    let wake: (() => void) | undefined;
    streams.set(streamId, (message) => {
      if (message.sample) queue.push(message.sample);
      if (message.end === true) {
        ended = true;
        if (message.error !== undefined) failure = streamError(message);
      }
      wake?.();
    });
    const onAbort = () => wake?.();
    signal.addEventListener("abort", onAbort);
    post({
      type: "labs-overview:usage-start",
      streamId,
      endpointId: input.endpointId,
      labName: input.labName,
      intervalSeconds: input.intervalSeconds
    });
    try {
      while (!signal.aborted) {
        const sample = queue.shift();
        if (sample) {
          yield sample;
          continue;
        }
        if (failure) throw failure;
        if (ended) return;
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
        wake = undefined;
      }
    } finally {
      streams.delete(streamId);
      signal.removeEventListener("abort", onAbort);
      if (!ended) post({ type: "labs-overview:usage-stop", streamId });
    }
  }

  return {
    loadSources(card) {
      const requestId = nextId++;
      return new Promise((resolve) => {
        sourceRequests.set(requestId, resolve);
        post({ type: "labs-overview:load-sources", requestId, cardId: card.id });
      });
    },
    streamLabStats,
    dispose() {
      unsubscribe();
      for (const resolve of sourceRequests.values()) resolve(undefined);
      sourceRequests.clear();
      for (const [streamId, push] of streams) push({ type: "labs-overview:usage", streamId, end: true });
      streams.clear();
    }
  };
}

function initialState(): LabsOverviewWebviewState {
  const initial = (window.__INITIAL_DATA__ ?? {}) as LabsOverviewWebviewInitialData;
  return {
    cards: initial.cards ?? [],
    loading: initial.loading ?? true,
    showEndpoints: initial.showEndpoints ?? false,
    sourcesRevision: initial.sourcesRevision ?? 0
  };
}

/** The bridge and the usage feed, made again if the host changes. */
function useLabsOverviewWiring(): { bridge: LabsOverviewBridge; feed: LabUsageFeed } | undefined {
  const host = useClabUiHost();
  const [wiring, setWiring] = useState<{ bridge: LabsOverviewBridge; feed: LabUsageFeed }>();
  useEffect(() => {
    const bridge = createLabsOverviewBridge(host);
    // An unknown answer is not a no: a lab host that cannot report usage ends its stream with 501.
    const feed = createLabUsageFeed({ streamLabStats: bridge.streamLabStats, supportsNodeStats: async () => true });
    setWiring({ bridge, feed });
    return () => {
      feed.dispose();
      bridge.dispose();
      setWiring(undefined);
    };
  }, [host]);
  return wiring;
}

export function LabsOverviewApp(): React.JSX.Element {
  const postMessage = usePostMessage<LabsOverviewOutgoingMessage>();
  const [state, setState] = useState(initialState);
  const wiring = useLabsOverviewWiring();

  useMessageListener<LabsOverviewIncomingMessage>((message) => {
    if (message.type !== "labs-overview:state") return;
    setState({
      cards: message.cards,
      loading: message.loading,
      showEndpoints: message.showEndpoints,
      sourcesRevision: message.sourcesRevision
    });
  });

  useEffect(() => {
    postMessage({ type: "labs-overview:ready" });
  }, [postMessage]);

  const action = useCallback(
    (kind: LabsOverviewAction) => (card: LabOverviewCard) =>
      postMessage({ type: "labs-overview:action", action: kind, cardId: card.id }),
    [postMessage]
  );
  const loadSources = useCallback(
    (card: LabOverviewCard) => wiring?.bridge.loadSources(card) ?? Promise.resolve(undefined),
    [wiring]
  );

  return (
    <MuiThemeProvider>
      <Box sx={{ position: "relative", width: "100%", height: "100%" }}>
        <LabsOverview
          cards={state.cards}
          loading={state.loading}
          lifecycleAvailable
          showEndpoints={state.showEndpoints}
          loadSources={loadSources}
          sourcesRevision={state.sourcesRevision}
          watchUsage={wiring?.feed.watch}
          onOpen={action("open")}
          onDeploy={action("deploy")}
          onDestroy={action("destroy")}
          onCreateLab={() => postMessage({ type: "labs-overview:create-lab" })}
        />
      </Box>
    </MuiThemeProvider>
  );
}

export function bootstrapLabsOverviewWebview(runtime: ClabUiRuntime): void {
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("Labs overview webview root element not found");
  }
  createRoot(container).render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <LabsOverviewApp />
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
}
