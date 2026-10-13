import { create } from "zustand";

interface CaptureDialogState {
  /** Canvas node whose interfaces the capture dialog lists, or null when closed. */
  nodeId: string | null;
  openCaptureDialog: (nodeId: string) => void;
  closeCaptureDialog: () => void;
}

export const useCaptureDialogStore = create<CaptureDialogState>((set) => ({
  nodeId: null,
  openCaptureDialog: (nodeId) => set({ nodeId }),
  closeCaptureDialog: () => set({ nodeId: null })
}));
