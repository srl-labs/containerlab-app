/**
 * What an SR-SIM chassis accepts, and how a node's components fit it.
 *
 * The checks follow containerlab's chassis_info validation (nodes/sros/chassis_info.go):
 * they are advisory there too, so a type the catalog does not list stays usable. MDAs under
 * a XIOM are not checked against the chassis, because the catalog does not say which MDA
 * types a XIOM accepts.
 *
 * The catalog has no slot counts for XIOMs and XCMs either, so those limits are kept by hand
 * below. Containerlab does not check them; they are advisory here like everything else.
 */
import type { SrosComponent, SrosMda, SrosXiom } from "../types/editors";
import { isRecord } from "../utilities/typeHelpers";

import { SRSIM_CHASSIS_INFO, type RawChassisEntry } from "./srsimChassisInfo";

export interface SrsimChassis {
  /** Name as the catalog spells it, e.g. SR-7s */
  name: string;
  /** Runs as one container with its card built in */
  integrated: boolean;
  /** Takes a second CPM in slot B */
  redundant: boolean;
  cardSlots: number;
  cpm: string[];
  card: string[];
  mda: string[];
  xiom: string[];
  sfm: string[];
  /** Hardware that cannot be changed, as cpm or cpm/card */
  fixedHardware?: string;
  /** MDA types that cannot be changed, by MDA slot */
  fixedMdas: Readonly<Partial<Record<number, string>>>;
  /** Cards of this chassis take no separate MDA */
  noSeparateMda: boolean;
  /** Slots a card of this chassis has for an MDA or a XIOM; undefined when no limit is known */
  xcmModuleSlots?: number;
}

/** Id of the SFM tile: the SFM is a node-level key, not a component in a slot */
export const SFM_SLOT_ID = "sfm";

/** Env key that names the chassis; containerlab prefers it over the node's type */
export const SRSIM_CHASSIS_ENV = "NOKIA_SROS_CHASSIS";

const HARDWARE_ENV_KEY = /^NOKIA_SROS_(CHASSIS|CARD|SFM|MDA_\S+|XIOM_\S+)$/;

const CPM_SLOTS = new Set(["A", "B"]);

// From the SR OS interface configuration guide:
// https://documentation.nokia.com/sr/26-10/7750-sr/books/interface-configuration/configuration-overview.html
export const XIOM_MDA_SLOTS = 2;
export const XIOM_MDA_NOTE = `An XIOM has ${XIOM_MDA_SLOTS} MDA slots`;
/** `mda N` and `xiom xN` on one of these cards are the same physical slot N */
const XCM_MODULE_SLOTS = new Map([
  ["SR-2s", 1],
  ["SR-7s", 1],
  ["SR-14s", 2]
]);

/** Containerlab expands ${VAR} before it reads the file, so such a value is unknown here */
function isVariable(value: string): boolean {
  return value.includes("${");
}

const NAMES_BY_LOWERCASE = new Map(
  Object.keys(SRSIM_CHASSIS_INFO).map((name) => [name.toLowerCase(), name])
);

function hasName(name: string): boolean {
  return Object.hasOwn(SRSIM_CHASSIS_INFO, name);
}

/** The entry holding a chassis' hardware, following aliases such as ESS-7 to SR-7 */
function resolveEntry(name: string): RawChassisEntry | undefined {
  const seen = new Set<string>();
  let current = name;
  while (hasName(current) && !seen.has(current)) {
    seen.add(current);
    const entry = SRSIM_CHASSIS_INFO[current];
    if (entry.alias === undefined) return entry;
    current = NAMES_BY_LOWERCASE.get(entry.alias.toLowerCase()) ?? "";
  }
  return undefined;
}

function toFixedMdas(raw: Record<string, string> | undefined): Record<number, string> {
  return Object.fromEntries(Object.entries(raw ?? {}).map(([slot, type]) => [Number(slot), type]));
}

