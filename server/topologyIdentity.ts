import type { TopologyRef } from "@srl-labs/clab-ui/session";

import type { ClabApiClient, TopologyEntry } from "./clabApiClient.js";

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

export function normalizeStandaloneTopologyRef(topologyRef: TopologyRef): TopologyRef {
  const yamlPath = normalizeTopologyPath(topologyRef.yamlPath);
  const labName = topologyRef.labName.trim();
  const source = topologyRef.source === "vscode" ? "vscode" : "standalone";

  return {
    ...topologyRef,
    topologyId: source === "standalone" ? buildStandaloneTopologyId(yamlPath) : topologyRef.topologyId,
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
  entry: Pick<TopologyEntry, "annotationsFileName" | "hasAnnotations" | "labName" | "yamlFileName">
): TopologyRef {
  return normalizeStandaloneTopologyRef({
    topologyId: buildStandaloneTopologyId(entry.yamlFileName),
    labName: entry.labName,
    yamlPath: normalizeTopologyPath(entry.yamlFileName),
    annotationsPath: entry.hasAnnotations
      ? normalizeTopologyPath(entry.annotationsFileName)
      : undefined,
    source: "standalone"
  });
}

export function buildStandaloneTopologyRefFromPath(pathValue: string, labName?: string): TopologyRef {
  const yamlPath = normalizeTopologyPath(pathValue);
  const resolvedLabName = (labName ?? stripTopologySuffix(safeFilename(yamlPath))).trim();

  return normalizeStandaloneTopologyRef({
    topologyId: buildStandaloneTopologyId(yamlPath),
    labName: resolvedLabName,
    yamlPath,
    annotationsPath: `${yamlPath}.annotations.json`,
    source: "standalone"
  });
}

export async function resolveCanonicalStandaloneTopologyRef(
  client: ClabApiClient,
  token: string,
  topologyRef: TopologyRef
): Promise<TopologyRef> {
  const normalizedRef = normalizeStandaloneTopologyRef(topologyRef);
  const topologies = await client.listTopologies(token);
  const exactMatch = topologies.find(
    (entry) => normalizeTopologyPath(entry.yamlFileName) === normalizedRef.yamlPath
  );

  return exactMatch ? buildStandaloneTopologyRef(exactMatch) : normalizedRef;
}
