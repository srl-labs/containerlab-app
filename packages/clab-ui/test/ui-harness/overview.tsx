/**
 * The labs overview against fixture labs: running labs stream fake usage while
 * their cards are visible. `?stats=unavailable` plays a lab host without node
 * stats, `?stats=none` a host without a usage feed, `?many=1` adds many labs.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { parse } from "yaml";

import { MuiThemeProvider } from "../../src/theme/MuiThemeProvider";
import type { HostRuntimeContainer } from "../../src/host";
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

/** Fake usage per lab while a card watches it, built from the same samples as the canvas harness. */
const watchUsage: WatchLabUsage = (watched, listener) => {
  if (!canWatchLabUsage(watched)) return () => undefined;
  const key = watched.labName!;
  active.set(key, (active.get(key) ?? 0) + 1);
  if (statsMode === "unavailable") {
    listener({ status: "unavailable" });
  } else {
    listener({ status: "pending" });
  }
  let usage: LabUsage | undefined;
  let tick = 0;
  const containers = Object.entries(watched.nodes)
    .filter(([, state]) => state !== "down")
    .map(([nodeName]) => ({ name: `clab-${key}-${nodeName}`, nodeName, labName: key, state: "running" }) as HostRuntimeContainer);
  const post = () => {
    tick += 1;
    const nodes = fakeNodeStats(containers, tick).map((node, index) =>
      // The first sample of a node has no CPU, as with real hosts.
      tick === 1 ? { ...node, cpuPercent: undefined } : { ...node, cpuPercent: (node.cpuPercent ?? 0) * (index % 5 === 1 ? 2.4 : 1) }
    );
    usage = nextLabUsage(usage, { time: new Date().toISOString(), intervalSeconds: 3, nodes });
    listener({ status: "live", usage });
  };
  const timer = statsMode === "unavailable" ? undefined : setInterval(post, INTERVAL_MS);
  if (timer !== undefined) post();
  return () => {
    if (timer !== undefined) clearInterval(timer);
    const count = (active.get(key) ?? 1) - 1;
    if (count > 0) active.set(key, count);
    else active.delete(key);
  };
};

Object.assign(window, { __OVERVIEW__: { activeWatches: () => [...active.keys()].sort() } });

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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <MuiThemeProvider>
      <OverviewHarness />
    </MuiThemeProvider>
  </React.StrictMode>
);
