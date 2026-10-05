import { publicAssetUrl } from "./publicAssetUrl";

/**
 * Title bar for the borderless desktop shell.
 *
 * The desktop app hides the native frame, so every window draws this toolbar itself: it is the
 * drag region, carries the logo and name, and leaves room for the native window controls
 * (env(titlebar-area-*) is the space they do not cover). In a normal browser
 * `window.containerlabDesktop` is absent and nothing here runs.
 */

/** Matches the overlay height the desktop main process reserves for the window controls. */
const TITLEBAR_HEIGHT = 40;
const FONT_FAMILY =
  'var(--clab-ui-font-family, var(--vscode-font-family, system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, sans-serif))';

interface DesktopBridge {
  platform: string;
  setTitleBarOverlay(options: { color: string; symbolColor: string; height: number }): void;
}

declare global {
  interface Window {
    containerlabDesktop?: DesktopBridge;
  }
}

const STYLE = `
:root { --clab-desktop-titlebar-height: ${TITLEBAR_HEIGHT}px; }
.clab-desktop-titlebar {
  position: fixed; inset: 0 0 auto 0; z-index: 1; box-sizing: border-box;
  height: var(--clab-desktop-titlebar-height); gap: 8px;
  padding-left: calc(env(titlebar-area-x, 0px) + 14px);
  padding-right: calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 16px);
  display: flex; align-items: center;
  background: var(--clab-ui-editor-background, var(--vscode-editor-background, #000000));
  color: var(--clab-ui-editor-foreground, var(--vscode-editor-foreground, #ececec));
  border-bottom: 1px solid var(--clab-ui-panel-border, var(--vscode-panel-border, #222222));
  font-family: ${FONT_FAMILY};
  -webkit-app-region: drag; -webkit-user-select: none; user-select: none;
}
.clab-desktop-titlebar-logo {
  display: flex; width: 20px; height: 20px; flex: none;
  color: var(--vscode-descriptionForeground, currentColor);
}
.clab-desktop-titlebar-logo > * { display: block; width: 100%; height: 100%; }
.clab-desktop-titlebar-name {
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; font-weight: 600; letter-spacing: -0.005em; line-height: 1;
}
html[data-desktop-chrome] #root {
  margin-top: var(--clab-desktop-titlebar-height);
  height: calc(100% - var(--clab-desktop-titlebar-height));
}
`;

let installed = false;

/** The logo's neutral frame color; inlined, it follows the theme's muted text color instead. */
const LOGO_FRAME_FILL = "rgb(135, 135, 135)";

/**
 * Swaps the logo image for inline SVG whose frame uses the theme's muted text color, so it stays
 * crisp and matches the rail icons on every theme. The image stays if the SVG cannot load.
 */
async function inlineThemedLogo(slot: HTMLElement, url: string): Promise<void> {
  try {
    const response = await fetch(url);
    if (!response.ok) return;
    const svg = new DOMParser().parseFromString(await response.text(), "image/svg+xml").documentElement;
    if (!(svg instanceof SVGSVGElement)) return;
    for (const shape of svg.querySelectorAll<SVGElement>("[style]")) {
      if (shape.style.fill === LOGO_FRAME_FILL) shape.style.fill = "currentColor";
    }
    svg.setAttribute("aria-hidden", "true");
    slot.replaceChildren(document.importNode(svg, true));
  } catch {
    // Keep the image.
  }
}

/** Whether this window draws the desktop title bar, which already shows the logo. */
export function hasDesktopTitleBar(): boolean {
  return installed;
}

/** Converts a computed `rgb()`/`rgba()` color to the `#rrggbb` form the main process accepts. */
export function cssColorToHex(value: string): string | null {
  const match = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(value.trim());
  if (!match) return null;
  const channels = match.slice(1, 4).map(Number);
  if (channels.some((channel) => channel > 255)) return null;
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function syncWindowControls(bridge: DesktopBridge, strip: HTMLElement): void {
  const computed = getComputedStyle(strip);
  const color = cssColorToHex(computed.backgroundColor);
  const symbolColor = cssColorToHex(computed.color);
  if (color !== null && symbolColor !== null) {
    bridge.setTitleBarOverlay({ color, symbolColor, height: TITLEBAR_HEIGHT });
  }
}

/** `title` pins the name shown beside the logo; without it the bar follows the document title. */
export function installDesktopChrome(options: { title?: string } = {}): void {
  const bridge = window.containerlabDesktop;
  if (!bridge) return;

  document.documentElement.dataset.desktopChrome = bridge.platform;
  const style = document.createElement("style");
  style.textContent = STYLE;
  document.head.append(style);

  const bar = document.createElement("div");
  bar.className = "clab-desktop-titlebar";
  const logo = document.createElement("span");
  logo.className = "clab-desktop-titlebar-logo";
  const logoImage = document.createElement("img");
  logoImage.src = publicAssetUrl("containerlab.svg");
  logoImage.alt = "";
  logoImage.setAttribute("aria-hidden", "true");
  logo.append(logoImage);
  void inlineThemedLogo(logo, logoImage.src);
  const name = document.createElement("span");
  name.className = "clab-desktop-titlebar-name";
  bar.append(logo, name);
  document.body.append(bar);
  installed = true;

  const syncName = () => {
    name.textContent = options.title ?? document.title;
  };
  let pending = 0;
  const syncControls = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => syncWindowControls(bridge, bar));
  };

  syncName();
  syncControls();
  // The theme is applied as inline variables and a class on <html>.
  new MutationObserver(syncControls).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"]
  });
  new MutationObserver(syncName).observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true
  });
}
