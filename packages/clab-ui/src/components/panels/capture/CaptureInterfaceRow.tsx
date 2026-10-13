// One selectable interface row in the capture dialog.
import React from "react";
import ArrowRightAltRoundedIcon from "@mui/icons-material/ArrowRightAltRounded";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Typography from "@mui/material/Typography";

import { controlRadius } from "../../../theme/surfaces";
import { MONO_FONT_FAMILY } from "../../../theme/typography";

import type { CaptureInterfaceOption, CaptureInterfaceState } from "./captureInterfaceOptions";

/** Checkbox, interface, link peer, state. */
const CAPTURE_ROW_GRID_COLUMNS = "auto minmax(0, 1fr) minmax(0, 1.1fr) 64px";

const SELECTED_TINT = "color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 9%, transparent)";
const SELECTED_HOVER_TINT = "color-mix(in srgb, var(--vscode-focusBorder, #3794ff) 14%, transparent)";

const STATE_LABEL: Record<CaptureInterfaceState, string> = {
  up: "up",
  down: "down",
  unknown: "—"
};

const StateBadge: React.FC<{ state: CaptureInterfaceState }> = ({ state }) => (
  <Box
    sx={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 0.75,
      color: state === "up" ? "text.secondary" : "text.disabled",
      fontSize: 12
    }}
  >
    <Box
      component="span"
      sx={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        bgcolor: state === "up" ? "success.main" : "text.disabled"
      }}
    />
    {STATE_LABEL[state]}
  </Box>
);

const ManagementTag: React.FC = () => (
  <Box>
    <Box
      component="span"
      sx={{
        px: 0.75,
        py: 0.125,
        borderRadius: "4px",
        border: 1,
        borderColor: "divider",
        color: "text.secondary",
        fontSize: 11,
        lineHeight: 1.5,
        whiteSpace: "nowrap"
      }}
    >
      management
    </Box>
  </Box>
);

const PeerCell: React.FC<{ option: CaptureInterfaceOption; linksKnown: boolean }> = ({
  option,
  linksKnown
}) => {
  const { peer } = option;
  if (peer) {
    const peerEndpoint = peer.endpoint ?? "";
    return (
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5, minWidth: 0 }}
        title={`Linked to ${peer.node} ${peerEndpoint}`.trim()}
      >
        <ArrowRightAltRoundedIcon sx={{ fontSize: 16, flexShrink: 0, color: "text.disabled" }} />
        <Typography noWrap sx={{ fontSize: 12, color: "text.primary" }}>
          {peer.node}
        </Typography>
        {peerEndpoint.length > 0 ? (
          <Typography
            noWrap
            sx={{ fontSize: 12, fontFamily: MONO_FONT_FAMILY, color: "text.secondary" }}
          >
            {peerEndpoint}
          </Typography>
        ) : null}
      </Box>
    );
  }
  if (option.isManagement) return <ManagementTag />;
  if (!linksKnown) return <Box />;
  return (
    <Typography noWrap sx={{ fontSize: 12, color: "text.disabled" }}>
      not linked
    </Typography>
  );
};

interface CaptureInterfaceRowProps {
  option: CaptureInterfaceOption;
  linksKnown: boolean;
  checked: boolean;
  onToggle: (name: string) => void;
}

export const CaptureInterfaceRow: React.FC<CaptureInterfaceRowProps> = ({
  option,
  linksKnown,
  checked,
  onToggle
}) => {
  const labelId = `capture-iface-${option.name}`;
  const detail = option.detail ?? "";
  return (
    <Box
      component="label"
      htmlFor={`${labelId}-input`}
      data-testid="capture-interface-row"
      data-interface={option.name}
      title={option.label === option.name ? undefined : `Captured on ${option.name}`}
      sx={{
        display: "grid",
        gridTemplateColumns: CAPTURE_ROW_GRID_COLUMNS,
        alignItems: "center",
        columnGap: 1.5,
        minHeight: 40,
        pl: 0.5,
        pr: 1.5,
        borderRadius: controlRadius,
        cursor: "pointer",
        bgcolor: checked ? SELECTED_TINT : "transparent",
        transition: "background-color 120ms ease",
        "&:hover": { bgcolor: checked ? SELECTED_HOVER_TINT : "action.hover" }
      }}
    >
      <Checkbox
        size="small"
        checked={checked}
        onChange={() => onToggle(option.name)}
        slotProps={{ input: { id: `${labelId}-input`, "aria-labelledby": labelId } }}
      />
      <Box id={labelId} sx={{ minWidth: 0, display: "flex", alignItems: "baseline", gap: 1 }}>
        <Typography
          noWrap
          sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 13, fontWeight: 600, color: "text.primary" }}
        >
          {option.label}
        </Typography>
        {detail.length > 0 ? (
          <Typography
            noWrap
            sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12, color: "text.secondary" }}
          >
            {detail}
          </Typography>
        ) : null}
      </Box>
      <PeerCell option={option} linksKnown={linksKnown} />
      <StateBadge state={option.state} />
    </Box>
  );
};
