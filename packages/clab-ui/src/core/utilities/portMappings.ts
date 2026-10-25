/**
 * Node `ports` entries: Docker publish specs (`80:8080`, `53:53/udp`) and, with
 * the `/ts` suffix, ports the lab Tailscale proxy forwards (containerlab 0.80).
 */

export type PortProtocol = "tcp" | "udp" | "sctp" | "ts";

const PROTOCOLS: readonly PortProtocol[] = ["tcp", "udp", "sctp", "ts"];

function toProtocol(suffix: string): PortProtocol | undefined {
  const normalized = suffix.trim().toLowerCase();
  return PROTOCOLS.find((protocol) => protocol === normalized);
}

interface PortMapping {
  /** The spec without its protocol suffix */
  spec: string;
  /** The suffix as written, without the slash; empty when the entry has none (TCP) */
  suffix: string;
}

/** Splits `8022:22/ts` into `8022:22` and `ts`. Unknown suffixes stay in the spec. */
export function splitPortMapping(entry: string): PortMapping {
  const slash = entry.lastIndexOf("/");
  if (slash === -1) return { spec: entry, suffix: "" };
  const suffix = entry.slice(slash + 1);
  return toProtocol(suffix) !== undefined
    ? { spec: entry.slice(0, slash), suffix }
    : { spec: entry, suffix: "" };
}

/** The protocol of an entry; no suffix means TCP. */
export function portProtocol(mapping: PortMapping): PortProtocol {
  return toProtocol(mapping.suffix) ?? "tcp";
}

/**
 * Puts a spec and protocol back together. The suffix is kept as written while
 * the protocol stays the same, so `80:80/tcp` does not lose its explicit `/tcp`.
 */
export function joinPortMapping(mapping: PortMapping, protocol: PortProtocol): string {
  let suffix = mapping.suffix;
  if (portProtocol(mapping) !== protocol) suffix = protocol === "tcp" ? "" : protocol;
  return suffix === "" ? mapping.spec : `${mapping.spec}/${suffix}`;
}
