import { create } from "zustand";

import type { LabHostScriptResult } from "../host/labOperations";

type ScriptRunStatus = "running" | "success" | "failed";

interface ScriptConfirmRequest {
  label: string;
  /** The script path, or the script itself, as the user will run it. */
  source: string;
  isPath: boolean;
}

interface PendingConfirm extends ScriptConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

interface ScriptButtonState {
  /** Last run state per script button id; cleared a moment after a run ends. */
  status: Record<string, ScriptRunStatus>;
  confirm: PendingConfirm | null;
  output: { label: string; result: LabHostScriptResult } | null;
  setStatus: (id: string, status: ScriptRunStatus | undefined) => void;
  /** Resolves true when the user agrees to run the script. */
  askConfirm: (request: ScriptConfirmRequest) => Promise<boolean>;
  answerConfirm: (confirmed: boolean) => void;
  showOutput: (label: string, result: LabHostScriptResult) => void;
  closeOutput: () => void;
}

/** Run state, the run confirmation and the output dialog of script buttons. */
export const useScriptButtonStore = create<ScriptButtonState>((set, get) => ({
  status: {},
  confirm: null,
  output: null,
  setStatus: (id, status) =>
    set((state) => {
      const next = { ...state.status };
      if (status === undefined) delete next[id];
      else next[id] = status;
      return { status: next };
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
