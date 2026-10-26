// Node info view with read-only fields.
import React from "react";
import Box from "@mui/material/Box";

import type { NodeData } from "../../../../hooks/ui";
import { PanelSection, ReadOnlyCopyField } from "../../../ui/form";
import {
  nodePendingPlaceholder,
  nodeReadinessLabel,
  useNodeReadiness
} from "../../../canvas/nodes/useNodeReadiness";
import { extractNodeDisplayProps } from "../../../canvas/nodes/nodeDisplayProps";
import { NodeResourcesSection } from "./NodeResourcesSection";

export interface NodeInfoViewProps {
  nodeData: NodeData | null;
}

export const NodeInfoView: React.FC<NodeInfoViewProps> = ({ nodeData }) => {
  const readiness = useNodeReadiness(nodeData?.id ?? "", nodeData);
  const pending = nodePendingPlaceholder(readiness);
  if (!nodeData) return null;

  const { nodeName, kind, state, image, mgmtIpv4, mgmtIpv6, fqdn, containerName } =
    extractNodeDisplayProps(nodeData);

  return (
    <Box sx={{ display: "flex", flexDirection: "column" }}>
      <PanelSection title="Node">
        <ReadOnlyCopyField label="Name" value={nodeName} />
      </PanelSection>

      <PanelSection title="Properties">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <ReadOnlyCopyField label="Kind" value={kind} />
          <ReadOnlyCopyField label="State" value={nodeReadinessLabel(readiness) ?? state} />
        </Box>
        <ReadOnlyCopyField label="Image" value={image} />
      </PanelSection>

      <PanelSection title="Management">
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
          <ReadOnlyCopyField label="IPv4" value={mgmtIpv4} placeholder={pending} mono />
          <ReadOnlyCopyField label="IPv6" value={mgmtIpv6} placeholder={pending} mono />
        </Box>
        <ReadOnlyCopyField label="FQDN" value={fqdn} mono />
      </PanelSection>

      <NodeResourcesSection containerName={containerName} nodeName={nodeData.id} />
    </Box>
  );
};
