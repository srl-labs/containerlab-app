// Deployment badges are not needed by the standalone documentation viewer.
import React from "react";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import StopRoundedIcon from "@mui/icons-material/StopRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import BlockRoundedIcon from "@mui/icons-material/BlockRounded";
import type { NodeRuntimeBadgeState } from "./nodeStyles";

const BADGE_STYLE_BASE: React.CSSProperties = {
  position: "absolute",
  right: -3,
  bottom: -3,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 12,
  height: 12,
  lineHeight: 0,
  borderRadius: 999,
  pointerEvents: "none",
  zIndex: 4
};

function getRuntimeBadgeColors(state: NodeRuntimeBadgeState): {
  bg: string;
  border: string;
  icon: string;
} {
  switch (state) {
    case "running":
      return { bg: "#16A34A", border: "#14532D", icon: "#ECFDF5" };
    case "paused":
      return { bg: "#F59E0B", border: "#78350F", icon: "#FFFBEB" };
    case "undeployed":
      return { bg: "#64748B", border: "#334155", icon: "#F8FAFC" };
    default:
      return { bg: "#EF4444", border: "#7F1D1D", icon: "#FFF1F2" };
  }
}

function getRuntimeBadgeIcon(state: NodeRuntimeBadgeState, iconColor: string): React.ReactElement {
  switch (state) {
    case "running":
      return <PlayArrowRoundedIcon sx={{ fontSize: "0.52rem", color: iconColor }} />;
    case "paused":
      return <PauseRoundedIcon sx={{ fontSize: "0.52rem", color: iconColor }} />;
    case "undeployed":
      return <BlockRoundedIcon sx={{ fontSize: "0.52rem", color: iconColor }} />;
    default:
      return <StopRoundedIcon sx={{ fontSize: "0.52rem", color: iconColor }} />;
  }
}

export default function NodeRuntimeBadge({ state }: { state: NodeRuntimeBadgeState }) {
  const colors = getRuntimeBadgeColors(state);
  const style = { ...BADGE_STYLE_BASE, backgroundColor: colors.bg, border: `1px solid ${colors.border}` };
  return (
    <div style={style} className={`react-flow__node-badge topology-node-runtime-badge state-${state}`}>
      {getRuntimeBadgeIcon(state, colors.icon)}
    </div>
  );
}
