// Front panel of a chassis: every slot at a glance, each row with the controls for what is in it.
import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

import {
  allChassisSlots,
  SFM_SLOT_ID,
  type ChassisLayout,
  type ChassisSlot
} from "../../../../core/sros/srsimChassis";
import type { SrosComponent } from "../../../../core/types/editors";
import type { SrosComponentTypes } from "../../../../hooks/editor";
import { controlRadius } from "../../../../theme/surfaces";

import type { SlotChoice } from "./SlotControls";
import { EmptySlot, FixedPart } from "./SlotPlaceholders";
import { InstalledSlot, SfmSlot } from "./SlotRow";
import { useCardDrag } from "./useCardDrag";
import type { ChassisBuilder } from "./useChassisBuilder";

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

/** What sits on a card beyond its type, for the toggle on its row */
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

const SlotGroup: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({
  title,
  note,
  children
}) => (
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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>{children}</Box>
  </Box>
);

/** Installed cards out of the slots the chassis has; a card in a slot it lacks does not count */
function cardCountNote(layout: ChassisLayout, cardSlots: number | undefined): string {
  const installed = layout.cards.filter((slot) => slot.componentIndex !== undefined);
  if (cardSlots === undefined) return `${installed.length} installed`;
  return `${installed.filter((slot) => Number(slot.label) <= cardSlots).length} of ${cardSlots}`;
}

/** The slots a card can go to, saying which of them would swap it with another card */
function describeSlotChoices(
  names: string[],
  cards: ChassisSlot[],
  components: SrosComponent[]
): SlotChoice[] {
  return names.map((name) => {
    const index = cards.find((slot) => slot.label === name)?.componentIndex;
    if (index === undefined) return { name };
    const type = components[index].type;
    return { name, note: type === undefined || type === "" ? "Swap" : `Swap with ${type}` };
  });
}

export interface ChassisNameplate {
  name?: string;
  description?: string;
  /** How the chassis runs, under its name */
  note?: string;
  fixedHardware?: string;
  /** Card slots the chassis has; undefined when the catalog does not know it */
  cardSlots?: number;
}

interface ChassisFrameProps {
  nameplate: ChassisNameplate;
  builder: ChassisBuilder;
  knownTypes: SrosComponentTypes;
  resourceKeys: string[];
  /** Slots stay visible while the lab is locked, without anything to change them */
  readOnly: boolean;
  sfmHint: string | undefined;
}

export const ChassisFrame: React.FC<ChassisFrameProps> = ({
  nameplate,
  builder,
  knownTypes,
  resourceKeys,
  readOnly,
  sfmHint
}) => {
  const { name, description, note, fixedHardware, cardSlots } = nameplate;
  const { chassis, components, layout, sfm, showSfm, selectedId, revealId, issueSlots, issueAt } = builder;
  const drag = useCardDrag(builder.moveToSlot);
  const slotChoices = describeSlotChoices(builder.slotChoices, layout.cards, components);

  // A single built-in slot has nothing to pick between, so it opens straight on its details
  const slots = allChassisSlots(layout);
  const isOnlySlot = !showSfm && slots.length === 1 && slots[0].builtIn;
  const canDrag = !readOnly && !isOnlySlot;

  const renderSlot = (slot: ChassisSlot): React.ReactElement => {
    const component = slot.componentIndex === undefined ? undefined : components[slot.componentIndex];
    const drop = canDrag ? drag.dropProps(slot) : undefined;
    const dragState = drag.stateOf(slot);
    if (component === undefined && !slot.builtIn) {
      return (
        <EmptySlot
          key={slot.id}
          id={slot.id}
          badge={slot.label}
          readOnly={readOnly}
          drop={drop}
          dragState={dragState}
          onInstall={() => builder.install(slot)}
        />
      );
    }
    return (
      <InstalledSlot
        key={slot.id}
        slot={slot}
        component={component}
        chassis={chassis}
        knownTypes={knownTypes}
        resourceKeys={resourceKeys}
        contents={describeSlotContents(component)}
        slotChoices={slotChoices}
        canCopy={builder.openSlots.length > 0}
        readOnly={readOnly}
        isOnlySlot={isOnlySlot}
        isOpen={selectedId === slot.id}
        reveal={revealId === slot.id}
        hasIssue={issueSlots.has(slot.id)}
        issueAt={issueAt}
        grip={canDrag && slot.role === "card" ? drag.gripProps(slot) : undefined}
        drop={drop}
        dragState={dragState}
        onToggle={() => builder.toggle(slot.id)}
        onUpdate={(updates) => builder.updateSlot(slot, updates)}
        onRemove={() => builder.removeFromSlot(slot)}
        onCopy={() => builder.copyToOpenSlot(slot)}
        onMove={(target) => builder.moveToSlot(slot, target)}
      />
    );
  };

  return (
    <Box sx={FRAME_SX} data-testid="chassis-frame">
      {name !== undefined && name !== "" && (
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
      {isOnlySlot ? (
        <SlotGroup title="Hardware">{renderSlot(slots[0])}</SlotGroup>
      ) : (
        <>
          {layout.control.length > 0 && <SlotGroup title="Control">{layout.control.map(renderSlot)}</SlotGroup>}
          {layout.cards.length > 0 && (
            <SlotGroup title="Line cards" note={cardCountNote(layout, cardSlots)}>
              {layout.cards.map(renderSlot)}
            </SlotGroup>
          )}
        </>
      )}
      {showSfm && (
        <SlotGroup title="Fabric">
          {sfm === "" ? (
            <EmptySlot id={SFM_SLOT_ID} badge="SFM" readOnly={readOnly} onInstall={builder.installSfm} />
          ) : (
            <SfmSlot
              chassis={chassis}
              knownTypes={knownTypes}
              value={sfm}
              reveal={revealId === SFM_SLOT_ID}
              issue={issueAt({ kind: "sfm" })}
              hint={sfmHint}
              onChange={builder.setSfm}
            />
          )}
        </SlotGroup>
      )}
    </Box>
  );
};
