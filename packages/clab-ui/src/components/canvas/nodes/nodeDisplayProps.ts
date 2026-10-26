// What the info panel and the hover card show about a topology node.
import { getRecordUnknown, getString } from "../../../core/utilities/typeHelpers";
import type { NodeData } from "../../../hooks/ui";

function getNodeProperty(
  extraData: Record<string, unknown> | undefined,
  nodeData: NodeData,
  extraKey: string,
  topLevelKey: keyof NodeData
): string {
  const fromExtra = getString(extraData?.[extraKey]);
  if (fromExtra !== undefined && fromExtra.length > 0) return fromExtra;

  const fromTopLevel = getString(nodeData[topLevelKey]);
  if (fromTopLevel !== undefined && fromTopLevel.length > 0) return fromTopLevel;

  return "";
}

export function extractNodeDisplayProps(nodeData: NodeData) {
  const extraData = getRecordUnknown(nodeData.extraData);
  const label = getString(nodeData.label);
  const name = getString(nodeData.name);
  const nodeId = nodeData.id;
  let nodeName = "Unknown";
  if (label !== undefined && label.length > 0) {
    nodeName = label;
  } else if (name !== undefined && name.length > 0) {
    nodeName = name;
  } else if (nodeId.length > 0) {
    nodeName = nodeId;
  }

  return {
    nodeName,
    kind: getNodeProperty(extraData, nodeData, "kind", "kind"),
    state: getNodeProperty(extraData, nodeData, "state", "state"),
    image: getNodeProperty(extraData, nodeData, "image", "image"),
    mgmtIpv4: getNodeProperty(extraData, nodeData, "mgmtIpv4Address", "mgmtIpv4"),
    mgmtIpv6: getNodeProperty(extraData, nodeData, "mgmtIpv6Address", "mgmtIpv6"),
    fqdn: getNodeProperty(extraData, nodeData, "fqdn", "fqdn"),
    containerName: getString(extraData?.longname)
  };
}
