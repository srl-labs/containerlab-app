// Options the lab host lacks or treats differently (c9s): greyed out with the
// reason, or kept with the reason as a hint. Without a limit, the children
// render exactly as they would anywhere else.
import React from "react";
import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import BlockOutlinedIcon from "@mui/icons-material/BlockOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";

import type { KubernetesLimitKey, RuntimeLimit } from "../../../host/kubernetesLimits";
import { useRuntimeLimit } from "../../../stores/labHostStore";

/** The reason under a field or section header. */
export const RuntimeLimitNote: React.FC<{ limit: RuntimeLimit; testId?: string }> = ({ limit, testId }) => {
  const Icon = limit.level === "unsupported" ? BlockOutlinedIcon : InfoOutlinedIcon;
  return (
    <Typography
      variant="caption"
      component="div"
      data-testid={testId ?? "runtime-limit-note"}
      data-limit={limit.level}
      sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, color: "text.secondary", lineHeight: 1.4 }}
    >
      <Icon sx={{ fontSize: 14, mt: "1px", flexShrink: 0 }} aria-hidden />
      <span>{limit.reason}</span>
    </Typography>
  );
};

/**
 * Wraps fields the lab host limits. `unsupported` greys them out (inert, so
 * neither mouse nor keyboard reach them) with the reason below and on hover;
 * `partial` keeps them and adds the reason as a hint.
 */
export const RuntimeLimited: React.FC<{
  limit: RuntimeLimit | undefined;
  children: React.ReactNode;
  /** Show the reason under the fields; off where a section header already says it. */
  note?: boolean;
  /**
   * Keep an unsupported field editable because it holds a value, so the user
   * can remove it; the reason still shows.
   */
  keepEditable?: boolean;
  /** Where the reason goes: under the fields, or above them for a whole tab. */
  notePlacement?: "top" | "bottom";
}> = ({ limit, children, note = true, keepEditable = false, notePlacement = "bottom" }) => {
  if (!limit) return <>{children}</>;
  const noteAbove = note && notePlacement === "top" ? <RuntimeLimitNote limit={limit} /> : null;
  const noteBelow = note && notePlacement === "bottom" ? <RuntimeLimitNote limit={limit} /> : null;
  if (limit.level === "partial" || keepEditable) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {noteAbove}
        {children}
        {noteBelow}
      </Box>
    );
  }
  return (
    <Tooltip title={limit.reason} placement="top-start" describeChild>
      <Box data-runtime-limited="" sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
        {noteAbove}
        <Box inert sx={{ opacity: 0.45, filter: "grayscale(1)", pointerEvents: "none", userSelect: "none" }}>
          {children}
        </Box>
        {noteBelow}
      </Box>
    </Tooltip>
  );
};

/** `RuntimeLimited` with the open topology's lab host's limit on one option. */
export const HostLimited: React.FC<{
  limit: KubernetesLimitKey;
  children: React.ReactNode;
  note?: boolean;
  keepEditable?: boolean;
}> = ({ limit, children, note, keepEditable }) => (
  <RuntimeLimited
    limit={useRuntimeLimit(limit)}
    {...(note !== undefined ? { note } : {})}
    {...(keepEditable !== undefined ? { keepEditable } : {})}
  >
    {children}
  </RuntimeLimited>
);
