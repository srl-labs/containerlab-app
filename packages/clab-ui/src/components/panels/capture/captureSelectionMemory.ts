import type { CaptureInterfaceOption } from "./captureInterfaceOptions";

/** Last capture selection per container, kept for the page session. */
const rememberedSelections = new Map<string, string[]>();

export function rememberCaptureSelection(containerName: string, interfaceNames: string[]): void {
  rememberedSelections.set(containerName, [...interfaceNames]);
}

/**
 * Interfaces checked when the dialog opens: the last selection for this
 * container when it still applies, otherwise every linked interface. Without
 * link data, the data interfaces stand in, since containerlab creates them for links.
 */
export function initialCaptureSelection(
  containerName: string,
  options: readonly CaptureInterfaceOption[],
  linksKnown = true
): string[] {
  const available = new Set(options.map((option) => option.name));
  const remembered = (rememberedSelections.get(containerName) ?? []).filter((name) =>
    available.has(name)
  );
  if (remembered.length > 0) return remembered;
  return options
    .filter((option) => (linksKnown ? option.peer !== undefined : !option.isManagement))
    .map((option) => option.name);
}
