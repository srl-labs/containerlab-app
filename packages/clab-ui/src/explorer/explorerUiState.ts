import type {
  ExplorerNode,
  ExplorerSectionId,
  ExplorerSectionSnapshot,
  ExplorerUiState
} from "./shared/explorer/types";

type ExpandedBySection = NonNullable<ExplorerUiState["expandedBySection"]>;

export function flattenNodeIds(nodes: ExplorerNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    ids.push(node.id);
    ids.push(...flattenNodeIds(node.children));
  }
  return ids;
}

export function flattenExpandableNodeIds(nodes: ExplorerNode[]): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    if (node.hasChildren || node.children.length > 0) {
      ids.push(node.id);
      ids.push(...flattenExpandableNodeIds(node.children));
    }
  }
  return ids;
}

export function flattenDescendantNodeIds(node: ExplorerNode): string[] {
  const ids: string[] = [];
  for (const child of node.children) {
    ids.push(child.id);
    ids.push(...flattenDescendantNodeIds(child));
  }
  return ids;
}

function cloneExpandedBySection(expandedBySection: ExplorerUiState["expandedBySection"]): ExpandedBySection {
  const next: ExpandedBySection = {};
  for (const [sectionId, itemIds] of Object.entries(expandedBySection ?? {})) {
    next[sectionId as ExplorerSectionId] = [...itemIds];
  }
  return next;
}

export function withExpandedSectionItems(
  expandedBySection: ExplorerUiState["expandedBySection"],
  sectionId: ExplorerSectionId,
  itemIds: readonly string[]
): ExpandedBySection {
  return {
    ...cloneExpandedBySection(expandedBySection),
    [sectionId]: [...itemIds]
  };
}

export function shouldPersistExpandedSectionImmediately(sectionId: ExplorerSectionId): boolean {
  return sectionId === "fileExplorer";
}

export function nextExpandedItemsForNodeToggle(input: {
  childIdsToExpand?: readonly string[];
  descendantIds?: readonly string[];
  expandedItems: readonly string[];
  nodeId: string;
  resetDescendants: boolean;
}): string[] {
  const { childIdsToExpand = [], descendantIds = [], expandedItems, nodeId, resetDescendants } = input;
  const isExpanded = expandedItems.includes(nodeId);
  const descendantSet = resetDescendants ? new Set(descendantIds) : null;

  if (isExpanded) {
    return expandedItems.filter((id) => id !== nodeId && !(descendantSet?.has(id) ?? false));
  }

  const nextExpanded = descendantSet
    ? expandedItems.filter((id) => !descendantSet.has(id))
    : [...expandedItems];
  if (!nextExpanded.includes(nodeId)) {
    nextExpanded.push(nodeId);
  }
  for (const childId of childIdsToExpand) {
    if (!nextExpanded.includes(childId)) {
      nextExpanded.push(childId);
    }
  }
  return nextExpanded;
}

export function nextExpandedBySectionForSnapshot(input: {
  current: ExplorerUiState["expandedBySection"];
  expandedBeforeFilter: ExplorerUiState["expandedBySection"] | null;
  filterText: string;
  sections: readonly ExplorerSectionSnapshot[];
}): {
  expandedBeforeFilter: ExplorerUiState["expandedBySection"] | null;
  expandedBySection: ExplorerUiState["expandedBySection"];
} {
  const { current, expandedBeforeFilter, filterText, sections } = input;
  const filterActive = filterText.length > 0;

  if (filterActive) {
    const next = cloneExpandedBySection(current);
    for (const section of sections) {
      if (section.id === "runningLabs" || section.id === "localLabs") {
        next[section.id] = flattenExpandableNodeIds(section.nodes);
      }
    }
    return {
      expandedBeforeFilter: expandedBeforeFilter ?? cloneExpandedBySection(current),
      expandedBySection: next
    };
  }

  if (expandedBeforeFilter) {
    return {
      expandedBeforeFilter: null,
      expandedBySection: {
        ...cloneExpandedBySection(expandedBeforeFilter),
        fileExplorer: [...(current?.fileExplorer ?? expandedBeforeFilter.fileExplorer ?? [])]
      }
    };
  }

  return {
    expandedBeforeFilter: null,
    expandedBySection: current
  };
}

/**
 * Nodes that start expanded and appear for the first time, by section. They
 * are remembered in `seen`, so a later collapse sticks.
 */
export function takeDefaultExpandedIds(
  sections: readonly ExplorerSectionSnapshot[],
  seen: Set<string>
): Partial<Record<ExplorerSectionSnapshot["id"], string[]>> {
  const result: Partial<Record<ExplorerSectionSnapshot["id"], string[]>> = {};
  for (const section of sections) {
    const added: string[] = [];
    const visit = (nodes: readonly ExplorerSectionSnapshot["nodes"][number][]) => {
      for (const node of nodes) {
        const key = `${section.id}\u0000${node.id}`;
        if (node.defaultExpanded === true && !seen.has(key)) {
          seen.add(key);
          added.push(node.id);
        }
        visit(node.children);
      }
    };
    visit(section.nodes);
    if (added.length > 0) result[section.id] = added;
  }
  return result;
}

/** Adds ids to the expanded items of their sections. */
export function withExpandedIds(
  expandedBySection: ExplorerUiState["expandedBySection"],
  additions: Partial<Record<ExplorerSectionSnapshot["id"], string[]>>
): ExplorerUiState["expandedBySection"] {
  let next = expandedBySection;
  for (const [sectionId, ids] of Object.entries(additions) as Array<
    [ExplorerSectionSnapshot["id"], string[]]
  >) {
    const current = next?.[sectionId] ?? [];
    next = { ...next, [sectionId]: [...current, ...ids.filter((id) => !current.includes(id))] };
  }
  return next;
}

export function buildExplorerUiState(input: {
  collapsedBySection: ExplorerUiState["collapsedBySection"];
  expandedBySection: ExplorerUiState["expandedBySection"];
  heightRatioBySection: ExplorerUiState["heightRatioBySection"];
  sectionOrder: ExplorerUiState["sectionOrder"];
}): ExplorerUiState {
  return {
    sectionOrder: input.sectionOrder,
    collapsedBySection: input.collapsedBySection,
    expandedBySection: input.expandedBySection,
    heightRatioBySection: input.heightRatioBySection
  };
}
