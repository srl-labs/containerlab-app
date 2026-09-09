/**
 * Color normalization helpers for form inputs and annotation persistence.
 */
import type { FreeShapeAnnotation } from "../core/types/topology";

function clampByte(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(255, Math.max(0, value));
}

function toHexByte(value: number): string {
  return clampByte(value).toString(16).padStart(2, "0");
}

function expandShortHex(value: string): string {
  const hex = value.replace("#", "");
  const expanded = hex
    .split("")
    .map((ch) => ch + ch)
    .join("");
  return "#" + expanded;
}

// Regex pattern for parsing rgba() or rgb() values
const RGB_REGEX = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

// Regex pattern for a full 6-digit hex color
const HEX6_REGEX = /^#([0-9a-f]{6})$/i;

// Regex pattern for 3-8 digit hex colors (capturing the digits)
const HEX_DIGITS_REGEX = /^#([0-9a-f]{3,8})$/i;

// Regex pattern for 3-8 digit hex colors (test only)
const HEX_TEST_REGEX = /^#[0-9a-f]{3,8}$/i;

// Regex pattern for extracting the leading r/g/b components of rgb()/rgba() values
const RGB_PREFIX_REGEX = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/;

function parseRgb(value: string): { hex: string; alpha?: number } | null {
  const match = RGB_REGEX.exec(value);
  if (!match) return null;
  const r = parseInt(match[1], 10);
  const g = parseInt(match[2], 10);
  const b = parseInt(match[3], 10);
  const alphaParsed = Number.parseFloat(match[4]);
  const alphaRaw = Number.isFinite(alphaParsed) ? alphaParsed : undefined;
  const alpha = alphaRaw !== undefined ? Math.min(1, Math.max(0, alphaRaw)) : undefined;
  return { hex: "#" + toHexByte(r) + toHexByte(g) + toHexByte(b), alpha };
}

/**
 * Apply alpha transparency to a color.
 * Supports hex colors (#RRGGBB). Falls back to returning original color for other formats.
 */
export function applyAlphaToColor(color: string, alpha: number): string {
  const normalizedAlpha = Math.min(1, Math.max(0, alpha));
  const hexMatch = HEX6_REGEX.exec(color);
  if (hexMatch) {
    const r = parseInt(hexMatch[1].slice(0, 2), 16);
    const g = parseInt(hexMatch[1].slice(2, 4), 16);
    const b = parseInt(hexMatch[1].slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${normalizedAlpha})`;
  }
  return color;
}

/**
 * Parse a CSS color string (hex or rgb/rgba) and return perceived luminance.
 * Returns a number 0..1 where 0 = black, 1 = white, or null if unparseable.
 */
export function parseLuminance(color: string): number | null {
  let r = 0;
  let g = 0;
  let b = 0;

  const hexMatch = HEX_DIGITS_REGEX.exec(color.trim());
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    const rgbMatch = RGB_PREFIX_REGEX.exec(color);
    if (!rgbMatch) return null;
    r = parseInt(rgbMatch[1], 10);
    g = parseInt(rgbMatch[2], 10);
    b = parseInt(rgbMatch[3], 10);
  }

  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export function normalizeHexColor(value: string | undefined, fallback = "#000000"): string {
  if (value === undefined || value.length === 0) return fallback;
  const trimmed = value.trim();
  if (trimmed.startsWith("#")) {
    const hex = trimmed.toLowerCase();
    if (hex.length === 4) return expandShortHex(hex);
    if (hex.length === 7) return hex;
    if (hex.length === 9) return hex.slice(0, 7);
    if (hex.length === 5) return expandShortHex(hex.slice(0, 4));
    return fallback;
  }
  const rgb = parseRgb(trimmed);
  if (rgb) return rgb.hex;
  return fallback;
}

// Cache for resolved CSS variable colors. getComputedStyle forces a style
// recalculation, and hot components resolve several variables per render, so
// successful lookups are memoized until the theme changes. VS Code theme swaps
// mutate class/style on body/documentElement (same signal MonacoCodeEditor
// observes), which clears the cache.
const computedColorCache = new Map<string, string>();
let computedColorObserverInstalled = false;

function ensureComputedColorCacheObserver(): boolean {
  if (computedColorObserverInstalled) return true;
  try {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return false;
    const { body, documentElement } = document;
    if (!body || !documentElement) return false;
    const observer = new MutationObserver(() => computedColorCache.clear());
    observer.observe(body, { attributes: true, attributeFilter: ["class", "style"] });
    observer.observe(documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    computedColorObserverInstalled = true;
    return true;
  } catch {
    return false;
  }
}

function parseComputedColorValue(raw: string): string | null {
  if (HEX_TEST_REGEX.test(raw)) {
    const normalized = normalizeHexColor(raw, "");
    return normalized.length > 0 ? normalized : null;
  }
  const rgb = parseRgb(raw);
  return rgb ? rgb.hex : null;
}

export function resolveComputedColor(cssVar: string, fallback: string): string {
  // Only cache when the invalidation observer is active, so stale colors can
  // never be served after a theme change (and node-env test runs stay safe).
  const canCache = ensureComputedColorCacheObserver();
  if (canCache) {
    const cached = computedColorCache.get(cssVar);
    if (cached !== undefined) return cached;
  }
  try {
    const raw = window.getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
    if (!raw) return fallback;
    const resolved = parseComputedColorValue(raw);
    if (resolved === null) return fallback;
    if (canCache) computedColorCache.set(cssVar, resolved);
    return resolved;
  } catch {
    return fallback;
  }
}

export function invertHexColor(hex: string, fallback = "#ffffff", strength = 0.5): string {
  const normalized = normalizeHexColor(hex, "");
  if (!normalized) return fallback;
  const sr = parseInt(normalized.slice(1, 3), 16);
  const sg = parseInt(normalized.slice(3, 5), 16);
  const sb = parseInt(normalized.slice(5, 7), 16);
  const r = Math.round(sr + (255 - 2 * sr) * strength);
  const g = Math.round(sg + (255 - 2 * sg) * strength);
  const b = Math.round(sb + (255 - 2 * sb) * strength);
  return "#" + toHexByte(r) + toHexByte(g) + toHexByte(b);
}

export function normalizeShapeAnnotationColors(
  annotation: FreeShapeAnnotation
): FreeShapeAnnotation {
  const fillColorValue = annotation.fillColor;
  const hasFillColor = annotation.fillColor !== undefined;
  const hasFillColorValue = typeof fillColorValue === "string" && fillColorValue.length > 0;
  const fill = hasFillColor && hasFillColorValue ? parseRgb(fillColorValue) : null;
  const fillColor = hasFillColor
    ? normalizeHexColor(annotation.fillColor, "#ffffff")
    : annotation.fillColor;
  const fillOpacity = annotation.fillOpacity ?? fill?.alpha;
  const hasBorderColor =
    typeof annotation.borderColor === "string" && annotation.borderColor.length > 0;

  return {
    ...annotation,
    fillColor,
    fillOpacity,
    borderColor: hasBorderColor
      ? normalizeHexColor(annotation.borderColor, "#000000")
      : annotation.borderColor
  };
}
