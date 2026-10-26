/**
 * One undo history for the canvas and the source tabs.
 *
 * Canvas edits and saved source edits are host steps: the host keeps the files
 * and undoes them. Unsaved source edits only change a source tab's draft, so
 * they live here, ordered among the host steps that snapshots report.
 */

import type { TopologyHistoryState } from "../core/types/messages";

export type SourceFile = "yaml" | "json";

/** A Monaco-style selection: where it started and where the cursor is. */
export interface SourceSelection {
  anchorLine: number;
  anchorColumn: number;
  line: number;
  column: number;
}

/** A source tab's text. Without a base, the tab shows the file as the host has it. */
export interface SourceDraft {
  /** The file content the unsaved edits started from; null while there are none. */
  base: string | null;
  text: string;
}

export const NO_DRAFT: SourceDraft = { base: null, text: "" };

export interface SourceChange {
  before: SourceDraft;
  after: SourceDraft;
  /** The cursor before the step's first edit and after its last one. */
  selectionBefore?: SourceSelection;
  selectionAfter?: SourceSelection;
}

export interface EditHistoryStep {
  /** The host step undone and redone with this one; unsaved source edits have none. */
  hostStep?: number;
  /** The source drafts the step changes. */
  sources: Partial<Record<SourceFile, SourceChange>>;
}

export type EditHistoryDirection = "undo" | "redo";

/** Typing pauses longer than this start a new step. */
export const TEXT_MERGE_WINDOW_MS = 1000;
const DEFAULT_HISTORY_LIMIT = 100;

function isSameDraft(a: SourceDraft, b: SourceDraft): boolean {
  if (a.base === null || b.base === null) return a.base === b.base;
  return a.base === b.base && a.text === b.text;
}

export class EditHistory {
  private past: EditHistoryStep[] = [];
  private future: EditHistoryStep[] = [];
  /** The step typing still merges into, and until when. */
  private openText: { file: SourceFile; until: number } | null = null;
  private host: TopologyHistoryState | null = null;
  private lastHostStep = 0;
  /** A host undo or redo is under way; snapshots wait until it settles. */
  private moving = false;
  private deferredHost: TopologyHistoryState | null = null;
  private readonly pendingSources = new Map<number, EditHistoryStep["sources"]>();

  constructor(private readonly limit = DEFAULT_HISTORY_LIMIT) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Records a source edit; typing within the merge window extends the previous step. */
  recordSourceEdit(file: SourceFile, change: SourceChange, now: number, merge = true): void {
    const top = this.past.at(-1);
    const open = this.openText;
    const existing =
      merge && open?.file === file && now <= open.until && top?.hostStep === undefined
        ? top?.sources[file]
        : undefined;
    if (existing && top) {
      existing.after = change.after;
      existing.selectionAfter = change.selectionAfter;
      if (isSameDraft(existing.before, existing.after)) {
        // Typed and deleted again: nothing left to undo.
        this.past.pop();
        this.openText = null;
        return;
      }
    } else {
      if (isSameDraft(change.before, change.after)) return;
      this.past.push({ sources: { [file]: { ...change } } });
      this.trim();
    }
    this.future = [];
    this.openText = merge ? { file, until: now + TEXT_MERGE_WINDOW_MS } : null;
  }

  /** Ends the step typing merges into, e.g. when the editor loses focus. */
  closeSourceStep(): void {
    this.openText = null;
  }

  /** Follows the host's stacks: adds its new steps and drops the ones it forgot. */
  syncHost(state: TopologyHistoryState): void {
    if (this.moving) {
      this.deferredHost = state;
      return;
    }
    if (this.host && this.host.scope !== state.scope) this.clear();
    this.host = state;

    const undo = new Set(state.undo);
    const redo = new Set(state.redo);
    // Redo only holds while the host can still redo every step it expects.
    if (this.future.some((step) => step.hostStep !== undefined && !redo.has(step.hostStep))) {
      this.future = [];
    }
    // The host forgets its steps when the file changes elsewhere; unsaved edits stay.
    this.past = this.past.filter((step) => step.hostStep === undefined || undo.has(step.hostStep));

    const added = state.undo.filter((step) => step > this.lastHostStep);
    if (added.length > 0) {
      // A new edit: whatever was undone before it can't be redone any more.
      this.future = this.future.filter((step) => step.hostStep !== undefined);
      this.openText = null;
      for (const hostStep of added) {
        this.past.push({ hostStep, sources: this.takePendingSources(hostStep) });
      }
      this.trim();
    }
    // Only a fresh client meets redo steps it never saw; they come after the known ones.
    const addedRedo = state.redo.filter((step) => step > this.lastHostStep);
    this.future.unshift(...addedRedo.map((hostStep) => ({ hostStep, sources: {} })));
    this.lastHostStep = Math.max(this.lastHostStep, ...state.undo, ...state.redo);
  }

  /** Remembers what a host step did to the source drafts, e.g. when saving one. */
  attachSources(hostStep: number, sources: EditHistoryStep["sources"]): void {
    const step = [...this.past, ...this.future].find((entry) => entry.hostStep === hostStep);
    if (step) step.sources = sources;
    else this.pendingSources.set(hostStep, sources);
  }

  /**
   * Moves the next step to the other stack and returns it. For a host step, the
   * caller asks the host to move too, then calls `settle` (or `putBack` if the
   * host refused).
   */
  take(direction: EditHistoryDirection): EditHistoryStep | null {
    this.openText = null;
    let step = this.next(direction);
    if (step?.hostStep !== undefined && !this.hostIsAt(direction, step.hostStep)) {
      // Out of step with the host; start over from what it has.
      this.rebuild();
      step = this.next(direction);
    }
    if (!step) return null;
    const [from, to] = direction === "undo" ? [this.past, this.future] : [this.future, this.past];
    from.pop();
    to.push(step);
    if (step.hostStep !== undefined) this.moving = true;
    return step;
  }

  /** Undoes a `take` whose host move failed. */
  putBack(direction: EditHistoryDirection, step: EditHistoryStep): void {
    const [from, to] = direction === "undo" ? [this.past, this.future] : [this.future, this.past];
    if (to.at(-1) === step) {
      to.pop();
      from.push(step);
    }
  }

  /** The host finished moving; catch up with the snapshots that arrived meanwhile. */
  settle(): void {
    this.moving = false;
    const deferred = this.deferredHost;
    this.deferredHost = null;
    if (deferred) this.syncHost(deferred);
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.openText = null;
    this.lastHostStep = 0;
    this.pendingSources.clear();
  }

  private next(direction: EditHistoryDirection): EditHistoryStep | undefined {
    return (direction === "undo" ? this.past : this.future).at(-1);
  }

  private hostIsAt(direction: EditHistoryDirection, hostStep: number): boolean {
    return (direction === "undo" ? this.host?.undo : this.host?.redo)?.at(-1) === hostStep;
  }

  private rebuild(): void {
    const host = this.host;
    this.clear();
    if (host) this.syncHost(host);
  }

  private takePendingSources(hostStep: number): EditHistoryStep["sources"] {
    const sources = this.pendingSources.get(hostStep) ?? {};
    this.pendingSources.delete(hostStep);
    return sources;
  }

  private trim(): void {
    if (this.past.length > this.limit) this.past.splice(0, this.past.length - this.limit);
  }
}
