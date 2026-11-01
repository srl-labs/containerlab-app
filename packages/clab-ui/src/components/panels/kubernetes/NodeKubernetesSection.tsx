// Where a c9s node runs: namespace, pod, device container and exposed ports.
import React from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import TerminalIcon from "@mui/icons-material/TerminalOutlined";

import { kubectlExecCommand } from "../../../host/kubernetes";
import { useLabHostStore } from "../../../stores/labHostStore";
import { copyToClipboard } from "../../../utils/clipboard";
import { PanelSection, ReadOnlyCopyField } from "../../ui/form";

import { useNodeLocation } from "./useNodeLocation";

export interface NodeKubernetesSectionProps {
  nodeName: string;
  /** The node's kind, for the shell of the kubectl command. */
  shell?: string;
  /** Changes when the node's runtime state changes, so the location is read again. */
  refreshKey?: unknown;
}

export const NodeKubernetesSection: React.FC<NodeKubernetesSectionProps> = ({ nodeName, shell, refreshKey }) => {
  const location = useNodeLocation(nodeName, refreshKey);
  const profile = useLabHostStore((state) => state.info?.profile);
  const [copied, setCopied] = React.useState(false);
  if (!location || profile?.runtime !== "c9s") return null;

  const ports = location.exposedPorts
    .map((port) =>
      port.exposePort === port.destinationPort
        ? `${port.destinationPort}/${port.protocol.toLowerCase()}`
        : `${port.destinationPort}/${port.protocol.toLowerCase()} → ${port.exposePort}`
    )
    .join(", ");
  const command = kubectlExecCommand(location, {
    ...(profile.kubeContext ? { kubeContext: profile.kubeContext } : {}),
    ...(profile.kubeconfig ? { kubeconfig: profile.kubeconfig } : {}),
    ...(shell ? { shell } : {})
  });

  return (
    <PanelSection title="Kubernetes">
      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }} data-testid="node-kubernetes">
        <ReadOnlyCopyField label="Namespace" value={location.namespace} mono />
        <ReadOnlyCopyField label="Container" value={location.container} mono />
      </Box>
      <ReadOnlyCopyField label="Pod" value={location.pod} mono />
      <ReadOnlyCopyField label="Exposed ports" value={ports} placeholder="None" mono />
      {location.loadBalancerAddress && (
        <ReadOnlyCopyField label="Load balancer" value={location.loadBalancerAddress} mono />
      )}
      <Typography variant="caption" sx={{ color: "text.secondary" }} data-testid="node-kubernetes-persistence">
        {profile.persistence === false
          ? "Node state is not persisted: a restart starts the node from its startup config."
          : "Node state is kept on a persistent volume across restarts; destroy with cleanup removes it."}
      </Typography>
      <Box>
        <Button
          size="small"
          variant="text"
          startIcon={<TerminalIcon fontSize="small" />}
          onClick={() => {
            void copyToClipboard(command).then(setCopied);
          }}
          data-testid="node-kubernetes-copy-kubectl"
        >
          {copied ? "Copied" : "Copy kubectl exec command"}
        </Button>
      </Box>
    </PanelSection>
  );
};
