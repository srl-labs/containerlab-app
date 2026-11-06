// The buttons at the end of a slot's row: what can be done to the slot as a whole.
import React from "react";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";

import { REMOVE_BUTTON_SX, ROW_ICON_SX } from "./HardwareFields";
import { CELL_SX } from "./SlotControls";

export const CopyAction: React.FC<{ canCopy: boolean; onCopy: () => void }> = ({ canCopy, onCopy }) => (
  <Box sx={CELL_SX}>
    <IconButton
      size="small"
      onClick={onCopy}
      disabled={!canCopy}
      aria-label="Copy to the next free slot"
      title={canCopy ? "Copy to the next free slot" : "No free slot to copy to"}
    >
      <ContentCopyIcon sx={ROW_ICON_SX} />
    </IconButton>
  </Box>
);

export const ResetAction: React.FC<{ onReset: () => void }> = ({ onReset }) => (
  <Box sx={CELL_SX}>
    <IconButton size="small" onClick={onReset} aria-label="Reset to defaults" title="Reset to defaults">
      <RestartAltIcon sx={ROW_ICON_SX} />
    </IconButton>
  </Box>
);

export const RemoveAction: React.FC<{ label: string; onRemove: () => void }> = ({ label, onRemove }) => (
  <Box sx={CELL_SX}>
    <IconButton size="small" onClick={onRemove} aria-label={label} title={label} sx={REMOVE_BUTTON_SX}>
      <DeleteIcon sx={ROW_ICON_SX} />
    </IconButton>
  </Box>
);