/** The catalog's entry for a node type; containerlab matches types case-insensitively */
export function findSrsimChassis(type: string | undefined): SrsimChassis | undefined {
  const name = NAMES_BY_LOWERCASE.get((type ?? "").trim().toLowerCase());
  const entry = name === undefined ? undefined : resolveEntry(name);
  if (name === undefined || entry === undefined) return undefined;
  const rawMda = entry.mda ?? [];
  return {
    name,
    integrated: entry.integrated === true,
    redundant: entry.redundant === true,
    cardSlots: entry.iom_slots ?? 0,
    cpm: entry.cpm ?? [],
    card: entry.iom ?? [],
    mda: rawMda.filter((type): type is string => type !== null),
    xiom: entry.xiom ?? [],
    sfm: entry.sfm ?? [],
    fixedHardware: entry.fixed_hw_cfg,
    fixedMdas: toFixedMdas(entry.fixed_mdas),
    noSeparateMda: rawMda.includes(null),
    xcmModuleSlots: XCM_MODULE_SLOTS.get(name)
  };
}

// ============================================================================
// Slots
// ============================================================================

type ChassisSlotRole = "cpm" | "card";

export interface ChassisSlot {
  /** Slot name, or #<index> for an entry repeating a slot another entry already holds */
  id: string;
  label: string;
  role: ChassisSlotRole;
  /** The component entry in this slot; absent while there is none */
  componentIndex?: number;
  /** An integrated chassis' own hardware: present even without a component entry */
  builtIn: boolean;
}

export interface ChassisLayout {
  control: ChassisSlot[];
  cards: ChassisSlot[];
}

export function allChassisSlots(layout: ChassisLayout): ChassisSlot[] {
  return [...layout.control, ...layout.cards];
}

export function isSlotInstalled(slot: ChassisSlot): boolean {
  return slot.componentIndex !== undefined || slot.builtIn;
}

/** The slot a component sits in, as containerlab reads it: a missing slot means A */
function componentSlotName(component: SrosComponent): string {
  const raw = String(component.slot ?? "").trim();
  if (isVariable(raw)) return raw;
  const slot = raw.toUpperCase();
  if (slot === "") return "A";
  return /^\d+$/.test(slot) ? String(Number(slot)) : slot;
}

function slotRole(name: string): ChassisSlotRole {
  return CPM_SLOTS.has(name) ? "cpm" : "card";
}

/** Sort rank of a slot in the chassis and in YAML: CPMs, cards by number, the rest last */
function slotRank(name: string): number {
  if (CPM_SLOTS.has(name)) return name === "A" ? 0 : 1;
  const slot = Number(name);
  return Number.isNaN(slot) ? Number.MAX_SAFE_INTEGER : slot + 1;
}

function controlSlotNames(chassis: SrsimChassis | undefined, occupied: Set<string>): string[] {
  const names = new Set<string>();
  if (chassis === undefined || chassis.fixedHardware === undefined) {
    names.add("A");
    if (chassis === undefined || chassis.redundant) names.add("B");
  }
  for (const name of occupied) if (slotRole(name) === "cpm") names.add(name);
  return [...names].sort((a, b) => slotRank(a) - slotRank(b));
}

function cardSlotNames(chassis: SrsimChassis | undefined, occupied: Set<string>): string[] {
  const names = new Set<string>();
  for (const name of occupied) if (slotRole(name) === "card") names.add(name);
  if (chassis === undefined) {
    // Without a catalog entry the chassis can always take another card
    const used = [...names].map(Number).filter((slot) => !Number.isNaN(slot));
    names.add(String(Math.max(0, ...used) + 1));
  } else if (chassis.fixedHardware === undefined && !chassis.integrated) {
    for (let slot = 1; slot <= chassis.cardSlots; slot += 1) names.add(String(slot));
  }
  return [...names].sort((a, b) => slotRank(a) - slotRank(b));
}

/** The slots to show for a chassis: what it offers, plus whatever the node already holds */
export function layoutChassis(
  chassis: SrsimChassis | undefined,
  components: SrosComponent[]
): ChassisLayout {
  const occupied = new Map<string, number>();
  const repeats: ChassisSlot[] = [];
  components.forEach((component, index) => {
    const name = componentSlotName(component);
    if (occupied.has(name)) {
      repeats.push({
        id: `#${index}`,
        label: name,
        role: slotRole(name),
        componentIndex: index,
        builtIn: false
      });
    } else {
      occupied.set(name, index);
    }
  });

  const names = new Set(occupied.keys());
  const toSlot = (name: string): ChassisSlot => ({
    id: name,
    label: name,
    role: slotRole(name),
    componentIndex: occupied.get(name),
    builtIn: name === "A" && chassis?.integrated === true
  });
  return {
    control: [
      ...controlSlotNames(chassis, names).map(toSlot),
      ...repeats.filter((slot) => slot.role === "cpm")
    ],
    cards: [
      ...cardSlotNames(chassis, names).map(toSlot),
      ...repeats.filter((slot) => slot.role === "card")
    ]
  };
}

