/** What the lenses' answers come to: where a trace ended, who holds an address, what a service is. */
import { natural } from "./fabricFormat";
import type { FabricPathHop, FabricServiceRecord, FabricSighting } from "./fabricTypes";

const FAILED_OUTCOMES = new Set(["no-route", "discard", "dead-end", "unresolved", "no-neighbor", "loop", "too-long"]);
const ARRIVED_OUTCOMES = new Set(["delivered", "handed-off", "local-ip"]);

export function isFailedOutcome(outcome: string): boolean {
  return FAILED_OUTCOMES.has(outcome);
}

export function isArrivedOutcome(outcome: string): boolean {
  return ARRIVED_OUTCOMES.has(outcome);
}

export interface FabricPathSummary {
  arrived: FabricPathHop[];
  failed: FabricPathHop[];
  /** The nodes of the walk by hop: the cables crossed to reach them. */
  stages: string[][];
  /** Cables crossed. */
  hops: number;
}

/** Where a trace ended, on each branch, and which nodes it went through. */
export function summarizePath(hops: readonly FabricPathHop[]): FabricPathSummary {
  const stages: Array<Set<string>> = [];
  const place = (node: string, stage: number) => {
    (stages[stage] ??= new Set()).add(node);
  };
  for (const hop of hops) {
    place(hop.node, hop.hop);
    // A walk cut short still crossed the cable to its peer.
    if (hop.outcome === "forwarded" && hop.peer) place(hop.peer, hop.hop + 1);
  }
  const ordered = stages.filter(Boolean).map((nodes) => [...nodes].sort(natural));
  return {
    arrived: hops.filter((hop) => isArrivedOutcome(hop.outcome)),
    failed: hops.filter((hop) => isFailedOutcome(hop.outcome)),
    stages: ordered,
    hops: Math.max(0, ordered.length - 1)
  };
}

/** The hops by stage of the walk, in order. */
export function hopsByStage(hops: readonly FabricPathHop[]): FabricPathHop[][] {
  const stages = new Map<number, FabricPathHop[]>();
  for (const hop of hops) {
    const stage = stages.get(hop.hop);
    if (stage) stage.push(hop);
    else stages.set(hop.hop, [hop]);
  }
  return [...stages.entries()].sort(([a], [b]) => a - b).map(([, stage]) => stage);
}

export interface FabricWhereSummary {
  found: boolean;
  duplicate: boolean;
  multihomed: boolean;
  places: number;
  nodes: string[];
}

/** Whether an address is anywhere, and whether what holds it agrees. */
export function summarizeWhere(sightings: readonly FabricSighting[]): FabricWhereSummary {
  const kinds = new Set(sightings.map((sighting) => sighting.kind));
  return {
    found: sightings.length > 0 && !kinds.has("not-found"),
    duplicate: kinds.has("duplicate"),
    multihomed: kinds.has("multihomed"),
    places: sightings.length,
    nodes: [...new Set(sightings.map((sighting) => sighting.node))].sort(natural)
  };
}

export interface FabricServiceCard {
  id: string;
  type: string;
  names: string[];
  dci: string;
  sites: string[];
  rows: FabricServiceRecord[];
  nodes: string[];
  vnis: number[];
  rts: string[];
  subnets: string[];
  macs: number;
  /** `up`, `down`, or `mixed` where its nodes disagree. */
  state: string;
  issues: number;
}

function unique<T extends string | number>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => natural(String(a), String(b)));
}

function serviceState(down: number, total: number): string {
  if (down === 0) return "up";
  return down === total ? "down" : "mixed";
}

/** The services there are, each with the nodes that carry it. */
export function serviceCards(records: readonly FabricServiceRecord[]): FabricServiceCard[] {
  const groups = new Map<string, FabricServiceRecord[]>();
  for (const record of records) {
    const group = record.group || record.name;
    const rows = groups.get(group);
    if (rows) rows.push(record);
    else groups.set(group, [record]);
  }
  return [...groups].map(([id, rows]) => {
    const down = rows.filter((row) => row.oper !== "up").length;
    return {
      id,
      type: rows[0]?.type ?? "",
      names: unique(rows.map((row) => row.name)),
      dci: rows[0]?.dci ?? "",
      sites: unique(rows.flatMap((row) => (row.site ? [row.site] : []))),
      rows: [...rows].sort((a, b) => natural(a.node, b.node)),
      nodes: unique(rows.map((row) => row.node)),
      vnis: unique(rows.flatMap((row) => row.vnis ?? [])),
      rts: unique(rows.flatMap((row) => (row.vpn ?? []).flatMap((vpn) => vpn.import_rts ?? []))),
      subnets: unique(rows.flatMap((row) => row.subnets ?? [])),
      macs: rows.reduce((sum, row) => sum + (row.macs_local ?? 0), 0),
      state: serviceState(down, rows.length),
      issues: rows.filter((row) => (row.issues ?? []).length > 0).length
    };
  }).sort((a, b) => b.issues - a.issues || natural(a.names[0] ?? "", b.names[0] ?? ""));
}

/** Route-targets a node has that the others of its service do not: what disagrees. */
export function disagreeingRts(card: FabricServiceCard): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const counts = new Map<string, number>();
  const ofRow = (row: FabricServiceRecord) => unique((row.vpn ?? []).flatMap((vpn) => vpn.import_rts ?? []));
  for (const row of card.rows) for (const rt of ofRow(row)) counts.set(rt, (counts.get(rt) ?? 0) + 1);
  if (card.rows.length < 2) return out;
  for (const row of card.rows) {
    const lonely = ofRow(row).filter((rt) => (counts.get(rt) ?? 0) === 1);
    if (lonely.length > 0) out.set(row.node, lonely);
  }
  return out;
}
