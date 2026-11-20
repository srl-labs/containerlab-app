import type { TopologyRef } from "@containerlab/clab-ui/session";

export function isTopologyFileExistsError(error: unknown): boolean {
  return error instanceof Error && / already exists$/.test(error.message);
}

function replacementRef(fileName: string): TopologyRef {
  const labName = fileName.replace(/\.clab\.ya?ml$/i, "");
  return {
    topologyId: `standalone:pages-sandbox::${fileName}`,
    labName,
    yamlPath: fileName,
    annotationsPath: `${fileName}.annotations.json`,
    source: "standalone",
  };
}

/** Create the topology file, replacing it when that name is already in the sandbox. */
export async function writeTopologyFileReplacing(
  fileName: string,
  content: string,
  deps: {
    createTopologyFile: (input: {
      fileName: string;
      content: string;
    }) => Promise<{ topologyRef: TopologyRef }>;
    deleteTopologyFile: (target: { topologyRef: TopologyRef }) => Promise<unknown>;
  },
): Promise<{ topologyRef: TopologyRef }> {
  try {
    return await deps.createTopologyFile({ fileName, content });
  } catch (error) {
    if (!isTopologyFileExistsError(error)) {
      throw error;
    }
  }
  await deps.deleteTopologyFile({ topologyRef: replacementRef(fileName) });
  return await deps.createTopologyFile({ fileName, content });
}
