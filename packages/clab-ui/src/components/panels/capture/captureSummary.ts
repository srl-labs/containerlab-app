/**
 * What a capture picker says about the current pick: the submit label and,
 * when the pick cannot open the way the user asked, a short hint.
 */
import type { CaptureInterfaceOption, CaptureRequestGroup } from "./captureInterfaceOptions";

export interface CaptureSummary {
  submitLabel: string;
  /** Set when the pick needs explaining, e.g. it opens more Wiresharks than asked for. */
  hint?: string;
}

/** The option as the user reads it, with its node when the list spans nodes. */
export function captureOptionName(option: CaptureInterfaceOption): string {
  return option.nodeLabel !== undefined ? `${option.nodeLabel} · ${option.label}` : option.label;
}

/** Name for one capture session's window or tab, e.g. "1/1/c1/1, 1/1/c2/1". */
export function captureGroupLabel(
  options: readonly CaptureInterfaceOption[],
  group: CaptureRequestGroup
): string {
  const labels = new Map(options.map((option) => [option.name, option.label]));
  return group.interfaceNames.map((name) => labels.get(name) ?? name).join(", ");
}

/** Why one Wireshark for the whole pick turned into several. */
function splitHint(picked: readonly CaptureInterfaceOption[], sessionCount: number): string {
  const hostSide = picked.filter((option) => option.hostNetns).map((option) => option.label);
  if (hostSide.length === 0) {
    return `These interfaces belong to different containers, so they open in ${sessionCount} Wiresharks.`;
  }
  const subject = hostSide.length === 1 ? `${hostSide[0]} is` : `${hostSide.join(", ")} are`;
  return `${subject} only reachable from the host side, so ${sessionCount} Wiresharks open.`;
}

export function summarizeCapture(
  options: readonly CaptureInterfaceOption[],
  selected: ReadonlySet<string>,
  groups: readonly CaptureRequestGroup[],
  separate: boolean
): CaptureSummary {
  const picked = options.filter((option) => selected.has(option.name));
  if (picked.length === 0) return { submitLabel: "Select interfaces to capture" };
  if (picked.length === 1) return { submitLabel: `Capture ${captureOptionName(picked[0])}` };
  if (groups.length <= 1) return { submitLabel: `Capture ${picked.length} interfaces` };
  const submitLabel = `Open ${groups.length} Wiresharks`;
  return separate ? { submitLabel } : { submitLabel, hint: splitHint(picked, groups.length) };
}

/**
 * Link ends: stitched ends share the host network namespace and can open in
 * one Wireshark; ends inside two nodes always open one each.
 */
export function summarizeLinkCapture(
  options: readonly CaptureInterfaceOption[],
  selected: ReadonlySet<string>,
  groups: readonly CaptureRequestGroup[]
): CaptureSummary {
  const picked = options.filter((option) => selected.has(option.name));
  if (picked.length === 0) return { submitLabel: "Select the ends to capture" };
  if (picked.length === 1) return { submitLabel: `Capture ${captureOptionName(picked[0])}` };
  if (groups.length === 1) {
    return { submitLabel: "Capture both ends", hint: "Each packet shows up once per end." };
  }
  const submitLabel = `Open ${groups.length} Wiresharks`;
  if (picked.every((option) => option.hostNetns)) return { submitLabel };
  return {
    submitLabel,
    hint: "The ends are in different network namespaces, so each opens in its own Wireshark."
  };
}
