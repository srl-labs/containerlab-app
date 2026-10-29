import { create } from "zustand";

import type { LabHostInfo, LabHostSupport } from "../host/labHostSupport";
import type { LabOperationSupport } from "../host/labOperations";

interface LabHostState {
  /** The lab host of the open topology; undefined until it answers or when the host tells nothing. */
  info: LabHostInfo | undefined;
  setInfo: (info: LabHostInfo | undefined) => void;
}

/** The runtime and support of the open topology's lab host. */
export const useLabHostStore = create<LabHostState>((set) => ({
  info: undefined,
  setInfo: (info) => set({ info })
}));

/**
 * Whether the lab host offers `flag`. A host that tells nothing hides
 * nothing: the lab host still refuses what it cannot do.
 */
export function hostSupports(info: LabHostInfo | undefined, flag: keyof LabHostSupport): boolean {
  return info ? info.support[flag] : true;
}

/** Any way to capture packets: Edgeshark, Wireshark VNC, tcpdump on the lab host or its capture stream. */
export function hostCanCapture(info: LabHostInfo | undefined): boolean {
  return (
    hostSupports(info, "edgeshark") ||
    hostSupports(info, "wiresharkVnc") ||
    hostSupports(info, "hostCapture") ||
    hostSupports(info, "captureStream")
  );
}

/**
 * A lab host that captures lab links as one stream (c9s): its nodes' own
 * interfaces are pod interfaces, so pickers offer the topology's links only.
 */
export function hostCapturesLinks(info: LabHostInfo | undefined): boolean {
  return info?.support.captureStream === true;
}

/** Lab operations the lab host offers: VM snapshots need a runtime that has them. */
export function hostLabOperationSupport(
  support: LabOperationSupport,
  info: LabHostInfo | undefined
): LabOperationSupport {
  const snapshots = hostSupports(info, "snapshots");
  return {
    ...support,
    snapshotSave: support.snapshotSave && snapshots,
    deployRestore: support.deployRestore && snapshots
  };
}
