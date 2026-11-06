// The controls on the left of a slot's row and its details toggle.
import React from "react";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import WarningAmberIcon from "@mui/icons-material/WarningAmberRounded";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import InputBase from "@mui/material/InputBase";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Typography from "@mui/material/Typography";

import { ROW_ICON_SX } from "./HardwareFields";
import type { GripProps } from "./useCardDrag";

const GRIP_WIDTH = 16;
const SLOT_CELL_WIDTH = 44;
/** Room for the most a toggle says, so the type fields of a chassis end in one line */
const TOGGLE_WIDTH = 66;
const XIOM_TOGGLE_WIDTH = 116;

/** Every control on a row lines up with the first line of the type, as tall as a field */
export const CELL_SX = { display: "flex", alignItems: "center", flexShrink: 0, height: 32 } as const;

export const SLOT_TRANSITION = "border-color 120ms ease, background-color 120ms ease, opacity 120ms ease";

/** The slot a dragged card would land in */
export const DROP_TARGET_SX = { borderColor: "primary.main", bgcolor: "action.selected" } as const;

const BADGE_SX = {
  height: 22,
  minWidth: 22,
  px: 0.5,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "4px",
  fontSize: 11,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums"
} as const;

/** Keeps every row's columns lined up, with or without a grip */
export const GripCell: React.FC<{ id?: string; grip?: GripProps }> = ({ id, grip }) =>
  grip === undefined ? (
    <Box sx={{ ...CELL_SX, width: GRIP_WIDTH }} />
  ) : (
    <Box
      {...grip}
      data-testid={`chassis-grip-${id}`}
      title="Drag to another slot"
      sx={{
        ...CELL_SX,
        width: GRIP_WIDTH,
        color: "text.secondary",
        cursor: "grab",
        "&:hover": { color: "text.primary" },
        "&:active": { cursor: "grabbing" }
      }}
    >
      <DragIndicatorIcon sx={ROW_ICON_SX} aria-hidden />
    </Box>
  );

/** The slot's name, for a slot that stays where it is */
export const SlotBadge: React.FC<{ label: string; muted?: boolean }> = ({ label, muted = false }) => (
  <Box sx={{ ...CELL_SX, width: SLOT_CELL_WIDTH }}>
    <Box
      component="span"
      sx={muted ? { ...BADGE_SX, fontWeight: 500 } : { ...BADGE_SX, bgcolor: "action.selected", color: "text.primary" }}
    >
      {label}
    </Box>
  </Box>
);

export interface SlotChoice {
  name: string;
  /** What a card already in this slot means for the move */
  note?: string;
}

/** The slot's name as a dropdown: moves the card without a mouse too */
export const SlotPicker: React.FC<{
  id: string;
  value: string;
  choices: SlotChoice[];
  onMove: (slot: string) => void;
}> = ({ id, value, choices, onMove }) => (
  <Box sx={{ ...CELL_SX, width: SLOT_CELL_WIDTH }}>
    <Select
      id={id}
      value={value}
      onChange={(event) => onMove(event.target.value)}
      input={<InputBase />}
      SelectDisplayProps={{ "aria-label": `Slot ${value}: move to another slot`, title: "Move to another slot" }}
      MenuProps={{ slotProps: { paper: { sx: { minWidth: 180 } } } }}
      renderValue={(selected) => selected}
      sx={{
        width: SLOT_CELL_WIDTH - 4,
        height: 22,
        borderRadius: "4px",
        bgcolor: "action.selected",
        fontSize: 11,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        "&:hover": { outline: "1px solid", outlineColor: "text.secondary" },
        "&.Mui-focused": { outline: "1px solid", outlineColor: "primary.main" },
        "&& .MuiSelect-select.MuiInputBase-input": {
          minHeight: 0,
          py: 0,
          pl: "6px",
          pr: "16px",
          lineHeight: "22px"
        },
        "& .MuiSelect-icon": { right: 0, fontSize: 16 }
      }}
    >
      {choices.map(({ name, note }) => (
        <MenuItem key={name} value={name} sx={{ justifyContent: "space-between", gap: 2 }}>
          <span>{name}</span>
          {name !== value && note !== undefined && (
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {note}
            </Typography>
          )}
        </MenuItem>
      ))}
    </Select>
  </Box>
);

/** Opens what sits on the card, and says how much there is while it is closed */
export const DetailsToggle: React.FC<{
  id: string;
  contents: string;
  /** The chassis takes XIOMs, so the toggle may have those to count as well */
  countsXioms: boolean;
  isOpen: boolean;
  hasIssue: boolean;
  onToggle: () => void;
}> = ({ id, contents, countsXioms, isOpen, hasIssue, onToggle }) => {
  const action = isOpen ? "Hide details" : "Show details";
  return (
    <ButtonBase
      data-testid={`chassis-toggle-${id}`}
      aria-expanded={isOpen}
      aria-label={`${action}${contents === "" ? "" : `: ${contents}`}${hasIssue ? ", needs a look" : ""}`}
      title={action}
      onClick={onToggle}
      sx={{
        ...CELL_SX,
        justifyContent: "flex-end",
        gap: 0.5,
        minWidth: countsXioms ? XIOM_TOGGLE_WIDTH : TOGGLE_WIDTH,
        px: 0.5,
        borderRadius: "4px",
        color: "text.secondary",
        "&:hover": { color: "text.primary", bgcolor: "action.hover" },
        "&.Mui-focusVisible": { outline: "1px solid", outlineColor: "primary.main" }
      }}
    >
      {contents !== "" && (
        <Typography variant="caption" sx={{ color: "inherit", whiteSpace: "nowrap" }}>
          {contents}
        </Typography>
      )}
      {hasIssue && !isOpen && <WarningAmberIcon sx={{ fontSize: 15, color: "warning.main" }} aria-hidden />}
      <ExpandMoreIcon
        aria-hidden
        sx={{
          fontSize: 18,
          transform: isOpen ? "rotate(180deg)" : "none",
          transition: "transform 120ms ease",
          "@media (prefers-reduced-motion: reduce)": { transition: "none" }
        }}
      />
    </ButtonBase>
  );
};
