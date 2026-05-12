import type { TopologyRef } from "@srl-labs/clab-ui/session";

import type {
  ClabApiClient,
  InspectAllLabsResponse,
  InspectContainerInfo,
  TopologyEntry
} from "./clabApiClient.ts";

const ENDPOINT_TOPOLOGY_ID_SEPARATOR = "::";

export function normalizeTopologyPath(pathValue: string): string {
  return pathValue.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function stripTopologySuffix(name: string): string {
  return name.replace(/\.clab\.(ya?ml)$/i, "");
}

function safeFilename(pathValue: string): string {
  const segments = pathValue.split("/").filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : pathValue;
}

function hasPathBoundarySuffix(pathValue: string, suffix: string): boolean {
  if (pathValue === suffix) {
    return true;
  }
  if (!pathValue.endsWith(suffix)) {
    return false;
  }
  const boundaryIndex = pathValue.length - suffix.length - 1;
  return boundaryIndex >= 0 && pathValue[boundaryIndex] === "/";
}

function runtimeContainerString(
  container: InspectContainerInfo,
  ...keys: string[]
): string | undefined {
  const record = container as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return undefined;
}

export function topologyPathsLikelyMatch(leftPath: string, rightPath: string): boolean {
  const left = normalizeTopologyPath(leftPath).toLowerCase();
  const right = normalizeTopologyPath(rightPath).toLowerCase();
  if (!left || !right) {
    return false;
  }
  return hasPathBoundarySuffix(left, right) || hasPathBoundarySuffix(right, left);
}

function runtimeLabName(labName: string, containers: InspectContainerInfo[]): string {
  return runtimeContainerString(containers[0], "labName", "lab_name") ?? labName;
}

function runtimeLabMatchesTopologyPath(
  containers: InspectContainerInfo[],
  normalizedPath: string
): boolean {
  return containers.some((container) => {
    const labPath = runtimeContainerString(container, "absLabPath", "abs_lab_path", "labPath", "lab_path");
    return labPath ? topologyPathsLikelyMatch(labPath, normalizedPath) : false;
  });
}

export function findRunningLabNameForTopology(
  labs: InspectAllLabsResponse,
  topologyRef: Pick<TopologyRef, "labName" | "yamlPath">
): string | undefined {
  const normalizedPath = normalizeTopologyPath(topologyRef.yamlPath);
  const normalizedLabName = topologyRef.labName.trim().toLowerCase();
  const entries = Object.entries(labs);

  if (normalizedPath) {
    const pathMatches = entries.filter(([, containers]) =>
      runtimeLabMatchesTopologyPath(containers, normalizedPath)
    );
    if (pathMatches.length === 1) {
      return runtimeLabName(pathMatches[0][0], pathMatches[0][1]);
    }
    if (pathMatches.length > 1 && normalizedLabName) {
      const namedPathMatches = pathMatches.filter(([labName, containers]) => {
        const actualLabName = runtimeLabName(labName, containers).toLowerCase();
        return actualLabName === normalizedLabName || labName.trim().toLowerCase() === normalizedLabName;
      });
      if (namedPathMatches.length === 1) {
        return runtimeLabName(namedPathMatches[0][0], namedPathMatches[0][1]);
      }
    }
  }

  if (!normalizedLabName) {
    return undefined;
  }

  const namedMatches = entries.filter(([labName, containers]) => {
    const actualLabName = runtimeLabName(labName, containers).toLowerCase();
    return actualLabName === normalizedLabName || labName.trim().toLowerCase() === normalizedLabName;
  });
  return namedMatches.length === 1
    ? runtimeLabName(namedMatches[0][0], namedMatches[0][1])
    : undefined;
}

export async function resolveRunningLabNameForTopology(
  client: ClabApiClient,
  token: string,
  topologyRef: Pick<TopologyRef, "labName" | "yamlPath">,
  fallbackLabName: string
): Promise<string> {
  try {
    const runningLabName = findRunningLabNameForTopology(await client.listLabs(token), topologyRef);
    return runningLabName ?? fallbackLabName;
  } catch {
    return fallbackLabName;
  }
}

export function buildStandaloneTopologyId(yamlPath: string): string {
  return `standalone:${normalizeTopologyPath(yamlPath)}`;
}

export function extractEndpointIdFromTopologyId(topologyId: string | undefined): string | undefined {
  if (typeof topologyId !== "string" || !topologyId.startsWith("standalone:")) {
    return undefined;
  }

  const raw = topologyId.slice("standalone:".length);
  const separatorIndex = raw.indexOf(ENDPOINT_TOPOLOGY_ID_SEPARATOR);
  if (separatorIndex <= 0) {
    return undefined;
  }

  const endpointId = raw.slice(0, separatorIndex).trim();
  return endpointId.length > 0 ? endpointId : undefined;
}

export function buildEndpointScopedTopologyId(yamlPath: string, endpointId: string): string {
  return `standalone:${endpointId}${ENDPOINT_TOPOLOGY_ID_SEPARATOR}${normalizeTopologyPath(yamlPath)}`;
}

export function normalizeStandaloneTopologyRef(
  topologyRef: TopologyRef,
  endpointId?: string
): TopologyRef {
  const yamlPath = normalizeTopologyPath(topologyRef.yamlPath);
  const labName = topologyRef.labName.trim();
  const source = topologyRef.source === "vscode" ? "vscode" : "standalone";
  const resolvedEndpointId = endpointId ?? extractEndpointIdFromTopologyId(topologyRef.topologyId);
  let topologyId = topologyRef.topologyId;
  if (source === "standalone") {
    topologyId = resolvedEndpointId
      ? buildEndpointScopedTopologyId(yamlPath, resolvedEndpointId)
      : buildStandaloneTopologyId(yamlPath);
  }

  let annotationsPath = topologyRef.annotationsPath;
  if (annotationsPath) {
    annotationsPath = normalizeTopologyPath(annotationsPath);
  } else if (source === "standalone") {
    annotationsPath = `${yamlPath}.annotations.json`;
  }

  return {
    ...topologyRef,
    topologyId,
    labName,
    yamlPath,
    annotationsPath,
    source
  };
}

export function buildStandaloneTopologyRef(
  entry: Pick<TopologyEntry, "annotationsFileName" | "hasAnnotations" | "labName" | "yamlFileName">,
  endpointId?: string
): TopologyRef {
  return normalizeStandaloneTopologyRef({
    topologyId: endpointId
      ? buildEndpointScopedTopologyId(entry.yamlFileName, endpointId)
      : buildStandaloneTopologyId(entry.yamlFileName),
    labName: entry.labName,
    yamlPath: normalizeTopologyPath(entry.yamlFileName),
    annotationsPath: entry.hasAnnotations
      ? normalizeTopologyPath(entry.annotationsFileName)
      : undefined,
    source: "standalone"
  }, endpointId);
}

export function buildStandaloneTopologyRefFromPath(
  pathValue: string,
  labName?: string,
  endpointId?: string
): TopologyRef {
  const yamlPath = normalizeTopologyPath(pathValue);
  const resolvedLabName = (labName ?? stripTopologySuffix(safeFilename(yamlPath))).trim();

  return normalizeStandaloneTopologyRef({
    topologyId: endpointId
      ? buildEndpointScopedTopologyId(yamlPath, endpointId)
      : buildStandaloneTopologyId(yamlPath),
    labName: resolvedLabName,
    yamlPath,
    annotationsPath: `${yamlPath}.annotations.json`,
    source: "standalone"
  }, endpointId);
}

export async function resolveCanonicalStandaloneTopologyRef(
  client: ClabApiClient,
  token: string,
  topologyRef: TopologyRef,
  endpointId?: string
): Promise<TopologyRef> {
  const normalizedRef = normalizeStandaloneTopologyRef(topologyRef, endpointId);
  const topologies = await client.listTopologies(token);
  const exactMatch = topologies.find(
    (entry) => normalizeTopologyPath(entry.yamlFileName) === normalizedRef.yamlPath
  );

  return exactMatch ? buildStandaloneTopologyRef(exactMatch, endpointId) : normalizedRef;
}
