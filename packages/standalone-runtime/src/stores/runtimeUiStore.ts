import type { AlertColor } from "@mui/material/Alert";
import { create } from "zustand";

import type {
  FileExplorerDocument,
  NetemFields,
  RuntimeTargetRequest,
  TerminalProtocol as ApiTerminalProtocol
} from "../runtimeApi";
import { extractEndpointIdFromTopologyId } from "../standaloneHostShared";

export type RuntimeTerminalProtocol = ApiTerminalProtocol | "output";

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
  protocol: RuntimeTerminalProtocol;
  sshUsername?: string;
  telnetPort?: number;
  initialOutput?: string;
}

export type RuntimeTerminalPaneState = "creating" | "connecting" | "ready" | "exited" | "error";

export interface RuntimeTerminalPane extends RuntimeTerminalRequest {
  id: string;
  terminalSessionId?: string;
  state: RuntimeTerminalPaneState;
  exitCode?: number | null;
  error?: string;
}

export type RuntimeTerminalWindow = RuntimeTerminalPane;

export interface RuntimeTerminalGroup {
  activePaneId: string;
  id: string;
  panes: RuntimeTerminalPane[];
  title: string;
}

export interface RuntimeTerminalShell {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
}

export interface RuntimeFileEditor extends FileExplorerDocument {
  title: string;
  originalContent: string;
  saving: boolean;
  error?: string;
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
  imageManagerOpen: boolean;
  fileEditor: RuntimeFileEditor | null;
  activeTerminalGroupId?: string;
  terminalShell: RuntimeTerminalShell;
  terminals: RuntimeTerminalGroup[];
  versionOpen: boolean;
  snackbar: SnackbarState;
  activateTerminalGroup: (groupId: string) => void;
  activateTerminalPane: (paneId: string) => void;
  closeAllTerminals: () => void;
  closeFileEditor: () => void;
  closeInspect: () => void;
  closeLogs: () => void;
  closeImageManager: () => void;
  closeNetem: () => void;
  closeSnackbar: () => void;
  closeTerminal: (id: string) => void;
  focusTerminal: (id: string) => void;
  markFileEditorSaved: (content: string) => void;
  openFileEditor: (document: FileExplorerDocument & { title: string }) => void;
  openInspect: (request: RuntimeInspectRequest) => void;
  openImageManager: () => void;
  openLogs: (request: RuntimeNodeRequest) => void;
  openNetem: (request: RuntimeNetemRequest) => void;
  openTerminal: (request: RuntimeTerminalRequest) => string;
  openVersion: () => void;
  splitTerminal: (paneId: string) => string | null;
  setTerminalConnecting: (id: string) => void;
  setFileEditorContent: (content: string) => void;
  setFileEditorError: (message?: string) => void;
  setFileEditorSaving: (saving: boolean) => void;
  setTerminalError: (id: string, message: string) => void;
  setTerminalExited: (id: string, exitCode?: number | null, error?: string) => void;
  setTerminalMinimized: (id: string, minimized: boolean) => void;
  setTerminalReady: (id: string) => void;
  setTerminalSession: (id: string, sessionId: string) => void;
  showSnackbar: (message: string, severity?: AlertColor) => void;
  updateTerminalLayout: (
    id: string,
    layout: Partial<Pick<RuntimeTerminalShell, "height" | "width" | "x" | "y">>
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

function createId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createTerminalPane(request: RuntimeTerminalRequest): RuntimeTerminalPane {
  return {
    ...request,
    id: createId("term"),
    state: "creating"
  };
}

function createTerminalGroup(request: RuntimeTerminalRequest): RuntimeTerminalGroup {
  const pane = createTerminalPane(request);
  return {
    activePaneId: pane.id,
    id: createId("term-tab"),
    panes: [pane],
    title: request.title
  };
}

const defaultTerminalShell: RuntimeTerminalShell = {
  id: "runtime-terminal-shell",
  x: 96,
  y: 88,
  width: 860,
  height: 500,
  zIndex: 1401,
  minimized: false
};

function nextShellZIndex(shell: RuntimeTerminalShell): number {
  return Math.max(shell.zIndex, 1400) + 1;
}

function duplicatePaneRequest(pane: RuntimeTerminalPane): RuntimeTerminalRequest {
  return {
    endpointId: pane.endpointId,
    initialOutput: pane.initialOutput,
    nodeName: pane.nodeName,
    protocol: pane.protocol,
    sessionId: pane.sessionId,
    sshUsername: pane.sshUsername,
    telnetPort: pane.telnetPort,
    title: pane.title,
    topologyRef: pane.topologyRef
  };
}

function findPaneLocation(
  terminals: RuntimeTerminalGroup[],
  paneId: string
): { group: RuntimeTerminalGroup; groupIndex: number; pane: RuntimeTerminalPane; paneIndex: number } | null {
  for (const [groupIndex, group] of terminals.entries()) {
    const paneIndex = group.panes.findIndex((pane) => pane.id === paneId);
    if (paneIndex >= 0) {
      return {
        group,
        groupIndex,
        pane: group.panes[paneIndex],
        paneIndex
      };
    }
  }
  return null;
}

function resolveNextActiveGroupId(
  terminals: RuntimeTerminalGroup[],
  previousActiveGroupId: string | undefined
): string | undefined {
  if (terminals.some((group) => group.id === previousActiveGroupId)) {
    return previousActiveGroupId;
  }
  return terminals.at(-1)?.id;
}

function updatePane(
  terminals: RuntimeTerminalGroup[],
  paneId: string,
  update: (pane: RuntimeTerminalPane) => RuntimeTerminalPane
): { changed: boolean; terminals: RuntimeTerminalGroup[] } {
  let changed = false;
  const nextTerminals = terminals.map((group) => {
    let groupChanged = false;
    const panes = group.panes.map((pane) => {
      if (pane.id !== paneId) {
        return pane;
      }
      const nextPane = update(pane);
      groupChanged = nextPane !== pane;
      changed = changed || groupChanged;
      return nextPane;
    });
    return groupChanged ? { ...group, panes } : group;
  });
  return { changed, terminals: nextTerminals };
}

export const useRuntimeUiStore = create<RuntimeUiState>((set, get) => ({
  inspectRequest: null,
  logsRequest: null,
  netemRequest: null,
  imageManagerOpen: false,
  fileEditor: null,
  activeTerminalGroupId: undefined,
  terminalShell: defaultTerminalShell,
  terminals: [],
  versionOpen: false,
  snackbar: defaultSnackbar,
  openFileEditor: (document) =>
    set({
      fileEditor: {
        ...document,
        originalContent: document.content,
        saving: false
      }
    }),
  closeFileEditor: () => set({ fileEditor: null }),
  setFileEditorContent: (content) =>
    set((state) => ({
      fileEditor: state.fileEditor ? { ...state.fileEditor, content, error: undefined } : null
    })),
  setFileEditorSaving: (saving) =>
    set((state) => ({
      fileEditor: state.fileEditor ? { ...state.fileEditor, saving } : null
    })),
  setFileEditorError: (message) =>
    set((state) => ({
      fileEditor: state.fileEditor ? { ...state.fileEditor, error: message, saving: false } : null
    })),
  markFileEditorSaved: (content) =>
    set((state) => ({
      fileEditor: state.fileEditor
        ? { ...state.fileEditor, content, originalContent: content, saving: false, error: undefined }
        : null
    })),
  openInspect: (request) => set({ inspectRequest: request }),
  closeInspect: () => set({ inspectRequest: null }),
  openImageManager: () => set({ imageManagerOpen: true }),
  closeImageManager: () => set({ imageManagerOpen: false }),
  openLogs: (request) => set({ logsRequest: request }),
  closeLogs: () => set({ logsRequest: null }),
  openNetem: (request) => set({ netemRequest: request }),
  closeNetem: () => set({ netemRequest: null }),
  openTerminal: (request) => {
    const terminals = get().terminals;
    const requestedKey = terminalMatchKey(request);
    const existing = terminals
      .flatMap((group) => group.panes)
      .find((pane) => terminalMatchKey(pane) === requestedKey);
    if (existing) {
      get().focusTerminal(existing.id);
      return existing.id;
    }

    const group = createTerminalGroup(request);
    set((state) => ({
      activeTerminalGroupId: group.id,
      terminalShell: {
        ...state.terminalShell,
        minimized: false,
        zIndex: nextShellZIndex(state.terminalShell)
      },
      terminals: [...state.terminals, group]
    }));
    return group.activePaneId;
  },
  activateTerminalGroup: (groupId) =>
    set((state) => {
      const group = state.terminals.find((candidate) => candidate.id === groupId);
      if (!group) {
        return state;
      }
      return {
        activeTerminalGroupId: group.id,
        terminalShell: {
          ...state.terminalShell,
          minimized: false,
          zIndex: nextShellZIndex(state.terminalShell)
        }
      };
    }),
  activateTerminalPane: (paneId) =>
    set((state) => {
      const location = findPaneLocation(state.terminals, paneId);
      if (!location) {
        return state;
      }
      return {
        activeTerminalGroupId: location.group.id,
        terminalShell: {
          ...state.terminalShell,
          minimized: false,
          zIndex: nextShellZIndex(state.terminalShell)
        },
        terminals: state.terminals.map((group) =>
          group.id === location.group.id ? { ...group, activePaneId: paneId } : group
        )
      };
    }),
  focusTerminal: (id) =>
    set((state) => {
      const group = state.terminals.find((candidate) => candidate.id === id);
      const location = group ? null : findPaneLocation(state.terminals, id);
      if (!group && !location && id !== state.terminalShell.id) {
        return state;
      }
      const activeGroupId = group?.id ?? location?.group.id ?? state.activeTerminalGroupId;
      return {
        activeTerminalGroupId: activeGroupId,
        terminalShell: {
          ...state.terminalShell,
          minimized: id === state.terminalShell.id ? state.terminalShell.minimized : false,
          zIndex: nextShellZIndex(state.terminalShell)
        },
        terminals: location
          ? state.terminals.map((candidate) =>
              candidate.id === location.group.id ? { ...candidate, activePaneId: id } : candidate
            )
          : state.terminals
      };
    }),
  closeTerminal: (id) =>
    set((state) => {
      const closingGroup = state.terminals.find((group) => group.id === id);
      if (closingGroup) {
        const terminals = state.terminals.filter((group) => group.id !== id);
        return {
          activeTerminalGroupId: resolveNextActiveGroupId(terminals, state.activeTerminalGroupId),
          terminals
        };
      }

      const location = findPaneLocation(state.terminals, id);
      if (!location) {
        return state;
      }

      const terminals = state.terminals.flatMap((group) => {
        if (group.id !== location.group.id) {
          return [group];
        }
        const panes = group.panes.filter((pane) => pane.id !== id);
        if (panes.length === 0) {
          return [];
        }
        return [
          {
            ...group,
            activePaneId:
              group.activePaneId === id
                ? panes[Math.max(0, Math.min(location.paneIndex - 1, panes.length - 1))].id
                : group.activePaneId,
            panes
          }
        ];
      });

      return {
        activeTerminalGroupId: resolveNextActiveGroupId(terminals, state.activeTerminalGroupId),
        terminals
      };
    }),
  closeAllTerminals: () =>
    set({
      activeTerminalGroupId: undefined,
      terminals: []
    }),
  updateTerminalLayout: (id, layout) =>
    set((state) => {
      if (id !== state.terminalShell.id) {
        return state;
      }
      const nextShell = { ...state.terminalShell, ...layout };
      const hasChanges =
        nextShell.x !== state.terminalShell.x ||
        nextShell.y !== state.terminalShell.y ||
        nextShell.width !== state.terminalShell.width ||
        nextShell.height !== state.terminalShell.height;
      return hasChanges ? { terminalShell: nextShell } : state;
    }),
  setTerminalConnecting: (id) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({
        ...pane,
        state: "connecting",
        error: undefined
      }));
      return result.changed ? { terminals: result.terminals } : state;
    }),
  setTerminalSession: (id, sessionId) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({ ...pane, terminalSessionId: sessionId }));
      return result.changed ? { terminals: result.terminals } : state;
    }),
  setTerminalReady: (id) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({
        ...pane,
        state: "ready",
        error: undefined
      }));
      return result.changed ? { terminals: result.terminals } : state;
    }),
  setTerminalExited: (id, exitCode, error) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({
        ...pane,
        state: "exited",
        exitCode,
        error
      }));
      return result.changed ? { terminals: result.terminals } : state;
    }),
  setTerminalError: (id, message) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({
        ...pane,
        state: "error",
        error: message
      }));
      return result.changed ? { terminals: result.terminals } : state;
    }),
  setTerminalMinimized: (id, minimized) =>
    set((state) => {
      if (id !== state.terminalShell.id || state.terminalShell.minimized === minimized) {
        return state;
      }
      return {
        terminalShell: {
          ...state.terminalShell,
          minimized
        }
      };
    }),
  splitTerminal: (paneId) => {
    const location = findPaneLocation(get().terminals, paneId);
    if (!location) {
      return null;
    }
    const pane = createTerminalPane(duplicatePaneRequest(location.pane));
    set((state) => ({
      activeTerminalGroupId: location.group.id,
      terminalShell: {
        ...state.terminalShell,
        minimized: false,
        zIndex: nextShellZIndex(state.terminalShell)
      },
      terminals: state.terminals.map((group) =>
        group.id === location.group.id
          ? {
              ...group,
              activePaneId: pane.id,
              panes: [...group.panes, pane]
            }
          : group
      )
    }));
    return pane.id;
  },
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
  activateTerminalGroup: (groupId: string) => useRuntimeUiStore.getState().activateTerminalGroup(groupId),
  activateTerminalPane: (paneId: string) => useRuntimeUiStore.getState().activateTerminalPane(paneId),
  closeAllTerminals: () => useRuntimeUiStore.getState().closeAllTerminals(),
  closeFileEditor: () => useRuntimeUiStore.getState().closeFileEditor(),
  closeInspect: () => useRuntimeUiStore.getState().closeInspect(),
  closeImageManager: () => useRuntimeUiStore.getState().closeImageManager(),
  closeLogs: () => useRuntimeUiStore.getState().closeLogs(),
  closeNetem: () => useRuntimeUiStore.getState().closeNetem(),
  closeTerminal: (id: string) => useRuntimeUiStore.getState().closeTerminal(id),
  closeVersion: () => useRuntimeUiStore.setState({ versionOpen: false }),
  focusTerminal: (id: string) => useRuntimeUiStore.getState().focusTerminal(id),
  markFileEditorSaved: (content: string) => useRuntimeUiStore.getState().markFileEditorSaved(content),
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
  openImageManager: () => useRuntimeUiStore.getState().openImageManager(),
  openFileEditor: (document: FileExplorerDocument & { title: string }) =>
    useRuntimeUiStore.getState().openFileEditor(document),
  openLogs: (request: RuntimeNodeRequest) => useRuntimeUiStore.getState().openLogs(request),
  openNetem: (request: RuntimeNetemRequest) => useRuntimeUiStore.getState().openNetem(request),
  openTerminal: (request: RuntimeTerminalRequest) => useRuntimeUiStore.getState().openTerminal(request),
  openVersion: () => useRuntimeUiStore.getState().openVersion(),
  splitTerminal: (paneId: string) => useRuntimeUiStore.getState().splitTerminal(paneId),
  setFileEditorContent: (content: string) => useRuntimeUiStore.getState().setFileEditorContent(content),
  setFileEditorError: (message?: string) => useRuntimeUiStore.getState().setFileEditorError(message),
  setFileEditorSaving: (saving: boolean) => useRuntimeUiStore.getState().setFileEditorSaving(saving),
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
    layout: Partial<Pick<RuntimeTerminalShell, "height" | "width" | "x" | "y">>
  ) => useRuntimeUiStore.getState().updateTerminalLayout(id, layout)
};
