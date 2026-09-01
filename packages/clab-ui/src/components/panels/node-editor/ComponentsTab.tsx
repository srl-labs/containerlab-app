/* eslint-disable import-x/max-dependencies */
// Components tab for node editor (Nokia SROS).
import React, { useCallback, useState } from "react";
import { IconChevronDown, IconChevronUp, IconPlus, IconTrash } from "@tabler/icons-react";
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Collapse,
  Divider,
  NumberInput,
  Paper,
  Tabs,
  Text
} from "@mantine/core";

import { InputField, FilterableDropdown } from "../../ui/form";
import { useSchema, type SrosComponentTypes } from "../../../hooks/editor";

import type { TabProps, SrosComponent, SrosMda, SrosXiom } from "./types";
import { INTEGRATED_SROS_TYPES } from "./types";

/** Check if type is integrated mode (simpler chassis) */
const isIntegratedType = (type: string | undefined): boolean => {
  if (type === undefined || type.length === 0) return false;
  return INTEGRATED_SROS_TYPES.has(type.toLowerCase());
};

/** Check if slot is a CPM slot (A or B) */
const isCpmSlot = (slot: string | number | undefined): boolean => {
  if (slot === undefined) return false;
  const s = String(slot).trim().toUpperCase();
  return s === "A" || s === "B";
};

/** Convert string array to dropdown options */
const toOptions = (types: string[]): Array<{ value: string; label: string }> =>
  types.map((t) => ({ value: t, label: t }));

const JUSTIFY_SPACE_BETWEEN = "space-between";

// ============================================================================
// MDA Entry Component
// ============================================================================

interface MdaEntryProps {
  mda: SrosMda;
  index: number;
  mdaTypes: string[];
  onUpdate: (index: number, updates: Partial<SrosMda>) => void;
  onRemove: (index: number) => void;
  slotPrefix?: string;
}

const MdaEntry: React.FC<MdaEntryProps> = ({
  mda,
  index,
  mdaTypes,
  onUpdate,
  onRemove,
  slotPrefix = ""
}) => (
  <Box
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      paddingBlock: 8,
      paddingInline: 12,
      borderRadius: 4,
      border: "1px solid var(--mantine-color-default-border)"
    }}
  >
    <Box style={{ flex: 2, minWidth: 0 }}>
      <NumberInput
        id={`mda-slot-${index}`}
        label="Slot"
        size="sm"
        min={1}
        hideControls
        value={mda.slot ?? ""}
        onChange={(value) =>
          onUpdate(index, { slot: typeof value === "number" ? value : undefined })
        }
        placeholder="Slot"
        leftSection={
          slotPrefix ? (
            <Text size="xs" style={{ whiteSpace: "nowrap" }}>
              {slotPrefix}
            </Text>
          ) : undefined
        }
        leftSectionWidth={slotPrefix ? slotPrefix.length * 7 + 12 : undefined}
      />
    </Box>
    <Box style={{ flex: 3, minWidth: 0 }}>
      <FilterableDropdown
        id={`mda-type-${index}`}
        label="Type"
        value={mda.type ?? ""}
        onChange={(v) => onUpdate(index, { type: v })}
        options={toOptions(mdaTypes)}
        allowFreeText
      />
    </Box>
    <ActionIcon
      variant="subtle"
      color="red"
      onClick={() => onRemove(index)}
      title="Remove MDA"
    >
      <IconTrash size={18} />
    </ActionIcon>
  </Box>
);

// ============================================================================
// MDA List Section - Shared component for rendering MDA lists
// ============================================================================

interface MdaListSectionProps {
  mdas: SrosMda[];
  mdaTypes: string[];
  slotPrefix?: string;
  onUpdate: (index: number, updates: Partial<SrosMda>) => void;
  onRemove: (index: number) => void;
}

const MdaListSection: React.FC<MdaListSectionProps> = ({
  mdas,
  mdaTypes,
  slotPrefix,
  onUpdate,
  onRemove
}) => (
  <Box style={{ display: "flex", flexDirection: "column", gap: 8 }}>
    {mdas.map((mda, mdaIdx) => (
      <MdaEntry
        key={mdaIdx}
        mda={mda}
        index={mdaIdx}
        mdaTypes={mdaTypes}
        slotPrefix={slotPrefix}
        onUpdate={onUpdate}
        onRemove={onRemove}
      />
    ))}
  </Box>
);

