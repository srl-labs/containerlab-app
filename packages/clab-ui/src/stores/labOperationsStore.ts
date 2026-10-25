import { create } from "zustand";

import { NO_LAB_OPERATIONS, type LabOperationSupport } from "../host/labOperations";

export type LabOperationDialogKind = "exec" | "saveConfigs" | "snapshots" | "details";

interface LabOperationDialog {
  kind: LabOperationDialogKind;
  /** Nodes the dialog starts with; empty means the whole lab. */
  nodeNames: string[];
}

interface LabOperationsState {
  /** What the lab host supports; all false until it answers. */
  support: LabOperationSupport;
  dialog: LabOperationDialog | null;
  setSupport: (support: LabOperationSupport) => void;
  openDialog: (kind: LabOperationDialogKind, nodeNames?: string[]) => void;
  closeDialog: () => void;
}

/** Lab operation dialogs, opened from the navbar and the node menu. */
export const useLabOperationsStore = create<LabOperationsState>((set) => ({
  support: NO_LAB_OPERATIONS,
  dialog: null,
  setSupport: (support) => set({ support }),
  openDialog: (kind, nodeNames = []) => set({ dialog: { kind, nodeNames } }),
  closeDialog: () => set({ dialog: null })
}));
