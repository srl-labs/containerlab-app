import { validateContainerlabTopology } from "@containerlab/clab-ui/workspace/yaml";
import type { TopologyRef } from "@containerlab/clab-ui/session";
import * as YAML from "yaml";

import { validateAnnotations } from "./annotationsInputSchema";
import { saveLabFiles, type LabFileStore } from "./saveLabFiles";

export type CreateLabDeps = {
  files: LabFileStore;
  openTopology?: (topologyRef: TopologyRef) => Promise<void>;
};

export type CreateLabResult =
  | {
      ok: true;
      fileName: string;
      topologyRef: TopologyRef;
      autoLayout: boolean;
      replaced: boolean;
    }
  | { ok: false; errors: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Pull topology + optional annotations from the tool argument. */
export function parseCreateLabInput(input: unknown): {
  topology: unknown;
  annotations: unknown;
} {
  if (!isRecord(input)) {
    return { topology: input, annotations: undefined };
  }
  if ("topology" in input && isRecord(input.topology)) {
    const topologyValue = input.topology;
    // Wrapper form: { topology, annotations? }. A Containerlab document also has
    // a nested topology object, but that document also has required `name`.
    if (typeof input.name !== "string") {
      return { topology: topologyValue, annotations: input.annotations };
    }
  }
  return { topology: input, annotations: undefined };
}

function topologyErrors(topology: unknown): string[] {
  const validation = validateContainerlabTopology(topology);
  if (!validation.valid) {
    return validation.errors.map((error) =>
      error.instancePath ? `${error.instancePath}: ${error.message}` : error.message,
    );
  }
  if (!isRecord(topology) || typeof topology.name !== "string") {
    return ['Missing required property "name"'];
  }
  return [];
}

/**
 * Validate a topology document and its annotations, write them as
 * `{name}.clab.yml` (replacing a file of that name) and open the lab. When a
 * step fails, the previous files are restored.
 */
export async function createLab(
  input: unknown,
  deps: CreateLabDeps,
): Promise<CreateLabResult> {
  const { topology, annotations } = parseCreateLabInput(input);
  const errors = [
    ...topologyErrors(topology),
    ...(annotations !== undefined ? validateAnnotations(annotations) : []),
  ];
  if (errors.length > 0 || !isRecord(topology)) {
    return { ok: false, errors };
  }

  const fileName = `${String(topology.name)}.clab.yml`;
  try {
    const { topologyRef, replaced } = await saveLabFiles(
      {
        fileName,
        yaml: YAML.stringify(topology),
        ...(annotations !== undefined
          ? { annotations: `${JSON.stringify(annotations, null, 2)}\n` }
          : {}),
      },
      deps.files,
      deps.openTopology,
    );
    return { ok: true, fileName, topologyRef, autoLayout: annotations === undefined, replaced };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }
}
