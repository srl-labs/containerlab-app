// What a chassis shows where there is nothing to edit: an empty slot, or hardware that is fixed.
import React from "react";
import AddIcon from "@mui/icons-material/Add";
import LockIcon from "@mui/icons-material/LockOutlined";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";

import { controlRadius } from "../../../../theme/surfaces";

import { DROP_TARGET_SX, GripCell, SLOT_TRANSITION, SlotBadge } from "./SlotControls";
import type { DropProps, SlotDragState } from "./useCardDrag";

export const EmptySlot: React.FC<{
  id: string;
  badge: string;
  readOnly: boolean;
  drop?: DropProps;
  dragState?: SlotDragState;
  onInstall: () => void;
}> = ({ id, badge, readOnly, drop, dragState, onInstall }) => (
  <ButtonBase
    {...drop}
    data-testid={`chassis-slot-${id}`}
    aria-label={readOnly ? `Slot ${badge}: empty` : `Install in slot ${badge}`}
    onClick={onInstall}
    sx={{
      display: "flex",
      justifyContent: "flex-start",
      gap: 0.5,
      width: "100%",
      minWidth: 0,
      minHeight: 34,
      px: 0.5,
      border: 1,
      borderRadius: controlRadius,
      textAlign: "left",
      transition: SLOT_TRANSITION,
      color: "text.secondary",
      // Taken from the text so the outline reads on the frame in light and dark themes alike
      borderColor: "color-mix(in srgb, currentColor 40%, transparent)",
      borderStyle: "dashed",
      "&:hover": { color: "primary.main", borderColor: "primary.main", bgcolor: "action.hover" },
      "&.Mui-focusVisible": { outline: "1px solid", outlineColor: "primary.main", outlineOffset: 1 },
      ...(dragState === "target" ? { ...DROP_TARGET_SX, color: "primary.main" } : undefined)
    }}
  >
    <GripCell />
    <SlotBadge label={badge} muted />
    <Box component="span" sx={{ flex: 1, minWidth: 0, pl: 1.5, fontSize: 12 }}>
      {readOnly ? "Empty" : "Install"}
    </Box>
    {!readOnly && <AddIcon sx={{ flexShrink: 0, mr: 0.75, fontSize: 15 }} aria-hidden />}
  </ButtonBase>
);

/** Hardware that comes with the chassis and cannot be changed */
export const FixedPart: React.FC<{ part: string }> = ({ part }) => (
  <Box
    title="Comes with the chassis"
    sx={{
      display: "flex",
      alignItems: "center",
      gap: 1,
      minHeight: 34,
      px: 0.75,
      border: 1,
      borderColor: "divider",
      borderRadius: controlRadius,
      bgcolor: "background.default",
      cursor: "default"
    }}
  >
    <LockIcon sx={{ flexShrink: 0, ml: 0.25, fontSize: 15, color: "text.secondary" }} aria-hidden />
    <Box
      component="span"
      sx={{ flex: 1, minWidth: 0, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >
      {part}
    </Box>
  </Box>
);