// ============================================================================
// Checks
// ============================================================================

export type HardwareTarget =
  | { kind: "sfm" }
  | { kind: "cpm" }
  | { kind: "slot" | "type"; component: number }
  | { kind: "xiom"; component: number; xiom: number }
  | { kind: "mda"; component: number; mda: number; xiom?: number };

export interface HardwareIssue {
  target: HardwareTarget;
  message: string;
}

export function hardwareTargetKey(target: HardwareTarget): string {
  switch (target.kind) {
    case "sfm":
    case "cpm":
      return target.kind;
    case "slot":
    case "type":
      return `${target.component}.${target.kind}`;
    case "xiom":
      return `${target.component}.x${target.xiom}`;
    case "mda":
      return `${target.component}.x${target.xiom ?? ""}.m${target.mda}`;
  }
}

function isSet(value: string | undefined): value is string {
  return value !== undefined && value !== "";
}

function isUnlisted(type: string | undefined, listed: string[]): boolean {
  return isSet(type) && !isVariable(type) && listed.length > 0 && !listed.includes(type);
}

/** The hardware's limit on a list of MDAs or XIOMs */
interface SlotLimit {
  highest: number;
  message: string;
}

/** What containerlab refuses in a list of MDAs or XIOMs, and what the hardware has no slot for */
function slotListProblems(
  entries: Array<{ slot?: number }>,
  noun: string,
  limit?: SlotLimit
): Map<number, string> {
  const problems = new Map<number, string>();
  const seen = new Set<number>();
  entries.forEach(({ slot }, index) => {
    if (slot === undefined || slot <= 0) {
      problems.set(index, `${noun} needs a slot number`);
    } else if (seen.has(slot)) {
      problems.set(index, `${noun} slot ${slot} is used twice, which containerlab refuses to deploy`);
    } else if (limit !== undefined && slot > limit.highest) {
      problems.set(index, limit.message);
    }
    if (slot !== undefined) seen.add(slot);
  });
  return problems;
}

/** What a card of this chassis has room for, in words */
export function xcmSlotsNote(chassis: SrsimChassis | undefined): string | undefined {
  const count = chassis?.xcmModuleSlots;
  if (count === undefined) return undefined;
  const room = count === 1 ? "1 slot, for" : `${count} slots, each for`;
  return `An XCM on ${chassis?.name} has ${room} an MDA or an XIOM`;
}

/** What is wrong among a card's own MDAs and XIOMs, each by position in its list */
function moduleProblems(
  chassis: SrsimChassis | undefined,
  component: SrosComponent
): { mda: Map<number, string>; xiom: Map<number, string> } {
  const mdas = component.mda ?? [];
  const xioms = component.xiom ?? [];
  const count = chassis?.xcmModuleSlots;
  if (count === undefined || slotRole(componentSlotName(component)) !== "card") {
    return { mda: slotListProblems(mdas, "MDA"), xiom: slotListProblems(xioms, "XIOM") };
  }
  const limit = { highest: count, message: xcmSlotsNote(chassis) ?? "" };
  const mda = slotListProblems(mdas, "MDA", limit);
  const xiom = slotListProblems(xioms, "XIOM", limit);
  // Flagged on the MDA: fixing it then keeps the XIOM, and whatever sits on that
  const xiomSlots = new Set(xioms.map(({ slot }) => slot));
  mdas.forEach(({ slot }, index) => {
    if (slot !== undefined && xiomSlots.has(slot) && !mda.has(index)) {
      mda.set(index, `XCM slot ${slot} holds either an MDA or an XIOM, not both`);
    }
  });
  return { mda, xiom };
}

