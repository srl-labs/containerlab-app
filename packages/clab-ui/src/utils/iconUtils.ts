import type { CustomIconInfo } from "../core/types/icons";

const customIconMapCache = new WeakMap<CustomIconInfo[], Map<string, string>>();

export function supportsCustomIconColor(dataUri: string): boolean {
  return /^data:image\/svg\+xml(?:;[^,]*)?,/i.test(dataUri);
}

function escapeSvgAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** Keep the source viewport so tinting does not change an icon's sizing or crop. */
function getSvgViewport(dataUri: string): { root: string; image: string } {
  const fallback = { root: 'width="48" height="48"', image: 'width="48" height="48"' };
  try {
    const comma = dataUri.indexOf(",");
    const payload = decodeURIComponent(dataUri.slice(comma + 1));
    const svg = /;base64$/i.test(dataUri.slice(0, comma)) ? atob(payload) : payload;
    // Read only the root geometry, leaving the source artwork untouched. Quoted
    // attribute values can contain '>', and comments can contain example tags.
    const root = /<svg\b(?:[^>"']|"[^"]*"|'[^']*')*>/.exec(
      svg.replace(/<!--[\s\S]*?-->/g, "")
    )?.[0];
    if (root === undefined) return fallback;
    const attributes: string[] = [];
    let image = 'width="100%" height="100%"';
    for (const match of root.matchAll(/([^\s=<>]+)\s*=\s*("[^"]*"|'[^']*')/g)) {
      const [, name, quotedValue] = match;
      if (!["width", "height", "viewBox", "preserveAspectRatio"].includes(name)) continue;
      attributes.push(match[0]);
      if (name !== "viewBox") continue;
      const bounds = quotedValue.slice(1, -1).trim().split(/[\s,]+/).map(Number);
      if (bounds.length === 4 && bounds.every(Number.isFinite) && bounds[2] > 0 && bounds[3] > 0) {
        const [x, y, width, height] = bounds;
        image = `x="${x}" y="${y}" width="${width}" height="${height}"`;
      }
    }
    return { root: attributes.join(" "), image };
  } catch {
    return fallback;
  }
}

/** Apply an optional SVG tint without changing the original artwork or its alpha channel. */
export function getCustomIconUrl(dataUri: string, color?: string | null): string {
  if (color == null || color.length === 0 || !supportsCustomIconColor(dataUri)) return dataUri;

  // Filtering the rendered image covers fills, strokes, CSS and gradients alike.
  // Keep it in its own image document so filter IDs and icon styles stay isolated.
  const viewport = getSvgViewport(dataUri);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${viewport.root}>
    <defs><filter id="tint" color-interpolation-filters="sRGB">
      <feFlood flood-color="${escapeSvgAttribute(color)}"/>
      <feComposite in2="SourceAlpha" operator="in"/>
    </filter></defs>
    <image ${viewport.image} href="${escapeSvgAttribute(dataUri)}" filter="url(#tint)"/>
  </svg>`;
  // Also escape characters that would break an unquoted CSS background-image URL.
  const encoded = encodeURIComponent(svg).replace(
    /['()]/g,
    (character) => `%${character.charCodeAt(0).toString(16)}`
  );
  return `data:image/svg+xml,${encoded}`;
}

export function buildCustomIconMap(customIcons: CustomIconInfo[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const icon of customIcons) {
    map.set(icon.name, icon.dataUri);
  }
  return map;
}

export function getCustomIconMap(customIcons: CustomIconInfo[]): Map<string, string> {
  const cached = customIconMapCache.get(customIcons);
  if (cached) return cached;
  const map = buildCustomIconMap(customIcons);
  customIconMapCache.set(customIcons, map);
  return map;
}
