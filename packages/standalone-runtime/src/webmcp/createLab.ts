import { validateContainerlabTopology } from "@containerlab/clab-ui/workspace/yaml";
import type { TopologyRef } from "@containerlab/clab-ui/session";
import * as YAML from "yaml";

export type CreateLabDeps = {
  writeTopologyFile: (
    fileName: string,
    content: string,
  ) => Promise<{ topologyRef: TopologyRef }>;
  writeAnnotationsFile?: (
    annotationsPath: string,
    content: string,
  ) => Promise<void>;
  openTopology?: (topologyRef: TopologyRef) => Promise<void>;
};

export type CreateLabResult =
  | { ok: true; fileName: string; topologyRef: TopologyRef; autoLayout: boolean }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function annotationsPathFor(yamlPath: string): string {
  return `${yamlPath}.annotations.json`;
}

/** Pull topology + optional annotations from the tool argument. */
export function parseCreateLabInput(input: unknown): {
  topology: unknown;
  annotations: Record<string, unknown> | undefined;
} {
  if (!isRecord(input)) {
    return { topology: input, annotations: undefined };
  }
  if ("topology" in input && isRecord(input.topology)) {
    const topologyValue = input.topology;
    // Wrapper form: { topology, annotations? }. A Containerlab document also has
    // a nested topology object, but that document also has required `name`.
    if (typeof input.name !== "string") {
      const annotations = isRecord(input.annotations) ? input.annotations : undefined;
      return { topology: topologyValue, annotations };
    }
  }
  return { topology: input, annotations: undefined };
}

/** Validate a topology document and write it as a `.clab.yml` file. */
export async function createLab(
  input: unknown,
  deps: CreateLabDeps,
): Promise<CreateLabResult> {
  const { topology, annotations } = parseCreateLabInput(input);
  const validation = validateContainerlabTopology(topology);
  if (!validation.valid) {
    return {
      ok: false,
      errors: validation.errors.map((error) =>
        error.instancePath ? `${error.instancePath}: ${error.message}` : error.message,
      ),
    };
  }

  if (!isRecord(topology) || typeof topology.name !== "string") {
    return { ok: false, errors: ['Missing required property "name"'] };
  }

  const fileName = `${topology.name}.clab.yml`;
  const content = YAML.stringify(topology);
  const autoLayout = annotations === undefined;
  try {
    const { topologyRef } = await deps.writeTopologyFile(fileName, content);
    if (annotations !== undefined) {
      if (!deps.writeAnnotationsFile) {
        return { ok: false, errors: ["Annotations writing is unavailable."] };
      }
      const path =
        topologyRef.annotationsPath ?? annotationsPathFor(topologyRef.yamlPath);
      await deps.writeAnnotationsFile(path, `${JSON.stringify(annotations, null, 2)}\n`);
    }
    if (deps.openTopology) {
      await deps.openTopology(topologyRef);
    }
    return { ok: true, fileName, topologyRef, autoLayout };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
