// What the link hover card shows: both endpoints as the lab host reports them, and the link's state.
import type { InterfaceStatsPayload } from "../../../core/types/topology";
import { getString } from "../../../core/utilities/typeHelpers";
import { normalizeNetemPercentage, normalizeNetemValue } from "../../../utils/netemNormalization";

export interface LinkHoverEndpoint {
  node: string;
  interface: string;
  /** Empty while the lab is not deployed. */
  state: string;
  mac: string;
  mtu: string;
  stats?: InterfaceStatsPayload;
  /** Impairments in effect, e.g. "delay 10ms, loss 5%". */
  impairment?: string;
}

export type LinkHoverState = "up" | "down" | "unknown";

interface LinkLike {
  source: string;
  target: string;
  data?: Record<string, unknown>;
}

function stringOf(value: unknown): string {
  if (typeof value === "number") return String(value);
  return getString(value) ?? "";
}

function isActive(value: string): boolean {
  const amount = parseFloat(value);
  return Number.isFinite(amount) && amount > 0;
}

/** The impairments of an endpoint that change anything, or undefined. */
export function netemSummary(netem: unknown): string | undefined {
  if (typeof netem !== "object" || netem === null) return undefined;
  const state = netem as Record<string, string | number | undefined>;
  const parts: string[] = [];
  const time = (key: string) => {
    const value = normalizeNetemValue(state[key]);
    if (isActive(value)) parts.push(`${key} ${value}`);
  };
  const percent = (key: string) => {
    const value = normalizeNetemPercentage(state[key]);
    if (isActive(value)) parts.push(`${key} ${value}%`);
  };
  time("delay");
  time("jitter");
  percent("loss");
  const rate = normalizeNetemValue(state.rate);
  if (isActive(rate)) parts.push(`rate ${rate} kbps`);
  percent("corruption");
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function endpoint(link: LinkLike, side: "Source" | "Target"): LinkHoverEndpoint {
  const data = link.data ?? {};
  const extra = (typeof data.extraData === "object" && data.extraData !== null ? data.extraData : {}) as Record<string, unknown>;
  const stats = extra[`clab${side}Stats`];
  const impairment = netemSummary(extra[`clab${side}Netem`]);
  return {
    node: side === "Source" ? link.source : link.target,
    interface: stringOf(data[side === "Source" ? "sourceEndpoint" : "targetEndpoint"]),
    state: stringOf(extra[`clab${side}InterfaceState`]).toLowerCase(),
    mac: stringOf(extra[`clab${side}MacAddress`]),
    mtu: stringOf(extra[`clab${side}Mtu`]),
    ...(typeof stats === "object" && stats !== null ? { stats: stats as InterfaceStatsPayload } : {}),
    ...(impairment !== undefined ? { impairment } : {})
  };
}

export function linkHoverEndpoints(link: LinkLike): [LinkHoverEndpoint, LinkHoverEndpoint] {
  return [endpoint(link, "Source"), endpoint(link, "Target")];
}

/** Up when both ends are up, down when either is down; unknown when the host reports neither. */
export function linkHoverState(endpoints: readonly LinkHoverEndpoint[]): LinkHoverState {
  if (endpoints.some((end) => end.state === "down")) return "down";
  if (endpoints.every((end) => end.state === "up")) return "up";
  return "unknown";
}
