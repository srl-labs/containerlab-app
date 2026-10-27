import fs from "node:fs/promises";
import path from "node:path";

/**
 * The topology path containerlab reports for a c9s lab that containerlab did
 * not create (no recorded file): `k8s://<namespace>/topologies/<lab>`.
 */
export function isClusterTopologyPath(topology: string): boolean {
  return /^k8s:\/\//i.test(topology);
}

/**
 * Whether a command on a running lab can name it by its topology file (`-t`).
 * A c9s lab reports the file it was deployed from, as a path on the deploying
 * machine, so the file may not be on this one; such a lab, and one that
 * containerlab did not create, goes by its name. Docker and Podman labs run
 * here, so their file is always taken.
 */
export async function isRunningTopologyHere(runtime: string, topology: string): Promise<boolean> {
  if (isClusterTopologyPath(topology)) return false;
  if (runtime !== "c9s" || !path.isAbsolute(topology)) return true;
  try {
    await fs.access(topology);
    return true;
  } catch {
    return false;
  }
}
