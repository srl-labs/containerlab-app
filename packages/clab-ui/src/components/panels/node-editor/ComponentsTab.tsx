// Components tab of the node editor: build a chassis from the hardware it accepts.
import React, { useEffect, useMemo, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { useSchema, type SrosComponentTypes } from "../../../hooks/editor";
import {
  allChassisSlots,
  describeChassis,
  findSrsimChassis,
  isSlotInstalled,
  SFM_SLOT_ID,
  type ChassisLayout,
  type ChassisSlot,
  type SrsimChassis
} from "../../../core/sros/srsimChassis";
import { kindComponentKeys } from "../../../core/utilities/nodeKindConfig";
import { FilterableDropdown } from "../../ui/form";

import { ChassisFrame } from "./chassis/ChassisFrame";
import { CatalogNotes, HardwareStatus, StarterPrompt } from "./chassis/HardwareNotes";
import { SfmInspector, SlotInspector } from "./chassis/SlotInspector";
import { firstSet, useChassisBuilder, type ChassisBuilder } from "./chassis/useChassisBuilder";
import { inheritedFieldHint } from "./inheritanceHints";
import type { TabProps } from "./types";

/** Per-component VM resources, in the order the form shows them */
const RESOURCE_KEYS = ["cpu", "ram", "max-nics"];

const SECTION_SX = { display: "flex", flexDirection: "column", gap: 1.5, px: 2, pt: 2 } as const;
const NO_SLOTS: ChassisLayout = { control: [], cards: [] };

const ChassisOption: React.FC<{ label: string }> = ({ label }) => {
  const chassis = findSrsimChassis(label);
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", gap: 2, width: "100%" }}>
      <span>{label}</span>
      {chassis && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {describeChassis(chassis)}
        </Typography>
      )}
    </Box>
  );
};

const ChassisField: React.FC<
  Pick<TabProps, "data" | "inheritance"> & {
    types: string[];
    placeholder: string;
    onChange: (type: string) => void;
  }
> = ({ data, inheritance, types, placeholder, onChange }) => {
  const options = useMemo(
    () =>
      [...types]
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((type) => ({ value: type, label: type })),
    [types]
  );
  return (
    <FilterableDropdown
      id="node-chassis"
      label="Chassis"
      value={data.type ?? ""}
      onChange={onChange}
      options={options}
      allowFreeText
      showArrow
      placeholder={placeholder}
      helperText={inheritedFieldHint({ data, inheritance }, "type")}
      renderOption={({ label }) => <ChassisOption label={label} />}
    />
  );
};

/** How an integrated chassis runs, for its nameplate */
function integratedNote(chassis: SrsimChassis): string | undefined {
  if (!chassis.integrated || chassis.fixedHardware !== undefined) return undefined;
  return chassis.redundant
    ? `${chassis.name} runs as one container, or one per CPM once slot B is installed.`
    : `${chassis.name} runs as one container. Change something here only to override what it boots with.`;
}

/** The nameplate of the chassis frame; a type outside the catalog still gets its name on it */
function nameplateOf({ kind, nodeType, chassis }: ChassisBuilder) {
  if (!chassis) {
    return { name: kind === "nokia_srsim" ? nodeType : undefined, defaultTypeLabel: "Slot default" };
  }
  return {
    name: chassis.name,
    description: describeChassis(chassis),
    note: integratedNote(chassis),
    fixedHardware: chassis.fixedHardware,
    cardSlots: chassis.cardSlots,
    defaultTypeLabel: chassis.integrated ? "Built-in" : "Slot default"
  };
}

