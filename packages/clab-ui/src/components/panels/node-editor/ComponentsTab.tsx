// Components tab of the node editor: build a chassis from the hardware it accepts.
import React, { useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import { useSchema } from "../../../hooks/editor";
import { describeChassis, findSrsimChassis, type SrsimChassis } from "../../../core/sros/srsimChassis";
import { kindComponentKeys } from "../../../core/utilities/nodeKindConfig";
import { FilterableDropdown } from "../../ui/form";

import { ChassisFrame, type ChassisNameplate } from "./chassis/ChassisFrame";
import { CatalogNotes, HardwareStatus, StarterPrompt } from "./chassis/HardwareNotes";
import { firstSet, useChassisBuilder, type ChassisBuilder } from "./chassis/useChassisBuilder";
import { inheritedFieldHint } from "./inheritanceHints";
import type { TabProps } from "./types";

/** Per-component VM resources, in the order the form shows them */
const RESOURCE_KEYS = ["cpu", "ram", "max-nics"];

const SECTION_SX = { display: "flex", flexDirection: "column", gap: 1.5, px: 2, pt: 2 } as const;

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

/** What to know about how a chassis runs, for its nameplate */
function chassisNote(chassis: SrsimChassis): string | undefined {
  if (chassis.noSeparateMda && chassis.cardSlots > 0 && chassis.mda.length === 0) {
    return `Cards on ${chassis.name} take no separate MDA.`;
  }
  if (!chassis.integrated || chassis.fixedHardware !== undefined) return undefined;
  return chassis.redundant
    ? `${chassis.name} runs as one container, or one per CPM once slot B is installed.`
    : `${chassis.name} runs as one container. Change something here only to override what it boots with.`;
}

/** The nameplate of the chassis frame; a type outside the catalog still gets its name on it */
function nameplateOf({ kind, nodeType, chassis }: ChassisBuilder): ChassisNameplate {
  if (!chassis) return { name: kind === "nokia_srsim" ? nodeType : undefined };
  return {
    name: chassis.name,
    description: describeChassis(chassis),
    note: chassisNote(chassis),
    fixedHardware: chassis.fixedHardware,
    cardSlots: chassis.cardSlots
  };
}

/**
 * ComponentsTab - Hardware of nokia_srsim and nokia_sros nodes.
 * SR-SIM chassis come from the catalog, so only what fits is offered; anything else
 * (a type the catalog does not know, or nokia_sros) gets every known type and open slots.
 */
export const ComponentsTab: React.FC<TabProps> = ({ data, onChange, inheritance, readOnly = false }) => {
  const { srosComponentTypes, getTypesForKind } = useSchema();
  const builder = useChassisBuilder({ data, onChange, inheritance });
  const { kind, defaultType, chassis, layout } = builder;

  const componentKeys = kindComponentKeys(data.kind);
  const resourceKeys = RESOURCE_KEYS.filter((key) => componentKeys.has(key));

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
          nameplate={nameplateOf(builder)}
          builder={builder}
          knownTypes={srosComponentTypes}
          resourceKeys={resourceKeys}
          readOnly={readOnly}
          sfmHint={inheritedFieldHint({ data, inheritance }, "sfm")}
        />
      </Box>

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
