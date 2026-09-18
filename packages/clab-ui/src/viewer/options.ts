import type { ReactFlowInstance } from "@xyflow/react";
import { isRecord } from "../core/utilities/typeHelpers";
import type { ViewerOptions as PublicViewerOptions } from "./publicTypes";

export interface ViewerOptions extends PublicViewerOptions {
  onInit?: (instance: ReactFlowInstance) => void;
}

export function resolveViewerOptions(options: ViewerOptions = {}, borderless = false) {
  const fitPadding = options.fitPadding ?? 0.25;
  return {
    ...options,
    controls: options.controls ?? !borderless,
    background: options.background ?? (borderless ? "none" : "dots"),
    transparent: options.transparent ?? borderless,
    nodeLabels: options.nodeLabels ?? true,
    zoomOnScroll: options.zoomOnScroll ?? true,
    panOnDrag: options.panOnDrag ?? true,
    fitPadding: Number.isFinite(fitPadding) ? Math.min(2, Math.max(0, fitPadding)) : 0.25
  };
}

function isFitPadding(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 2);
}

function isAppearance(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.values(value).every(value => typeof value === "string"));
}

/** postMessage payloads are untrusted; validate options before touching the canvas. */
export function isViewerOptions(value: unknown): value is ViewerOptions | undefined {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const options = value;
  for (const key of ["controls", "transparent", "nodeLabels", "zoomOnScroll", "panOnDrag"]) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") return false;
  }
  if (options.background !== undefined && !["dots", "lines", "none"].includes(String(options.background))) return false;
  if (options.linkLabels !== undefined && !["show-all", "on-select", "hide"].includes(String(options.linkLabels))) return false;
  return isFitPadding(options.fitPadding) && isAppearance(options.appearance);
}
