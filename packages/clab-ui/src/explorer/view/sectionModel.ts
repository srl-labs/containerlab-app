import type { Theme } from "@mui/material/styles";
import {
  EXPLORER_SECTION_IDS,
  type ExplorerNode,
  type ExplorerSectionId,
  type ExplorerSectionSnapshot
} from "../shared/explorer/types";
import { COLOR_TEXT_DISABLED, SECTION_HEADER_HEIGHT_PX, STATUS_COLOR_MAP } from "./constants";

export function statusColor(indicator: string | undefined): string {
  if (!indicator) {
    return COLOR_TEXT_DISABLED;
  }
  return STATUS_COLOR_MAP[indicator] || COLOR_TEXT_DISABLED;
}

export function indicatorThemeColor(theme: Theme, indicator: ExplorerNode["statusIndicator"]): string {
  switch (indicator) {
    case "green":
      return theme.palette.success.main;
    case "red":
      return theme.palette.error.main;
    case "yellow":
      return theme.palette.warning.main;
    case "blue":
      return theme.palette.info.main;
    default:
      return theme.palette.text.disabled;
  }
}

export function formatSectionTitle(section: ExplorerSectionSnapshot): string {
  return section.label;
}

export function showSectionCount(section: ExplorerSectionSnapshot): boolean {
  return section.id !== "helpFeedback";
}

export function isBareTreeSection(section: ExplorerSectionSnapshot): boolean {
  return section.appearance === "bareTree";
}

export function sectionHeaderHeight(section: ExplorerSectionSnapshot): number {
  return isBareTreeSection(section) ? 0 : SECTION_HEADER_HEIGHT_PX;
}

export function mergeSectionOrder(
  currentOrder: ExplorerSectionId[],
  sections: ExplorerSectionSnapshot[]
): ExplorerSectionId[] {
  const visibleIds = sections.map((section) => section.id);
  const visibleSet = new Set(visibleIds);

  const nextOrder = currentOrder.filter((id) => visibleSet.has(id));
  for (let index = 0; index < visibleIds.length; index += 1) {
    const sectionId = visibleIds[index];
    if (!nextOrder.includes(sectionId)) {
      const previousVisibleId = visibleIds
        .slice(0, index)
        .reverse()
        .find((id) => nextOrder.includes(id));
      const insertIndex = previousVisibleId ? nextOrder.indexOf(previousVisibleId) + 1 : 0;
      nextOrder.splice(insertIndex, 0, sectionId);
    }
  }

  return nextOrder;
}

export function reorderSections(
  currentOrder: ExplorerSectionId[],
  sourceId: ExplorerSectionId,
  targetId: ExplorerSectionId
): ExplorerSectionId[] {
  if (sourceId === targetId) {
    return currentOrder;
  }

  const nextOrder = currentOrder.filter((sectionId) => sectionId !== sourceId);
  const targetIndex = nextOrder.indexOf(targetId);
  if (targetIndex < 0) {
    return currentOrder;
  }

  nextOrder.splice(targetIndex, 0, sourceId);
  return nextOrder;
}

export function isExplorerSectionId(value: string): value is ExplorerSectionId {
  return EXPLORER_SECTION_IDS.includes(value as ExplorerSectionId);
}
