import type { AlertColor } from "@mui/material/Alert";
import { create } from "zustand";

import type {
  FileExplorerDocument,
  NetemFields,
  RuntimeTargetRequest,
  TerminalProtocol as ApiTerminalProtocol
} from "../types";
import type { CaptureDelivery, LabCaptureInterface } from "../../host/captureStream";
import { extractEndpointIdFromTopologyId } from "./documentUtils";

export type RuntimeTerminalProtocol = ApiTerminalProtocol | "output";

interface RuntimeInspectRequest {
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

export interface RuntimeCaptureSession {
  interfaceNames: string[];
  /** The names are ports inside the node: capture them there. */
  nodeNamespace: boolean;
  /** The interfaces as the user knows them, e.g. 1/1/c1/1, for the capture window or tab. */
  label?: string;
}

/** One capture stream of a lab host with `captureStream` (c9s), as the dialog asks for it. */
export interface RuntimeStreamCapture {
  /** Nodes and interfaces, in list order. */
  targets: { node: string; interface: string }[];
  delivery: CaptureDelivery;
  /** Go duration; undefined captures until it is stopped. */
  duration?: string;
  /** The interfaces as the user reads them, for the window title. */
  label: string;
}

/**
 * A capture on a lab host that captures lab links as one stream (c9s): the
 * dialog lists the lab-link interfaces of `nodes` and asks where the
 * capture goes.
 */
export interface RuntimeStreamCaptureRequest {
  /** Topology nodes whose lab-link interfaces are offered; the first one names the dialog. */
  nodes: string[];
  /** `<node>:<interface>` keys ticked when the dialog opens; the last pick otherwise. */
  initialSelection?: string[];
  /** Where a capture can go on this lab host, the default first. */
  deliveries: CaptureDelivery[];
  loadInterfaces: () => Promise<LabCaptureInterface[]>;
  onCapture: (capture: RuntimeStreamCapture) => void;
}

export interface RuntimeCaptureRequest extends RuntimeNodeRequest {
  /** Opens the capture sessions the dialog asks for, in list order, in one call. */
  onCapture: (sessions: RuntimeCaptureSession[]) => void;
  /** Set for a lab host with capture streams; `onCapture` is then not used. */
  stream?: RuntimeStreamCaptureRequest;
}

export interface RuntimeTerminalRequest extends RuntimeNodeRequest {
  protocol: RuntimeTerminalProtocol;
  sshUsername?: string;
  telnetPort?: number;
  initialOutput?: string;
}

/**
 * `reconnecting`: the connection dropped and the pane attaches again.
 * `detached`: another window attached to the session. `expired`: the session
 * ended on the lab host while the pane was away.
 */
type RuntimeTerminalPaneState =
  | "creating"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "detached"
  | "expired"
  | "exited"
  | "error";

export interface RuntimeTerminalPane extends RuntimeTerminalRequest {
  id: string;
  terminalSessionId?: string;
  state: RuntimeTerminalPaneState;
  /** The lab host keeps the session when the connection drops. */
  resumable?: boolean;
  exitCode?: number | null;
  error?: string;
}

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

interface RuntimeFileEditor extends FileExplorerDocument {
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
  captureRequest: RuntimeCaptureRequest | null;
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
  closeCapture: () => void;
  closeSnackbar: () => void;
  closeTerminal: (id: string) => void;
  focusTerminal: (id: string) => void;
  markFileEditorSaved: (content: string) => void;
  openFileEditor: (document: FileExplorerDocument & { title: string }) => void;
  openInspect: (request: RuntimeInspectRequest) => void;
  openImageManager: () => void;
  openLogs: (request: RuntimeNodeRequest) => void;
  openNetem: (request: RuntimeNetemRequest) => void;
  openCapture: (request: RuntimeCaptureRequest) => void;
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
  setTerminalResumable: (id: string) => void;
  setTerminalReconnecting: (id: string, message?: string) => void;
  setTerminalDetached: (id: string) => void;
  setTerminalExpired: (id: string, message?: string) => void;
  /** Starts a new session in the pane, e.g. after the old one expired. */
  restartTerminal: (id: string) => void;
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

// Terminals of a lab host that keeps sessions come back after a page reload.
// sessionStorage keeps them per browser tab, so a second tab does not take
// over the first one's terminals.
const TERMINAL_STATE_STORAGE_KEY = "clab.workspace.terminals.v1";

interface StoredTerminalState {
  activeTerminalGroupId?: string;
  terminalShell: RuntimeTerminalShell;
  terminals: RuntimeTerminalGroup[];
}

function terminalStorage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.sessionStorage;
  } catch {
    return undefined;
  }
}

