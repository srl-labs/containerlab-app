import type { ContainerState, LabState, RuntimeTargetRequest } from "../types";
import { findLabStateForTopology } from "./documentUtils";

function scoreNodeMatch(
  labName: string,
  container: ContainerState,
  requestedNodeName: string
): number {
  const normalizedRequested = requestedNodeName.trim().toLowerCase();
  if (!normalizedRequested) {
    return 0;
  }
  const normalizedContainerName = container.name.trim().toLowerCase();
  if (normalizedContainerName === normalizedRequested) {
    return 100;
  }

  const normalizedNodeName = container.nodeName.trim().toLowerCase();
  if (normalizedNodeName === normalizedRequested) {
    return 90;
  }
  if (normalizedNodeName.startsWith(`${normalizedRequested}-`)) {
    return 80;
  }

  const shortName = normalizedContainerName.startsWith(`clab-${labName.toLowerCase()}-`)
    ? normalizedContainerName.slice(`clab-${labName.toLowerCase()}-`.length)
    : normalizedContainerName;
  if (shortName === normalizedRequested) {
    return 70;
  }
  if (shortName.startsWith(`${normalizedRequested}-`)) {
    return 60;
  }

  return 0;
}

export function findRuntimeContainer(
  labs: Map<string, LabState>,
  input: {
    endpointId?: string;
    nodeName: string;
    topologyRef?: RuntimeTargetRequest["topologyRef"];
  }
): ContainerState | undefined {
  const topologyHint = input.topologyRef?.yamlPath
    ? {
        topologyId: input.topologyRef.topologyId,
        absoluteYamlPath: input.topologyRef.absoluteYamlPath,
        yamlPath: input.topologyRef.yamlPath,
        labName: input.topologyRef.labName,
        endpointId: input.endpointId
      }
    : undefined;
  const lab = findLabStateForTopology(topologyHint, labs);
  let candidateLabs = lab ? [lab] : [...labs.values()];
  if (!lab && topologyHint?.absoluteYamlPath) candidateLabs = [];

  let bestContainer: ContainerState | undefined;
  let bestScore = 0;
  for (const candidateLab of candidateLabs) {
    for (const container of candidateLab.containers.values()) {
      const score = scoreNodeMatch(candidateLab.name, container, input.nodeName);
      if (score > bestScore) {
        bestContainer = container;
        bestScore = score;
      }
    }
  }

  return bestScore > 0 ? bestContainer : undefined;
}
