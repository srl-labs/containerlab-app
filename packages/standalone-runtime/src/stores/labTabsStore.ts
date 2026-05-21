import type { TopologyRef } from "@srl-labs/clab-ui/session";
import { create } from "zustand";

import {
  extractEndpointIdFromTopologyId,
  normalizePathValue,
  normalizeStandaloneTopologyRef,
  safeFilename,
  stripTopologySuffix
} from "../standaloneHostShared";

export interface TopologyLabTab {
  kind: "topology";
  id: string;
  endpointId: string;
  title: string;
  topologyRef: TopologyRef;
}

export interface FileLabTab {
  kind: "file";
  id: string;
  endpointId: string;
  title: string;
  path: string;
  content: string;
  originalContent: string;
  saving: boolean;
  error?: string;
}

export type LabTab = TopologyLabTab | FileLabTab;

export interface ResolveLabTabInput {
  endpointId?: string;
  topologyRef: TopologyRef;
}

export interface ResolveFileTabInput {
  content: string;
  endpointId: string;
  path: string;
  title?: string;
}

export interface CloseLabTabResult {
  nextActiveTabId: string | null;
  removed: boolean;
  wasActive: boolean;
}

export interface CloseTabsByEndpointResult {
  nextActiveTabId: string | null;
  removedCount: number;
  removedIds: string[];
  removedWasActive: boolean;
}

interface OpenOrFocusLabTabResult {
  alreadyOpen: boolean;
  tab: LabTab;
}

interface LabTabsStoreState {
  activeTabId: string | null;
  tabs: LabTab[];
  clear: () => void;
  closeAllTabs: () => void;
  closeOtherTabs: (tabId: string) => void;
  closeTab: (tabId: string) => CloseLabTabResult;
  closeTabsByEndpoint: (endpointId: string) => CloseTabsByEndpointResult;
  openOrFocusTab: (tab: LabTab) => OpenOrFocusLabTabResult;
  markFileTabSaved: (tabId: string, content: string) => void;
  setActiveTab: (tabId: string | null) => void;
  setFileTabContent: (tabId: string, content: string) => void;
  setFileTabError: (tabId: string, message?: string) => void;
  setFileTabSaving: (tabId: string, saving: boolean) => void;
}

const FALLBACK_TAB_TITLE = "Topology";

function toTabTitle(topologyRef: TopologyRef): string {
  const labName = topologyRef.labName.trim();
  if (labName.length > 0) {
    return labName;
  }
  const fileName = safeFilename(topologyRef.yamlPath);
  if (fileName.length > 0) {
    return stripTopologySuffix(fileName);
  }
  return FALLBACK_TAB_TITLE;
}

export function buildLabTabId(topologyRef: TopologyRef, endpointId: string): string {
  const normalizedPath = normalizePathValue(topologyRef.yamlPath);
  if (normalizedPath.length > 0) {
    return `${endpointId}::${normalizedPath}`;
  }
  return `${endpointId}::${topologyRef.topologyId}`;
}

export function buildFileLabTabId(endpointId: string, pathValue: string): string {
  return `file:${endpointId}::${normalizePathValue(pathValue)}`;
}

export function isTopologyLabTab(tab: LabTab): tab is TopologyLabTab {
  return tab.kind === "topology";
}

export function isFileLabTab(tab: LabTab | undefined | null): tab is FileLabTab {
  return tab?.kind === "file";
}

export function resolveLabTab(
  input: ResolveLabTabInput,
  fallbackEndpointId?: string
): TopologyLabTab {
  const resolvedEndpointId =
    input.endpointId ??
    extractEndpointIdFromTopologyId(input.topologyRef.topologyId) ??
    fallbackEndpointId;
  if (!resolvedEndpointId) {
    throw new Error("No endpoint is available for this topology.");
  }
  const topologyRef = normalizeStandaloneTopologyRef(input.topologyRef, resolvedEndpointId);
  return {
    kind: "topology",
    id: buildLabTabId(topologyRef, resolvedEndpointId),
    endpointId: resolvedEndpointId,
    title: toTabTitle(topologyRef),
    topologyRef
  };
}

export function resolveFileTab(input: ResolveFileTabInput): FileLabTab {
  const path = normalizePathValue(input.path);
  if (!path) {
    throw new Error("No path is available for this file.");
  }
  const fallbackTitle = safeFilename(path) || "File";
  return {
    kind: "file",
    id: buildFileLabTabId(input.endpointId, path),
    endpointId: input.endpointId,
    title: input.title?.trim() || fallbackTitle,
    path,
    content: input.content,
    originalContent: input.content,
    saving: false
  };
}

