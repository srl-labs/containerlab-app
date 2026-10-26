/**
 * Opens the files a topology refers to (binds, startup configs, licenses) in
 * workspace file tabs, creating missing ones when asked.
 */
import { resolveWorkspaceLabFile, type LabFileRequest } from "@containerlab/clab-ui/host";

/** The workspace operations the flow needs, so tests can supply their own. */
export interface LabFileWorkspace {
  list: (endpointId: string, directory: string) => Promise<Array<{ name: string; kind: "file" | "directory" }>>;
  read: (endpointId: string, path: string) => Promise<{ content: string }>;
  write: (input: { endpointId: string; path: string; content: string }) => Promise<void>;
  createDirectory: (endpointId: string, path: string) => Promise<void>;
  openTab: (document: { endpointId: string; path: string; content: string; title: string }) => void;
  notify: (message: string, severity: "success" | "info" | "warning" | "error") => void;
}

export interface LabFileTopology {
  endpointId: string;
  /** Workspace path of the topology file. */
  topologyPath: string;
  /** Absolute directory of the topology file on the lab host, for absolute paths. */
  topologyDir?: string;
}

function splitPath(pathValue: string): { directory: string; name: string } {
  const index = pathValue.lastIndexOf("/");
  return index < 0
    ? { directory: "", name: pathValue }
    : { directory: pathValue.slice(0, index), name: pathValue.slice(index + 1) };
}

async function findEntry(
  workspace: LabFileWorkspace,
  endpointId: string,
  pathValue: string
): Promise<{ kind: "file" | "directory" } | undefined> {
  const { directory, name } = splitPath(pathValue);
  try {
    return (await workspace.list(endpointId, directory)).find((entry) => entry.name === name);
  } catch {
    // A missing folder lists nothing.
    return undefined;
  }
}

async function createEmptyFile(workspace: LabFileWorkspace, endpointId: string, pathValue: string): Promise<void> {
  try {
    await workspace.write({ endpointId, path: pathValue, content: "" });
    return;
  } catch {
    // The folders may be missing; create them, then write again.
  }
  const segments = pathValue.split("/").slice(0, -1);
  for (let index = 1; index <= segments.length; index += 1) {
    const directory = segments.slice(0, index).join("/");
    if ((await findEntry(workspace, endpointId, directory))?.kind !== "directory") {
      await workspace.createDirectory(endpointId, directory);
    }
  }
  await workspace.write({ endpointId, path: pathValue, content: "" });
}

export async function openLabFileInWorkspace(
  request: LabFileRequest,
  topology: LabFileTopology,
  workspace: LabFileWorkspace
): Promise<void> {
  const { endpointId } = topology;
  const pathValue = resolveWorkspaceLabFile(request, topology.topologyPath, topology.topologyDir);
  if (pathValue === undefined) {
    workspace.notify(`${request.path} is outside the lab workspace.`, "warning");
    return;
  }
  const title = splitPath(pathValue).name;
  try {
    const entry = await findEntry(workspace, endpointId, pathValue);
    if (entry?.kind === "directory") {
      workspace.notify(`${pathValue} is a folder.`, "info");
      return;
    }
    if (entry) {
      const document = await workspace.read(endpointId, pathValue);
      workspace.openTab({ endpointId, path: pathValue, content: document.content, title });
      return;
    }
    if (request.create !== true) {
      workspace.notify(`${pathValue} does not exist.`, "warning");
      return;
    }
    await createEmptyFile(workspace, endpointId, pathValue);
    workspace.openTab({ endpointId, path: pathValue, content: "", title });
    workspace.notify(`Created ${pathValue}`, "success");
  } catch (error) {
    workspace.notify(error instanceof Error ? error.message : String(error), "error");
  }
}
