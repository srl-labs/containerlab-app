/**
 * What happened to each block of a lab guide since the page loaded: the
 * confirmation it waits on, its run and its output.
 *
 * It lives here, not in the Guide tab: the tab goes away whenever the panel
 * shows something else, such as a node's details, and a command keeps running
 * on the lab meanwhile. Its result has to be there when the reader comes back.
 */
import { create } from "zustand";

import type { LabExecResult } from "../host/labOperations";

export type GuideBlockRun =
  | { status: "idle" }
  /** `canTrustGuide`: the reader may agree to every block of the guide at once. */
  | { status: "confirm"; canTrustGuide: boolean }
  | { status: "running" }
  | { status: "done"; result: LabExecResult }
  | { status: "sent" }
  | { status: "error"; message: string };

/** The runs of one guide, by block id. */
export type GuideRuns = Readonly<Record<string, GuideBlockRun>>;

const NO_RUNS: GuideRuns = {};

interface GuideRunState {
  /** By guide: the lab's name and the guide's file name. */
  runs: Record<string, GuideRuns>;
  setRun: (guideKey: string, blockId: string, run: GuideBlockRun) => void;
}

export const useGuideRunStore = create<GuideRunState>((set) => ({
  runs: {},
  setRun: (guideKey, blockId, run) =>
    set((state) => ({
      runs: { ...state.runs, [guideKey]: { ...state.runs[guideKey], [blockId]: run } }
    }))
}));

/** The runs of one guide; the same object until one of them changes. */
export function guideRuns(state: GuideRunState, guideKey: string): GuideRuns {
  return state.runs[guideKey] ?? NO_RUNS;
}
