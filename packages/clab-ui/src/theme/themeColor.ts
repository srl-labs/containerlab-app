// Color math for app themes. Theme colors are hex (3, 4, 6 or 8 digits) or rgb()/rgba().

type Rgb = [number, number, number];

interface Rgba {
  rgb: Rgb;
  alpha: number;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const HEX_ANY = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNCTION =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+|1\.0+)\s*)?\)$/i;

/** An opaque `#rrggbb` color. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX6.test(value);
}

/** A color a theme token may hold. */
export function isThemeColor(value: unknown): value is string {
  return typeof value === "string" && parseColor(value) !== null;
}

function rgb(channel: (index: number) => number): Rgb {
  return [channel(0), channel(1), channel(2)];
}

function parseColor(value: string): Rgba | null {
  const text = value.trim();
  if (HEX_ANY.test(text)) {
    const digits =
      text.length <= 5
        ? text
            .slice(1)
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : text.slice(1);
    const channel = (index: number) => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);
    return { rgb: rgb(channel), alpha: digits.length === 8 ? channel(3) / 255 : 1 };
  }
  const match = RGB_FUNCTION.exec(text);
  if (!match) return null;
  const channels = rgb((index) => Number(match[index + 1]));
  if (channels.some((channel) => channel > 255)) return null;
  const alpha = match.at(4);
  return { rgb: channels, alpha: alpha === undefined ? 1 : Number(alpha) };
}

function parseHex(value: string | undefined): Rgb | null {
  return isHexColor(value) ? (parseColor(value)?.rgb ?? null) : null;
}

function toHex(value: Rgb): string {
  return `#${value
    .map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Blends `weight` of `to` into `from`; both are `#rrggbb`. */
export function mix(from: string, to: string, weight: number): string {
  const a = parseHex(from) ?? [0, 0, 0];
  const b = parseHex(to) ?? [0, 0, 0];
  return toHex(rgb((index) => a[index] + (b[index] - a[index]) * weight));
}

/** Shifts every channel of `color` by `to - from`, so a color keeps its offset from a moved base. */
export function rebase(color: string, from: string, to: string): string | null {
  const value = parseHex(color);
  const origin = parseHex(from);
  const target = parseHex(to);
  if (!value || !origin || !target) return null;
  return toHex(rgb((index) => target[index] + value[index] - origin[index]));
}

export function withAlpha(color: string, alpha: number): string {
  const [red, green, blue] = parseHex(color) ?? [0, 0, 0];
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

/** `#rrggbb` for any theme color, compositing translucent colors over `background`. */
export function toOpaqueHex(value: string | undefined, background = "#000000"): string | null {
  const color = value === undefined ? null : parseColor(value);
  if (!color) return null;
  const under = parseHex(background) ?? [0, 0, 0];
  return toHex(rgb((index) => under[index] + (color.rgb[index] - under[index]) * color.alpha));
}

/** The `#rrggbb` or `#rrggbbaa` form VS Code color themes require. */
export function toVsCodeColor(value: string): string | null {
  const color = parseColor(value);
  if (!color) return null;
  const hex = toHex(color.rgb);
  return color.alpha >= 1 ? hex : `${hex}${Math.round(color.alpha * 255).toString(16).padStart(2, "0")}`;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

function contrastRatio(first: string, second: string): number {
  const a = parseHex(first);
  const b = parseHex(second);
  if (!a || !b) return 1;
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export function isLightColor(value: string): boolean {
  const color = parseHex(value);
  return color !== null && relativeLuminance(color) > 0.4;
}

/** White text unless it falls below MUI's 3:1 contrast threshold on `background`. */
export function readableOn(background: string): string {
  return contrastRatio("#ffffff", background) >= 3 ? "#ffffff" : "#000000";
}

/** `preferred` if it stays legible on `background`, otherwise black or white. */
export function legibleOn(background: string, preferred: string): string {
  return contrastRatio(preferred, background) >= 4.5 ? preferred : readableOn(background);
}
