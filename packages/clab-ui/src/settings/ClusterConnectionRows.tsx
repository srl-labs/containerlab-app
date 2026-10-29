// The Connection section of a Kubernetes lab host's page: which cluster and
// namespaces, and "Change…" into the cluster form (the same form as Add lab
// host, without the deploy defaults, which the page edits itself).
import React, { useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";

import { ClusterHostDialog } from "../workspace/components/LabHostSetup";
import type { ClusterHostSettings, ClusterHostsSupport } from "../workspace/types";
import { MONO_FONT_FAMILY } from "../theme/typography";

function Summary(props: { lines: readonly (string | undefined)[] }) {
  return (
    <Box sx={{ display: "grid", gap: 0.25, minWidth: 0 }}>
      {props.lines.filter(Boolean).map((line) => (
        <Typography key={line} variant="body2" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12, overflowWrap: "anywhere" }}>
          {line}
        </Typography>
      ))}
    </Box>
  );
}

/** The cluster of a Kubernetes lab host, e.g. "kind-c9s-app" in "~/.kube/config". */
function clusterConnectionLines(
  settings: Pick<ClusterHostSettings, "kubeContext" | "kubeconfig">,
  defaultKubeconfig?: string
): string[] {
  const kubeconfig = settings.kubeconfig ?? defaultKubeconfig;
  return [`context ${settings.kubeContext || "current context"}`, ...(kubeconfig ? [kubeconfig] : [])];
}

/** How a Kubernetes lab host places labs. */
function clusterNamespaceLine(namespace: string | undefined): string {
  return namespace ? `One fixed namespace: ${namespace}` : "One per lab: c9s-<lab>";
}

/** The two custom rows of a Kubernetes lab host's Connection section. */
export function useClusterConnectionRows(props: {
  endpointId: string;
  settings: ClusterHostSettings;
  /** Without it, or for a cluster from the app's configuration, the rows are read-only. */
  support?: ClusterHostsSupport;
  editable: boolean;
}): { kubeconfig: React.ReactNode; namespaces: React.ReactNode; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const canEdit = props.editable && props.support !== undefined;
  const change = canEdit ? (
    <Button size="small" variant="outlined" onClick={() => setOpen(true)} sx={{ alignSelf: "flex-start", mt: 0.5 }}>
      Change…
    </Button>
  ) : null;
  return {
    kubeconfig: (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }} data-testid="lab-host-cluster-connection">
        <Summary lines={clusterConnectionLines(props.settings, props.support?.defaultKubeconfig)} />
        {change}
      </Box>
    ),
    namespaces: (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        <Summary lines={[clusterNamespaceLine(props.settings.namespace)]} />
      </Box>
    ),
    dialog:
      canEdit && props.support ? (
        <ClusterHostDialog
          open={open}
          support={props.support}
          editing={{ endpointId: props.endpointId, settings: props.settings }}
          connectionOnly
          onClose={() => setOpen(false)}
        />
      ) : null
  };
}
