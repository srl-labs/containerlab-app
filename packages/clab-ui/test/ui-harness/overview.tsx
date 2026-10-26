/**
 * The labs overview against fixture labs: running labs stream fake usage while
 * their cards are visible. `?stats=unavailable` plays a lab host without node
 * stats, `?stats=none` a host without a usage feed, `?many=1` adds many labs.
 * `?host=webview` shows it as the editor-tab webview, with a fake extension host
 * answering its messages.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { parse } from "yaml";

import { MuiThemeProvider } from "../../src/theme/MuiThemeProvider";
import {
  ClabUiRuntimeProvider,
  createClabUiRuntime,
  createWindowClabUiHost,
  type HostRuntimeContainer
} from "../../src/host";
import { LabsOverviewApp, type LabsOverviewIncomingMessage, type LabsOverviewOutgoingMessage } from "../../src/labs-overview";
import { LabsOverview } from "../../src/workspace/overview";
import {
  canWatchLabUsage,
  nextLabUsage,
  type LabNodeRunState,
  type LabOverviewCard,
  type LabRunState,
  type LabUsage,
  type WatchLabUsage
} from "../../src/workspace/state";
import { applyStandaloneAppearance, readStandaloneAppearance } from "../../src/workspace/state/themePreferences";
import "../../src/styles/global.css";

import { fakeNodeStats } from "./fakeNodeStats";
import { fixtureFiles, TOPOLOGY_ROOT } from "./fixtureFiles";

const params = new URLSearchParams(location.search);
applyStandaloneAppearance(readStandaloneAppearance(), params.get("theme") === "light" ? "light" : "dark");
const statsMode = params.get("stats") ?? "live";
const INTERVAL_MS = Number(params.get("interval") ?? 1000);

function nodeNames(path: string): string[] {
  try {
    const topology = (parse(fixtureFiles[path] ?? "") as { topology?: { nodes?: Record<string, unknown> } }).topology;
    return Object.keys(topology?.nodes ?? {});
  } catch {
    return [];
  }
}

function card(file: string, state: LabRunState, overrides: Partial<LabOverviewCard> = {}): LabOverviewCard {
  const path = `${TOPOLOGY_ROOT}/${file}.clab.yml`;
  const names = nodeNames(path);
  const nodes: Record<string, LabNodeRunState> = {};
  if (state !== "undeployed") for (const name of names) nodes[name] = "ready";
  return {
    id: `harness::${path}`,
    endpointId: "harness",
    endpointLabel: "this-host",
    name: file,
    ...(state === "undeployed" ? {} : { labName: file }),
    path,
    annotationsPath: `${path}.annotations.json`,
    topologyRef: { topologyId: `harness:${path}`, labName: file, yamlPath: path, annotationsPath: `${path}.annotations.json`, source: "standalone" },
    shared: false,
    state,
    nodeCount: state === "undeployed" ? 0 : names.length,
    readyCount: state === "undeployed" ? 0 : names.length,
    nodes,
    startedAt: state === "undeployed" ? undefined : Date.now() - 2 * 3600_000,
    canDeploy: state === "undeployed",
    canDestroy: state !== "undeployed",
    ...overrides
  };
}

function buildCards(): LabOverviewCard[] {
  const partial = card("stages", "partial");
  const [down, starting] = Object.keys(partial.nodes);
  if (down) partial.nodes[down] = "down";
  if (starting) partial.nodes[starting] = "starting";
  partial.readyCount = Math.max(0, partial.nodeCount - 2);
  const cards = [
    card("spine-leaf", "running"),
    card("datacenter", "running"),
    card("network", "running"),
    card("ai-fabric", "running"),
    partial,
    card("simple", "undeployed"),
    card("inheritance", "undeployed"),
    card("multi-mgmt", "undeployed"),
    {
      ...card("orphan", "running"),
      id: "harness::lab:other-user",
      name: "other-user",
      labName: "other-user",
      path: undefined,
      annotationsPath: undefined,
      topologyRef: undefined,
      owner: "bob",
      nodes: { r1: "ready", r2: "ready", r3: "ready" } as Record<string, LabNodeRunState>,
      nodeCount: 3,
      readyCount: 3
    } satisfies LabOverviewCard
  ];
  if (params.get("many") === "1") {
    for (let index = 0; index < 60; index += 1) {
      const base = card(index % 2 === 0 ? "spine-leaf" : "simple", index % 3 === 0 ? "running" : "undeployed");
      cards.push({ ...base, id: `${base.id}#${index}`, name: `lab-${String(index).padStart(2, "0")}`, ...(base.labName === undefined ? {} : { labName: `lab-${index}` }) });
    }
  }
  return cards;
}

const active = new Map<string, number>();

function countActive(key: string, delta: 1 | -1): void {
  const count = (active.get(key) ?? 0) + delta;
  if (count > 0) active.set(key, count);
  else active.delete(key);
}

function usageContainers(watched: LabOverviewCard): HostRuntimeContainer[] {
  return Object.entries(watched.nodes)
    .filter(([, state]) => state !== "down")
    .map(([nodeName]) => ({ name: `clab-${watched.labName}-${nodeName}`, nodeName, labName: watched.labName!, state: "running" }) as HostRuntimeContainer);
}

/** One fake sample; the first of a node has no CPU, as with real hosts. */
function fakeSample(containers: HostRuntimeContainer[], tick: number) {
  const nodes = fakeNodeStats(containers, tick).map((node, index) =>
    tick === 1 ? { ...node, cpuPercent: undefined } : { ...node, cpuPercent: (node.cpuPercent ?? 0) * (index % 5 === 1 ? 2.4 : 1) }
  );
  return { time: new Date().toISOString(), intervalSeconds: 3, nodes };
}