function slotIssue(chassis: SrsimChassis, name: string): string | undefined {
  if (name === "B" && !chassis.redundant) return `${chassis.name} has no second CPM`;
  if (slotRole(name) === "cpm" || isVariable(name)) return undefined;
  if (!/^\d+$/.test(name)) return "Not a slot name";
  if (chassis.cardSlots === 0) return `${chassis.name} takes no line cards`;
  if (Number(name) > chassis.cardSlots) {
    return `${chassis.name} has only ${chassis.cardSlots} card ${chassis.cardSlots === 1 ? "slot" : "slots"}`;
  }
  return undefined;
}

function typeIssue(
  chassis: SrsimChassis,
  name: string,
  type: string | undefined
): string | undefined {
  if (!isSet(type) || isVariable(type)) return undefined;
  if (slotRole(name) === "card") {
    return isUnlisted(type, chassis.card) ? `${type} is not listed for ${chassis.name}` : undefined;
  }
  if (chassis.fixedHardware !== undefined) {
    return type === chassis.fixedHardware
      ? undefined
      : `${chassis.name} has fixed hardware: ${chassis.fixedHardware}`;
  }
  return isUnlisted(type, chassis.cpm) ? `${type} is not listed for ${chassis.name}` : undefined;
}

function mdaIssue(chassis: SrsimChassis, mda: SrosMda): string | undefined {
  if (isSet(mda.type) && isVariable(mda.type)) return undefined;
  const fixed = mda.slot === undefined ? undefined : chassis.fixedMdas[mda.slot];
  if (fixed !== undefined) {
    return mda.type === fixed ? undefined : `MDA slot ${mda.slot} always holds ${fixed} on ${chassis.name}`;
  }
  if (!isSet(mda.type)) return undefined;
  if (chassis.mda.length === 0) return `${chassis.name} takes no separate MDA`;
  return chassis.mda.includes(mda.type) ? undefined : `${mda.type} is not listed for ${chassis.name}`;
}

function xiomIssue(chassis: SrsimChassis, xiom: SrosXiom): string | undefined {
  if (chassis.xiom.length === 0) return `${chassis.name} takes no XIOMs`;
  return isUnlisted(xiom.type, chassis.xiom)
    ? `${xiom.type} is not listed for ${chassis.name}`
    : undefined;
}

function componentIssues(
  chassis: SrsimChassis | undefined,
  component: SrosComponent,
  index: number
): HardwareIssue[] {
  const issues: HardwareIssue[] = [];
  const add = (target: HardwareTarget, message: string | undefined): void => {
    if (message !== undefined) issues.push({ target, message });
  };
  const slotName = componentSlotName(component);

  if (chassis) {
    add({ kind: "slot", component: index }, slotIssue(chassis, slotName));
    add({ kind: "type", component: index }, typeIssue(chassis, slotName, component.type));
  }

  // Containerlab does not check MDAs configured on a distributed CPM
  const checkMdas = chassis?.integrated === true || slotRole(slotName) === "card";
  const problems = moduleProblems(chassis, component);
  (component.mda ?? []).forEach((mda, mdaIndex) => {
    const target = { kind: "mda", component: index, mda: mdaIndex } as const;
    const missing = isSet(mda.type) ? undefined : `MDA ${mda.slot ?? ""} needs a type`;
    const fit = chassis && checkMdas ? mdaIssue(chassis, mda) : undefined;
    add(target, problems.mda.get(mdaIndex) ?? fit ?? missing);
  });

  (component.xiom ?? []).forEach((xiom, xiomIndex) => {
    const target = { kind: "xiom", component: index, xiom: xiomIndex } as const;
    const name = `x${xiom.slot ?? ""}`;
    const missing = isSet(xiom.type) ? undefined : `XIOM ${name} needs a type`;
    const fit = chassis ? xiomIssue(chassis, xiom) : undefined;
    add(target, problems.xiom.get(xiomIndex) ?? fit ?? missing);

    const nestedProblems = slotListProblems(xiom.mda ?? [], `MDA under ${name}:`, {
      highest: XIOM_MDA_SLOTS,
      message: XIOM_MDA_NOTE
    });
    (xiom.mda ?? []).forEach((mda, mdaIndex) => {
      const mdaTarget = { kind: "mda", component: index, xiom: xiomIndex, mda: mdaIndex } as const;
      const missingType = isSet(mda.type) ? undefined : `MDA ${name}/${mda.slot ?? ""} needs a type`;
      add(mdaTarget, nestedProblems.get(mdaIndex) ?? missingType);
    });
  });
  return issues;
}