// ============================================================================
// MDA Section Wrapper - Generic MDA list wrapper with subsection
// ============================================================================

interface MdaSectionWrapperProps {
  mdas: SrosMda[];
  mdaTypes: string[];
  slotPrefix: string;
  parentIndex: number;
  onAddMda: (parentIndex: number) => void;
  onUpdateMda: (parentIndex: number, mdaIndex: number, updates: Partial<SrosMda>) => void;
  onRemoveMda: (parentIndex: number, mdaIndex: number) => void;
}

const MdaSectionWrapper: React.FC<MdaSectionWrapperProps> = ({
  mdas,
  mdaTypes,
  slotPrefix,
  parentIndex,
  onAddMda,
  onUpdateMda,
  onRemoveMda
}) => (
  <>
    <Box
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: JUSTIFY_SPACE_BETWEEN,
        paddingInline: 16,
        paddingBlock: 8
      }}
    >
      <Text size="sm" fw={600}>
        MDA Components
      </Text>
      <Button
        variant="subtle"
        size="xs"
        leftSection={<IconPlus size={20} />}
        onClick={() => onAddMda(parentIndex)}
      >
        Add
      </Button>
    </Box>
    <Divider />
    <Box style={{ padding: 16 }}>
      <MdaListSection
        mdas={mdas}
        mdaTypes={mdaTypes}
        slotPrefix={slotPrefix}
        onUpdate={(idx, updates) => onUpdateMda(parentIndex, idx, updates)}
        onRemove={(idx) => onRemoveMda(parentIndex, idx)}
      />
    </Box>
  </>
);

// ============================================================================
// XIOM Entry Component
// ============================================================================

/** Content panel for a single XIOM tab */
const XiomTabContent: React.FC<{
  xiom: SrosXiom;
  index: number;
  cardSlot: string | number;
  srosTypes: SrosComponentTypes;
  onUpdate: (index: number, updates: Partial<SrosXiom>) => void;
  onAddMda: (xiomIndex: number) => void;
  onUpdateMda: (xiomIndex: number, mdaIndex: number, updates: Partial<SrosMda>) => void;
  onRemoveMda: (xiomIndex: number, mdaIndex: number) => void;
}> = ({ xiom, index, cardSlot, srosTypes, onUpdate, onAddMda, onUpdateMda, onRemoveMda }) => {
  const slotLabel = `${cardSlot}\u00A0/\u00A0x${xiom.slot ?? index + 1}`;

  return (
    <>
      <Box style={{ padding: 12 }}>
        <FilterableDropdown
          id={`xiom-type-${index}`}
          label="Type"
          value={xiom.type ?? ""}
          onChange={(v) => onUpdate(index, { type: v })}
          options={toOptions(srosTypes.xiom)}
          allowFreeText
        />
      </Box>
      <Divider />
      <MdaSectionWrapper
        mdas={xiom.mda ?? []}
        mdaTypes={srosTypes.xiomMda}
        slotPrefix={`${slotLabel}\u00A0/\u00A0`}
        parentIndex={index}
        onAddMda={onAddMda}
        onUpdateMda={onUpdateMda}
        onRemoveMda={onRemoveMda}
      />
    </>
  );
};

// ============================================================================
// Component Entry (CPM or Card)
// ============================================================================

// Shared callback types for component operations
interface ComponentCallbacks {
  onAddMda: (compIndex: number) => void;
  onUpdateMda: (compIndex: number, mdaIndex: number, updates: Partial<SrosMda>) => void;
  onRemoveMda: (compIndex: number, mdaIndex: number) => void;
  onAddXiom: (compIndex: number) => void;
  onUpdateXiom: (compIndex: number, xiomIndex: number, updates: Partial<SrosXiom>) => void;
  onRemoveXiom: (compIndex: number, xiomIndex: number) => void;
  onAddXiomMda: (compIndex: number, xiomIndex: number) => void;
  onUpdateXiomMda: (
    compIndex: number,
    xiomIndex: number,
    mdaIndex: number,
    updates: Partial<SrosMda>
  ) => void;
  onRemoveXiomMda: (compIndex: number, xiomIndex: number, mdaIndex: number) => void;
}

interface ComponentEntryProps extends ComponentCallbacks {
  component: SrosComponent;
  index: number;
  srosTypes: SrosComponentTypes;
  onUpdate: (index: number, updates: Partial<SrosComponent>) => void;
  onRemove: (index: number) => void;
}

