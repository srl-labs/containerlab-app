/** The ends of a canvas link as capture checklist options. */
import type { Node } from "@xyflow/react";

import { isRecord } from "../../../core/utilities/typeHelpers";
import { isHostNetnsInterfaceName, readRuntimeInterfaces } from "../../../core/utilities/runtimeInterfaces";

import type { CaptureInterfaceOption } from "./captureInterfaceOptions";

export interface LinkCaptureEnd {
  /** Which side of the link: stays unique even when both ends share a port name. */
  id: "source" | "target";
  /** Canvas node of this end. */
  nodeId: string;
  /** Container to capture in, as the runtime names it. */
  captureName: string;
  /** Node name as the topology shows it. */
  displayName: string;
  /** Port name as the topology shows it; the host resolves it to the live interface. */
  endpoint: string;
}

/** Pseudo container for ends captured in the host network namespace. */
const HOST_NAMESPACE = "host";

/**
 * The end is stitched: the node reports a host-side interface (clab-s-*) for
 * this port. Such ends live in the host network namespace and can share one capture.
 */
function hasHostSideEnd(end: LinkCaptureEnd, nodes: readonly Node[]): boolean {
  const node = nodes.find((candidate) => candidate.id === end.nodeId);
  const data = isRecord(node?.data) ? node.data : {};
  return (readRuntimeInterfaces(data.extraData) ?? []).some(
    (iface) => isHostNetnsInterfaceName(iface.name) && iface.alias === end.endpoint
  );
}

/** Both ends are stitched, so one Wireshark can show the link from both sides. */
export function linkEndsShareNamespace(ends: readonly LinkCaptureEnd[], nodes: readonly Node[]): boolean {
  return ends.length > 1 && ends.every((end) => hasHostSideEnd(end, nodes));
}

export function linkCaptureOptions(
  ends: readonly LinkCaptureEnd[],
  shareNamespace: boolean
): CaptureInterfaceOption[] {
  return ends.map((end) => ({
    name: end.id,
    label: end.endpoint,
    nodeLabel: end.displayName,
    nodeNamespace: false,
    hostNetns: shareNamespace,
    state: "unknown",
    // Shared ends group into one capture; the others stay one per node.
    containerName: shareNamespace ? HOST_NAMESPACE : end.captureName,
    isManagement: false
  }));
}