/** The panes that can attach again: resumable sessions that were still open. */
export function resumableTerminalState(state: StoredTerminalState): StoredTerminalState | undefined {
  const terminals = state.terminals
    .map((group) => {
      const panes = group.panes
        .filter(
          (pane) =>
            pane.resumable === true &&
            pane.terminalSessionId !== undefined &&
            pane.state !== "exited" &&
            pane.state !== "error" &&
            pane.state !== "expired" &&
            // Taken over by another window: a reload must not take it back.
            pane.state !== "detached"
        )
        .map((pane): RuntimeTerminalPane => ({ ...pane, state: "connecting", error: undefined }));
      if (panes.length === 0) return undefined;
      const activePaneId = panes.some((pane) => pane.id === group.activePaneId) ? group.activePaneId : panes[0].id;
      return { ...group, activePaneId, panes };
    })
    .filter((group): group is RuntimeTerminalGroup => group !== undefined);
  if (terminals.length === 0) return undefined;
  return {
    activeTerminalGroupId: resolveNextActiveGroupId(terminals, state.activeTerminalGroupId),
    terminalShell: state.terminalShell,
    terminals
  };
}

function restoreTerminalState(): StoredTerminalState | undefined {
  try {
    const raw = terminalStorage()?.getItem(TERMINAL_STATE_STORAGE_KEY);
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as StoredTerminalState;
    if (!Array.isArray(stored.terminals) || typeof stored.terminalShell !== "object") return undefined;
    return resumableTerminalState(stored);
  } catch {
    return undefined;
  }
}

const restoredTerminals = restoreTerminalState();

export const useRuntimeUiStore = create<RuntimeUiState>((set, get) => ({
  inspectRequest: null,
  logsRequest: null,
  netemRequest: null,
  captureRequest: null,
  imageManagerOpen: false,
  fileEditor: null,
  activeTerminalGroupId: restoredTerminals?.activeTerminalGroupId,
  terminalShell: restoredTerminals?.terminalShell ?? defaultTerminalShell,
  terminals: restoredTerminals?.terminals ?? [],
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
  openCapture: (request) => set({ captureRequest: request }),
  closeCapture: () => set({ captureRequest: null }),
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
  setTerminalResumable: (id) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) =>
        pane.resumable === true ? pane : { ...pane, resumable: true }
      );
      return result.changed ? { terminals: result.terminals } : state;
    }),
  setTerminalReconnecting: (id, message) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({
        ...pane,
        state: "reconnecting",
        error: message
      }));
      return result.changed ? { terminals: result.terminals } : state;
    }),
  setTerminalDetached: (id) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({ ...pane, state: "detached", error: undefined }));
      return result.changed ? { terminals: result.terminals } : state;
    }),
  setTerminalExpired: (id, message) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({
        ...pane,
        state: "expired",
        terminalSessionId: undefined,
        error: message
      }));
      return result.changed ? { terminals: result.terminals } : state;
    }),
  restartTerminal: (id) =>
    set((state) => {
      const result = updatePane(state.terminals, id, (pane) => ({
        ...pane,
        state: "creating",
        terminalSessionId: undefined,
        resumable: undefined,
        exitCode: undefined,
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
  closeCapture: () => useRuntimeUiStore.getState().closeCapture(),
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
  openCapture: (request: RuntimeCaptureRequest) => useRuntimeUiStore.getState().openCapture(request),
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
  setTerminalResumable: (id: string) => useRuntimeUiStore.getState().setTerminalResumable(id),
  setTerminalReconnecting: (id: string, message?: string) =>
    useRuntimeUiStore.getState().setTerminalReconnecting(id, message),
  setTerminalDetached: (id: string) => useRuntimeUiStore.getState().setTerminalDetached(id),
  setTerminalExpired: (id: string, message?: string) =>
    useRuntimeUiStore.getState().setTerminalExpired(id, message),
  restartTerminal: (id: string) => useRuntimeUiStore.getState().restartTerminal(id),
  updateTerminalLayout: (
    id: string,
    layout: Partial<Pick<RuntimeTerminalShell, "height" | "width" | "x" | "y">>
  ) => useRuntimeUiStore.getState().updateTerminalLayout(id, layout)
};

// Saves the panes that can attach again after a reload.
let storedTerminalState = "";
useRuntimeUiStore.subscribe((state) => {
  const resumable = resumableTerminalState(state);
  const next = resumable ? JSON.stringify(resumable) : "";
  if (next === storedTerminalState) return;
  storedTerminalState = next;
  try {
    const storage = terminalStorage();
    if (next) {
      storage?.setItem(TERMINAL_STATE_STORAGE_KEY, next);
    } else {
      storage?.removeItem(TERMINAL_STATE_STORAGE_KEY);
    }
  } catch {
    // Storage may be full or blocked; terminals then just don't come back.
  }
});
