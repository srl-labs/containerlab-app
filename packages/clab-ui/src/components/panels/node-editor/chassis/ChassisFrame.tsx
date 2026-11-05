// Front panel of a chassis: every slot at a glance, the way the hardware is laid out.
import React from "react";
import AddIcon from "@mui/icons-material/Add";
import LockIcon from "@mui/icons-material/LockOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmberRounded";
import Box from "@mui/material/Box";
import ButtonBase from "@mui/material/ButtonBase";
import Typography from "@mui/material/Typography";

import { SFM_SLOT_ID, type ChassisLayout, type ChassisSlot } from "../../../../core/sros/srsimChassis";
import type { SrosComponent } from "../../../../core/types/editors";
import { controlRadius } from "../../../../theme/surfaces";

/** A chassis with more slots than this gets two columns of cards */
const SINGLE_COLUMN_CARD_SLOTS = 10;

const FRAME_SX = {
  display: "flex",
  flexDirection: "column",
  gap: 1.25,
  p: 1.25,
  border: 1,
  borderColor: "divider",
  borderRadius: controlRadius,
  bgcolor: "action.hover"
} as const;

const SLOT_SX = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 1,
  width: "100%",
  minWidth: 0,
  minHeight: 34,
  px: 0.75,
  border: 1,
  borderRadius: controlRadius,
  textAlign: "left",
  transition: "border-color 120ms ease, background-color 120ms ease, color 120ms ease",
  "&.Mui-focusVisible": { outline: "1px solid", outlineColor: "primary.main", outlineOffset: 1 }
} as const;

const SLOT_BADGE_SX = {
  flexShrink: 0,
  minWidth: 22,
  height: 22,
  px: 0.5,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "4px",
  fontSize: 11,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums"
} as const;

const SLOT_TEXT_SX = {
  flex: 1,
  minWidth: 0,
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
} as const;

/** What sits on a card beyond its type, for the slot's second column */
function describeSlotContents(component: SrosComponent | undefined): string {
  if (!component) return "";
  const xioms = component.xiom ?? [];
  const mdaCount =
    (component.mda?.length ?? 0) + xioms.reduce((total, xiom) => total + (xiom.mda?.length ?? 0), 0);
  const parts: string[] = [];
  if (xioms.length > 0) parts.push(`${xioms.length} XIOM`);
  if (mdaCount > 0) parts.push(`${mdaCount} MDA`);
  return parts.join(" · ");
}

interface SlotButtonProps {
  id: string;
  badge: string;
  text: string;
  contents?: string;
  selected: boolean;
  hasIssue: boolean;
  onClick: () => void;
}

const FilledSlot: React.FC<SlotButtonProps> = ({
  id,
  badge,
  text,
  contents = "",
  selected,
  hasIssue,
  onClick
}) => {
  const state = hasIssue ? ", needs a look" : "";
  const accent = selected ? "primary.main" : "divider";
  return (
    <ButtonBase
      data-testid={`chassis-slot-${id}`}
      aria-pressed={selected}
      aria-label={`Slot ${badge}: ${text}${contents === "" ? "" : `, ${contents}`}${state}`}
      onClick={onClick}
      sx={{
        ...SLOT_SX,
        bgcolor: selected ? "action.selected" : "background.default",
        borderColor: hasIssue && !selected ? "warning.main" : accent,
        "&:hover": { borderColor: selected ? "primary.main" : "text.secondary" }
      }}
    >
      <Box
        component="span"
        sx={{
          ...SLOT_BADGE_SX,
          bgcolor: selected ? "primary.main" : "action.selected",
          color: selected ? "primary.contrastText" : "text.primary"
        }}
      >
        {badge}
      </Box>
      <Box component="span" sx={SLOT_TEXT_SX} title={text}>
        {text}
      </Box>
      {contents !== "" && (
        <Typography variant="caption" sx={{ flexShrink: 0, color: "text.secondary" }}>
          {contents}
        </Typography>
      )}
      {hasIssue && (
        <WarningAmberIcon sx={{ flexShrink: 0, fontSize: 15, color: "warning.main" }} aria-hidden />
      )}
    </ButtonBase>
  );
};

const EmptySlot: React.FC<{
  id: string;
  badge: string;
  readOnly: boolean;
  onInstall: () => void;
}> = ({ id, badge, readOnly, onInstall }) => (
  <ButtonBase
    data-testid={`chassis-slot-${id}`}
    aria-label={readOnly ? `Slot ${badge}: empty` : `Install in slot ${badge}`}
    onClick={onInstall}
    sx={{
      ...SLOT_SX,
      color: "text.secondary",
      // Taken from the text so the outline reads on the frame in light and dark themes alike
      borderColor: "color-mix(in srgb, currentColor 40%, transparent)",
      borderStyle: "dashed",
      "&:hover": {
        color: "primary.main",
        borderColor: "primary.main",
        bgcolor: "action.hover"
      }
    }}
  >
    <Box component="span" sx={{ ...SLOT_BADGE_SX, fontWeight: 500 }}>
      {badge}
    </Box>
    <Box component="span" sx={SLOT_TEXT_SX}>
      {readOnly ? "Empty" : "Install"}
    </Box>
    {!readOnly && <AddIcon sx={{ flexShrink: 0, fontSize: 15 }} aria-hidden />}
  </ButtonBase>
);

