import { createClosTopology } from "./createClosTopology";
import { createClosTopologyInputSchema } from "./createClosTopologyInputSchema";
import { createLab, type CreateLabDeps, type CreateLabResult } from "./createLab";
import { createLabInputSchema } from "./createLabInputSchema";
import { type ModelContext } from "./modelContext";

let registrationAbort: AbortController | null = null;

export type RegisterCreateLabToolOptions = CreateLabDeps & {
  modelContext?: ModelContext;
};

const REPLACES =
  "A lab with the same name replaces {name}.clab.yml and its annotations; if any step fails, the previous files are kept.";

function toolResult(result: CreateLabResult) {
  if (!result.ok) {
    return { error: result.errors.join("; ") };
  }
  return {
    fileName: result.fileName,
    topologyRef: result.topologyRef,
    autoLayout: result.autoLayout,
    replaced: result.replaced,
  };
}

/**
 * Register the sandbox WebMCP tools when the document exposes modelContext.
 * Each tool registers on its own; returns the error of each tool that failed.
 */
export async function registerCreateLabTool(
  options: RegisterCreateLabToolOptions,
): Promise<Error[]> {
  const modelContext = options.modelContext ?? document.modelContext;
  if (!modelContext) {
    return [];
  }

  registrationAbort?.abort();
  registrationAbort = new AbortController();
  const { signal } = registrationAbort;
  const annotations = { readOnlyHint: false, destructiveHint: true };

  const results = await Promise.allSettled([
    modelContext.registerTool(
      {
        name: "create_lab",
        description: `Create a containerlab topology from a topology document and open it. ${REPLACES}`,
        inputSchema: createLabInputSchema,
        annotations,
        async execute(input) {
          return toolResult(await createLab(input, options));
        },
      },
      { signal },
    ),
    modelContext.registerTool(
      {
        name: "create_clos_topology",
        description: `Generate a Clos leaf–spine topology (every node links to every node of the next tier) and open it. ${REPLACES}`,
        inputSchema: createClosTopologyInputSchema,
        annotations,
        async execute(input) {
          return toolResult(await createClosTopology(input, options));
        },
      },
      { signal },
    ),
  ]);
  return results.flatMap((result) =>
    result.status === "rejected"
      ? [result.reason instanceof Error ? result.reason : new Error(String(result.reason))]
      : [],
  );
}
