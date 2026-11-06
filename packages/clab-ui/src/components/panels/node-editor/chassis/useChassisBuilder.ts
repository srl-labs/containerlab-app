// What the Components tab knows about a node's chassis, and every edit it can make to it.
import { useMemo, useState } from "react";

import { getDefaultNodeType } from "../../../../core/constants/nodeTypes";
import {
  allChassisSlots,
  canBuildChassis,
  cardSlotChoices,
  checkHardware,
  copyCard,
  findSrsimChassis,
  fitToChassis,
  freeCardSlots,
  hardwareEnvKeys,
  hardwareTargetKey,
  insertComponent,
  installSlot,
  isSlotInstalled,
  issueSlotId,
  layoutChassis,
  moveCard,
  removeSlot,
  SFM_SLOT_ID,
  SRSIM_CHASSIS_ENV,
  starterHardware,
  type ChassisLayout,
  type ChassisSlot,
  type HardwareIssue,
  type HardwareTarget,
  type SrsimChassis
} from "../../../../core/sros/srsimChassis";
import type { SrosComponent, TabProps } from "../types";

export function firstSet(...values: Array<string | undefined>): string {
  return values.find((value) => value !== undefined && value !== "") ?? "";
}

/** The chassis a node runs: only nokia_srsim reads the catalog, its image ships the same file */
function resolveNodeChassis({ data, inheritance }: Pick<TabProps, "data" | "inheritance">) {
  const kind = data.kind?.trim().toLowerCase() ?? "";
  const defaultType = getDefaultNodeType(kind);
  const env = { ...inheritance?.values.env, ...data.env };
  const isSrsim = kind === "nokia_srsim";
  // Containerlab checks a node against the chassis in its env when it has one
  const envChassis = env[SRSIM_CHASSIS_ENV];
  const nodeType = firstSet(
    isSrsim && typeof envChassis === "string" ? envChassis.trim() : undefined,
    data.type,
    inheritance?.values.type,
    defaultType
  );
  return { kind, defaultType, nodeType, env, chassis: isSrsim ? findSrsimChassis(nodeType) : undefined };
}

/** Picked when somebody closes the open slot, so that none opens in its place */
const NOTHING_OPEN = "";

/** The slot to open: the one picked if it still exists, else the first card, else a CPM */
function resolveSelection(
  picked: string | undefined,
  layout: ChassisLayout,
  showSfm: boolean
): string | undefined {
  if (picked === NOTHING_OPEN) return undefined;
  if (picked === SFM_SLOT_ID && showSfm) return picked;
  const installed = allChassisSlots(layout).filter(isSlotInstalled);
  if (installed.some((slot) => slot.id === picked)) return picked;
  return (layout.cards.find(isSlotInstalled) ?? installed.at(0))?.id;
}

function firstMessageByTarget(issues: HardwareIssue[]): Map<string, string> {
  const messages = new Map<string, string>();
  for (const { target, message } of issues) {
    const key = hardwareTargetKey(target);
    if (!messages.has(key)) messages.set(key, message);
  }
  return messages;
}