/** Component header with expand/collapse toggle */
const ComponentHeader: React.FC<{
  slot: string | number | undefined;
  isCpm: boolean;
  type?: string;
  mdaCount: number;
  xiomCount: number;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
}> = ({ slot, isCpm, type, mdaCount, xiomCount, isExpanded, onToggle, onRemove }) => (
  <Box
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: JUSTIFY_SPACE_BETWEEN,
      paddingInline: 12,
      paddingBlock: 4,
      cursor: "pointer"
    }}
    onClick={onToggle}
  >
    <Box style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {isExpanded ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
      <Badge size="sm" variant="default">
        {slot}
      </Badge>
      <Text size="sm">{isCpm ? "Control Processing Module" : "Line Card"}</Text>
      {!isCpm && type !== undefined && type.length > 0 && (
        <Text size="xs" c="dimmed">
          ({type})
        </Text>
      )}
      {!isCpm && (type === undefined || type.length === 0) && (mdaCount > 0 || xiomCount > 0) && (
        <Text size="xs" c="dimmed">
          ({mdaCount} MDA, {xiomCount} XIOM)
        </Text>
      )}
    </Box>
    <ActionIcon
      variant="subtle"
      color="red"
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      title="Remove component"
    >
      <IconTrash size={18} />
    </ActionIcon>
  </Box>
);

/** MDA section for a component */
const ComponentMdaSection: React.FC<
  {
    component: SrosComponent;
    index: number;
    srosTypes: SrosComponentTypes;
  } & Pick<ComponentCallbacks, "onAddMda" | "onUpdateMda" | "onRemoveMda">
> = ({ component, index, srosTypes, onAddMda, onUpdateMda, onRemoveMda }) => (
  <MdaSectionWrapper
    mdas={component.mda ?? []}
    mdaTypes={srosTypes.mda}
    slotPrefix={`${component.slot}\u00A0/\u00A0`}
    parentIndex={index}
    onAddMda={onAddMda}
    onUpdateMda={onUpdateMda}
    onRemoveMda={onRemoveMda}
  />
);

/** XIOM section for a component — tabbed layout */
const ComponentXiomSection: React.FC<
  {
    component: SrosComponent;
    index: number;
    srosTypes: SrosComponentTypes;
  } & Pick<
    ComponentCallbacks,
    | "onAddXiom"
    | "onUpdateXiom"
    | "onRemoveXiom"
    | "onAddXiomMda"
    | "onUpdateXiomMda"
    | "onRemoveXiomMda"
  >
> = ({
  component,
  index,
  srosTypes,
  onAddXiom,
  onUpdateXiom,
  onRemoveXiom,
  onAddXiomMda,
  onUpdateXiomMda,
  onRemoveXiomMda
}) => {
  const xioms = component.xiom ?? [];
  const [activeXiomTab, setActiveXiomTab] = useState(0);

  // Clamp active tab if a XIOM was removed
  const clampedTab = Math.min(activeXiomTab, xioms.length - 1);
  const activeXiom = xioms[clampedTab];

  return (
    <>
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: JUSTIFY_SPACE_BETWEEN,
          paddingInline: 16,
          paddingBlock: 8
        }}
      >
        <Text size="sm" fw={600}>
          XIOM Components
        </Text>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconPlus size={20} />}
          onClick={() => onAddXiom(index)}
          disabled={xioms.length >= 2}
          title={xioms.length >= 2 ? "XIOM slots x1 and x2 are already defined" : undefined}
        >
          Add
        </Button>
      </Box>
      <Divider />
      {xioms.length > 0 && (
        <>
          <Box style={{ display: "flex", alignItems: "center" }}>
            <Tabs
              value={String(clampedTab)}
              onChange={(v) => setActiveXiomTab(Number(v))}
              style={{ flex: 1 }}
            >
              <Tabs.List style={{ flexWrap: "nowrap", overflowX: "auto" }}>
                {xioms.map((xiom, xiomIdx) => (
                  <Tabs.Tab key={xiomIdx} value={String(xiomIdx)}>
                    {`x${xiom.slot ?? xiomIdx + 1}`}
                  </Tabs.Tab>
                ))}
              </Tabs.List>
            </Tabs>
            <ActionIcon
              variant="subtle"
              onClick={() => {
                onRemoveXiom(index, clampedTab);
                setActiveXiomTab(0);
              }}
              color="red"
              title="Remove XIOM"
              style={{ marginRight: 8 }}
            >
              <IconTrash size={18} />
            </ActionIcon>
          </Box>
          <Divider />
          <Box>
            <XiomTabContent
              xiom={activeXiom}
              index={clampedTab}
              cardSlot={component.slot ?? ""}
              srosTypes={srosTypes}
              onUpdate={(idx, updates) => onUpdateXiom(index, idx, updates)}
              onAddMda={(xIdx) => onAddXiomMda(index, xIdx)}
              onUpdateMda={(xIdx, mIdx, updates) => onUpdateXiomMda(index, xIdx, mIdx, updates)}
              onRemoveMda={(xIdx, mIdx) => onRemoveXiomMda(index, xIdx, mIdx)}
            />
          </Box>
        </>
      )}
    </>
  );
};