/** Everything about a node's hardware worth a second look, without a catalog entry too */
export function checkHardware(
  chassis: SrsimChassis | undefined,
  sfm: string | undefined,
  components: SrosComponent[]
): HardwareIssue[] {
  const issues: HardwareIssue[] = [];
  if (chassis && isSet(sfm) && !isVariable(sfm) && !chassis.sfm.includes(sfm)) {
    issues.push({
      target: { kind: "sfm" },
      message:
        chassis.sfm.length > 0
          ? `${sfm} is not listed for ${chassis.name}`
          : `${chassis.name} takes no SFM`
    });
  }

  const seen = new Set<string>();
  components.forEach((component, index) => {
    const name = componentSlotName(component);
    if (seen.has(name)) {
      issues.push({
        target: { kind: "slot", component: index },
        message: "Defined twice, which containerlab refuses to deploy"
      });
    }
    seen.add(name);
    issues.push(...componentIssues(chassis, component, index));
  });

  // Containerlab finds a distributed node through its CPM and fails the deploy without one
  const isDistributed = chassis?.integrated !== true && components.length > 1;
  if (isDistributed && !seen.has("A") && !seen.has("B")) {
    issues.push({ target: { kind: "cpm" }, message: "A chassis with cards needs a CPM to deploy" });
  }
  return issues;
}

/** The tile an issue shows on */
export function issueSlotId(target: HardwareTarget, layout: ChassisLayout): string | undefined {
  if (target.kind === "sfm") return SFM_SLOT_ID;
  if (target.kind === "cpm") return "A";
  return allChassisSlots(layout).find((slot) => slot.componentIndex === target.component)?.id;
}

// ============================================================================
// Edits
// ============================================================================

export interface NodeHardware {
  components: SrosComponent[];
  sfm: string;
}

function fitType(
  chassis: SrsimChassis,
  component: SrosComponent,
  name: string
): string | undefined {
  // An integrated chassis works without a type: setting one turns off its generated config
  if (chassis.integrated) return undefined;
  return slotRole(name) === "card"
    ? chassis.card.at(0)
    : (chassis.fixedHardware ?? chassis.cpm.at(0) ?? component.type);
}

function fitComponent(
  chassis: SrsimChassis,
  component: SrosComponent,
  index: number,
  isFlagged: (target: HardwareTarget) => boolean
): SrosComponent {
  const name = componentSlotName(component);
  const next: SrosComponent = { ...component };
  if (isFlagged({ kind: "type", component: index })) next.type = fitType(chassis, component, name);

  const problems = moduleProblems(chassis, component);
  if (component.mda) {
    next.mda = component.mda.flatMap((mda, mdaIndex) => {
      if (!isFlagged({ kind: "mda", component: index, mda: mdaIndex })) return [mda];
      const isFixedSlot = mda.slot !== undefined && chassis.fixedMdas[mda.slot] !== undefined;
      const replacement = chassis.mda.at(0);
      return problems.mda.has(mdaIndex) || isFixedSlot || replacement === undefined
        ? []
        : [{ ...mda, type: replacement }];
    });
  }
  if (component.xiom) {
    next.xiom = component.xiom.flatMap((xiom, xiomIndex) => {
      const fitted: SrosXiom = {
        ...xiom,
        mda: xiom.mda?.filter(
          (_, mdaIndex) => !isFlagged({ kind: "mda", component: index, xiom: xiomIndex, mda: mdaIndex })
        )
      };
      if (!isFlagged({ kind: "xiom", component: index, xiom: xiomIndex })) return [fitted];
      const replacement = chassis.xiom.at(0);
      return problems.xiom.has(xiomIndex) || replacement === undefined
        ? []
        : [{ ...fitted, type: replacement }];
    });
  }
  return next;
}

/**
 * Make a node's hardware fit its chassis: drop what the chassis has no room for and swap
 * unlisted types for the first listed one, leaving everything that already fits alone.
 */
