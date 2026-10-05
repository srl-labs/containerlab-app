import type { ClabLabTreeNode } from "../../../treeView/common";
import { flattenContainers } from "../../../treeView/common";
import {
  normalizeRuntimeContainer,
  sortRuntimeContainers,
  type HostRuntimeContainer
} from "@containerlab/clab-ui/host";

function treeItemLabelText(label: unknown): string | undefined {
  if (typeof label === "string") {
    return label;
  }
  if (label !== null && typeof label === "object" && "label" in label) {
    const value = (label as { label?: unknown }).label;
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}

export function labsToRuntimeContainers(
  labs: Record<string, ClabLabTreeNode> | undefined
): HostRuntimeContainer[] {
  if (!labs) {
    return [];
  }

  const containers: HostRuntimeContainer[] = [];
  for (const lab of Object.values(labs)) {
    const labName = lab.name ?? "";
    for (const container of flattenContainers(lab.containers)) {
      containers.push(
        normalizeRuntimeContainer({
          name: container.name,
          nodeName: container.rootNodeName ?? container.name_short,
          labName,
          state: container.state,
          kind: container.kind,
          image: container.image,
          ipv4Address: container.IPv4Address,
          ipv6Address: container.IPv6Address,
          interfaces: container.interfaces.map((iface) => ({
            ...iface,
            label: treeItemLabelText(iface.label)
          }))
        })
      );
    }
  }

  return sortRuntimeContainers(containers);
}
