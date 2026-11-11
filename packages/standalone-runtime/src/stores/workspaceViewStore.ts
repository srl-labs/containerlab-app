import { create } from "zustand";

/** What covers the document area: the editor, the labs overview, or the images view. */
type DocumentView = "editor" | "overview" | "images";

interface WorkspaceViewState {
  /** Which view fills the document area. */
  documentView: DocumentView;
  /** Derived: the labs overview covers the document area (`documentView === "overview"`). */
  overviewOpen: boolean;
  /** The active tab's lab host does not answer, so its lab could not load. */
  unavailableTabId: string | null;
  /** Changes when topology files change, so the overview lists and draws them again. */
  filesRevision: number;
  bumpFilesRevision: () => void;
  setDocumentView: (view: DocumentView) => void;
  /** `true` shows the overview; `false` shows the editor, leaving the images view too. */
  setOverviewOpen: (open: boolean) => void;
  setUnavailableTabId: (tabId: string | null) => void;
}

export const useWorkspaceViewStore = create<WorkspaceViewState>((set) => ({
  documentView: "editor",
  overviewOpen: false,
  unavailableTabId: null,
  filesRevision: 0,
  bumpFilesRevision: () => set((state) => ({ filesRevision: state.filesRevision + 1 })),
  setDocumentView: (documentView) =>
    set((state) => (state.documentView === documentView ? state : { documentView, overviewOpen: documentView === "overview" })),
  setOverviewOpen: (open) =>
    set((state) => {
      const documentView: DocumentView = open ? "overview" : "editor";
      return state.documentView === documentView ? state : { documentView, overviewOpen: open };
    }),
  setUnavailableTabId: (unavailableTabId) =>
    set((state) => (state.unavailableTabId === unavailableTabId ? state : { unavailableTabId }))
}));
