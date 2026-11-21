import type { TopologyRef } from "@containerlab/clab-ui/session";

/** File operations the WebMCP tools use on the sandbox. */
export type LabFileStore = {
  /** The topology file at this path, or undefined when there is none. */
  findTopologyFile: (
    fileName: string,
  ) => Promise<{ topologyRef: TopologyRef; hasAnnotations: boolean } | undefined>;
  /** Create a topology file; fails when the file already exists. */
  createTopologyFile: (fileName: string, content: string) => Promise<TopologyRef>;
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
};

export type LabFiles = {
  fileName: string;
  yaml: string;
  /** Annotations JSON. Without it, old annotations are removed so the lab auto-lays out. */
  annotations?: string;
};

function annotationsPathOf(topologyRef: TopologyRef): string {
  return topologyRef.annotationsPath ?? `${topologyRef.yamlPath}.annotations.json`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Write a lab's YAML and annotations, replacing a file of the same name, then
 * run `afterWrite`. If any step fails, the previous files are put back.
 */
export async function saveLabFiles(
  files: LabFiles,
  store: LabFileStore,
  afterWrite?: (topologyRef: TopologyRef) => Promise<void>,
): Promise<{ topologyRef: TopologyRef; replaced: boolean }> {
  const existing = await store.findTopologyFile(files.fileName);
  const previousYaml = existing
    ? await store.readFile(existing.topologyRef.yamlPath)
    : undefined;
  const previousAnnotations = existing?.hasAnnotations === true
    ? await store.readFile(annotationsPathOf(existing.topologyRef))
    : undefined;

  const undo: Array<() => Promise<void>> = [];
  try {
    let topologyRef: TopologyRef;
    if (existing && previousYaml !== undefined) {
      topologyRef = existing.topologyRef;
      await store.writeFile(topologyRef.yamlPath, files.yaml);
      undo.push(() => store.writeFile(topologyRef.yamlPath, previousYaml));
    } else {
      topologyRef = await store.createTopologyFile(files.fileName, files.yaml);
      undo.push(() => store.deleteFile(topologyRef.yamlPath));
    }

    const annotationsPath = annotationsPathOf(topologyRef);
    if (files.annotations !== undefined) {
      await store.writeFile(annotationsPath, files.annotations);
      undo.push(() =>
        previousAnnotations !== undefined
          ? store.writeFile(annotationsPath, previousAnnotations)
          : store.deleteFile(annotationsPath),
      );
    } else if (previousAnnotations !== undefined) {
      await store.deleteFile(annotationsPath);
      undo.push(() => store.writeFile(annotationsPath, previousAnnotations));
    }

    await afterWrite?.(topologyRef);
    return { topologyRef, replaced: existing !== undefined };
  } catch (error) {
    const restoreErrors: string[] = [];
    for (const step of undo.reverse()) {
      try {
        await step();
      } catch (restoreError) {
        restoreErrors.push(messageOf(restoreError));
      }
    }
    if (restoreErrors.length > 0) {
      throw new Error(
        `${messageOf(error)} Restoring the previous files also failed: ${restoreErrors.join("; ")}`,
      );
    }
    throw error;
  }
}
