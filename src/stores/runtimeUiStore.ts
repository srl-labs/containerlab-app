import type { AlertColor } from "@mui/material/Alert";
import { create } from "zustand";

import type { NetemFields, RuntimeTargetRequest } from "../runtimeApi";

export interface RuntimeInspectRequest {
  mode: "all" | "lab";
  target?: RuntimeTargetRequest;
  title: string;
}

export interface RuntimeNodeRequest extends RuntimeTargetRequest {
  nodeName: string;
  title: string;
}

export interface RuntimeNetemRequest extends RuntimeNodeRequest {
  preferredField?: keyof NetemFields;
  preferredInterfaceName?: string;
}

interface SnackbarState {
  open: boolean;
  message: string;
  severity: AlertColor;
}

interface RuntimeUiState {
  inspectRequest: RuntimeInspectRequest | null;
  logsRequest: RuntimeNodeRequest | null;
  netemRequest: RuntimeNetemRequest | null;
  sshRequest: RuntimeNodeRequest | null;
  versionOpen: boolean;
  snackbar: SnackbarState;
  closeInspect: () => void;
  closeLogs: () => void;
  closeNetem: () => void;
  closeSsh: () => void;
  closeSnackbar: () => void;
  openInspect: (request: RuntimeInspectRequest) => void;
  openLogs: (request: RuntimeNodeRequest) => void;
  openNetem: (request: RuntimeNetemRequest) => void;
  openSsh: (request: RuntimeNodeRequest) => void;
  openVersion: () => void;
  showSnackbar: (message: string, severity?: AlertColor) => void;
}

const defaultSnackbar: SnackbarState = {
  open: false,
  message: "",
  severity: "info"
};

export const useRuntimeUiStore = create<RuntimeUiState>((set) => ({
  inspectRequest: null,
  logsRequest: null,
  netemRequest: null,
  sshRequest: null,
  versionOpen: false,
  snackbar: defaultSnackbar,
  openInspect: (request) => set({ inspectRequest: request }),
  closeInspect: () => set({ inspectRequest: null }),
  openLogs: (request) => set({ logsRequest: request }),
  closeLogs: () => set({ logsRequest: null }),
  openNetem: (request) => set({ netemRequest: request }),
  closeNetem: () => set({ netemRequest: null }),
  openSsh: (request) => set({ sshRequest: request }),
  closeSsh: () => set({ sshRequest: null }),
  openVersion: () => set({ versionOpen: true }),
  closeSnackbar: () => set({ snackbar: defaultSnackbar }),
  showSnackbar: (message, severity = "info") =>
    set({
      snackbar: {
        open: true,
        message,
        severity
      }
    })
}));

export const runtimeUiActions = {
  closeInspect: () => useRuntimeUiStore.getState().closeInspect(),
  closeLogs: () => useRuntimeUiStore.getState().closeLogs(),
  closeNetem: () => useRuntimeUiStore.getState().closeNetem(),
  closeSsh: () => useRuntimeUiStore.getState().closeSsh(),
  closeVersion: () => useRuntimeUiStore.setState({ versionOpen: false }),
  notify: (message: string, severity?: AlertColor) =>
    useRuntimeUiStore.getState().showSnackbar(message, severity),
  openInspectAll: () =>
    useRuntimeUiStore.getState().openInspect({
      mode: "all",
      title: "Inspect All Running Labs"
    }),
  openInspectLab: (target: RuntimeTargetRequest, title: string) =>
    useRuntimeUiStore.getState().openInspect({
      mode: "lab",
      target,
      title
    }),
  openLogs: (request: RuntimeNodeRequest) => useRuntimeUiStore.getState().openLogs(request),
  openNetem: (request: RuntimeNetemRequest) => useRuntimeUiStore.getState().openNetem(request),
  openSsh: (request: RuntimeNodeRequest) => useRuntimeUiStore.getState().openSsh(request),
  openVersion: () => useRuntimeUiStore.getState().openVersion()
};