// ============================================================================
// Component Section - Shared component for CPM and Card sections
// ============================================================================

interface ComponentSectionProps {
  title: string;
  filteredComponents: SrosComponent[];
  allComponents: SrosComponent[];
  srosTypes: SrosComponentTypes;
  updateComponent: (index: number, updates: Partial<SrosComponent>) => void;
  removeComponent: (index: number) => void;
  addMda: (compIndex: number) => void;
  updateMda: (compIndex: number, mdaIndex: number, updates: Partial<SrosMda>) => void;
  removeMda: (compIndex: number, mdaIndex: number) => void;
  addXiom: (compIndex: number) => void;
  updateXiom: (compIndex: number, xiomIndex: number, updates: Partial<SrosXiom>) => void;
  removeXiom: (compIndex: number, xiomIndex: number) => void;
  addXiomMda: (compIndex: number, xiomIndex: number) => void;
  updateXiomMda: (
    compIndex: number,
    xiomIndex: number,
    mdaIndex: number,
    updates: Partial<SrosMda>
  ) => void;
  removeXiomMda: (compIndex: number, xiomIndex: number, mdaIndex: number) => void;
  onAdd: () => void;
  addDisabled?: boolean;
  addDisabledTitle?: string;
}

const ComponentSection: React.FC<ComponentSectionProps> = ({
  title,
  filteredComponents,
  allComponents,
  srosTypes,
  updateComponent,
  removeComponent,
  addMda,
  updateMda,
  removeMda,
  addXiom,
  updateXiom,
  removeXiom,
  addXiomMda,
  updateXiomMda,
  removeXiomMda,
  onAdd,
  addDisabled,
  addDisabledTitle
}) => (
  <>
    <Divider />
    <Box
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: JUSTIFY_SPACE_BETWEEN,
        paddingInline: 16,
        paddingBlock: 8
      }}
    >
      <Text size="sm" fw={600}>
        {title}
      </Text>
      <Button
        variant="subtle"
        size="xs"
        leftSection={<IconPlus size={20} />}
        onClick={onAdd}
        disabled={addDisabled}
        title={addDisabled === true ? addDisabledTitle : undefined}
      >
        Add
      </Button>
    </Box>
    <Divider />
    <Box style={{ margin: 16 }}>
      <Box style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filteredComponents.map((comp) => {
          const realIndex = allComponents.indexOf(comp);
          return (
            <ComponentEntry
              key={realIndex}
              component={comp}
              index={realIndex}
              srosTypes={srosTypes}
              onUpdate={updateComponent}
              onRemove={removeComponent}
              onAddMda={addMda}
              onUpdateMda={updateMda}
              onRemoveMda={removeMda}
              onAddXiom={addXiom}
              onUpdateXiom={updateXiom}
              onRemoveXiom={removeXiom}
              onAddXiomMda={addXiomMda}
              onUpdateXiomMda={updateXiomMda}
              onRemoveXiomMda={removeXiomMda}
            />
          );
        })}
      </Box>
    </Box>
  </>
);

interface ComponentSlotTypeRowProps {
  index: number;
  component: SrosComponent;
  typeOptions: string[];
  slotPlaceholder: string;
  onUpdate: (index: number, updates: Partial<SrosComponent>) => void;
  onRemove?: () => void;
  removeTitle?: string;
  padded?: boolean;
}

