import { createClosTopology } from "./createClosTopology";
import { createClosTopologyInputSchema } from "./createClosTopologyInputSchema";
import { createLab, type CreateLabDeps } from "./createLab";
import { createLabInputSchema } from "./createLabInputSchema";
import { type ModelContext } from "./modelContext";

export { isWebMcpAvailable } from "./modelContext";

let registrationAbort: AbortController | null = null;

export type RegisterCreateLabToolOptions = CreateLabDeps & {
  modelContext?: ModelContext;
  enabled?: boolean;
};

/** Register sandbox WebMCP tools when the document exposes modelContext. */
export async function registerCreateLabTool(
  options: RegisterCreateLabToolOptions,
): Promise<void> {
  if (options.enabled === false) {
    return;
  }

  const modelContext = options.modelContext ?? document.modelContext;
  if (!modelContext) {
    return;
  }

  registrationAbort?.abort();
  registrationAbort = new AbortController();
  const { signal } = registrationAbort;

  await modelContext.registerTool(
    {
      name: "create_lab",
      description: "Create a containerlab topology.",
      inputSchema: createLabInputSchema,
      annotations: { readOnlyHint: false },
      async execute(input) {
        const result = await createLab(input, options);
        if (!result.ok) {
          return { error: result.errors.join("; ") };
        }
        return {
          fileName: result.fileName,
          topologyRef: result.topologyRef,
          autoLayout: result.autoLayout,
        };
      },
    },
    { signal },
  );

  await modelContext.registerTool(
    {
      name: "create_clos_topology",
      description:
        "Generate a Clos leaf–spine topology (every node links to every node of the next tier) and open it.",
      inputSchema: createClosTopologyInputSchema,
      annotations: { readOnlyHint: false },
      async execute(input) {
        const result = await createClosTopology(input, options);
        if (!result.ok) {
          return { error: result.errors.join("; ") };
        }
        return {
          fileName: result.fileName,
          topologyRef: result.topologyRef,
          autoLayout: result.autoLayout,
        };
      },
    },
    { signal },
  );
}

export function unregisterCreateLabTool(): void {
  registrationAbort?.abort();
  registrationAbort = null;
}
