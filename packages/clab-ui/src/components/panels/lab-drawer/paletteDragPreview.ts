// Custom drag preview for palette items. The native HTML5 drag image is not
// rendered at all in some hosts (VS Code's webview on Linux among them), so
// instead of dataTransfer.setDragImage a DOM ghost is appended to the body
// and follows the cursor via document-level dragover events. The native drag
// image is replaced with a transparent pixel so hosts that do render it don't
// show a second preview.
import { DEFAULT_TELEMETRY_NODE_SIZE_PX } from "../../../utils/telemetryInterfaceLabels";

const PREVIEW_ICON_SIZE = DEFAULT_TELEMETRY_NODE_SIZE_PX;
const PREVIEW_LABEL_MAX_WIDTH = 110;
const PREVIEW_GLYPH_SIZE = 32;

export const PALETTE_DRAG_GHOST_ATTR = "data-palette-drag-ghost";

export interface PaletteDragPreviewOptions {
  label: string;
  /** Icon data URI rendered exactly like a canvas node icon. */
  iconUrl?: string;
  iconCornerRadius?: number;
  /** SVG element to clone (palette glyph) when there is no icon URL. */
  iconElement?: SVGSVGElement | null;
}

function buildIconGhost(iconUrl: string, cornerRadius: number | undefined): HTMLElement {
  const icon = document.createElement("div");
  icon.style.width = `${PREVIEW_ICON_SIZE}px`;
  icon.style.height = `${PREVIEW_ICON_SIZE}px`;
  icon.style.backgroundImage = `url(${iconUrl})`;
  icon.style.backgroundSize = "cover";
  icon.style.backgroundPosition = "center";
  icon.style.backgroundRepeat = "no-repeat";
  icon.style.borderRadius = typeof cornerRadius === "number" ? `${cornerRadius}px` : "4px";
  return icon;
}

function buildGlyphGhost(source: SVGSVGElement): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.style.display = "flex";
  wrapper.style.alignItems = "center";
  wrapper.style.justifyContent = "center";
  wrapper.style.width = `${PREVIEW_ICON_SIZE}px`;
  wrapper.style.height = `${PREVIEW_ICON_SIZE}px`;
  wrapper.style.color = getComputedStyle(source).color;
  const glyph = source.cloneNode(true) as SVGSVGElement;
  glyph.style.width = `${PREVIEW_GLYPH_SIZE}px`;
  glyph.style.height = `${PREVIEW_GLYPH_SIZE}px`;
  glyph.style.fontSize = `${PREVIEW_GLYPH_SIZE}px`;
  wrapper.appendChild(glyph);
  return wrapper;
}

function buildLabelGhost(label: string): HTMLElement {
  // Mirrors the canvas node label style (nodeStyles.ts) so the ghost reads on
  // any background.
  const el = document.createElement("div");
  el.textContent = label;
  el.style.color = "#F5F5F5";
  el.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
  el.style.padding = "1px 4px";
  el.style.borderRadius = "3px";
  el.style.fontSize = "0.7rem";
  el.style.lineHeight = "1.4";
  el.style.maxWidth = `${PREVIEW_LABEL_MAX_WIDTH}px`;
  el.style.whiteSpace = "nowrap";
  el.style.overflow = "hidden";
  el.style.textOverflow = "ellipsis";
  return el;
}

function buildGhostContainer(options: PaletteDragPreviewOptions): HTMLElement | null {
  let icon: HTMLElement;
  if (options.iconUrl !== undefined && options.iconUrl.length > 0) {
    icon = buildIconGhost(options.iconUrl, options.iconCornerRadius);
  } else if (options.iconElement) {
    icon = buildGlyphGhost(options.iconElement);
  } else {
    return null;
  }

  const container = document.createElement("div");
  container.setAttribute(PALETTE_DRAG_GHOST_ATTR, "true");
  container.style.position = "fixed";
  container.style.top = "0";
  container.style.left = "0";
  container.style.zIndex = "99999";
  container.style.pointerEvents = "none";
  container.style.opacity = "0.85";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.alignItems = "center";
  container.style.gap = "2px";
  container.appendChild(icon);
  container.appendChild(buildLabelGhost(options.label));
  return container;
}

// Transparent pixel handed to setDragImage to suppress the browser's default
// snapshot of the palette card. Created once so it is decoded before the
// first drag (an unloaded image falls back to the default snapshot).
let transparentDragImage: HTMLImageElement | null = null;

function getTransparentDragImage(): HTMLImageElement {
  if (!transparentDragImage) {
    transparentDragImage = new Image(1, 1);
    transparentDragImage.src =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'/%3E";
  }
  return transparentDragImage;
}

// Preload so the pixel is decoded before the first drag; setDragImage with a
// not-yet-loaded image falls back to the default snapshot.
if (typeof Image !== "undefined") {
  getTransparentDragImage();
}

let cleanupActiveGhost: (() => void) | null = null;

/**
 * Shows a cursor-following drag ghost for a palette item. Must be called
 * synchronously from a dragstart handler; the ghost removes itself when the
 * drag operation ends.
 */
export function applyPaletteDragPreview(
  event: React.DragEvent,
  options: PaletteDragPreviewOptions
): void {
  cleanupActiveGhost?.();

  const ghost = buildGhostContainer(options);
  if (!ghost) return;

  if (typeof event.dataTransfer.setDragImage === "function") {
    event.dataTransfer.setDragImage(getTransparentDragImage(), 0, 0);
  }

  document.body.appendChild(ghost);
  // Cursor sits at the icon center; measured once, the ghost size is static.
  const offsetX = ghost.offsetWidth / 2;
  const offsetY = PREVIEW_ICON_SIZE / 2;
  const moveTo = (x: number, y: number) => {
    ghost.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px)`;
  };
  moveTo(event.clientX, event.clientY);

  const handleDragOver = (dragEvent: DragEvent) => {
    moveTo(dragEvent.clientX, dragEvent.clientY);
  };
  const handleDragEnd = () => {
    cleanupActiveGhost?.();
  };

  document.addEventListener("dragover", handleDragOver, true);
  document.addEventListener("dragend", handleDragEnd, true);
  document.addEventListener("drop", handleDragEnd, true);

  cleanupActiveGhost = () => {
    cleanupActiveGhost = null;
    document.removeEventListener("dragover", handleDragOver, true);
    document.removeEventListener("dragend", handleDragEnd, true);
    document.removeEventListener("drop", handleDragEnd, true);
    ghost.remove();
  };
}
