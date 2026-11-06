// What sits on a slot's card, below its row: VM resources, MDAs and XIOMs.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { xcmSlotsNote, type ChassisSlot, type SrsimChassis } from "../../../../core/sros/srsimChassis";
import type { SrosComponent } from "../../../../core/types/editors";
import type { SrosComponentTypes } from "../../../../hooks/editor";
import { InputField } from "../../../ui/form";

import { COLUMN_SX, MdaSection, offeredTypes, XiomSection, type IssueAt } from "./HardwareFields";

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

function hasFixedMdas(chassis: SrsimChassis | undefined): boolean {
  return Object.keys(chassis?.fixedMdas ?? {}).length > 0;
}

function offersMdas(chassis: SrsimChassis | undefined): boolean {
  return !chassis || chassis.mda.length > 0 || hasFixedMdas(chassis);
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

/** Whether a slot has anything to show below its row */
export function slotHasDetails(
  chassis: SrsimChassis | undefined,
  slot: ChassisSlot,
  entry: SrosComponent,
  resourceKeys: string[],
  readOnly: boolean
): boolean {
  const sections = visibleSections(chassis, slot, entry, readOnly);
  return sections.mda || sections.xiom || resourceKeys.length > 0;
}

/** The limit an XCM puts on a slot's MDAs and XIOMs; undefined where none is known */
function slotXcm(chassis: SrsimChassis | undefined, slot: ChassisSlot): SlotXcm | undefined {
  const slots = slot.role === "card" ? chassis?.xcmModuleSlots : undefined;
  return slots === undefined ? undefined : { slots, note: xcmSlotsNote(chassis) };
}

interface SlotXcm {
  slots: number;
  note: string | undefined;
}

interface SlotDetailsProps {
  slot: ChassisSlot;
  chassis: SrsimChassis | undefined;
  entry: SrosComponent;
  /** Position of the slot's entry in the node's components */
  index: number;
  idPrefix: string;
  knownTypes: SrosComponentTypes;
  resourceKeys: string[];
  /** The lab is locked: sections with nothing in them stay out of the way */
  readOnly: boolean;
  issueAt: IssueAt;
  onUpdate: (updates: Partial<SrosComponent>) => void;
}

type SlotListProps = Pick<
  SlotDetailsProps,
  "slot" | "chassis" | "entry" | "index" | "idPrefix" | "knownTypes" | "issueAt" | "onUpdate"
> & { xcm: SlotXcm | undefined };

const SlotMdas: React.FC<SlotListProps> = ({
  slot,
  chassis,
  entry,
  index,
  idPrefix,
  knownTypes,
  issueAt,
  onUpdate,
  xcm
}) => (
  <MdaSection
    idPrefix={`${idPrefix}-mda`}
    mdas={entry.mda ?? []}
    types={offeredTypes(chassis?.mda, knownTypes.mda)}
    fixedMdas={chassis?.fixedMdas}
    prefix={slot.role === "card" ? `${slot.label}/` : ""}
    defaultType={chassis?.mda.at(0)}
    limit={xcm && { highest: xcm.slots, note: xcm.note }}
    xcmXioms={xcm && entry.xiom}
    issueOf={(mda) => issueAt({ kind: "mda", component: index, mda })}
    onChange={(mda) => onUpdate({ mda })}
  />
);

const SlotXioms: React.FC<SlotListProps> = ({
  slot,
  chassis,
  entry,
  index,
  idPrefix,
  knownTypes,
  issueAt,
  onUpdate,
  xcm
}) => (
  <XiomSection
    idPrefix={`${idPrefix}-xiom`}
    xioms={entry.xiom ?? []}
    componentIndex={index}
    slotLabel={slot.label}
    listedTypes={chassis?.xiom ?? []}
    knownTypes={knownTypes}
    issueAt={issueAt}
    onChange={(xiom) => onUpdate({ xiom })}
    xcm={xcm && { slots: xcm.slots, mdas: entry.mda ?? [], note: xcm.note }}
  />
);

export const SlotDetails: React.FC<SlotDetailsProps> = ({ resourceKeys, readOnly, ...list }) => {
  const { slot, chassis, entry, idPrefix, onUpdate } = list;
  const sections = visibleSections(chassis, slot, entry, readOnly);
  const xcm = slotXcm(chassis, slot);
  return (
    <Box sx={COLUMN_SX} data-testid="slot-details">
      <ResourcesRow idPrefix={idPrefix} component={entry} resourceKeys={resourceKeys} onUpdate={onUpdate} />
      {xcm !== undefined && (
        <Typography variant="caption" sx={{ color: "text.secondary", lineHeight: 1.4 }}>
          {xcm.note}.
        </Typography>
      )}
      {sections.mda && <SlotMdas {...list} xcm={xcm} />}
      {sections.xiom && <SlotXioms {...list} xcm={xcm} />}
    </Box>
  );
};
