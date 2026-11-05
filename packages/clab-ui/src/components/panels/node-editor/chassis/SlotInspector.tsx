// Details of the selected slot: its type, and the MDAs and XIOMs on it.
import React from "react";
import ContentCopyIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import RestartAltIcon from "@mui/icons-material/RestartAlt";
import WarningAmberIcon from "@mui/icons-material/WarningAmberRounded";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";

import type { ChassisSlot, SrsimChassis } from "../../../../core/sros/srsimChassis";
import type { SrosComponent } from "../../../../core/types/editors";
import type { SrosComponentTypes } from "../../../../hooks/editor";
import { InputField, SelectField } from "../../../ui/form";

import {
  COLUMN_SX,
  HEADER_ROW_SX,
  MdaSection,
  offeredTypes,
  REMOVE_BUTTON_SX,
  ROW_ICON_SX,
  TypeField,
  XiomSection,
  type IssueAt
} from "./HardwareFields";

/** Component index of a slot without an entry: nothing there, so no issue can point at it */
const NO_ENTRY = -1;

const RESOURCE_FIELDS: Partial<Record<string, { label: string; suffix?: string }>> = {
  cpu: { label: "vCPUs" },
  ram: { label: "RAM", suffix: "GB" },
  "max-nics": { label: "NICs" }
};

