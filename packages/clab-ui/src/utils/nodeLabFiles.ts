// The files of a node on the lab host: its startup config, license and bind sources.
import {
  resolveLabFileReference,
  type LabFileReferenceKind,
  type LabFileRequest,
  type LabFileScope
} from "../host/labFiles";

export type NodeLabFileRole = "startup-config" | "license" | "bind";

export interface NodeLabFile {
  role: NodeLabFileRole;
  request: LabFileRequest;
}

const SOURCES: ReadonlyArray<{ key: string; role: NodeLabFileRole; kind: LabFileReferenceKind }> = [
  { key: "startup-config", role: "startup-config", kind: "file" },
  { key: "license", role: "license", kind: "file" },
  { key: "binds", role: "bind", kind: "bind" }
];

/**
 * The files a node's effective configuration (`extraData` of a topology
 * node, with what it inherits) opens, without duplicates.
 */
export function collectNodeLabFiles(
  config: Record<string, unknown>,
  scope: LabFileScope
): NodeLabFile[] {
  const files: NodeLabFile[] = [];
  const seen = new Set<string>();
  for (const { key, role, kind } of SOURCES) {
    const raw = config[key];
    const values = Array.isArray(raw) ? raw : [raw];
    for (const value of values) {
      if (typeof value !== "string") continue;
      const request = resolveLabFileReference(value, kind, scope);
      if (!request || seen.has(request.path)) continue;
      seen.add(request.path);
      files.push({ role, request });
    }
  }
  return files;
}
