/**
 * Live container interfaces carried on topology nodes, used to offer packet
 * capture on every interface of a node (not only the linked ones).
 */
import { isRecord } from "./typeHelpers";
import { mapSrosInterfaceName } from "../parsing/DistributedSrosMapper";

/** Node extraData key holding the node's live interfaces. */
export const RUNTIME_INTERFACES_KEY = "runtimeInterfaces";

/** A live container interface, as listed for packet capture. */
export interface TopologyRuntimeInterface {
  name: string;
  alias?: string;
  state: string;
}

interface RuntimeInterfaceSource {
  name: string;
  alias?: string;
  label?: string;
  state: string;
}

const INTERFACE_NAME_COLLATOR = new Intl.Collator(undefined, { numeric: true });

/** Host-side end of a containerlab link; its alias is the port name inside the node. */
const HOST_NETNS_INTERFACE_PREFIX = "clab-s-";
/** SR-SIM plumbing (fabric, internal management), not router ports. */
const SRSIM_INTERNAL_PREFIX = "_nokia_";
/** SR Linux plumbing: management gateway, monitoring, and the mgmt0.0 netdev mgmt0 already covers. */
const SRLINUX_INTERNAL = /^(?:gway-\d+|monit_in|mgmt0-\d+)$/;

/** Platform plumbing that is not a port a user would capture on. */
export function isInternalInterfaceName(kind: string | undefined, name: string): boolean {
  if (name.startsWith(SRSIM_INTERNAL_PREFIX)) return true;
  return kind === "nokia_srlinux" && SRLINUX_INTERNAL.test(name);
}

/** Link interfaces captured in the host network namespace rather than the node's. */
export function isHostNetnsInterfaceName(name: string): boolean {
  return name.startsWith(HOST_NETNS_INTERFACE_PREFIX);
}

const LINUX_PORT_NAME = /^eth\d+$/;
const SRLINUX_PORT_NAME = /^e\d+-\d+(?:-\d+)?$/;
const SRLINUX_PORT_ALIAS = /^ethernet-(\d+)\/(\d+)(?:\/(\d+))?$/;

function srlinuxPortName(alias: string): string | undefined {
  if (SRLINUX_PORT_NAME.test(alias)) return alias;
  const match = SRLINUX_PORT_ALIAS.exec(alias);
  if (!match) return undefined;
  const [, slot, port, breakout] = match as Array<string | undefined>;
  return breakout === undefined ? `e${slot}-${port}` : `e${slot}-${port}-${breakout}`;
}

/**
 * Name of an interface inside the node's network namespace, so link ports can
 * share one capture stream with the node's own interfaces (e.g. eth0).
 *
 * containerlab reports a veth-stitched link by its host-side end (clab-s-*)
 * and keeps the topology name as alias; the node's own end is named after that
 * alias, per kind. Returns undefined when the kind's naming is not known, and
 * the host-side end has to be captured instead.
 */
export function nodeNamespaceInterfaceName(
  kind: string | undefined,
  iface: { name: string; alias?: string }
): string | undefined {
  if (!isHostNetnsInterfaceName(iface.name)) return iface.name;
  const alias = iface.alias?.trim() ?? "";
  if (alias.length === 0) return undefined;
  if (kind === "nokia_srsim") return mapSrosInterfaceName(alias);
  if (LINUX_PORT_NAME.test(alias)) return alias;
  if (kind === "nokia_srlinux") return srlinuxPortName(alias);
  if (kind === "linux") return alias;
  return undefined;
}

export function compareInterfaceNames(left: string, right: string): number {
  return INTERFACE_NAME_COLLATOR.compare(left, right);
}

/** Capturable interfaces of a container: loopback, unknown-state and platform internals are dropped. */
export function toRuntimeCaptureInterfaces(
  interfaces: readonly RuntimeInterfaceSource[] | undefined,
  kind?: string
): TopologyRuntimeInterface[] {
  return (interfaces ?? [])
    .filter(
      (iface) =>
        iface.name.length > 0 &&
        iface.name !== "lo" &&
        iface.state !== "unknown" &&
        !isInternalInterfaceName(kind, iface.name)
    )
    .map((iface) => {
      const alias = [iface.alias, iface.label].find(
        (candidate): candidate is string => candidate !== undefined && candidate.length > 0
      );
      return {
        name: iface.name,
        ...(alias !== undefined && alias !== iface.name ? { alias } : {}),
        state: iface.state
      };
    })
    .sort((left, right) => compareInterfaceNames(left.name, right.name));
}

export function runtimeInterfaceListsEqual(
  previous: readonly TopologyRuntimeInterface[] | undefined,
  next: readonly TopologyRuntimeInterface[] | undefined
): boolean {
  if (previous === next) return true;
  if (!previous || !next || previous.length !== next.length) return false;
  return previous.every(
    (iface, index) =>
      iface.name === next[index].name &&
      iface.alias === next[index].alias &&
      iface.state === next[index].state
  );
}

/** Read the live interfaces stored on a node's extraData. */
export function readRuntimeInterfaces(extraData: unknown): TopologyRuntimeInterface[] | undefined {
  if (!isRecord(extraData)) return undefined;
  const value = extraData[RUNTIME_INTERFACES_KEY];
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry): TopologyRuntimeInterface[] => {
    if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.length === 0) return [];
    return [
      {
        name: entry.name,
        ...(typeof entry.alias === "string" && entry.alias.length > 0 ? { alias: entry.alias } : {}),
        state: typeof entry.state === "string" ? entry.state : ""
      }
    ];
  });
}