/** Fake usage per lab while a card watches it, built from the same samples as the canvas harness. */
const watchUsage: WatchLabUsage = (watched, listener) => {
  if (!canWatchLabUsage(watched)) return () => undefined;
  const key = watched.labName!;
  countActive(key, 1);
  if (statsMode === "unavailable") {
    listener({ status: "unavailable" });
  } else {
    listener({ status: "pending" });
  }
  let usage: LabUsage | undefined;
  let tick = 0;
  const containers = usageContainers(watched);
  const post = () => {
    tick += 1;
    usage = nextLabUsage(usage, fakeSample(containers, tick));
    listener({ status: "live", usage });
  };
  const timer = statsMode === "unavailable" ? undefined : setInterval(post, INTERVAL_MS);
  if (timer !== undefined) post();
  return () => {
    if (timer !== undefined) clearInterval(timer);
    countActive(key, -1);
  };
};

// Messages the webview posted to its host, for specs to read.
const posted: LabsOverviewOutgoingMessage[] = [];
Object.assign(window, { __OVERVIEW__: { activeWatches: () => [...active.keys()].sort(), posted } });

async function loadSources(target: LabOverviewCard) {
  if (target.path === undefined || !(target.path in fixtureFiles)) return undefined;
  return { yaml: fixtureFiles[target.path], annotations: fixtureFiles[`${target.path}.annotations.json`] };
}

function OverviewHarness() {
  const [cards] = React.useState(buildCards);
  const [open, setOpen] = React.useState(true);
  const noop = () => {};
  return open ? (
    <LabsOverview
      cards={cards}
      lifecycleAvailable
      showEndpoints={false}
      loadSources={loadSources}
      sourcesRevision={0}
      watchUsage={statsMode === "none" ? undefined : watchUsage}
      onOpen={noop}
      onDeploy={noop}
      onDestroy={noop}
      onCopyLink={noop}
      onCreateLab={noop}
      onClose={() => setOpen(false)}
    />
  ) : (
    <div data-testid="overview-closed" />
  );
}

/** Answers the webview as the extension host would: labs, topology files and usage streams. */
function fakeExtensionHost(cards: LabOverviewCard[]) {
  const send = (message: LabsOverviewIncomingMessage) => window.postMessage(message, "*");
  const streams = new Map<number, { key: string; timer?: ReturnType<typeof setInterval> }>();
  return (message: LabsOverviewOutgoingMessage) => {
    posted.push(message);
    switch (message.type) {
      case "labs-overview:ready":
        setTimeout(() => send({ type: "labs-overview:state", cards, loading: false, showEndpoints: false, sourcesRevision: 0 }), 100);
        break;
      case "labs-overview:load-sources": {
        const target = cards.find((entry) => entry.id === message.cardId);
        void loadSources(target!).then((sources) => send({ type: "labs-overview:sources", requestId: message.requestId, sources }));
        break;
      }
      case "labs-overview:usage-start": {
        const { streamId, labName } = message;
        if (statsMode === "unavailable") {
          send({ type: "labs-overview:usage", streamId, end: true, error: "Not implemented", status: 501 });
          break;
        }
        const watched = cards.find((entry) => entry.labName === labName);
        const containers = watched ? usageContainers(watched) : [];
        let tick = 0;
        const post = () => {
          tick += 1;
          send({ type: "labs-overview:usage", streamId, sample: fakeSample(containers, tick) });
        };
        countActive(labName, 1);
        streams.set(streamId, { key: labName, timer: setInterval(post, INTERVAL_MS) });
        post();
        break;
      }
      case "labs-overview:usage-stop": {
        const stream = streams.get(message.streamId);
        if (!stream) break;
        clearInterval(stream.timer);
        streams.delete(message.streamId);
        countActive(stream.key, -1);
        break;
      }
      default:
        break;
    }
  };
}

if (params.get("host") === "webview") {
  const runtime = createClabUiRuntime({
    host: createWindowClabUiHost({ postMessage: fakeExtensionHost(buildCards()) as (message: unknown) => void })
  });
  createRoot(document.getElementById("root")!).render(
    <ClabUiRuntimeProvider runtime={runtime}>
      <React.StrictMode>
        <div style={{ position: "fixed", inset: 0 }}>
          <LabsOverviewApp />
        </div>
      </React.StrictMode>
    </ClabUiRuntimeProvider>
  );
} else {
  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <MuiThemeProvider>
        <OverviewHarness />
      </MuiThemeProvider>
    </React.StrictMode>
  );
}
