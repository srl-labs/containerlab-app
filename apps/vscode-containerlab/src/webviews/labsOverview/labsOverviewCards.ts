/**
 * Cards for the labs overview tab, from what the explorer lists: the running
 * labs of every connection, then the topology files nobody deployed.
 */
import {
  labNodeRunState,
  labRunState,
  parseDockerUptime,
  type LabNodeRunState,
  type LabOverviewCard
} from "@containerlab/clab-ui/labs-overview/cards";
import type { TopologyRef } from "@containerlab/clab-ui/session";

export interface OverviewContainer {
  nodeName: string;
  state: string;
  /** Docker's status line, e.g. `Up 5 minutes (healthy)`. */
  status: string;
}

interface OverviewConnection {
  id: string;
  label: string;
}

export interface OverviewRunningLab {
  connection: OverviewConnection;
  labName: string;
  /** The topology file, a local path or a lab-host URI. */
  path?: string;
  owner?: string;
  containers: OverviewContainer[];
}

export interface OverviewTopologyFile {
  connection: OverviewConnection;
  /** The file name, shown as the card's name. */
  name: string;
  path: string;
}

/** The id the webview sends back with an action. */
export function overviewCardId(connectionId: string, pathOrLab: string): string {
  return `${connectionId}::${pathOrLab}`;
}

/** Cards with a topology file open it; others can only be looked at. */
function topologyRefOf(
  connectionId: string,
  labName: string,
  path: string | undefined
): TopologyRef | undefined {
  if (path === undefined) return undefined;
  return {
    topologyId: overviewCardId(connectionId, path),
    labName,
    yamlPath: path,
    annotationsPath: `${path}.annotations.json`,
    source: "vscode"
  };
}

function oldestStart(containers: OverviewContainer[], now: number) {
  let oldest: { startedAt: number; precisionMs: number } | undefined;
  for (const container of containers) {
    const uptime = parseDockerUptime(container.status);
    if (!uptime) continue;
    const startedAt = now - uptime.ms;
    if (!oldest || startedAt < oldest.startedAt)
      oldest = { startedAt, precisionMs: uptime.precisionMs };
  }
  return oldest;
}

function runningLabCard(lab: OverviewRunningLab, now: number): LabOverviewCard {
  const nodes: Record<string, LabNodeRunState> = {};
  for (const container of lab.containers) nodes[container.nodeName] = labNodeRunState(container);
  const started = oldestStart(lab.containers, now);
  return {
    id: overviewCardId(lab.connection.id, lab.path ?? `lab:${lab.labName}`),
    endpointId: lab.connection.id,
    endpointLabel: lab.connection.label,
    name: lab.labName,
    labName: lab.labName,
    path: lab.path,
    topologyRef: topologyRefOf(lab.connection.id, lab.labName, lab.path),
    owner: lab.owner,
    shared: false,
    state: labRunState(lab.containers),
    nodeCount: lab.containers.length,
    readyCount: Object.values(nodes).filter((state) => state === "ready").length,
    nodes,
    startedAt: started?.startedAt,
    uptimePrecisionMs: started?.precisionMs,
    canDeploy: false,
    canDestroy: lab.path !== undefined
  };
}

function topologyFileCard(file: OverviewTopologyFile): LabOverviewCard {
  return {
    id: overviewCardId(file.connection.id, file.path),
    endpointId: file.connection.id,
    endpointLabel: file.connection.label,
    name: file.name,
    path: file.path,
    topologyRef: topologyRefOf(file.connection.id, file.name, file.path),
    shared: false,
    state: "undeployed",
    nodeCount: 0,
    readyCount: 0,
    nodes: {},
    canDeploy: true,
    canDestroy: false
  };
}

function compareCards(left: LabOverviewCard, right: LabOverviewCard): number {
  return (
    left.name.localeCompare(right.name) ||
    left.endpointLabel.localeCompare(right.endpointLabel) ||
    (left.path ?? "").localeCompare(right.path ?? "")
  );
}

export function buildOverviewCards(
  running: readonly OverviewRunningLab[],
  files: readonly OverviewTopologyFile[],
  now: number
): LabOverviewCard[] {
  const cards = running.map((lab) => runningLabCard(lab, now));
  const runningPaths = new Set(cards.map((card) => card.id));
  for (const file of files) {
    const card = topologyFileCard(file);
    if (!runningPaths.has(card.id)) cards.push(card);
  }
  return cards.sort(compareCards);
}
