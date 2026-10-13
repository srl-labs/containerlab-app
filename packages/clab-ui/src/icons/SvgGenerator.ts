// SvgGenerator.ts
//
// Built-in node icons: the containerlab rounded hex around a line symbol. The
// frame is drawn in an ink that reads on the background (navy on light, pale on
// dark) and the symbol in the icon color, so every icon can be recolored.

import type { BuiltInIcon } from "../core/types/icons";

/**
 * Supported node types for SVG generation
 */
export type NodeType = BuiltInIcon;

/** Frame ink for light and dark backgrounds. */
export const ICON_INK = { light: "#001135", dark: "#ddf8ff" } as const;

/** Display names for the icon pickers. */
export const BUILT_IN_ICON_LABELS: Readonly<Record<NodeType, string>> = {
  router: "Router",
  switch: "Switch",
  leaf: "Leaf",
  spine: "Spine",
  "super-spine": "Super Spine",
  dcgw: "DC Gateway",
  firewall: "Firewall",
  container: "Container",
  vm: "VM",
  server: "Server",
  client: "Client",
  controller: "Controller",
  cloud: "Cloud",
  pon: "PON",
  rgw: "RGW",
  ue: "User Equipment"
};

const FRAME =
  "M29 6.6Q32 4.9 35 6.6L53 17Q56 18.7 56 22.2V41.8Q56 45.3 53 47L35 57.4Q32 59.1 29 57.4L11 47Q8 45.3 8 41.8V22.2Q8 18.7 11 17Z";
// The hex and its stroke fill the icon, without the artwork's outer margin.
const VIEW_BOX = "4 4 56 56";

function dot(cx: number, cy: number, r: number): string {
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor" stroke="none"/>`;
}

// Symbols are drawn on the 64 unit artwork grid in currentColor.
const SYMBOLS: Readonly<Record<NodeType, string>> = {
  router:
    '<path d="M28 28L21 21M21 27V21H27M36 28L43 21M37 21H43V27M28 36L21 43M21 37V43H27M36 36L43 43M37 43H43V37"/>',
  switch: '<path d="M20 26H44M38 20L44 26L38 32M44 38H20M26 32L20 38L26 44"/>',
  // Uplinks over the forwarding plane
  leaf: '<path d="M28 29L21 22M21 28V22H27M36 29L43 22M37 22H43V28M21 36H43M21 42H43"/>',
  spine:
    '<path d="M20 26H44M24 22L20 26L24 30M40 22L44 26L40 30M20 38H44M24 34L20 38L24 42M40 34L44 38L40 42"/>',
  "super-spine":
    '<path d="M20 22H44M20 32H44M24 28L20 32L24 36M40 28L44 32L40 36M20 42H44"/>',
  // Traffic both ways through the gateway
  dcgw: '<path d="M24 20V44M40 20V44M19 32H45M23 28L19 32L23 36M41 28L45 32L41 36"/>',
  // Brick wall
  firewall:
    '<rect x="20" y="21" width="24" height="22" rx="2.5"/>' +
    '<path d="M20 28.3H44M20 35.7H44M32 21V28.3M26 28.3V35.7M38 28.3V35.7M32 35.7V43"/>',
  container:
    '<path d="M24 21H21V43H24M40 21H43V43H40"/><g fill="currentColor" stroke="none">' +
    '<rect x="27" y="25" width="4" height="5" rx="0.8"/><rect x="34" y="25" width="4" height="5" rx="0.8"/>' +
    '<rect x="27" y="34" width="4" height="5" rx="0.8"/><rect x="34" y="34" width="4" height="5" rx="0.8"/></g>',
  vm: '<path d="M26 21H42Q45 21 45 24V37"/><rect x="19" y="27" width="20" height="16" rx="2.5"/><path d="M25 32L28 35L25 38M32 38H34"/>',
  server:
    '<rect x="21" y="20" width="22" height="10" rx="2"/><rect x="21" y="34" width="22" height="10" rx="2"/>' +
    `<path d="M25 25H30M25 39H30"/>${dot(38, 25, 1.6)}${dot(38, 39, 1.6)}`,
  client: '<rect x="19" y="21" width="26" height="17" rx="2.5"/><path d="M32 38V43M26 43H38"/>',
  // Mixer sliders
  controller: `<path d="M24 20V44M32 20V44M40 20V44"/>${dot(24, 36, 3)}${dot(32, 26, 3)}${dot(40, 33, 3)}`,
  cloud: '<path d="M25 41H40A5.5 5.5 0 0 0 40 30A8 8 0 0 0 24.3 31.05A5 5 0 0 0 25 41Z"/>',
  // Optical splitter
  pon: `<path d="M19 32H27M27 32L40 23M27 32H40M27 32L40 41"/>${dot(42.5, 22, 2.2)}${dot(42.5, 32, 2.2)}${dot(42.5, 42, 2.2)}`,
  rgw:
    '<path d="M20 31L32 21L44 31M24 28V43H40V28M29.2 36.7A4 4 0 0 1 34.8 36.7M26.7 34.2A7.5 7.5 0 0 1 37.3 34.2"/>' +
    dot(32, 39.5, 1.5),
  ue: '<rect x="25" y="19" width="14" height="26" rx="3"/><path d="M30 40H34"/>'
};

// At low detail the symbol shrinks to a solid hex, keeping the icon color.
const LITE_SYMBOL = `<path d="${FRAME}" transform="translate(32 32) scale(0.42) translate(-32 -32)" fill="currentColor" stroke="none"/>`;

const svgCache = new Map<string, string>();

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function buildSvgString(symbol: string, color: string, ink: string): string {
  // Paint is set on each layer so the markup also works embedded in another SVG.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56" viewBox="${VIEW_BOX}">` +
    `<path d="${FRAME}" fill="none" stroke="${escapeAttribute(ink)}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<g color="${escapeAttribute(color)}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">` +
    symbol +
    "</g></svg>"
  );
}

function encode(cacheKey: string, svgString: () => string): string {
  const cached = svgCache.get(cacheKey);
  if (cached !== undefined) return cached;
  // Also escape characters that would break an unquoted CSS background-image URL.
  const encoded =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(svgString()).replace(
      /['()]/g,
      (character) => `%${character.charCodeAt(0).toString(16)}`
    );
  svgCache.set(cacheKey, encoded);
  return encoded;
}

/**
 * Generates an encoded SVG data URI for a built-in icon.
 *
 * @param nodeType - The built-in icon to draw
 * @param color - Color of the symbol (e.g., "#FF0000", "blue")
 * @param ink - Color of the hex frame, see ICON_INK
 * @returns Encoded SVG data URI suitable for use as CSS background-image
 */
export function generateEncodedSVG(nodeType: NodeType, color: string, ink: string): string {
  const symbol = Object.prototype.hasOwnProperty.call(SYMBOLS, nodeType)
    ? SYMBOLS[nodeType]
    : SYMBOLS.router;
  return encode(`${nodeType}:${color}:${ink}`, () => buildSvgString(symbol, color, ink));
}

/**
 * Generates the low-detail icon: the hex frame around a solid hex in the icon color.
 */
export function generateLiteSVG(color: string, ink: string): string {
  return encode(`lite:${color}:${ink}`, () => buildSvgString(LITE_SYMBOL, color, ink));
}