export function fitToChassis(
  chassis: SrsimChassis,
  sfm: string,
  components: SrosComponent[]
): NodeHardware {
  const flagged = new Set(
    checkHardware(chassis, sfm, components).map(({ target }) => hardwareTargetKey(target))
  );
  const isFlagged = (target: HardwareTarget): boolean => flagged.has(hardwareTargetKey(target));
  const fitted = components.flatMap((component, index) =>
    isFlagged({ kind: "slot", component: index })
      ? []
      : [fitComponent(chassis, component, index, isFlagged)]
  );
  return {
    components: isFlagged({ kind: "cpm" }) ? installSlot(chassis, fitted, "A") : fitted,
    sfm: isFlagged({ kind: "sfm" }) ? (chassis.sfm.at(0) ?? "") : sfm
  };
}

function slotValue(name: string): string | number {
  return slotRole(name) === "card" && /^\d+$/.test(name) ? Number(name) : name;
}

/** Add a component where the chassis (and so the YAML) would have it */
export function insertComponent(
  components: SrosComponent[],
  component: SrosComponent
): SrosComponent[] {
  const rank = slotRank(componentSlotName(component));
  const position = components.findIndex((entry) => slotRank(componentSlotName(entry)) > rank);
  return position === -1
    ? [...components, component]
    : [...components.slice(0, position), component, ...components.slice(position)];
}

/** The type a new CPM or card most likely wants: its neighbor's, else the first listed one */
function defaultSlotType(
  chassis: SrsimChassis | undefined,
  components: SrosComponent[],
  name: string
): string | undefined {
  if (chassis?.integrated === true) return undefined;
  const role = slotRole(name);
  const neighbor = components
    .filter((component) => slotRole(componentSlotName(component)) === role && isSet(component.type))
    .at(-1);
  return neighbor?.type ?? (role === "cpm" ? chassis?.cpm.at(0) : chassis?.card.at(0));
}

/** Install hardware in an empty slot, ready to run where the catalog allows it */
export function installSlot(
  chassis: SrsimChassis | undefined,
  components: SrosComponent[],
  name: string
): SrosComponent[] {
  // A redundant integrated chassis only runs both CPMs when both slots are named
  const base =
    chassis?.integrated === true && name === "B"
      ? components.map((component) =>
          componentSlotName(component) === "A" ? { ...component, slot: "A" } : component
        )
      : components;
  const withA =
    chassis?.integrated === true && name === "B" && !base.some((c) => componentSlotName(c) === "A")
      ? insertComponent(base, { slot: "A" })
      : base;
  const type = defaultSlotType(chassis, withA, name);
  return insertComponent(withA, { slot: slotValue(name), ...(type === undefined ? {} : { type }) });
}

/** Take a slot's entry out; an integrated chassis keeps its own hardware, back at the defaults */
export function removeSlot(
  chassis: SrsimChassis | undefined,
  components: SrosComponent[],
  slot: ChassisSlot
): SrosComponent[] {
  if (slot.componentIndex === undefined) return components;
  const remaining = components.filter((_, index) => index !== slot.componentIndex);
  // Slot B alone would not run: both slots stay named until B is gone too
  const keepsSlotA = chassis?.integrated === true && slot.builtIn && remaining.length > 0;
  return keepsSlotA ? insertComponent(remaining, { slot: "A" }) : remaining;
}

/** A first build that deploys: CPM A, one card with its MDA, and the fabric */
export function starterHardware(chassis: SrsimChassis): NodeHardware {
  const [cpmType, cardType, mdaType] = [chassis.cpm.at(0), chassis.card.at(0), chassis.mda.at(0)];
  const cpm: SrosComponent = { slot: "A" };
  if (cpmType !== undefined) cpm.type = cpmType;
  const card: SrosComponent = { slot: 1 };
  if (cardType !== undefined) card.type = cardType;
  if (mdaType !== undefined) card.mda = [{ slot: 1, type: mdaType }];
  return { components: [cpm, card], sfm: chassis.sfm.at(0) ?? "" };
}

/** Whether a chassis has anything to build: integrated and fixed ones come ready to run */
export function canBuildChassis(chassis: SrsimChassis): boolean {
  return !chassis.integrated && chassis.fixedHardware === undefined && chassis.cardSlots > 0;
}

