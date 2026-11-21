type ModelContextTool = {
  name: string;
  description: string;
  inputSchema?: object;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  execute: (input: unknown) => unknown | Promise<unknown>;
};

export type ModelContext = {
  registerTool: (
    tool: ModelContextTool,
    options?: { signal?: AbortSignal },
  ) => Promise<void>;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
}

export function isWebMcpAvailable(doc: Document = document): boolean {
  return doc.modelContext !== undefined;
}
