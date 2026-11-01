// The Kubernetes resources a c9s apply changes; recreated nodes restart.
import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import type { ApplyPlanChange } from "../../../host/applyPlan";
import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

const ACTION_COLOR: Record<ApplyPlanChange["action"], string> = {
  create: "success.main",
  update: "info.main",
  recreate: "warning.main",
  delete: "error.main"
};

/** Nodes the plan recreates: their pods restart. */
function recreatedNodeNames(changes: readonly ApplyPlanChange[]): string[] {
  return changes
    .filter((change) => change.action === "recreate" && change.kind.toLowerCase() === "node")
    .map((change) => change.name);
}

export const ApplyPlanChanges: React.FC<{ changes: readonly ApplyPlanChange[]; namespace?: string }> = ({
  changes,
  namespace
}) => {
  const restarting = recreatedNodeNames(changes);
  return (
    <Box component="section" data-testid="apply-plan-changes" sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="subtitle2" component="h3">
        Kubernetes resources{namespace ? ` in ${namespace}` : ""}
      </Typography>
      <Box
        component="ul"
        sx={{ listStyle: "none", m: 0, p: 0, border: 1, borderColor: "divider", borderRadius: controlRadius, overflow: "hidden" }}
      >
        {changes.map((change) => {
          const recreate = change.action === "recreate";
          return (
            <Box
              component="li"
              key={`${change.action}:${change.kind}:${change.name}`}
              data-testid={`apply-plan-change-${change.action}`}
              data-recreate={recreate ? "true" : undefined}
              sx={{
                display: "flex",
                alignItems: "baseline",
                gap: 1.5,
                px: 1.5,
                py: 0.75,
                borderLeft: 3,
                borderLeftColor: ACTION_COLOR[change.action],
                bgcolor: recreate ? "action.selected" : undefined,
                "&:not(:last-of-type)": { borderBottom: 1, borderBottomColor: "divider" }
              }}
            >
              <Typography
                variant="caption"
                sx={{ color: ACTION_COLOR[change.action], fontWeight: recreate ? 700 : 500, minWidth: 64 }}
              >
                {change.action}
              </Typography>
              <Typography variant="caption" sx={{ color: "text.secondary", minWidth: 72 }}>
                {change.kind}
              </Typography>
              <Typography
                variant="body2"
                sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12.5, fontWeight: recreate ? 700 : 400, overflowWrap: "anywhere" }}
              >
                {change.name}
              </Typography>
            </Box>
          );
        })}
      </Box>
      {restarting.length > 0 && (
        <Alert severity="warning" variant="outlined" data-testid="apply-plan-recreate-warning">
          These nodes restart: {restarting.join(", ")}. Without persistence they lose unsaved configuration.
        </Alert>
      )}
    </Box>
  );
};
