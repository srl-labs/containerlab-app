import type { AlertColor } from "@mui/material/Alert";
import { create } from "zustand";

import type { NetemFields, RuntimeTargetRequest, TerminalProtocol } from "../runtimeApi";
import { extractEndpointIdFromTopologyId } from "../standaloneHostShared";

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

export interface RuntimeTerminalRequest extends RuntimeNodeRequest {
  protocol: TerminalProtocol;
  sshUsername?: string;
  telnetPort?: number;
}

export interface RuntimeTerminalWindow extends RuntimeTerminalRequest {
  id: string;
  sessionId?: string;
  state: "creating" | "connecting" | "ready" | "exited" | "error";
  exitCode?: number | null;
  error?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
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
  terminals: RuntimeTerminalWindow[];
  versionOpen: boolean;
  snackbar: SnackbarState;
  closeInspect: () => void;
  closeLogs: () => void;
  closeNetem: () => void;
  closeSnackbar: () => void;
  closeTerminal: (id: string) => void;
  focusTerminal: (id: string) => void;
  openInspect: (request: RuntimeInspectRequest) => void;
  openLogs: (request: RuntimeNodeRequest) => void;
  openNetem: (request: RuntimeNetemRequest) => void;
  openTerminal: (request: RuntimeTerminalRequest) => string;
  openVersion: () => void;
  setTerminalConnecting: (id: string) => void;
  setTerminalError: (id: string, message: string) => void;
  setTerminalExited: (id: string, exitCode?: number | null, error?: string) => void;
  setTerminalMinimized: (id: string, minimized: boolean) => void;
  setTerminalReady: (id: string) => void;
  setTerminalSession: (id: string, sessionId: string) => void;
  showSnackbar: (message: string, severity?: AlertColor) => void;
  updateTerminalLayout: (
    id: string,
    layout: Partial<Pick<RuntimeTerminalWindow, "height" | "width" | "x" | "y">>
  ) => void;
}

const defaultSnackbar: SnackbarState = {
  open: false,
  message: "",
  severity: "info"
};

function topologyKey(target: RuntimeTargetRequest): string {
  const endpointId =
    target.endpointId ?? extractEndpointIdFromTopologyId(target.topologyRef?.topologyId) ?? "default";
  if (typeof target.sessionId === "string" && target.sessionId.trim().length > 0) {
    return `session:${endpointId}:${target.sessionId.trim()}`;
  }
  const topologyRef = target.topologyRef;
  if (!topologyRef) {
    return `unknown:${endpointId}`;
  }
  return `topology:${endpointId}:${topologyRef.topologyId ?? ""}:${topologyRef.labName ?? ""}:${topologyRef.yamlPath ?? ""}`;
}

function terminalMatchKey(request: RuntimeTerminalRequest): string {
  return `${request.protocol}:${topologyKey(request)}:${request.nodeName.trim().toLowerCase()}`;
}

function nextZIndex(terminals: RuntimeTerminalWindow[]): number {
  return terminals.reduce((max, terminal) => Math.max(max, terminal.zIndex), 1400) + 1;
}

function createWindow(request: RuntimeTerminalRequest, terminals: RuntimeTerminalWindow[]): RuntimeTerminalWindow {
  const index = terminals.length % 6;
  return {
    ...request,
    id: `term-${Math.random().toString(36).slice(2, 10)}`,
    state: "creating",
    x: 96 + index * 28,
    y: 88 + index * 24,
    width: 760,
    height: 460,
    zIndex: nextZIndex(terminals),
    minimized: false
  };
}