const ComponentSlotTypeRow: React.FC<ComponentSlotTypeRowProps> = ({
  index,
  component,
  typeOptions,
  slotPlaceholder,
  onUpdate,
  onRemove,
  removeTitle,
  padded = false
}) => (
  <Box
    style={{
      display: "grid",
      gridTemplateColumns: onRemove ? "1fr 4fr auto" : "1fr 4fr",
      gap: 12,
      alignItems: "center",
      ...(padded ? { padding: 12 } : {})
    }}
  >
    <InputField
      id={`comp-slot-${index}`}
      label="Slot"
      value={String(component.slot ?? "")}
      onChange={(v) => onUpdate(index, { slot: v })}
      placeholder={slotPlaceholder}
    />
    <FilterableDropdown
      id={`comp-type-${index}`}
      label="Type"
      value={component.type ?? ""}
      onChange={(v) => onUpdate(index, { type: v })}
      options={toOptions(typeOptions)}
      allowFreeText
    />
    {onRemove && (
      <ActionIcon variant="subtle" color="red" onClick={onRemove} title={removeTitle}>
        <IconTrash size={18} />
      </ActionIcon>
    )}
  </Box>
);

const ComponentEntry: React.FC<ComponentEntryProps> = (props) => {
  const { component, index, srosTypes, onUpdate, onRemove } = props;
  const [isExpanded, setIsExpanded] = useState(true);
  const isCpm = isCpmSlot(component.slot);
  const typeOptions = isCpm ? srosTypes.cpm : srosTypes.card;

  if (isCpm) {
    return (
      <Paper withBorder style={{ padding: 12 }}>
        <ComponentSlotTypeRow
          index={index}
          component={component}
          typeOptions={typeOptions}
          slotPlaceholder="A or B"
          onUpdate={onUpdate}
          onRemove={() => onRemove(index)}
          removeTitle="Remove CPM"
        />
      </Paper>
    );
  }

  const mdaCount = component.mda?.length ?? 0;
  const xiomCount = component.xiom?.length ?? 0;

  return (
    <Paper withBorder style={{ overflow: "hidden" }}>
      <ComponentHeader
        slot={component.slot}
        isCpm={false}
        type={component.type}
        mdaCount={mdaCount}
        xiomCount={xiomCount}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(!isExpanded)}
        onRemove={() => onRemove(index)}
      />

      <Collapse in={isExpanded}>
        <Divider />
        <Box>
          <ComponentSlotTypeRow
            index={index}
            component={component}
            typeOptions={typeOptions}
            slotPlaceholder="1, 2, ..."
            onUpdate={onUpdate}
            padded={true}
          />
          <Divider />
          <ComponentMdaSection {...props} />
          <Divider />
          <ComponentXiomSection {...props} />
        </Box>
      </Collapse>
    </Paper>
  );
};

// ============================================================================
// Integrated Mode - simpler MDA-only configuration
// ============================================================================

interface IntegratedModeSectionProps {
  components: SrosComponent[];
  srosTypes: SrosComponentTypes;
  onChange: (components: SrosComponent[]) => void;
}

const IntegratedModeSection: React.FC<IntegratedModeSectionProps> = ({
  components,
  srosTypes,
  onChange
}) => {
  const integratedComp = components.find((c) => c.slot === undefined || c.slot === "") ?? {
    mda: []
  };
  const mdas = integratedComp.mda ?? [];

  const updateMda = (index: number, updates: Partial<SrosMda>) => {
    const newMdas = [...mdas];
    newMdas[index] = { ...newMdas[index], ...updates };
    onChange([{ ...integratedComp, mda: newMdas }]);
  };

  const removeMda = (index: number) => {
    const newMdas = mdas.filter((_, i) => i !== index);
    onChange([{ ...integratedComp, mda: newMdas }]);
  };

  const addMda = () => {
    const nextSlot = mdas.length > 0 ? Math.max(...mdas.map((m) => m.slot ?? 0)) + 1 : 1;
    onChange([{ ...integratedComp, mda: [...mdas, { slot: nextSlot }] }]);
  };

  return (
    <>
      <Divider />
      <Box
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: JUSTIFY_SPACE_BETWEEN,
          paddingInline: 16,
          paddingBlock: 8
        }}
      >
        <Text size="sm" fw={600}>
          MDA Configuration
        </Text>
        <Button variant="subtle" size="xs" leftSection={<IconPlus size={20} />} onClick={addMda}>
          Add
        </Button>
      </Box>
      <Divider />
      <Box style={{ padding: 16 }}>
        <Box style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {mdas.map((mda, mdaIdx) => (
            <MdaEntry
              key={mdaIdx}
              mda={mda}
              index={mdaIdx}
              mdaTypes={srosTypes.mda}
              onUpdate={updateMda}
              onRemove={removeMda}
            />
          ))}
        </Box>
      </Box>
    </>
  );
};