export const useLabTabsStore = create<LabTabsStoreState>((set, get) => ({
  activeTabId: null,
  tabs: [],

  setActiveTab: (tabId) => {
    if (tabId === null) {
      set({ activeTabId: null });
      return;
    }
    if (!get().tabs.some((tab) => tab.id === tabId)) {
      return;
    }
    set({ activeTabId: tabId });
  },

  openOrFocusTab: (tab) => {
    const state = get();
    const existingIndex = state.tabs.findIndex((entry) => entry.id === tab.id);
    if (existingIndex >= 0) {
      const nextTabs = [...state.tabs];
      const existingTab = nextTabs[existingIndex];
      const keepDirtyFileState =
        isFileLabTab(existingTab) &&
        isFileLabTab(tab) &&
        existingTab.content !== existingTab.originalContent;
      nextTabs[existingIndex] = keepDirtyFileState
        ? {
            ...existingTab,
            ...tab,
            content: existingTab.content,
            originalContent: existingTab.originalContent,
            saving: existingTab.saving,
            error: existingTab.error
          }
        : {
            ...existingTab,
            ...tab
          };
      set({
        activeTabId: tab.id,
        tabs: nextTabs
      });
      return {
        alreadyOpen: true,
        tab: nextTabs[existingIndex]
      };
    }

    const nextTabs = [...state.tabs, tab];
    set({
      activeTabId: tab.id,
      tabs: nextTabs
    });
    return {
      alreadyOpen: false,
      tab
    };
  },

  setFileTabContent: (tabId, content) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        isFileLabTab(tab) && tab.id === tabId ? { ...tab, content } : tab
      )
    }));
  },

  setFileTabSaving: (tabId, saving) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        isFileLabTab(tab) && tab.id === tabId ? { ...tab, saving } : tab
      )
    }));
  },

  setFileTabError: (tabId, message) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        isFileLabTab(tab) && tab.id === tabId ? { ...tab, error: message } : tab
      )
    }));
  },

  markFileTabSaved: (tabId, content) => {
    set((state) => ({
      tabs: state.tabs.map((tab) =>
        isFileLabTab(tab) && tab.id === tabId
          ? { ...tab, content, originalContent: content, saving: false, error: undefined }
          : tab
      )
    }));
  },

  closeTab: (tabId) => {
    const state = get();
    const removeIndex = state.tabs.findIndex((tab) => tab.id === tabId);
    if (removeIndex < 0) {
      return {
        nextActiveTabId: state.activeTabId,
        removed: false,
        wasActive: false
      };
    }

    const wasActive = state.activeTabId === tabId;
    const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
    let nextActiveTabId = state.activeTabId;
    if (wasActive) {
      const preferredRight = nextTabs[removeIndex];
      const preferredLeft = nextTabs[removeIndex - 1];
      nextActiveTabId = preferredRight?.id ?? preferredLeft?.id ?? null;
    }

    set({
      activeTabId: nextActiveTabId,
      tabs: nextTabs
    });
    return {
      nextActiveTabId,
      removed: true,
      wasActive
    };
  },

  closeOtherTabs: (tabId) => {
    const state = get();
    const target = state.tabs.find((tab) => tab.id === tabId);
    if (!target) {
      return;
    }
    set({
      activeTabId: target.id,
      tabs: [target]
    });
  },

  closeAllTabs: () => {
    set({
      activeTabId: null,
      tabs: []
    });
  },

  closeTabsByEndpoint: (endpointId) => {
    const state = get();
    const removedIds = state.tabs
      .filter((tab) => tab.endpointId === endpointId)
      .map((tab) => tab.id);
    if (removedIds.length === 0) {
      return {
        nextActiveTabId: state.activeTabId,
        removedCount: 0,
        removedIds: [],
        removedWasActive: false
      };
    }

    const activeTabId = state.activeTabId;
    const activeIndex = activeTabId
      ? state.tabs.findIndex((tab) => tab.id === activeTabId)
      : -1;
    const nextTabs = state.tabs.filter((tab) => tab.endpointId !== endpointId);
    const removedWasActive = activeTabId !== null && removedIds.includes(activeTabId);

    let nextActiveTabId = activeTabId;
    if (removedWasActive) {
      const preferredRight = activeIndex >= 0 ? nextTabs[activeIndex] : undefined;
      const preferredLeft = activeIndex >= 0 ? nextTabs[activeIndex - 1] : undefined;
      nextActiveTabId = preferredRight?.id ?? preferredLeft?.id ?? nextTabs[0]?.id ?? null;
    }

    set({
      activeTabId: nextActiveTabId,
      tabs: nextTabs
    });

    return {
      nextActiveTabId,
      removedCount: removedIds.length,
      removedIds,
      removedWasActive
    };
  },

  clear: () => {
    set({
      activeTabId: null,
      tabs: []
    });
  }
}));