/** The details below the chassis: the picked slot, or everything while the lab is locked */
const SlotDetails: React.FC<{
  builder: ChassisBuilder;
  knownTypes: SrosComponentTypes;
  resourceKeys: string[];
  readOnly: boolean;
  sfmHint: string | undefined;
}> = ({ builder, knownTypes, resourceKeys, readOnly, sfmHint }) => {
  const { chassis, components, layout, sfm, selectedId, pickedId, openSlots, issueAt } = builder;
  const paneRef = useRef<HTMLDivElement>(null);

  // Picking a slot on a tall chassis should not leave its details below the fold
  useEffect(() => {
    if (pickedId !== undefined) paneRef.current?.scrollIntoView({ block: "nearest" });
  }, [pickedId]);

  const renderSlot = (slot: ChassisSlot): React.ReactElement => (
    <SlotInspector
      slot={slot}
      component={slot.componentIndex === undefined ? undefined : components[slot.componentIndex]}
      chassis={chassis}
      knownTypes={knownTypes}
      resourceKeys={resourceKeys}
      slotOptions={[slot.label, ...openSlots]}
      canCopy={openSlots.length > 0}
      readOnly={readOnly}
      issueAt={issueAt}
      onUpdate={(updates) => builder.updateSlot(slot, updates)}
      onRemove={() => builder.removeFromSlot(slot)}
      onCopy={() => builder.copyToOpenSlot(slot)}
      onMove={(name) => builder.moveToSlot(slot, name)}
    />
  );
  const sfmDetails = (
    <SfmInspector
      chassis={chassis}
      knownTypes={knownTypes}
      value={sfm}
      issue={issueAt({ kind: "sfm" })}
      hint={sfmHint}
      onChange={builder.setSfm}
    />
  );

  if (readOnly) {
    return (
      <>
        {allChassisSlots(layout)
          .filter(isSlotInstalled)
          .map((slot) => (
            <Box key={slot.id} sx={SECTION_SX}>
              {renderSlot(slot)}
            </Box>
          ))}
        {sfm !== "" && <Box sx={SECTION_SX}>{sfmDetails}</Box>}
      </>
    );
  }

  if (selectedId === SFM_SLOT_ID) {
    return (
      <Box ref={paneRef} sx={SECTION_SX}>
        {sfmDetails}
      </Box>
    );
  }
  const selectedSlot = allChassisSlots(layout).find((slot) => slot.id === selectedId);
  return selectedSlot ? (
    <Box ref={paneRef} sx={SECTION_SX}>
      {renderSlot(selectedSlot)}
    </Box>
  ) : null;
};

/**
 * ComponentsTab - Hardware of nokia_srsim and nokia_sros nodes.
 * SR-SIM chassis come from the catalog, so only what fits is offered; anything else
 * (a type the catalog does not know, or nokia_sros) gets every known type and open slots.
 */
export const ComponentsTab: React.FC<TabProps> = ({ data, onChange, inheritance, readOnly = false }) => {
  const { srosComponentTypes, getTypesForKind } = useSchema();
  const builder = useChassisBuilder({ data, onChange, inheritance });
  const { kind, defaultType, chassis, layout, showSfm } = builder;

  const componentKeys = kindComponentKeys(data.kind);
  const resourceKeys = RESOURCE_KEYS.filter((key) => componentKeys.has(key));

  // A single built-in slot has nothing to pick between, so it opens straight on its details
  const slots = allChassisSlots(layout);
  const isSingleSlot = !showSfm && slots.length === 1 && slots[0].builtIn;
  const componentsHint = inheritedFieldHint({ data, inheritance }, "components");

  return (
    <Box sx={{ display: "flex", flexDirection: "column", pb: 2 }} data-testid="components-tab">
      <Box sx={SECTION_SX}>
        <ChassisField
          data={data}
          inheritance={inheritance}
          types={getTypesForKind(kind)}
          placeholder={defaultType === undefined ? "Type to filter…" : `${defaultType} (default)`}
          onChange={builder.setType}
        />
        <HardwareStatus
          chassis={chassis}
          isEmpty={builder.isEmpty}
          issues={builder.issues}
          layout={layout}
          onSelect={builder.pick}
          onFit={builder.fit}
        />
        {componentsHint !== undefined && (
          <Typography variant="caption" sx={{ color: "text.secondary" }} data-testid="chassis-inherited">
            Components: {componentsHint}
          </Typography>
        )}
        {builder.canStart && !readOnly && (
          <StarterPrompt chassisName={chassis?.name} onStart={builder.applyStarter} />
        )}
        <ChassisFrame
          {...nameplateOf(builder)}
          layout={isSingleSlot ? NO_SLOTS : layout}
          components={builder.components}
          sfm={builder.sfm}
          showSfm={showSfm}
          selectedId={readOnly ? undefined : builder.selectedId}
          issueSlots={builder.issueSlots}
          readOnly={readOnly}
          onSelect={builder.pick}
          onInstall={builder.install}
          onInstallSfm={builder.installSfm}
        />
      </Box>

      <SlotDetails
        builder={builder}
        knownTypes={srosComponentTypes}
        resourceKeys={resourceKeys}
        readOnly={readOnly}
        sfmHint={inheritedFieldHint({ data, inheritance }, "sfm")}
      />

      {kind === "nokia_srsim" && (
        <CatalogNotes
          nodeType={builder.nodeType}
          chassis={chassis}
          image={firstSet(data.image, inheritance?.values.image)}
          generatesConfig={data.kindConfig?.["gen-component-config"] !== false}
          envOverrides={builder.envOverrides}
        />
      )}
    </Box>
  );
};