// ============================================================================
// Distributed Mode - full CPM/Card/SFM/MDA/XIOM configuration
// ============================================================================

interface DistributedModeSectionProps {
  components: SrosComponent[];
  sfmValue: string;
  srosTypes: SrosComponentTypes;
  onComponentsChange: (components: SrosComponent[]) => void;
  onSfmChange: (sfm: string) => void;
}

const DistributedModeSection: React.FC<DistributedModeSectionProps> = ({
  components,
  sfmValue,
  srosTypes,
  onComponentsChange,
  onSfmChange
}) => {
  const cpmComponents = components.filter((c) => isCpmSlot(c.slot));
  const cardComponents = components.filter(
    (c) => !isCpmSlot(c.slot) && c.slot !== undefined && c.slot !== ""
  );

  const updateComponent = useCallback(
    (index: number, updates: Partial<SrosComponent>) => {
      const newComponents = [...components];
      newComponents[index] = { ...newComponents[index], ...updates };
      onComponentsChange(newComponents);
    },
    [components, onComponentsChange]
  );

  const removeComponent = useCallback(
    (index: number) => {
      onComponentsChange(components.filter((_, i) => i !== index));
    },
    [components, onComponentsChange]
  );

  const addCpm = () => {
    const usedSlots = cpmComponents.map((c) => String(c.slot).toUpperCase());
    let newSlot: string | null = null;
    if (!usedSlots.includes("A")) {
      newSlot = "A";
    } else if (!usedSlots.includes("B")) {
      newSlot = "B";
    }
    if (newSlot !== null) {
      onComponentsChange([...components, { slot: newSlot }]);
    }
  };

  const addCard = () => {
    const usedSlots = cardComponents.map((c) => Number(c.slot)).filter((n) => !isNaN(n));
    const newSlot = usedSlots.length > 0 ? Math.max(...usedSlots) + 1 : 1;
    onComponentsChange([...components, { slot: newSlot }]);
  };

  // MDA operations
  const addMda = (compIndex: number) => {
    const comp = components[compIndex];
    const mdas = comp.mda ?? [];
    const nextSlot = mdas.length > 0 ? Math.max(...mdas.map((m) => m.slot ?? 0)) + 1 : 1;
    updateComponent(compIndex, { mda: [...mdas, { slot: nextSlot }] });
  };

  const updateMda = (compIndex: number, mdaIndex: number, updates: Partial<SrosMda>) => {
    const comp = components[compIndex];
    const mdas = [...(comp.mda ?? [])];
    mdas[mdaIndex] = { ...mdas[mdaIndex], ...updates };
    updateComponent(compIndex, { mda: mdas });
  };

  const removeMda = (compIndex: number, mdaIndex: number) => {
    const comp = components[compIndex];
    updateComponent(compIndex, { mda: (comp.mda ?? []).filter((_, i) => i !== mdaIndex) });
  };

  // XIOM operations
  const addXiom = (compIndex: number) => {
    const comp = components[compIndex];
    const xioms = comp.xiom ?? [];
    const usedSlots = xioms.map((x) => x.slot ?? 0);
    const nextSlot = usedSlots.includes(1) && !usedSlots.includes(2) ? 2 : 1;
    updateComponent(compIndex, { xiom: [...xioms, { slot: nextSlot }] });
  };

  const updateXiom = (compIndex: number, xiomIndex: number, updates: Partial<SrosXiom>) => {
    const comp = components[compIndex];
    const xioms = [...(comp.xiom ?? [])];
    xioms[xiomIndex] = { ...xioms[xiomIndex], ...updates };
    updateComponent(compIndex, { xiom: xioms });
  };

  const removeXiom = (compIndex: number, xiomIndex: number) => {
    const comp = components[compIndex];
    updateComponent(compIndex, { xiom: (comp.xiom ?? []).filter((_, i) => i !== xiomIndex) });
  };

  // XIOM MDA operations
  const addXiomMda = (compIndex: number, xiomIndex: number) => {
    const comp = components[compIndex];
    const xiom = comp.xiom?.at(xiomIndex);
    if (xiom === undefined) return;
    const mdas = xiom.mda ?? [];
    const nextSlot = mdas.length > 0 ? Math.max(...mdas.map((m) => m.slot ?? 0)) + 1 : 1;
    const newXioms = [...(comp.xiom ?? [])];
    newXioms[xiomIndex] = { ...xiom, mda: [...mdas, { slot: nextSlot }] };
    updateComponent(compIndex, { xiom: newXioms });
  };

  const updateXiomMda = (
    compIndex: number,
    xiomIndex: number,
    mdaIndex: number,
    updates: Partial<SrosMda>
  ) => {
    const comp = components[compIndex];
    const xiom = comp.xiom?.at(xiomIndex);
    if (xiom === undefined) return;
    const mdas = [...(xiom.mda ?? [])];
    mdas[mdaIndex] = { ...mdas[mdaIndex], ...updates };
    const newXioms = [...(comp.xiom ?? [])];
    newXioms[xiomIndex] = { ...xiom, mda: mdas };
    updateComponent(compIndex, { xiom: newXioms });
  };

  const removeXiomMda = (compIndex: number, xiomIndex: number, mdaIndex: number) => {
    const comp = components[compIndex];
    const xiom = comp.xiom?.at(xiomIndex);
    if (xiom === undefined) return;
    const newXioms = [...(comp.xiom ?? [])];
    newXioms[xiomIndex] = { ...xiom, mda: (xiom.mda ?? []).filter((_, i) => i !== mdaIndex) };
    updateComponent(compIndex, { xiom: newXioms });
  };

  // Common props for both CPM and Card sections
  const commonSectionProps = {
    allComponents: components,
    srosTypes,
    updateComponent,
    removeComponent,
    addMda,
    updateMda,
    removeMda,
    addXiom,
    updateXiom,
    removeXiom,
    addXiomMda,
    updateXiomMda,
    removeXiomMda
  };

  return (
    <>
      {/* CPM Components */}
      <ComponentSection
        {...commonSectionProps}
        title="Control Processing Modules (CPM)"
        filteredComponents={cpmComponents}
        onAdd={addCpm}
        addDisabled={cpmComponents.length >= 2}
        addDisabledTitle="CPM slots A and B are already defined"
      />

      {/* Card Components */}
      <ComponentSection
        {...commonSectionProps}
        title="Line Cards"
        filteredComponents={cardComponents}
        onAdd={addCard}
      />

      {/* SFM Configuration */}
      <Divider />
      <Box style={{ paddingInline: 16, paddingBlock: 8 }}>
        <Text size="sm" fw={600}>
          Switch Fabric Module (SFM)
        </Text>
      </Box>
      <Divider />
      <Box style={{ padding: 16 }}>
        <FilterableDropdown
          id="sfm-type"
          label="SFM Type"
          value={sfmValue}
          onChange={onSfmChange}
          options={toOptions(srosTypes.sfm)}
          allowFreeText
        />
      </Box>
    </>
  );
};