/** Hardware that comes with the chassis and cannot be changed */
const FixedPart: React.FC<{ part: string }> = ({ part }) => (
  <Box
    sx={{ ...SLOT_SX, borderColor: "divider", bgcolor: "background.default", cursor: "default" }}
    title="Comes with the chassis"
  >
    <LockIcon sx={{ flexShrink: 0, ml: 0.25, fontSize: 15, color: "text.secondary" }} aria-hidden />
    <Box component="span" sx={SLOT_TEXT_SX}>
      {part}
    </Box>
  </Box>
);

const SlotGroup: React.FC<{
  title: string;
  note?: string;
  columns: number;
  children: React.ReactNode;
}> = ({ title, note, columns, children }) => (
  <Box role="group" aria-label={title}>
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 1, mb: 0.5, px: 0.25 }}>
      <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 600 }}>
        {title}
      </Typography>
      {note !== undefined && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {note}
        </Typography>
      )}
    </Box>
    <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 0.5 }}>
      {children}
    </Box>
  </Box>
);

function slotText(component: SrosComponent | undefined, defaultTypeLabel: string): string {
  const type = component?.type;
  return type === undefined || type === "" ? defaultTypeLabel : type;
}

/** Installed cards out of the slots the chassis has; a card in a slot it lacks does not count */
function cardCountNote(layout: ChassisLayout, cardSlots: number | undefined): string {
  const installed = layout.cards.filter((slot) => slot.componentIndex !== undefined);
  if (cardSlots === undefined) return `${installed.length} installed`;
  return `${installed.filter((slot) => Number(slot.label) <= cardSlots).length} of ${cardSlots}`;
}

interface ChassisFrameProps {
  /** Nameplate of the chassis */
  name?: string;
  description?: string;
  /** How the chassis runs, under its nameplate */
  note?: string;
  fixedHardware?: string;
  /** Card slots the chassis has; undefined when the catalog does not know it */
  cardSlots?: number;
  /** What an entry without a type runs */
  defaultTypeLabel: string;
  layout: ChassisLayout;
  components: SrosComponent[];
  sfm: string;
  showSfm: boolean;
  selectedId: string | undefined;
  issueSlots: ReadonlySet<string>;
  /** Slots stay visible while the lab is locked, without the install prompt */
  readOnly: boolean;
  onSelect: (id: string) => void;
  onInstall: (slot: ChassisSlot) => void;
  onInstallSfm: () => void;
}

export const ChassisFrame: React.FC<ChassisFrameProps> = ({
  name,
  description,
  note,
  fixedHardware,
  cardSlots,
  defaultTypeLabel,
  layout,
  components,
  sfm,
  showSfm,
  selectedId,
  issueSlots,
  readOnly,
  onSelect,
  onInstall,
  onInstallSfm
}) => {
  const renderSlot = (slot: ChassisSlot): React.ReactElement => {
    const component = slot.componentIndex === undefined ? undefined : components[slot.componentIndex];
    if (component === undefined && !slot.builtIn) {
      return (
        <EmptySlot
          key={slot.id}
          id={slot.id}
          badge={slot.label}
          readOnly={readOnly}
          onInstall={() => onInstall(slot)}
        />
      );
    }
    return (
      <FilledSlot
        key={slot.id}
        id={slot.id}
        badge={slot.label}
        text={slotText(component, defaultTypeLabel)}
        contents={describeSlotContents(component)}
        selected={selectedId === slot.id}
        hasIssue={issueSlots.has(slot.id)}
        onClick={() => onSelect(slot.id)}
      />
    );
  };

  const hasNameplate = name !== undefined && name !== "";
  return (
    <Box sx={FRAME_SX} data-testid="chassis-frame">
      {hasNameplate && (
        <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1, px: 0.25 }}>
          <Typography variant="subtitle2" data-testid="chassis-name">
            {name}
          </Typography>
          {description !== undefined && (
            <Typography variant="caption" sx={{ color: "text.secondary", textAlign: "right" }}>
              {description}
            </Typography>
          )}
        </Box>
      )}
      {note !== undefined && (
        <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.4, px: 0.25 }}>
          {note}
        </Typography>
      )}
      {fixedHardware !== undefined && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
          {fixedHardware.split("/").map((part) => (
            <FixedPart key={part} part={part} />
          ))}
        </Box>
      )}
      {layout.control.length > 0 && (
        <SlotGroup title="Control" columns={2}>
          {layout.control.map(renderSlot)}
        </SlotGroup>
      )}
      {layout.cards.length > 0 && (
        <SlotGroup
          title="Line cards"
          note={cardCountNote(layout, cardSlots)}
          columns={layout.cards.length > SINGLE_COLUMN_CARD_SLOTS ? 2 : 1}
        >
          {layout.cards.map(renderSlot)}
        </SlotGroup>
      )}
      {showSfm && (
        <SlotGroup title="Fabric" columns={1}>
          {sfm === "" ? (
            <EmptySlot id={SFM_SLOT_ID} badge="SFM" readOnly={readOnly} onInstall={onInstallSfm} />
          ) : (
            <FilledSlot
              id={SFM_SLOT_ID}
              badge="SFM"
              text={sfm}
              selected={selectedId === SFM_SLOT_ID}
              hasIssue={issueSlots.has(SFM_SLOT_ID)}
              onClick={() => onSelect(SFM_SLOT_ID)}
            />
          )}
        </SlotGroup>
      )}
    </Box>
  );
};
