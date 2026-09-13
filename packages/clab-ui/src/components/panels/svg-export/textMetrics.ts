// Text measurement helpers so exported labels size exactly like the canvas.

const FALLBACK_CHAR_WIDTH_RATIO = 0.6;

let measureContext: CanvasRenderingContext2D | null | undefined;

function getMeasureContext(): CanvasRenderingContext2D | null {
  if (measureContext === undefined) {
    measureContext =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  return measureContext;
}

export interface FontSpec {
  fontFamily: string;
  fontSizePx: number;
  fontWeight: string;
}

export interface SampledFontMetrics extends FontSpec {
  lineHeightPx: number;
}

/** Measure rendered text width; falls back to a character estimate without a DOM. */
export function measureTextWidth(text: string, font: FontSpec): number {
  const ctx = getMeasureContext();
  if (!ctx) return text.length * font.fontSizePx * FALLBACK_CHAR_WIDTH_RATIO;
  ctx.font = `${font.fontWeight} ${font.fontSizePx}px ${font.fontFamily}`;
  return ctx.measureText(text).width;
}

/** Emulate CSS `text-overflow: ellipsis` at maxWidth. */
export function truncateTextToWidth(
  text: string,
  font: FontSpec,
  maxWidth: number
): { text: string; width: number } {
  const fullWidth = measureTextWidth(text, font);
  if (fullWidth <= maxWidth) return { text, width: fullWidth };
  for (let length = text.length - 1; length > 0; length--) {
    const candidate = text.slice(0, length).trimEnd() + "…";
    const width = measureTextWidth(candidate, font);
    if (width <= maxWidth) return { text: candidate, width };
  }
  return { text: "…", width: measureTextWidth("…", font) };
}

/**
 * Sample font metrics from a live element (e.g. a rendered node label) so the
 * export uses the exact font the canvas renders with. Returns null when the
 * element is absent (labels hidden, no DOM).
 */
export function sampleFontMetrics(selector: string): SampledFontMetrics | null {
  if (typeof document === "undefined") return null;
  const element = document.querySelector(selector);
  if (!element) return null;
  const style = getComputedStyle(element);
  const fontSizePx = Number.parseFloat(style.fontSize);
  if (!Number.isFinite(fontSizePx) || fontSizePx <= 0) return null;
  const lineHeightPx = Number.parseFloat(style.lineHeight);
  return {
    fontFamily: style.fontFamily,
    fontSizePx,
    fontWeight: style.fontWeight,
    lineHeightPx: Number.isFinite(lineHeightPx) ? lineHeightPx : fontSizePx * 1.4
  };
}
