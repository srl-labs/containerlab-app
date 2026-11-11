import fs from "node:fs/promises";
import path from "node:path";

import type { ImagesRunAs } from "./config.ts";

/** Whether files the server creates need an owner change to belong to the `climg` user. */
function differsFromProcess(runAs: ImagesRunAs | undefined): runAs is ImagesRunAs {
  if (!runAs) return false;
  return runAs.uid !== process.getuid?.() || runAs.gid !== process.getgid?.();
}

/** Gives a path to the `climg` run-as user before it becomes visible to others. */
export async function chownToRunAs(runAs: ImagesRunAs | undefined, target: string): Promise<void> {
  if (differsFromProcess(runAs)) await fs.chown(target, runAs.uid, runAs.gid);
}

export async function chownHandleToRunAs(
  runAs: ImagesRunAs | undefined,
  handle: fs.FileHandle
): Promise<void> {
  if (differsFromProcess(runAs)) await handle.chown(runAs.uid, runAs.gid);
}

/**
 * Creates a directory (and parents) for the run-as user. Only folders this call
 * created change owner; an existing folder keeps its owner and mode.
 */
export async function mkdirForRunAs(runAs: ImagesRunAs | undefined, directory: string, mode: number): Promise<void> {
  const first = await fs.mkdir(directory, { recursive: true, mode });
  if (first === undefined) return;
  const created: string[] = [];
  for (let current = directory; ; current = path.dirname(current)) {
    created.push(current);
    if (current === first || path.dirname(current) === current) break;
  }
  for (const folder of created) await chownToRunAs(runAs, folder);
}
