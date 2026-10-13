/**
 * Custom icon type definitions for React TopoViewer.
 * Shared between extension and webview.
 */

/**
 * Information about a custom icon
 */
export interface CustomIconInfo {
  /** Icon name without extension (e.g., "my-router") */
  name: string;
  /** Where the icon was loaded from */
  source: "workspace" | "global";
  /** Base64 data URI for rendering */
  dataUri: string;
  /** Image format */
  format: "svg" | "png";
}

/**
 * Built-in icons, in the order the icon picker shows them.
 */
export const BUILTIN_ICONS = [
  "router",
  "switch",
  "leaf",
  "spine",
  "super-spine",
  "dcgw",
  "firewall",
  "container",
  "vm",
  "server",
  "client",
  "controller",
  "cloud",
  "pon",
  "rgw",
  "ue"
] as const;

export type BuiltInIcon = (typeof BUILTIN_ICONS)[number];

const BUILTIN_ICON_SET: ReadonlySet<string> = new Set(BUILTIN_ICONS);

function isBuiltInIconId(name: string): name is BuiltInIcon {
  return BUILTIN_ICON_SET.has(name);
}

/**
 * Older icon names that still draw a built-in icon.
 */
export const BUILTIN_ICON_ALIASES: Readonly<Record<string, BuiltInIcon>> = {
  pe: "router",
  bridge: "switch"
};

/**
 * Built-in icon names that ship with the extension, aliases included
 */
export const BUILTIN_ICON_NAMES: ReadonlySet<string> = new Set<string>([
  ...BUILTIN_ICONS,
  ...Object.keys(BUILTIN_ICON_ALIASES)
]);

/**
 * Check if an icon name is a built-in icon
 */
export function isBuiltInIcon(name: string): boolean {
  return BUILTIN_ICON_NAMES.has(name);
}

/**
 * The built-in icon an icon name draws, or undefined for custom icon names
 */
export function resolveBuiltInIcon(name: string): BuiltInIcon | undefined {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_ICON_ALIASES, name)) {
    return BUILTIN_ICON_ALIASES[name];
  }
  return isBuiltInIconId(name) ? name : undefined;
}

/**
 * Supported icon file extensions
 */
export const SUPPORTED_ICON_EXTENSIONS = new Set([".svg", ".png"]);

/**
 * Check if a file extension is a supported icon format
 */
export function isSupportedIconExtension(ext: string): boolean {
  return SUPPORTED_ICON_EXTENSIONS.has(ext.toLowerCase());
}

/**
 * Get MIME type for an icon file extension
 */
export function getIconMimeType(ext: string): string {
  const lower = ext.toLowerCase();
  if (lower === ".svg") return "image/svg+xml";
  if (lower === ".png") return "image/png";
  return "application/octet-stream";
}

/**
 * Get icon format from file extension
 */
export function getIconFormat(ext: string): "svg" | "png" {
  return ext.toLowerCase() === ".png" ? "png" : "svg";
}

/**
 * Extract unique custom icon names used by nodes in an element list.
 * Filters out built-in icons, returning only custom icon names. A custom icon
 * may share a built-in name, in which case it replaces the built-in icon.
 *
 * @param elements - Array of graph elements (nodes and edges)
 * @param customIconNames - Names of the available custom icons
 * @returns Array of unique custom icon names
 */
export function extractUsedCustomIcons<T extends { data?: { topoViewerRole?: string } }>(
  elements: T[],
  customIconNames: ReadonlySet<string> = new Set()
): string[] {
  const usedIcons = new Set<string>();
  for (const el of elements) {
    const role = el.data?.topoViewerRole;
    if (role !== undefined && role.length > 0 && (!isBuiltInIcon(role) || customIconNames.has(role))) {
      usedIcons.add(role);
    }
  }
  return Array.from(usedIcons);
}
