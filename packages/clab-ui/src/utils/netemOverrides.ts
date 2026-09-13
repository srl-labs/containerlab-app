import type { NetemState } from "../core/parsing";
import { isRecord } from "../core/utilities/typeHelpers";

import { normalizeNetemPercentage, normalizeNetemValue } from "./netemNormalization";

export const PENDING_NETEM_KEY = "clabPendingNetem";
const PENDING_NETEM_TTL_MS = 10000;

export interface PendingNetemOverride {
  source?: NetemState;
  target?: NetemState;
  appliedAt: number;
}

export function createPendingNetemOverride(
  source?: NetemState,
  target?: NetemState
): PendingNetemOverride {
  return {
    source,
    target,
    appliedAt: Date.now()
  };
}

function isPendingNetemFresh(pending?: PendingNetemOverride): boolean {
  if (!pending) return false;
  return Date.now() - pending.appliedAt <= PENDING_NETEM_TTL_MS;
}

function normalizeNetemForCompare(netem?: NetemState): Record<keyof NetemState, string> {
  return {
    delay: normalizeNetemValue(netem?.delay),
    jitter: normalizeNetemValue(netem?.jitter),
    loss: normalizeNetemPercentage(netem?.loss),
    rate: normalizeNetemValue(netem?.rate),
    corruption: normalizeNetemPercentage(netem?.corruption)
  };
}

export function areNetemEquivalent(a?: NetemState, b?: NetemState): boolean {
  const normalizedA = normalizeNetemForCompare(a);
  const normalizedB = normalizeNetemForCompare(b);
  return JSON.stringify(normalizedA) === JSON.stringify(normalizedB);
}

/**
 * Parse an unknown value into a NetemState, keeping only string fields.
 * Returns undefined when no netem fields are present.
 */
export function toNetemState(value: unknown): NetemState | undefined {
  if (!isRecord(value)) return undefined;
  const state: NetemState = {};
  if (typeof value.delay === "string") state.delay = value.delay;
  if (typeof value.jitter === "string") state.jitter = value.jitter;
  if (typeof value.loss === "string") state.loss = value.loss;
  if (typeof value.rate === "string") state.rate = value.rate;
  if (typeof value.corruption === "string") state.corruption = value.corruption;
  return Object.keys(state).length > 0 ? state : undefined;
}

/** Parse an unknown value into a PendingNetemOverride (requires a finite appliedAt). */
export function toPendingNetemOverride(value: unknown): PendingNetemOverride | undefined {
  if (!isRecord(value)) return undefined;
  const appliedAt = value.appliedAt;
  if (typeof appliedAt !== "number" || !Number.isFinite(appliedAt)) return undefined;
  return {
    source: toNetemState(value.source),
    target: toNetemState(value.target),
    appliedAt
  };
}

/** True when a runtime update carries netem fields for either endpoint. */
function hasNetemUpdate(updateExtraData: Record<string, unknown>): boolean {
  return (
    Object.prototype.hasOwnProperty.call(updateExtraData, "clabSourceNetem") ||
    Object.prototype.hasOwnProperty.call(updateExtraData, "clabTargetNetem")
  );
}

/** True when the incoming netem values match the locally applied pending override. */
function matchesPendingNetem(
  updateExtraData: Record<string, unknown>,
  pending: PendingNetemOverride
): boolean {
  const incomingSource = toNetemState(updateExtraData.clabSourceNetem);
  const incomingTarget = toNetemState(updateExtraData.clabTargetNetem);
  return (
    areNetemEquivalent(incomingSource, pending.source) &&
    areNetemEquivalent(incomingTarget, pending.target)
  );
}

/**
 * Merge a runtime extraData update over the current extraData while a pending
 * netem override marker exists:
 * - expired override: merge everything and drop the pending marker
 * - update without netem fields: plain merge, keep the marker
 * - netem fields that do not match the override yet: merge everything except
 *   the stale netem fields (optimistic values win until confirmed or expired)
 * - matching netem fields: merge everything and drop the pending marker
 */
export function mergeExtraDataWithPending(
  currentExtraData: Record<string, unknown>,
  updateExtraData: Record<string, unknown>,
  pending: PendingNetemOverride
): Record<string, unknown> {
  if (!isPendingNetemFresh(pending)) {
    const merged = { ...currentExtraData, ...updateExtraData };
    delete merged[PENDING_NETEM_KEY];
    return merged;
  }

  if (!hasNetemUpdate(updateExtraData)) {
    return { ...currentExtraData, ...updateExtraData };
  }

  if (!matchesPendingNetem(updateExtraData, pending)) {
    const {
      clabSourceNetem: _clabSourceNetem,
      clabTargetNetem: _clabTargetNetem,
      ...rest
    } = updateExtraData;
    return { ...currentExtraData, ...rest };
  }

  const merged = { ...currentExtraData, ...updateExtraData };
  delete merged[PENDING_NETEM_KEY];
  return merged;
}