function slotsWithIssues(issues: HardwareIssue[], layout: ChassisLayout): Set<string> {
  const ids = new Set<string>();
  for (const { target } of issues) {
    const id = issueSlotId(target, layout);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

export interface ChassisBuilder {
  kind: string;
  defaultType: string | undefined;
  nodeType: string;
  chassis: SrsimChassis | undefined;
  components: SrosComponent[];
  sfm: string;
  /** Env keys that override what this tab sets */
  envOverrides: string[];
  layout: ChassisLayout;
  issues: HardwareIssue[];
  issueSlots: ReadonlySet<string>;
  issueAt: (target: HardwareTarget) => string | undefined;
  showSfm: boolean;
  isEmpty: boolean;
  canStart: boolean;
  /** The slot to bring into view, after somebody asked for it */
  revealId: string | undefined;
  /** The slot whose details are showing */
  selectedId: string | undefined;
  openSlots: string[];
  /** Card slots a card can go to, in chassis order */
  slotChoices: string[];
  pick: (id: string) => void;
  toggle: (id: string) => void;
  setType: (type: string) => void;
  setSfm: (sfm: string) => void;
  install: (slot: ChassisSlot) => void;
  installSfm: () => void;
  applyStarter: () => void;
  fit: () => void;
  updateSlot: (slot: ChassisSlot, updates: Partial<SrosComponent>) => void;
  removeFromSlot: (slot: ChassisSlot) => void;
  copyToOpenSlot: (slot: ChassisSlot) => void;
  moveToSlot: (slot: ChassisSlot, name: string) => void;
}

export function useChassisBuilder({
  data,
  onChange,
  inheritance
}: Pick<TabProps, "data" | "onChange" | "inheritance">): ChassisBuilder {
  const [pickedId, setPickedId] = useState<string>();
  const [revealId, setRevealId] = useState<string>();
  const openSlot = (id: string): void => {
    setPickedId(id);
    setRevealId(id);
  };

  const { kind, defaultType, nodeType, env, chassis } = resolveNodeChassis({ data, inheritance });
  const components = useMemo(() => data.components ?? [], [data.components]);
  const sfm = data.sfm ?? "";

  const layout = useMemo(() => layoutChassis(chassis, components), [chassis, components]);
  const issues = useMemo(() => checkHardware(chassis, sfm, components), [chassis, sfm, components]);
  const messages = useMemo(() => firstMessageByTarget(issues), [issues]);
  const issueSlots = useMemo(() => slotsWithIssues(issues, layout), [issues, layout]);

  const showSfm = chassis === undefined || chassis.sfm.length > 0 || sfm !== "";
  const isEmpty = components.length === 0 && sfm === "";
  const openSlots = freeCardSlots(chassis, layout);
  const selectedId = resolveSelection(pickedId, layout, showSfm);
  const setComponents = (next: SrosComponent[]): void => onChange({ components: next });

  return {
    kind,
    defaultType,
    nodeType,
    chassis,
    components,
    sfm,
    envOverrides: hardwareEnvKeys(env, components),
    layout,
    issues,
    issueSlots,
    issueAt: (target) => messages.get(hardwareTargetKey(target)),
    showSfm,
    isEmpty,
    canStart: chassis !== undefined && isEmpty && canBuildChassis(chassis),
    revealId,
    selectedId,
    openSlots,
    slotChoices: cardSlotChoices(chassis, layout),
    pick: openSlot,
    toggle: (id) => {
      if (selectedId === id) setPickedId(NOTHING_OPEN);
      else openSlot(id);
    },
    setType: (type) => onChange({ type }),
    setSfm: (value) => onChange({ sfm: value }),
    install: (slot) => {
      setComponents(installSlot(chassis, components, slot.label));
      // A CPM of a distributed chassis has nothing to open, so whatever is open stays that way
      if (slot.role === "card" || chassis?.integrated === true) openSlot(slot.id);
      else setRevealId(slot.id);
    },
    installSfm: () => {
      const first = chassis?.sfm.at(0);
      if (first !== undefined) onChange({ sfm: first });
      setRevealId(SFM_SLOT_ID);
    },
    applyStarter: () => {
      if (!chassis) return;
      onChange(starterHardware(chassis));
      openSlot("1");
    },
    fit: () => {
      if (chassis) onChange(fitToChassis(chassis, sfm, components));
    },
    updateSlot: (slot, updates) => {
      if (slot.componentIndex !== undefined) {
        setComponents(
          components.map((component, index) =>
            index === slot.componentIndex ? { ...component, ...updates } : component
          )
        );
        return;
      }
      // Built-in hardware gets its entry with the first override; only a second CPM needs slots
      const named = chassis?.redundant === true ? { slot: slot.label } : {};
      setComponents(insertComponent(components, { ...named, ...updates }));
    },
    removeFromSlot: (slot) => {
      setComponents(removeSlot(chassis, components, slot));
      if (selectedId === slot.id) setPickedId(undefined);
    },
    copyToOpenSlot: (slot) => {
      const target = openSlots.at(0);
      if (target === undefined || slot.componentIndex === undefined) return;
      setComponents(copyCard(components, slot.componentIndex, target));
      openSlot(target);
    },
    moveToSlot: (slot, name) => {
      if (slot.componentIndex === undefined || name === slot.label) return;
      setComponents(moveCard(components, slot.componentIndex, name));
      // Whichever card was open stays open, wherever it went
      if (selectedId === slot.id) openSlot(name);
      else setPickedId(selectedId === name ? slot.label : (selectedId ?? NOTHING_OPEN));
    }
  };
}
