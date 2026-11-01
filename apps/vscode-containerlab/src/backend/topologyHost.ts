import * as inspector from "../treeView/inspector";

import { type LabConnection } from "./connections";
import {
  connectionById,
  connectionOf,
  isUriString,
  knownTopologyHost,
  pickTopologyHost,
  rememberTopologyHost
} from "./labBackends";

/** This machine or the cluster whose running labs include a topology file. */
function runningHostOf(file: string): LabConnection | undefined {
  for (const [connectionId, labs] of inspector.allLabs()) {
    const connection = connectionById(connectionId);
    if (connection?.kind !== "local") continue;
    const runs = Object.values(labs).some(
      (containers) => containers[0]?.Labels["clab-topo-file"] === file
    );
    if (runs) return connection;
  }
  return undefined;
}

/**
 * The lab host a lab action on a topology runs on: the host whose section the
 * node is in, else the one the file was opened from, deployed to or runs on.
 * A topology file on this machine without a host yet asks where when
 * Kubernetes clusters are configured. Undefined when the user cancels.
 */
export async function topologyHostFor(
  file: string,
  labName: string,
  verb: string,
  connectionId?: string
): Promise<LabConnection | undefined> {
  const given = connectionId !== undefined ? connectionById(connectionId) : undefined;
  if (given) {
    await rememberTopologyHost(file, given);
    return given;
  }
  // Lab server files, cluster-only labs and URLs: where their URI says.
  if (isUriString(file)) return connectionOf(file);
  const known = knownTopologyHost(file) ?? runningHostOf(file);
  if (known) {
    await rememberTopologyHost(file, known);
    return known;
  }
  return pickTopologyHost(file, labName, verb);
}
