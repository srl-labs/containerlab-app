import {
  generateClosTopologyYaml,
  type ClosTopologyRequest,
} from "@containerlab/clab-ui/workspace/state";
import * as YAML from "yaml";

import { createLab, type CreateLabDeps, type CreateLabResult } from "./createLab";
import {
  MAX_CLOS_LINKS,
  MAX_CLOS_NODES,
  MAX_TIER_NODES,
} from "./createClosTopologyInputSchema";

/** The generator's kind for a tier without one. */
const DEFAULT_KIND = "nokia_srlinux";

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

function parseTiers(value: unknown, errors: string[]): ClosTopologyRequest["tiers"] {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('Missing required property "tiers" (at least one tier).');
    return [];
  }
  const tiers: ClosTopologyRequest["tiers"] = [];
  value.forEach((tier: unknown, index) => {
    if (!isRecord(tier)) {
      errors.push(`tiers[${index}] must be an object.`);
      return;
    }
    const count = tier.count;
    if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_TIER_NODES) {
      errors.push(`tiers[${index}].count must be an integer from 1 to ${MAX_TIER_NODES}.`);
      return;
    }
    const kind = optionalString(tier.kind);
    const type = optionalString(tier.type);
    tiers.push({
      count,
      ...(kind !== undefined ? { kind } : {}),
      ...(type !== undefined ? { type } : {}),
    });
  });
  return tiers;
}

/** Every node links to every node of the next tier; cap what the sandbox has to hold. */
function fabricSizeErrors(tiers: ClosTopologyRequest["tiers"]): string[] {
  const nodeCount = tiers.reduce((sum, tier) => sum + tier.count, 0);
  const linkCount = tiers.reduce(
    (sum, tier, index) => sum + tier.count * (tiers[index + 1]?.count ?? 0),
    0,
  );
  return [
    ...(nodeCount > MAX_CLOS_NODES
      ? [`The tiers have ${nodeCount} nodes; the limit is ${MAX_CLOS_NODES}.`]
      : []),
    ...(linkCount > MAX_CLOS_LINKS
      ? [`The tiers need ${linkCount} links; the limit is ${MAX_CLOS_LINKS}.`]
      : []),
  ];
}

function imageErrors(
  tiers: ClosTopologyRequest["tiers"],
  images: Record<string, string>,
): string[] {
  if (Object.keys(images).length === 0) {
    return ['Missing required property "images" (image per node kind).'];
  }
  const kinds = new Set(tiers.map((tier) => tier.kind ?? DEFAULT_KIND));
  return [...kinds]
    .filter((kind) => !Object.hasOwn(images, kind))
    .map((kind) => `images has no entry for kind "${kind}".`);
}

/** Parse a Clos generate request plus optional canvas annotations. */
export function parseCreateClosTopologyInput(input: unknown): {
  request: ClosTopologyRequest | undefined;
  annotations: unknown;
  errors: string[];
} {
  if (!isRecord(input)) {
    return { request: undefined, annotations: undefined, errors: ["Input must be an object."] };
  }

  const errors: string[] = [];
  const name = optionalString(input.name);
  if (name === undefined) errors.push('Missing required property "name".');

  const tiers = parseTiers(input.tiers, errors);
  errors.push(...fabricSizeErrors(tiers));

  const images = stringRecord(input.images) ?? {};
  errors.push(...imageErrors(tiers, images));

  if (errors.length > 0 || name === undefined) {
    return {
      request: undefined,
      annotations: input.annotations,
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
    annotations: input.annotations,
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
