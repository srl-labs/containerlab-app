/**
 * Login credentials of a node (`credentials`), resolved the way containerlab does.
 * Pure functions - no VS Code dependencies.
 */

import YAML from "yaml";

import type { ClabNode, ClabTopology } from "../types/topology";
import { isRecord } from "../utilities/typeHelpers";

/** Node data key with the credentials a node falls back to when it sets none */
export const INHERITED_CREDENTIALS_KEY = "inheritedCredentials";

/** Topology level a credential value comes from */
export type CredentialsLevel = "node" | "group" | "kind" | "defaults";

/** A `credentials` map as written in the topology */
export interface NodeCredentials {
  username?: string;
  password?: string;
  identityFile?: string;
}

/**
 * Credentials a node ends up with from the topology. Username and password
 * come together from the most specific level that sets either of them; they
 * are not merged across levels. The identity file has its own precedence.
 */
export interface ResolvedNodeCredentials {
  username?: string;
  password?: string;
  /** Level that supplied username and password */
  source?: CredentialsLevel;
  identityFile?: string;
  identityFileSource?: CredentialsLevel;
}

/** Read a scalar credential value; YAML may hand over a number or boolean password. */
function readScalar(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

/** Read the `credentials` map of a node, kind, group or defaults section */
export function readNodeCredentials(value: unknown): NodeCredentials | undefined {
  if (!isRecord(value)) return undefined;
  const credentials: NodeCredentials = {};
  const username = readScalar(value.username);
  if (username !== undefined) credentials.username = username;
  const password = readScalar(value.password);
  if (password !== undefined) credentials.password = password;
  const identityFile = readScalar(value["identity-file"]);
  if (identityFile !== undefined) credentials.identityFile = identityFile;
  return credentials;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/** Kind section by name; kind names are case-insensitive, an exact match wins */
function findKind(kinds: Record<string, ClabNode> | undefined, kind: string | undefined) {
  if (!kinds || kind === undefined) return undefined;
  if (kind in kinds) return kinds[kind];
  const lower = kind.toLowerCase();
  const name = Object.keys(kinds)
    .sort()
    .find((entry) => entry.toLowerCase() === lower);
  return name !== undefined ? kinds[name] : undefined;
}

function findGroup(groups: Record<string, ClabNode> | undefined, group: string | undefined) {
  if (!groups || group === undefined) return undefined;
  return groups[group];
}

/** Sections a node inherits from, most specific first (containerlab's lookup order) */
function inheritedSections(
  parsed: ClabTopology,
  node: ClabNode
): Array<[CredentialsLevel, ClabNode | undefined]> {
  const { defaults = {}, groups, kinds } = parsed.topology ?? {};
  const kind =
    textOf(node.kind) ??
    textOf(findGroup(groups, textOf(node.group))?.kind) ??
    textOf(findGroup(groups, textOf(defaults.group))?.kind) ??
    textOf(defaults.kind);
  const kindSection = findKind(kinds, kind);
  const group = textOf(node.group) ?? textOf(kindSection?.group) ?? textOf(defaults.group);
  return [
    ["group", findGroup(groups, group)],
    ["kind", kindSection],
    ["defaults", defaults]
  ];
}

/**
 * Resolve the credentials of a node. With `inheritedOnly` the node's own
 * `credentials` are ignored, which gives what the node falls back to.
 */
export function resolveNodeCredentials(
  parsed: ClabTopology,
  node: ClabNode,
  options: { inheritedOnly?: boolean } = {}
): ResolvedNodeCredentials {
  const sections: Array<[CredentialsLevel, ClabNode | undefined]> = [
    ...(options.inheritedOnly === true ? [] : [["node", node] as [CredentialsLevel, ClabNode]]),
    ...inheritedSections(parsed, node)
  ];
  const resolved: ResolvedNodeCredentials = {};
  for (const [level, section] of sections) {
    const credentials = readNodeCredentials(section?.credentials);
    if (!credentials) continue;
    const hasLogin = credentials.username !== undefined || credentials.password !== undefined;
    if (resolved.source === undefined && hasLogin) {
      if (credentials.username !== undefined) resolved.username = credentials.username;
      if (credentials.password !== undefined) resolved.password = credentials.password;
      resolved.source = level;
    }
    if (resolved.identityFileSource === undefined && credentials.identityFile !== undefined) {
      resolved.identityFile = credentials.identityFile;
      resolved.identityFileSource = level;
    }
  }
  return resolved;
}

/**
 * Resolve the credentials of a node from topology YAML. Returns an empty
 * result when the YAML cannot be read or has no such node.
 */
export function resolveNodeCredentialsFromYaml(
  yamlContent: string,
  nodeName: string
): ResolvedNodeCredentials {
  let parsed: unknown;
  try {
    parsed = YAML.parse(yamlContent);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const topology = parsed as ClabTopology;
  const node = topology.topology?.nodes?.[nodeName];
  if (!isRecord(node)) return {};
  return resolveNodeCredentials(topology, node);
}
