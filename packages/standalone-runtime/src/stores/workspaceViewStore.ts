import { create } from "zustand";

interface WorkspaceViewState {
  /** The labs overview covers the document area. */
  overviewOpen: boolean;
  /** The active tab's lab host does not answer, so its lab could not load. */
  unavailableTabId: string | null;
  /** Changes when topology files change, so the overview lists and draws them again. */
  filesRevision: number;
  bumpFilesRevision: () => void;
  setOverviewOpen: (open: boolean) => void;
  setUnavailableTabId: (tabId: string | null) => void;
}

export const useWorkspaceViewStore = create<WorkspaceViewState>((set) => ({
  overviewOpen: false,
  unavailableTabId: null,
  filesRevision: 0,
  bumpFilesRevision: () => set((state) => ({ filesRevision: state.filesRevision + 1 })),
  setOverviewOpen: (overviewOpen) => set((state) => (state.overviewOpen === overviewOpen ? state : { overviewOpen })),
  setUnavailableTabId: (unavailableTabId) =>
    set((state) => (state.unavailableTabId === unavailableTabId ? state : { unavailableTabId }))
}));
