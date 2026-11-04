import { create } from "zustand";

import type { LabHostScriptDescription, LabHostScriptResult } from "../host/labOperations";
import { useTopoViewerStore } from "../stores/topoViewerStore";

type ScriptRunStatus = "running" | "success" | "failed";

interface ScriptConfirmRequest {
  label: string;
  /** What will run, as the lab host describes it. */
  script: LabHostScriptDescription;
}

/** Button ids repeat from lab to lab, so a run belongs to the lab it started in. */
export function scriptRunKey(id: string): string {
  const { labName, yamlFileName } = useTopoViewerStore.getState();
  return `${labName}|${yamlFileName}|${id}`;
}

interface PendingConfirm extends ScriptConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

interface ScriptButtonState {
  /** Last run state per `scriptRunKey`; cleared a moment after a run ends. */
  status: Record<string, ScriptRunStatus>;
  /** Stops the running script of a `scriptRunKey`. */
  stops: Record<string, () => void>;
  confirm: PendingConfirm | null;
  output: { label: string; result: LabHostScriptResult } | null;
  setStatus: (key: string, status: ScriptRunStatus | undefined) => void;
  setStop: (key: string, stop: (() => void) | undefined) => void;
  /** Resolves true when the user agrees to run the script. */
  askConfirm: (request: ScriptConfirmRequest) => Promise<boolean>;
  answerConfirm: (confirmed: boolean) => void;
  showOutput: (label: string, result: LabHostScriptResult) => void;
  closeOutput: () => void;
}

/** Run state, the run confirmation and the output dialog of script buttons. */
export const useScriptButtonStore = create<ScriptButtonState>((set, get) => ({
  status: {},
  stops: {},
  confirm: null,
  output: null,
  setStatus: (key, status) =>
    set((state) => {
      const next = { ...state.status };
      if (status === undefined) delete next[key];
      else next[key] = status;
      return { status: next };
    }),
  setStop: (key, stop) =>
    set((state) => {
      const next = { ...state.stops };
      if (stop === undefined) delete next[key];
      else next[key] = stop;
      return { stops: next };
    }),
  askConfirm: (request) =>
    new Promise<boolean>((resolve) => {
      // A second request while one is open declines the first.
      get().confirm?.resolve(false);
      set({ confirm: { ...request, resolve } });
    }),
  answerConfirm: (confirmed) => {
    get().confirm?.resolve(confirmed);
    set({ confirm: null });
  },
  showOutput: (label, result) => set({ output: { label, result } }),
  closeOutput: () => set({ output: null })
}));
