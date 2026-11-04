/**
 * Capture streams of c9s lab hosts: targets, durations, interface listings
 * and pcapng framing, shared by the local and the clab-api-server backend.
 * Pure helpers, so browser code can use them too.
 */
import type { CaptureGap, CaptureInterface, CaptureTarget } from "./contract/dto.ts";
import { LabBackendError } from "./contract/errors.ts";

/** A capture target as containerlab and clab-api-server take it: `<node>:<interface>`. */
export interface CaptureNodeTarget {
  node: string;
  interface: string;
}

const GO_DURATION = /^(?:\d+(?:\.\d+)?(?:ns|us|µs|ms|s|m|h))+$/;

/** A Go duration such as `30s` or `1m30s`; rejects anything else, and zero. */
export function captureDuration(value: string | undefined): string | undefined {
  const duration = value?.trim();
  if (!duration) return undefined;
  if (!GO_DURATION.test(duration) || !/[1-9]/.test(duration)) {
    throw new LabBackendError(`Invalid capture duration "${duration}". Use a Go duration such as 30s or 5m.`, 400);
  }
  return duration;
}

function positiveInteger(value: number | undefined, what: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new LabBackendError(`Invalid capture ${what} ${String(value)}: use ${min} to ${max}.`, 400);
  }
  return value;
}

/** Limits of a capture, checked like the lab hosts check them. */
export function captureLimits(options: { duration?: string; packetLimit?: number; snapLength?: number }): {
  duration?: string;
  packetLimit?: number;
  snapLength?: number;
} {
  const duration = captureDuration(options.duration);
  const packetLimit = positiveInteger(options.packetLimit, "packet limit", 1, 2 ** 31 - 1);
  const snapLength = positiveInteger(options.snapLength, "snap length", 64, 1_048_576);
  return {
    ...(duration !== undefined ? { duration } : {}),
    ...(packetLimit !== undefined ? { packetLimit } : {}),
    ...(snapLength !== undefined ? { snapLength } : {})
  };
}

/** The topology node of an inspect record (`nodeName`), if the record says. */
function recordNodeName(record: { name: string }): string | undefined {
  const value = (record as { nodeName?: unknown; node_name?: unknown }).nodeName ??
    (record as { node_name?: unknown }).node_name;
  return typeof value === "string" && value ? value : undefined;
}

/**
 * The node of a capture target. On c9s `containerName` is the inspect name,
 * `<lab>-<node>`; the inspect record names the node. A bare node name is
 * taken as it is.
 */
function captureTargetNode(
  labName: string,
  containerName: string,
  records: readonly { name: string }[]
): string {
  const record = records.find((candidate) => candidate.name === containerName);
  const fromRecord = record ? recordNodeName(record) : undefined;
  if (fromRecord) return fromRecord;
  for (const prefix of [`clab-${labName}-`, `${labName}-`]) {
    if (containerName.startsWith(prefix) && containerName.length > prefix.length) {
      return containerName.slice(prefix.length);
    }
  }
  return containerName;
}