// ============================================================================
// Main ComponentsTab
// ============================================================================

/**
 * ComponentsTab - Main component for SROS component configuration
 * Only visible for nokia_srsim nodes
 */
export const ComponentsTab: React.FC<TabProps> = ({ data, onChange }) => {
  const { srosComponentTypes } = useSchema();
  const isIntegrated = isIntegratedType(data.type);
  const components = data.components ?? [];

  // Extract shared SFM value from first component that has it
  const sfmValue = components.find((c) => typeof c.sfm === "string" && c.sfm.length > 0)?.sfm ?? "";

  const handleComponentsChange = (newComponents: SrosComponent[]) => {
    onChange({ components: newComponents });
  };

  const handleSfmChange = (sfm: string) => {
    // Apply SFM to all components
    const newComponents = components.map((c) => ({ ...c, sfm: sfm || undefined }));
    onChange({ components: newComponents.length > 0 ? newComponents : [{ sfm }] });
  };

  return (
    <Box style={{ display: "flex", flexDirection: "column" }}>
      {isIntegrated ? (
        <IntegratedModeSection
          components={components}
          srosTypes={srosComponentTypes}
          onChange={handleComponentsChange}
        />
      ) : (
        <DistributedModeSection
          components={components}
          sfmValue={sfmValue}
          srosTypes={srosComponentTypes}
          onComponentsChange={handleComponentsChange}
          onSfmChange={handleSfmChange}
        />
      )}
    </Box>
  );
};