/** Copy a card into another slot, with everything on it */
export function copyCard(
  components: SrosComponent[],
  index: number,
  name: string
): SrosComponent[] {
  return insertComponent(components, { ...components[index], slot: slotValue(name) });
}

/** Move a card to another slot, with everything on it; a card already there swaps places with it */
export function moveCard(
  components: SrosComponent[],
  index: number,
  name: string
): SrosComponent[] {
  const moved = components[index];
  const occupant = components.findIndex(
    (component, position) => position !== index && componentSlotName(component) === name
  );
  const others = components.filter((_, position) => position !== index && position !== occupant);
  const placed = insertComponent(others, { ...moved, slot: slotValue(name) });
  return occupant === -1
    ? placed
    : insertComponent(placed, { ...components[occupant], slot: moved.slot });
}

function lowestFreeSlot(taken: Array<number | undefined>): number {
  const used = new Set(taken);
  let slot = 1;
  while (used.has(slot)) slot += 1;
  return slot;
}

/**
 * The lowest unused MDA slot, leaving out slots whose MDA cannot be changed
 * and slots the XIOMs of an XCM hold.
 */
export function nextMdaSlot(
  mdas: SrosMda[],
  fixedMdas: Readonly<Partial<Record<number, string>>> = {},
  xcmXioms: SrosXiom[] = []
): number {
  return lowestFreeSlot([
    ...[...mdas, ...xcmXioms].map(({ slot }) => slot),
    ...Object.keys(fixedMdas).map(Number)
  ]);
}

/** The lowest unused XIOM slot, leaving out slots the MDAs of an XCM hold */
export function nextXiomSlot(xioms: SrosXiom[], xcmMdas: SrosMda[] = []): number {
  return lowestFreeSlot([...xioms, ...xcmMdas].map(({ slot }) => slot));
}

/** Card slots a card could move to: all open ones, or a sensible range without a catalog entry */
export function freeCardSlots(chassis: SrsimChassis | undefined, layout: ChassisLayout): string[] {
  const free = layout.cards.filter((slot) => slot.componentIndex === undefined).map((slot) => slot.label);
  if (chassis) return free;
  const used = new Set(layout.cards.filter((slot) => slot.componentIndex !== undefined).map((slot) => slot.label));
  const highest = Math.max(0, ...[...used].map(Number).filter((slot) => !Number.isNaN(slot)));
  const range = Array.from({ length: Math.max(12, highest + 1) }, (_, position) => String(position + 1));
  return range.filter((slot) => !used.has(slot));
}

/** Every card slot a card can go to, in chassis order; one holding a card means swapping them */
export function cardSlotChoices(chassis: SrsimChassis | undefined, layout: ChassisLayout): string[] {
  const names = new Set([...layout.cards.map((slot) => slot.label), ...freeCardSlots(chassis, layout)]);
  return [...names].sort((a, b) => slotRank(a) - slotRank(b));
}

/** Env keys that set hardware: containerlab lets them win over type, components and sfm */
export function hardwareEnvKeys(env: unknown, components: SrosComponent[]): string[] {
  const keys = new Set<string>();
  for (const entries of [env, ...components.map((component) => component.extra?.env)]) {
    if (!isRecord(entries)) continue;
    for (const key of Object.keys(entries)) if (HARDWARE_ENV_KEY.test(key)) keys.add(key);
  }
  return [...keys].sort();
}

/** One line on what a chassis takes, for its nameplate */
export function describeChassis(chassis: SrsimChassis): string {
  if (chassis.fixedHardware !== undefined) return "Fixed hardware";
  const parts: string[] = [];
  if (chassis.integrated) parts.push("Integrated");
  else parts.push(`${chassis.cardSlots} card ${chassis.cardSlots === 1 ? "slot" : "slots"}`);
  if (chassis.redundant) parts.push("redundant CPMs");
  if (chassis.xiom.length > 0) parts.push("XIOMs");
  return parts.join(" · ");
}

/** The release in an image reference, such as 25.10.R2; undefined without a tag */
export function imageTag(image: string | undefined): string | undefined {
  const tag = image?.slice(image.lastIndexOf("/") + 1).split(":")[1];
  return isSet(tag) ? tag : undefined;
}
