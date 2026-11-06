// One slot of the chassis as a row: what is in it, every control for it, and what sits on it.
import React, { useEffect, useRef } from "react";
import WarningAmberIcon from "@mui/icons-material/WarningAmberRounded";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { SFM_SLOT_ID, type ChassisSlot, type SrsimChassis } from "../../../../core/sros/srsimChassis";
import type { SrosComponent } from "../../../../core/types/editors";
import type { SrosComponentTypes } from "../../../../hooks/editor";
import { controlRadius } from "../../../../theme/surfaces";

import { offeredTypes, TypeField, type IssueAt } from "./HardwareFields";
import { CopyAction, RemoveAction, ResetAction } from "./SlotActions";
import {
  DetailsToggle,
  DROP_TARGET_SX,
  GripCell,
  SLOT_TRANSITION,
  SlotBadge,
  SlotPicker,
  type SlotChoice
} from "./SlotControls";
import { SlotDetails, slotHasDetails } from "./SlotDetails";
import type { DropProps, GripProps, SlotDragState } from "./useCardDrag";

/** Component index of a slot without an entry: nothing there, so no issue can point at it */
const NO_ENTRY = -1;

const HEAD_SX = {
  display: "flex",
  alignItems: "flex-start",
  gap: 0.5,
  minWidth: 0,
  px: 0.5,
  py: "2px",
  bgcolor: "background.default",
  borderRadius: controlRadius
} as const;

/** Scrolls an element into view once `reveal` turns on */
function useReveal(reveal: boolean): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reveal) ref.current?.scrollIntoView({ block: "nearest" });
  }, [reveal]);
  return ref;
}

const IssueNote: React.FC<{ message: string }> = ({ message }) => (
  <Typography
    variant="caption"
    component="div"
    sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, px: 1, pb: 0.75, color: "warning.main", lineHeight: 1.4 }}
  >
    <WarningAmberIcon sx={{ fontSize: 14, mt: "1px", flexShrink: 0 }} aria-hidden />
    <span>{message}</span>
  </Typography>
);

const RowShell: React.FC<{
  testId: string;
  title: string;
  /** Border of the row at rest */
  borderColor: string;
  reveal: boolean;
  dragState?: SlotDragState;
  drop?: DropProps;
  children: React.ReactNode;
}> = ({ testId, title, borderColor, reveal, dragState, drop, children }) => {
  const ref = useReveal(reveal);
  return (
    <Box
      {...drop}
      ref={ref}
      role="group"
      aria-label={title}
      data-testid={testId}
      sx={{
        minWidth: 0,
        border: 1,
        borderColor,
        borderRadius: controlRadius,
        bgcolor: "background.default",
        transition: SLOT_TRANSITION,
        opacity: dragState === "dragged" ? 0.5 : 1,
        ...(dragState === "target" ? DROP_TARGET_SX : undefined)
      }}
    >
      {children}
    </Box>
  );
};

function slotTitle(slot: ChassisSlot, chassis: SrsimChassis | undefined): string {
  if (slot.role === "card") return `Line card ${slot.label}`;
  const isOnlySlot = chassis?.integrated === true && !chassis.redundant;
  return isOnlySlot ? "Hardware" : `CPM ${slot.label}`;
}

/** The chassis' list for a slot's own type */
function listedSlotTypes(chassis: SrsimChassis | undefined, slot: ChassisSlot): string[] | undefined {
  if (slot.role === "card") return chassis?.card;
  return chassis?.fixedHardware === undefined ? chassis?.cpm : [chassis.fixedHardware];
}

const SlotTypeField: React.FC<{
  idPrefix: string;
  slot: ChassisSlot;
  chassis: SrsimChassis | undefined;
  value: string;
  knownTypes: SrosComponentTypes;
  issue?: string;
  onChange: (type: string) => void;
}> = ({ idPrefix, slot, chassis, value, knownTypes, issue, onChange }) => {
  const isCard = slot.role === "card";
  const isIntegrated = chassis?.integrated === true;
  return (
    <TypeField
      id={`${idPrefix}-type`}
      label={isCard ? "Card type" : "Type"}
      inRow
      value={value}
      types={offeredTypes(listedSlotTypes(chassis, slot), isCard ? knownTypes.card : knownTypes.cpm)}
      issue={issue}
      hint={isIntegrated && value !== "" ? "A type here turns off the generated card and MDA config" : undefined}
      placeholder={isIntegrated ? "Built-in" : "Slot default"}
      onChange={onChange}
    />
  );
};

function rowBorder(isOpen: boolean, hasIssue: boolean): string {
  if (hasIssue) return "warning.main";
  return isOpen ? "primary.main" : "divider";
}

interface InstalledSlotProps {
  slot: ChassisSlot;
  component: SrosComponent | undefined;
  chassis: SrsimChassis | undefined;
  knownTypes: SrosComponentTypes;
  resourceKeys: string[];
  /** What the slot's contents come to, for its toggle */
  contents: string;
  /** Slots the card can go to, in chassis order */
  slotChoices: SlotChoice[];
  canCopy: boolean;
  readOnly: boolean;
  /** The chassis' only slot: nothing to tell apart or to open, so its details always show */
  isOnlySlot: boolean;
  isOpen: boolean;
  reveal: boolean;
  hasIssue: boolean;
  issueAt: IssueAt;
  grip?: GripProps;
  drop?: DropProps;
  dragState?: SlotDragState;
  onToggle: () => void;
  onUpdate: (updates: Partial<SrosComponent>) => void;
  onRemove: () => void;
  onCopy: () => void;
  onMove: (slot: string) => void;
}

