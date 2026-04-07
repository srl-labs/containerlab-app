import type { TopologyRef } from "@srl-labs/clab-ui/session";

import type { ClabApiClient, TopologyEntry } from "./clabApiClient.js";

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

  return {
    ...topologyRef,
    topologyId:
      source === "standalone"
        ? resolvedEndpointId
          ? buildEndpointScopedTopologyId(yamlPath, resolvedEndpointId)
          : buildStandaloneTopologyId(yamlPath)
        : topologyRef.topologyId,
    labName,
    yamlPath,
    annotationsPath: topologyRef.annotationsPath
      ? normalizeTopologyPath(topologyRef.annotationsPath)
      : source === "standalone"
        ? `${yamlPath}.annotations.json`
        : topologyRef.annotationsPath,
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
