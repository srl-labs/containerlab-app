/**
 * Per-node appearance of the boxed node style, stored as `box` on node
 * annotations. Shared by the host (persistence) and the canvas (rendering).
 */

import type { NodeBoxAppearance } from "../types/topology";

import { isRecord } from "./typeHelpers";

export type { NodeBoxAppearance };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const NODE_BOX_OPACITY_RANGE = { min: 0, max: 100, default: 100 } as const;
export const NODE_BOX_BLUR_RANGE = { min: 0, max: 24, default: 0 } as const;
export const NODE_BOX_BORDER_WIDTH_RANGE = { min: 0, max: 4, default: 1 } as const;
export const NODE_BOX_CORNER_RADIUS_RANGE = { min: 0, max: 40 } as const;

const MAX_COLOR_LENGTH = 64;

function setIfDefined<K extends keyof NodeBoxAppearance>(
  target: NodeBoxAppearance,
  key: K,
  value: NodeBoxAppearance[K] | undefined
): void {
  if (value !== undefined) target[key] = value;
}

function toColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_COLOR_LENGTH ? trimmed : undefined;
}

function toBoundedNumber(
  value: unknown,
  range: { min: number; max: number; default?: number }
): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const bounded = clamp(Math.round(value), range.min, range.max);
  return bounded === range.default ? undefined : bounded;
}

/**
 * Validate a stored box appearance. Defaults are dropped so annotations only
 * keep what differs from the theme; returns undefined when nothing is left.
 */
export function normalizeNodeBoxAppearance(value: unknown): NodeBoxAppearance | undefined {
  if (!isRecord(value)) return undefined;
  const appearance: NodeBoxAppearance = {};
  setIfDefined(appearance, "color", toColor(value.color));
  setIfDefined(appearance, "opacity", toBoundedNumber(value.opacity, NODE_BOX_OPACITY_RANGE));
  setIfDefined(appearance, "blur", toBoundedNumber(value.blur, NODE_BOX_BLUR_RANGE));
  setIfDefined(appearance, "borderColor", toColor(value.borderColor));
  setIfDefined(
    appearance,
    "borderWidth",
    toBoundedNumber(value.borderWidth, NODE_BOX_BORDER_WIDTH_RANGE)
  );
  setIfDefined(
    appearance,
    "cornerRadius",
    toBoundedNumber(value.cornerRadius, NODE_BOX_CORNER_RADIUS_RANGE)
  );
  setIfDefined(appearance, "textColor", toColor(value.textColor));
  setIfDefined(appearance, "shadow", value.shadow === false ? false : undefined);
  return Object.keys(appearance).length > 0 ? appearance : undefined;
}

export function isSameNodeBoxAppearance(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(normalizeNodeBoxAppearance(left) ?? {}) ===
    JSON.stringify(normalizeNodeBoxAppearance(right) ?? {})
  );
}