/** Where the card sits, and the ways to move it */
const SlotPlace: React.FC<
  Pick<InstalledSlotProps, "slot" | "slotChoices" | "readOnly" | "grip" | "onMove"> & { idPrefix: string }
> = ({ slot, slotChoices, readOnly, grip, onMove, idPrefix }) => (
  <>
    <GripCell id={slot.id} grip={grip} />
    {slot.role === "card" && !readOnly ? (
      <SlotPicker id={`${idPrefix}-position`} value={slot.label} choices={slotChoices} onMove={onMove} />
    ) : (
      <SlotBadge label={slot.label} />
    )}
  </>
);

/** What can be done to the slot as a whole */
const SlotRowActions: React.FC<Pick<InstalledSlotProps, "slot" | "component" | "canCopy" | "onCopy" | "onRemove">> = ({
  slot,
  component,
  canCopy,
  onCopy,
  onRemove
}) => (
  <>
    {slot.role === "card" && <CopyAction canCopy={canCopy} onCopy={onCopy} />}
    {slot.builtIn && component !== undefined && <ResetAction onReset={onRemove} />}
    {!slot.builtIn && <RemoveAction label="Remove from chassis" onRemove={onRemove} />}
  </>
);

/** A slot with something in it, or an integrated chassis' own hardware */
export const InstalledSlot: React.FC<InstalledSlotProps> = (props) => {
  const { slot, component, chassis, knownTypes, resourceKeys, readOnly, isOnlySlot, issueAt, onUpdate } = props;
  const entry = component ?? {};
  const index = slot.componentIndex ?? NO_ENTRY;
  const idPrefix = `slot-${slot.id.replace("#", "repeat-")}`;
  const slotIssue = issueAt({ kind: "slot", component: index });
  const hasDetails = slotHasDetails(chassis, slot, entry, resourceKeys, readOnly);
  const isFolding = hasDetails && !isOnlySlot && !readOnly;
  const isOpen = isFolding ? props.isOpen : hasDetails;

  return (
    <RowShell
      testId={isOnlySlot ? "chassis-hardware" : `chassis-slot-${slot.id}`}
      title={slotTitle(slot, chassis)}
      borderColor={rowBorder(isFolding && isOpen, props.hasIssue)}
      reveal={props.reveal}
      dragState={props.dragState}
      drop={props.drop}
    >
      <Box sx={HEAD_SX}>
        {!isOnlySlot && (
          <SlotPlace
            slot={slot}
            slotChoices={props.slotChoices}
            readOnly={readOnly}
            grip={props.grip}
            onMove={props.onMove}
            idPrefix={idPrefix}
          />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <SlotTypeField
            idPrefix={idPrefix}
            slot={slot}
            chassis={chassis}
            value={entry.type ?? ""}
            knownTypes={knownTypes}
            issue={issueAt({ kind: "type", component: index })}
            onChange={(type) => onUpdate({ type })}
          />
        </Box>
        {isFolding && (
          <DetailsToggle
            id={slot.id}
            contents={props.contents}
            countsXioms={chassis === undefined || chassis.xiom.length > 0}
            isOpen={isOpen}
            hasIssue={props.hasIssue}
            onToggle={props.onToggle}
          />
        )}
        <SlotRowActions
          slot={slot}
          component={component}
          canCopy={props.canCopy}
          onCopy={props.onCopy}
          onRemove={props.onRemove}
        />
      </Box>
      {slotIssue !== undefined && <IssueNote message={slotIssue} />}
      {isOpen && (
        <Box sx={{ px: 1.25, pt: 1, pb: 1.25, borderTop: 1, borderColor: "divider" }}>
          <SlotDetails
            slot={slot}
            chassis={chassis}
            entry={entry}
            index={index}
            idPrefix={idPrefix}
            knownTypes={knownTypes}
            resourceKeys={resourceKeys}
            readOnly={readOnly}
            issueAt={issueAt}
            onUpdate={onUpdate}
          />
        </Box>
      )}
    </RowShell>
  );
};

/** The node-level SFM: one type for the whole fabric */
export const SfmSlot: React.FC<{
  chassis: SrsimChassis | undefined;
  knownTypes: SrosComponentTypes;
  value: string;
  reveal: boolean;
  issue?: string;
  /** Where an inherited SFM comes from */
  hint?: string;
  onChange: (sfm: string) => void;
}> = ({ chassis, knownTypes, value, reveal, issue, hint, onChange }) => (
  <RowShell
    testId={`chassis-slot-${SFM_SLOT_ID}`}
    title="Switch fabric"
    borderColor={rowBorder(false, issue !== undefined)}
    reveal={reveal}
  >
    <Box sx={HEAD_SX}>
      <GripCell />
      <SlotBadge label="SFM" />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <TypeField
          id="sfm-type"
          label="SFM type"
          inRow
          value={value}
          types={offeredTypes(chassis?.sfm, knownTypes.sfm)}
          issue={issue}
          hint={hint}
          onChange={onChange}
        />
      </Box>
      <RemoveAction label="Remove SFM" onRemove={() => onChange("")} />
    </Box>
  </RowShell>
);