/** Capture targets as nodes and interfaces, in request order, without duplicates. */
export function captureNodeTargets(
  labName: string,
  targets: readonly CaptureTarget[],
  records: readonly { name: string }[]
): CaptureNodeTarget[] {
  if (targets.length === 0) throw new LabBackendError("At least one capture target is required.", 400);
  const seen = new Set<string>();
  const result: CaptureNodeTarget[] = [];
  for (const target of targets) {
    const node = captureTargetNode(labName, target.containerName.trim(), records);
    const iface = target.interfaceName.trim();
    if (!node || !iface) throw new LabBackendError("A capture target needs a node and an interface.", 400);
    const key = `${node}\u0000${iface}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ node, interface: iface });
  }
  return result;
}

/**
 * `--target` values of `containerlab capture`: one per node, its interfaces
 * comma-separated, nodes in the order they first appear. The node ends at
 * the first colon, so interfaces such as `1/1/3` need no quoting.
 */
export function captureTargetFlags(targets: readonly CaptureNodeTarget[]): string[] {
  const byNode = new Map<string, string[]>();
  for (const target of targets) {
    const interfaces = byNode.get(target.node) ?? [];
    if (!interfaces.includes(target.interface)) interfaces.push(target.interface);
    byNode.set(target.node, interfaces);
  }
  return [...byNode].flatMap(([node, interfaces]) => ["--target", `${node}:${interfaces.join(",")}`]);
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

/**
 * Capture interfaces from containerlab (`peer_node`, snake case) or
 * clab-api-server (`peerNode`); entries without a node or interface are left out.
 */
export function parseCaptureInterfaces(value: unknown): CaptureInterface[] {
  if (!Array.isArray(value)) return [];
  const result: CaptureInterface[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const node = stringField(record, "node");
    const iface = stringField(record, "interface");
    if (!node || !iface) continue;
    const alias = stringField(record, "alias");
    result.push({
      node,
      interface: iface,
      ...(alias ? { alias } : {}),
      peerNode: stringField(record, "peerNode", "peer_node") ?? "",
      peerInterface: stringField(record, "peerInterface", "peer_interface") ?? ""
    });
  }
  return result;
}

/** `key=value` and `key="quoted value"` pairs of a containerlab log line. */
function logFields(line: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of line.matchAll(/(\w+)=("(?:[^"\\]|\\.)*"|\S*)/g)) {
    const raw = match[2];
    fields[match[1]] = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
  }
  return fields;
}

const ZERO_TIME = /^0001-01-01/;

/** The gap of containerlab's `Capture has a gap` warning, or undefined for other lines. */
export function parseCaptureGapLine(line: string): CaptureGap | undefined {
  const index = line.indexOf("Capture has a gap");
  if (index < 0) return undefined;
  const fields = logFields(line.slice(index));
  const interfaces = fields.interfaces ? fields.interfaces.split(",").filter(Boolean) : [];
  return {
    ...(fields.node ? { node: fields.node } : {}),
    ...(interfaces.length > 0 ? { interfaces } : {}),
    ...(fields.from && !ZERO_TIME.test(fields.from) ? { from: fields.from } : {}),
    ...(fields.to && !ZERO_TIME.test(fields.to) ? { to: fields.to } : {}),
    ...(fields.reason ? { reason: fields.reason } : {})
  };
}

/** One line for a status bar: "Capture gap on n1 (eth1): segment started late". */
export function describeCaptureGap(gap: CaptureGap): string {
  const where = [gap.node, gap.interfaces?.length ? `(${gap.interfaces.join(", ")})` : undefined]
    .filter(Boolean)
    .join(" ");
  return `Capture gap${where ? ` on ${where}` : ""}${gap.reason ? `: ${gap.reason}` : ""}. Packets in between are missing; the capture goes on.`;
}

const SHB_TYPE = 0x0a0d0d0a;
const MAX_BLOCK_BYTES = 64 * 1024 * 1024;

/**
 * Regroups a pcapng byte stream into chunks of whole blocks, so wherever the
 * stream stops, what was yielded is a valid file. A trailing partial block
 * is dropped. Byte order comes from each Section Header Block.
 */
export async function* pcapngBlocks(chunks: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  let buffer = new Uint8Array(0);
  let littleEndian = true;
  for await (const chunk of chunks) {
    if (chunk.byteLength === 0) continue;
    const joined = new Uint8Array(buffer.byteLength + chunk.byteLength);
    joined.set(buffer, 0);
    joined.set(chunk, buffer.byteLength);
    buffer = joined;
    let offset = 0;
    while (buffer.byteLength - offset >= 12) {
      const view = new DataView(buffer.buffer, buffer.byteOffset + offset);
      if (view.getUint32(0, true) === SHB_TYPE) {
        const magic = view.getUint32(8, true);
        if (magic === 0x1a2b3c4d) littleEndian = true;
        else if (magic === 0x4d3c2b1a) littleEndian = false;
        else throw new LabBackendError("The capture stream is not pcapng.", 502);
      }
      const length = view.getUint32(4, littleEndian);
      if (length < 12 || length % 4 !== 0 || length > MAX_BLOCK_BYTES) {
        throw new LabBackendError(`The capture stream has a malformed pcapng block (length ${length}).`, 502);
      }
      if (buffer.byteLength - offset < length) break;
      offset += length;
    }
    if (offset > 0) {
      yield buffer.slice(0, offset);
      buffer = buffer.slice(offset);
    }
  }
}
