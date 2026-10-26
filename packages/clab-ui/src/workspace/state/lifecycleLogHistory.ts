import { create } from "zustand";

/** The log of the last lifecycle action (deploy, apply, destroy, ...) of one topology. */
export interface LifecycleLogRecord {
  topologyId: string;
  labName: string;
  /** The action, e.g. `deploy`. */
  action: string;
  lines: Array<{ line: string; stream: "stdout" | "stderr" }>;
  status: "running" | "success" | "error";
  startedAt: number;
  finishedAt?: number;
}

/** Older lines are dropped from a long log. */
const MAX_LIFECYCLE_LOG_LINES = 5000;

interface LifecycleLogHistoryState {
  /** Keyed by topology id. */
  records: Record<string, LifecycleLogRecord>;
  begin: (record: { topologyId: string; labName: string; action: string }) => void;
  append: (topologyId: string, line: string, stream: "stdout" | "stderr") => void;
  finish: (topologyId: string, status: "success" | "error") => void;
}

export const useLifecycleLogHistory = create<LifecycleLogHistoryState>((set) => ({
  records: {},
  begin: ({ topologyId, labName, action }) =>
    set((state) => ({
      records: {
        ...state.records,
        [topologyId]: { topologyId, labName, action, lines: [], status: "running", startedAt: Date.now() }
      }
    })),
  append: (topologyId, line, stream) =>
    set((state) => {
      const record = state.records[topologyId];
      if (!record) return state;
      const lines = [...record.lines, { line, stream }];
      if (lines.length > MAX_LIFECYCLE_LOG_LINES) lines.splice(0, lines.length - MAX_LIFECYCLE_LOG_LINES);
      return { records: { ...state.records, [topologyId]: { ...record, lines } } };
    }),
  finish: (topologyId, status) =>
    set((state) => {
      const record = state.records[topologyId];
      if (!record) return state;
      return { records: { ...state.records, [topologyId]: { ...record, status, finishedAt: Date.now() } } };
    })
}));
