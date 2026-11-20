import {
  generateClosTopologyYaml,
  type ClosTopologyRequest,
} from "@containerlab/clab-ui/workspace/state";
import * as YAML from "yaml";

import { createLab, type CreateLabDeps, type CreateLabResult } from "./createLab";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).flatMap(([key, entry]) =>
    typeof entry === "string" && entry.trim() ? [[key, entry.trim()] as const] : [],
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Parse a Clos generate request plus optional canvas annotations. */
export function parseCreateClosTopologyInput(input: unknown): {
  request: ClosTopologyRequest | undefined;
  annotations: Record<string, unknown> | undefined;
  errors: string[];
} {
  if (!isRecord(input)) {
    return { request: undefined, annotations: undefined, errors: ["Input must be an object."] };
  }

  const errors: string[] = [];
  const name = optionalString(input.name);
  if (!name) errors.push('Missing required property "name".');

  if (!Array.isArray(input.tiers) || input.tiers.length === 0) {
    errors.push('Missing required property "tiers" (at least one tier).');
  }

  const tiers: ClosTopologyRequest["tiers"] = [];
  if (Array.isArray(input.tiers)) {
    input.tiers.forEach((tier, index) => {
      if (!isRecord(tier)) {
        errors.push(`tiers[${index}] must be an object.`);
        return;
      }
      const count = tier.count;
      if (!Number.isInteger(count) || (count as number) < 1) {
        errors.push(`tiers[${index}].count must be an integer >= 1.`);
        return;
      }
      const kind = optionalString(tier.kind);
      const type = optionalString(tier.type);
      tiers.push({
        count: count as number,
        ...(kind ? { kind } : {}),
        ...(type ? { type } : {}),
      });
    });
  }

  const images = stringRecord(input.images) ?? {};
  if (Object.keys(images).length === 0) {
    errors.push('Missing required property "images" (image per node kind).');
  }

  if (errors.length > 0 || !name) {
    return {
      request: undefined,
      annotations: isRecord(input.annotations) ? input.annotations : undefined,
      errors,
    };
  }

  const licenses = stringRecord(input.licenses);
  const request: ClosTopologyRequest = {
    name,
    tiers,
    images,
    ...(licenses ? { licenses } : {}),
  };
  const nodePrefix = optionalString(input.nodePrefix);
  const groupPrefix = optionalString(input.groupPrefix);
  const managementNetwork = optionalString(input.managementNetwork);
  const ipv4Subnet = optionalString(input.ipv4Subnet);
  const ipv6Subnet = optionalString(input.ipv6Subnet);
  if (nodePrefix) request.nodePrefix = nodePrefix;
  if (groupPrefix) request.groupPrefix = groupPrefix;
  if (managementNetwork) request.managementNetwork = managementNetwork;
  if (ipv4Subnet) request.ipv4Subnet = ipv4Subnet;
  if (ipv6Subnet) request.ipv6Subnet = ipv6Subnet;

  return {
    request,
    annotations: isRecord(input.annotations) ? input.annotations : undefined,
    errors: [],
  };
}

/**
 * Generate a Clos fabric (every node linked to every node of the next tier),
 * write it as a `.clab.yml`, and open it. Omit annotations to auto-layout.
 */
export async function createClosTopology(
  input: unknown,
  deps: CreateLabDeps,
): Promise<CreateLabResult> {
  const { request, annotations, errors } = parseCreateClosTopologyInput(input);
  if (!request) {
    return { ok: false, errors };
  }

  let yaml: string;
  try {
    yaml = generateClosTopologyYaml(request);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
    };
  }

  const topology = YAML.parse(yaml);
  return createLab(
    annotations !== undefined ? { topology, annotations } : { topology },
    deps,
  );
}