export const useRuntimeUiStore = create<RuntimeUiState>((set, get) => ({
  inspectRequest: null,
  logsRequest: null,
  netemRequest: null,
  terminals: [],
  versionOpen: false,
  snackbar: defaultSnackbar,
  openInspect: (request) => set({ inspectRequest: request }),
  closeInspect: () => set({ inspectRequest: null }),
  openLogs: (request) => set({ logsRequest: request }),
  closeLogs: () => set({ logsRequest: null }),
  openNetem: (request) => set({ netemRequest: request }),
  closeNetem: () => set({ netemRequest: null }),
  openTerminal: (request) => {
    const existing = get().terminals.find(
      (terminal) => terminalMatchKey(terminal) === terminalMatchKey(request)
    );
    if (existing) {
      get().focusTerminal(existing.id);
      if (existing.minimized) {
        get().setTerminalMinimized(existing.id, false);
      }
      return existing.id;
    }

    const windowState = createWindow(request, get().terminals);
    set((state) => ({
      terminals: [...state.terminals, windowState]
    }));
    return windowState.id;
  },
  focusTerminal: (id) =>
    set((state) => {
      const target = state.terminals.find((terminal) => terminal.id === id);
      if (!target) {
        return state;
      }
      const maxZIndex = state.terminals.reduce((max, terminal) => Math.max(max, terminal.zIndex), 1400);
      if (target.zIndex === maxZIndex && !target.minimized) {
        return state;
      }
      return {
        terminals: state.terminals.map((terminal) =>
          terminal.id === id
            ? { ...terminal, zIndex: nextZIndex(state.terminals), minimized: false }
            : terminal
        )
      };
    }),
  closeTerminal: (id) =>
    set((state) => ({
      terminals: state.terminals.filter((terminal) => terminal.id !== id)
    })),
  updateTerminalLayout: (id, layout) =>
    set((state) => {
      let changed = false;
      const terminals = state.terminals.map((terminal) => {
        if (terminal.id !== id) {
          return terminal;
        }
        const nextTerminal = { ...terminal, ...layout };
        const hasChanges =
          nextTerminal.x !== terminal.x ||
          nextTerminal.y !== terminal.y ||
          nextTerminal.width !== terminal.width ||
          nextTerminal.height !== terminal.height;
        if (!hasChanges) {
          return terminal;
        }
        changed = true;
        return nextTerminal;
      });
      return changed ? { terminals } : state;
    }),
  setTerminalConnecting: (id) =>
    set((state) => ({
      terminals: state.terminals.map((terminal) =>
        terminal.id === id ? { ...terminal, state: "connecting", error: undefined } : terminal
      )
    })),
  setTerminalSession: (id, sessionId) =>
    set((state) => ({
      terminals: state.terminals.map((terminal) =>
        terminal.id === id ? { ...terminal, sessionId } : terminal
      )
    })),
  setTerminalReady: (id) =>
    set((state) => ({
      terminals: state.terminals.map((terminal) =>
        terminal.id === id ? { ...terminal, state: "ready", error: undefined } : terminal
      )
    })),
  setTerminalExited: (id, exitCode, error) =>
    set((state) => ({
      terminals: state.terminals.map((terminal) =>
        terminal.id === id
          ? {
              ...terminal,
              state: "exited",
              exitCode,
              error
            }
          : terminal
      )
    })),
  setTerminalError: (id, message) =>
    set((state) => ({
      terminals: state.terminals.map((terminal) =>
        terminal.id === id
          ? {
              ...terminal,
              state: "error",
              error: message
            }
          : terminal
      )
    })),
  setTerminalMinimized: (id, minimized) =>
    set((state) => {
      let changed = false;
      const terminals = state.terminals.map((terminal) => {
        if (terminal.id !== id || terminal.minimized === minimized) {
          return terminal;
        }
        changed = true;
        return { ...terminal, minimized };
      });
      return changed ? { terminals } : state;
    }),
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
  closeTerminal: (id: string) => useRuntimeUiStore.getState().closeTerminal(id),
  closeVersion: () => useRuntimeUiStore.setState({ versionOpen: false }),
  focusTerminal: (id: string) => useRuntimeUiStore.getState().focusTerminal(id),
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
  openTerminal: (request: RuntimeTerminalRequest) => useRuntimeUiStore.getState().openTerminal(request),
  openVersion: () => useRuntimeUiStore.getState().openVersion(),
  setTerminalConnecting: (id: string) => useRuntimeUiStore.getState().setTerminalConnecting(id),
  setTerminalError: (id: string, message: string) => useRuntimeUiStore.getState().setTerminalError(id, message),
  setTerminalExited: (id: string, exitCode?: number | null, error?: string) =>
    useRuntimeUiStore.getState().setTerminalExited(id, exitCode, error),
  setTerminalMinimized: (id: string, minimized: boolean) =>
    useRuntimeUiStore.getState().setTerminalMinimized(id, minimized),
  setTerminalReady: (id: string) => useRuntimeUiStore.getState().setTerminalReady(id),
  setTerminalSession: (id: string, sessionId: string) =>
    useRuntimeUiStore.getState().setTerminalSession(id, sessionId),
  updateTerminalLayout: (
    id: string,
    layout: Partial<Pick<RuntimeTerminalWindow, "height" | "width" | "x" | "y">>
  ) => useRuntimeUiStore.getState().updateTerminalLayout(id, layout)
};