/** VM resources of a card (nokia_sros runs each card as its own VM) */
const ResourcesRow: React.FC<{
  idPrefix: string;
  component: SrosComponent;
  resourceKeys: string[];
  onUpdate: (updates: Partial<SrosComponent>) => void;
}> = ({ idPrefix, component, resourceKeys, onUpdate }) => {
  if (resourceKeys.length === 0) return null;
  const extra = component.extra ?? {};
  const setResource = (key: string, text: string): void => {
    const next = { ...extra };
    const num = Number(text);
    if (text.trim() === "" || !Number.isFinite(num)) delete next[key];
    else next[key] = Math.trunc(num);
    onUpdate({ extra: Object.keys(next).length > 0 ? next : undefined });
  };
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${resourceKeys.length}, minmax(0, 1fr))`, gap: 1.5 }}>
      {resourceKeys.map((key) => {
        const value = extra[key];
        return (
          <InputField
            key={key}
            id={`${idPrefix}-${key}`}
            label={RESOURCE_FIELDS[key]?.label ?? key}
            type="number"
            min={1}
            value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
            onChange={(text) => setResource(key, text)}
            suffix={RESOURCE_FIELDS[key]?.suffix}
            placeholder={key === "max-nics" ? "From MDAs" : "Default"}
          />
        );
      })}
    </Box>
  );
};

const IssueNote: React.FC<{ message: string }> = ({ message }) => (
  <Typography
    variant="caption"
    component="div"
    sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, color: "warning.main", lineHeight: 1.4 }}
  >
    <WarningAmberIcon sx={{ fontSize: 14, mt: "1px", flexShrink: 0 }} aria-hidden />
    <span>{message}</span>
  </Typography>
);

function slotTitle(slot: ChassisSlot, chassis: SrsimChassis | undefined): string {
  if (slot.role === "card") return `Line card ${slot.label}`;
  const isOnlySlot = chassis?.integrated === true && !chassis.redundant;
  return isOnlySlot ? "Hardware" : `CPM ${slot.label}`;
}

const SlotHeader: React.FC<{
  slot: ChassisSlot;
  chassis: SrsimChassis | undefined;
  hasEntry: boolean;
  canCopy: boolean;
  onRemove: () => void;
  onCopy: () => void;
}> = ({ slot, chassis, hasEntry, canCopy, onRemove, onCopy }) => (
  <Box sx={HEADER_ROW_SX}>
    <Typography variant="subtitle2">{slotTitle(slot, chassis)}</Typography>
    <Box sx={{ display: "flex", gap: 0.5, mr: -0.5 }}>
      {slot.role === "card" && (
        <IconButton
          size="small"
          onClick={onCopy}
          disabled={!canCopy}
          aria-label="Copy to the next free slot"
          title={canCopy ? "Copy to the next free slot" : "No free slot to copy to"}
        >
          <ContentCopyIcon sx={ROW_ICON_SX} />
        </IconButton>
      )}
      {slot.builtIn && hasEntry && (
        <IconButton size="small" onClick={onRemove} aria-label="Reset to defaults" title="Reset to defaults">
          <RestartAltIcon sx={ROW_ICON_SX} />
        </IconButton>
      )}
      {!slot.builtIn && (
        <IconButton
          size="small"
          onClick={onRemove}
          aria-label="Remove from chassis"
          title="Remove from chassis"
          sx={REMOVE_BUTTON_SX}
        >
          <DeleteIcon sx={ROW_ICON_SX} />
        </IconButton>
      )}
    </Box>
  </Box>
);

/** The chassis' list for a slot's own type */
function listedSlotTypes(chassis: SrsimChassis | undefined, slot: ChassisSlot): string[] | undefined {
  if (slot.role === "card") return chassis?.card;
  return chassis?.fixedHardware === undefined ? chassis?.cpm : [chassis.fixedHardware];
}

const SlotTypeRow: React.FC<{
  idPrefix: string;
  slot: ChassisSlot;
  chassis: SrsimChassis | undefined;
  value: string;
  knownTypes: SrosComponentTypes;
  slotOptions: string[];
  issue?: string;
  onChange: (type: string) => void;
  onMove: (slot: string) => void;
}> = ({ idPrefix, slot, chassis, value, knownTypes, slotOptions, issue, onChange, onMove }) => {
  const isCard = slot.role === "card";
  const isIntegrated = chassis?.integrated === true;
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: isCard ? "92px minmax(0, 1fr)" : "minmax(0, 1fr)",
        gap: 1,
        alignItems: "flex-start"
      }}
    >
      {isCard && (
        <SelectField
          id={`${idPrefix}-position`}
          label="Slot"
          value={slot.label}
          onChange={onMove}
          options={slotOptions.map((option) => ({ value: option, label: option }))}
        />
      )}
      <TypeField
        id={`${idPrefix}-type`}
        label={isCard ? "Card type" : "Type"}
        value={value}
        types={offeredTypes(listedSlotTypes(chassis, slot), isCard ? knownTypes.card : knownTypes.cpm)}
        issue={issue}
        hint={
          isIntegrated && value !== "" ? "A type here turns off the generated card and MDA config" : undefined
        }
        placeholder={isIntegrated ? "Built-in" : "Slot default"}
        onChange={onChange}
      />
    </Box>
  );
};

function offersMdas(chassis: SrsimChassis | undefined): boolean {
  return !chassis || chassis.mda.length > 0 || hasFixedMdas(chassis);
}

function hasFixedMdas(chassis: SrsimChassis | undefined): boolean {
  return Object.keys(chassis?.fixedMdas ?? {}).length > 0;
}

/** Which lists a slot shows: what it can take, and always whatever the node already holds */
function visibleSections(
  chassis: SrsimChassis | undefined,
  slot: ChassisSlot,
  entry: SrosComponent,
  readOnly: boolean
): { mda: boolean; xiom: boolean } {
  const takesHardware = slot.role === "card" || chassis?.integrated === true;
  const offersXioms = !chassis || chassis.xiom.length > 0;
  // While locked nothing can be added, so an empty list would only be a bare heading
  const showsEmptyMda = readOnly ? hasFixedMdas(chassis) : offersMdas(chassis);
  return {
    mda: (entry.mda?.length ?? 0) > 0 || (takesHardware && showsEmptyMda),
    xiom: (entry.xiom?.length ?? 0) > 0 || (takesHardware && !readOnly && offersXioms)
  };
}

interface SlotInspectorProps {
  slot: ChassisSlot;
  component: SrosComponent | undefined;
  chassis: SrsimChassis | undefined;
  knownTypes: SrosComponentTypes;
  resourceKeys: string[];
  /** Free card slots this one could move to, its own first */
  slotOptions: string[];
  canCopy: boolean;
  /** The lab is locked: sections with nothing in them stay out of the way */
  readOnly: boolean;
  issueAt: IssueAt;
  onUpdate: (updates: Partial<SrosComponent>) => void;
  onRemove: () => void;
  onCopy: () => void;
  onMove: (slot: string) => void;
}

/** The MDAs and XIOMs on a slot, or why there are none */
const SlotLists: React.FC<
  Pick<SlotInspectorProps, "slot" | "chassis" | "knownTypes" | "readOnly" | "issueAt" | "onUpdate"> & {
    entry: SrosComponent;
    index: number;
    idPrefix: string;
  }
> = ({ slot, chassis, knownTypes, readOnly, issueAt, onUpdate, entry, index, idPrefix }) => {
  const sections = visibleSections(chassis, slot, entry, readOnly);
  const takesNoMda = chassis?.noSeparateMda === true && !sections.mda && slot.role === "card";
  return (
    <>
      {takesNoMda && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          Cards on {chassis.name} take no separate MDA.
        </Typography>
      )}
      {sections.mda && (
        <MdaSection
          idPrefix={`${idPrefix}-mda`}
          mdas={entry.mda ?? []}
          types={offeredTypes(chassis?.mda, knownTypes.mda)}
          fixedMdas={chassis?.fixedMdas}
          prefix={slot.role === "card" ? `${slot.label}/` : ""}
          defaultType={chassis?.mda.at(0)}
          issueOf={(mda) => issueAt({ kind: "mda", component: index, mda })}
          onChange={(mda) => onUpdate({ mda })}
        />
      )}
      {sections.xiom && (
        <XiomSection
          idPrefix={`${idPrefix}-xiom`}
          xioms={entry.xiom ?? []}
          componentIndex={index}
          slotLabel={slot.label}
          listedTypes={chassis?.xiom ?? []}
          knownTypes={knownTypes}
          issueAt={issueAt}
          onChange={(xiom) => onUpdate({ xiom })}
        />
      )}
    </>
  );
};

export const SlotInspector: React.FC<SlotInspectorProps> = ({
  slot,
  component,
  chassis,
  knownTypes,
  resourceKeys,
  slotOptions,
  canCopy,
  readOnly,
  issueAt,
  onUpdate,
  onRemove,
  onCopy,
  onMove
}) => {
  const entry = component ?? {};
  const index = slot.componentIndex ?? NO_ENTRY;
  const idPrefix = `slot-${slot.id.replace("#", "repeat-")}`;
  const slotIssue = issueAt({ kind: "slot", component: index });

  return (
    <Box sx={COLUMN_SX} data-testid="slot-inspector">
      <SlotHeader
        slot={slot}
        chassis={chassis}
        hasEntry={component !== undefined}
        canCopy={canCopy}
        onRemove={onRemove}
        onCopy={onCopy}
      />
      {slotIssue !== undefined && <IssueNote message={slotIssue} />}
      <SlotTypeRow
        idPrefix={idPrefix}
        slot={slot}
        chassis={chassis}
        value={entry.type ?? ""}
        knownTypes={knownTypes}
        slotOptions={slotOptions}
        issue={issueAt({ kind: "type", component: index })}
        onChange={(type) => onUpdate({ type })}
        onMove={onMove}
      />
      <ResourcesRow idPrefix={idPrefix} component={entry} resourceKeys={resourceKeys} onUpdate={onUpdate} />
      <SlotLists
        slot={slot}
        chassis={chassis}
        knownTypes={knownTypes}
        readOnly={readOnly}
        issueAt={issueAt}
        onUpdate={onUpdate}
        entry={entry}
        index={index}
        idPrefix={idPrefix}
      />
    </Box>
  );
};

/** The node-level SFM: one type for the whole fabric */
export const SfmInspector: React.FC<{
  chassis: SrsimChassis | undefined;
  knownTypes: SrosComponentTypes;
  value: string;
  issue?: string;
  /** Where an inherited SFM comes from */
  hint?: string;
  onChange: (sfm: string) => void;
}> = ({ chassis, knownTypes, value, issue, hint, onChange }) => (
  <Box sx={COLUMN_SX} data-testid="sfm-inspector">
    <Box sx={HEADER_ROW_SX}>
      <Typography variant="subtitle2">Switch fabric</Typography>
      {value !== "" && (
        <IconButton
          size="small"
          onClick={() => onChange("")}
          aria-label="Remove SFM"
          title="Remove SFM"
          sx={{ ...REMOVE_BUTTON_SX, mr: -0.5 }}
        >
          <DeleteIcon sx={ROW_ICON_SX} />
        </IconButton>
      )}
    </Box>
    <TypeField
      id="sfm-type"
      label="SFM type"
      value={value}
      types={offeredTypes(chassis?.sfm, knownTypes.sfm)}
      issue={issue}
      hint={hint}
      onChange={onChange}
    />
  </Box>
);
