// Standalone app themes: VS Code Modern by default, the earlier palettes, and popular editor themes.
import {
  DARK_VARS,
  LIGHT_VARS,
  applyVarMap,
  terminalAnsiVars,
  type TerminalAnsiColors,
  type VarMap
} from "./devTheme";
import { DARK_MODERN_VARS, LIGHT_MODERN_VARS } from "./modernThemes";
import { mix, readableOn, withAlpha } from "./themeColor";

export type AppThemeMode = "light" | "dark";

export interface AppTheme {
  id: string;
  name: string;
  mode: AppThemeMode;
  vars: VarMap;
}

const FONT_VARS: VarMap = {
  "--vscode-font-family": DARK_VARS["--vscode-font-family"],
  "--vscode-font-size": DARK_VARS["--vscode-font-size"]
};

/** The handful of colors a theme is designed around; everything else is derived. */
interface ThemePalette {
  background: string;
  surface: string;
  raised: string;
  input?: string;
  border: string;
  foreground: string;
  muted: string;
  accent: string;
  accentForeground?: string;
  link?: string;
  hover?: string;
  selection?: string;
  editorSelection: string;
  error: string;
  warning: string;
  info: string;
  success: string;
  ansi: TerminalAnsiColors;
}

function paletteVars(mode: AppThemeMode, palette: ThemePalette): VarMap {
  const dark = mode === "dark";
  const accentForeground = palette.accentForeground ?? readableOn(palette.accent);
  const input = palette.input ?? (dark ? palette.raised : palette.background);
  const hover = palette.hover ?? mix(palette.surface, palette.foreground, dark ? 0.08 : 0.06);
  const selection = palette.selection ?? mix(palette.surface, palette.foreground, dark ? 0.14 : 0.1);
  const link = palette.link ?? palette.accent;
  const tint = (color: string) => mix(palette.background, color, dark ? 0.2 : 0.14);
  return {
    "--vscode-editor-background": palette.background,
    "--vscode-editor-foreground": palette.foreground,
    "--vscode-sideBar-background": palette.surface,
    "--vscode-sideBar-foreground": palette.foreground,
    "--vscode-panel-background": palette.surface,
    "--vscode-panel-border": palette.border,
    "--vscode-button-background": palette.accent,
    "--vscode-button-foreground": accentForeground,
    "--vscode-button-hoverBackground": mix(palette.accent, accentForeground, 0.12),
    "--vscode-button-secondaryBackground": palette.raised,
    "--vscode-button-secondaryForeground": palette.foreground,
    "--vscode-button-secondaryHoverBackground": mix(palette.raised, palette.foreground, 0.08),
    "--vscode-input-background": input,
    "--vscode-input-foreground": palette.foreground,
    "--vscode-input-border": palette.border,
    "--vscode-input-placeholderForeground": palette.muted,
    "--vscode-dropdown-background": input,
    "--vscode-dropdown-foreground": palette.foreground,
    "--vscode-dropdown-border": palette.border,
    "--vscode-focusBorder": palette.accent,
    "--vscode-foreground": palette.foreground,
    "--vscode-descriptionForeground": palette.muted,
    "--vscode-errorForeground": palette.error,
    "--vscode-icon-foreground": palette.foreground,
    "--vscode-list-hoverBackground": hover,
    "--vscode-list-activeSelectionBackground": selection,
    "--vscode-list-activeSelectionForeground": palette.foreground,
    "--vscode-list-inactiveSelectionBackground": selection,
    "--vscode-list-inactiveSelectionForeground": palette.foreground,
    "--vscode-badge-background": palette.raised,
    "--vscode-badge-foreground": palette.foreground,
    "--vscode-scrollbarSlider-background": withAlpha(palette.muted, 0.3),
    "--vscode-scrollbarSlider-hoverBackground": withAlpha(palette.muted, 0.5),
    "--vscode-scrollbarSlider-activeBackground": withAlpha(palette.muted, 0.7),
    "--vscode-statusBar-background": palette.surface,
    "--vscode-statusBar-foreground": palette.foreground,
    "--vscode-tab-activeBackground": palette.background,
    "--vscode-tab-activeForeground": palette.foreground,
    "--vscode-tab-inactiveBackground": palette.surface,
    "--vscode-tab-inactiveForeground": palette.muted,
    "--vscode-tab-activeBorderTop": palette.accent,
    "--vscode-tab-hoverBackground": hover,
    "--vscode-textLink-foreground": link,
    "--vscode-textLink-activeForeground": link,
    "--vscode-textCodeBlock-background": palette.raised,
    "--vscode-settings-textInputBackground": input,
    "--vscode-settings-textInputForeground": palette.foreground,
    "--vscode-settings-textInputBorder": palette.border,
    "--vscode-notifications-background": palette.background,
    "--vscode-notifications-foreground": palette.foreground,
    "--vscode-notifications-border": palette.border,
    "--vscode-disabledForeground": mix(palette.muted, palette.background, 0.35),
    "--vscode-checkbox-border": palette.muted,
    "--vscode-editorWidget-background": palette.surface,
    "--vscode-editorWidget-foreground": palette.foreground,
    "--vscode-editorWidget-border": palette.border,
    "--vscode-widget-shadow": dark ? "rgba(0, 0, 0, 0.5)" : "rgba(0, 0, 0, 0.16)",
    "--vscode-menu-background": palette.background,
    "--vscode-menu-foreground": palette.foreground,
    "--vscode-menu-border": palette.border,
    "--vscode-menu-selectionBackground": palette.accent,
    "--vscode-menu-selectionForeground": accentForeground,
    "--vscode-inputValidation-errorBackground": tint(palette.error),
    "--vscode-inputValidation-errorBorder": palette.error,
    "--vscode-inputValidation-errorForeground": palette.foreground,
    "--vscode-inputValidation-warningBackground": tint(palette.warning),
    "--vscode-inputValidation-warningBorder": palette.warning,
    "--vscode-inputValidation-warningForeground": palette.foreground,
    "--vscode-inputValidation-infoBackground": tint(palette.info),
    "--vscode-inputValidation-infoBorder": palette.info,
    "--vscode-inputValidation-infoForeground": palette.foreground,
    "--vscode-editorError-foreground": palette.error,
    "--vscode-editorWarning-foreground": palette.warning,
    "--vscode-editorInfo-foreground": palette.info,
    "--vscode-charts-yellow": palette.warning,
    "--vscode-testing-iconPassed": palette.success,
    "--vscode-charts-green": palette.success,
    "--vscode-progressBar-background": palette.accent,
    "--vscode-editor-selectionBackground": palette.editorSelection,
    "--vscode-editor-inactiveSelectionBackground": mix(palette.background, palette.editorSelection, 0.5),
    "--vscode-terminal-selectionBackground": palette.editorSelection,
    ...terminalAnsiVars(palette.ansi),
    ...FONT_VARS
  };
}

const githubLight = paletteVars("light", {
  background: "#ffffff",
  surface: "#f6f8fa",
  raised: "#eaeef2",
  border: "#d0d7de",
  foreground: "#1f2328",
  muted: "#59636e",
  accent: "#0969da",
  editorSelection: "#cfe3fb",
  error: "#cf222e",
  warning: "#9a6700",
  info: "#0969da",
  success: "#1a7f37",
  ansi: {
    black: "#24292f",
    red: "#cf222e",
    green: "#1a7f37",
    yellow: "#9a6700",
    blue: "#0969da",
    magenta: "#8250df",
    cyan: "#1b7c83",
    white: "#d0d7de",
    brightBlack: "#57606a",
    brightRed: "#a40e26",
    brightGreen: "#116329",
    brightYellow: "#7d4e00",
    brightBlue: "#0550ae",
    brightMagenta: "#6639ba",
    brightCyan: "#0a676d",
    brightWhite: "#ffffff"
  }
});

const solarizedLight = paletteVars("light", {
  background: "#fdf6e3",
  surface: "#eee8d5",
  raised: "#e4ddc8",
  border: "#ddd6c1",
  foreground: "#586e75",
  muted: "#657b83",
  accent: "#268bd2",
  link: "#2075b3",
  editorSelection: "#e7dfc6",
  error: "#dc322f",
  warning: "#9a7500",
  info: "#268bd2",
  success: "#6c7c00",
  ansi: {
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#93a1a1",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3"
  }
});

const gruvboxLight = paletteVars("light", {
  background: "#fbf1c7",
  surface: "#f2e5bc",
  raised: "#ebdbb2",
  border: "#d5c4a1",
  foreground: "#3c3836",
  muted: "#665c54",
  accent: "#076678",
  editorSelection: "#e2d3aa",
  error: "#9d0006",
  warning: "#af3a03",
  info: "#076678",
  success: "#79740e",
  ansi: {
    black: "#282828",
    red: "#9d0006",
    green: "#79740e",
    yellow: "#b57614",
    blue: "#076678",
    magenta: "#8f3f71",
    cyan: "#427b58",
    white: "#d5c4a1",
    brightBlack: "#7c6f64",
    brightRed: "#cc241d",
    brightGreen: "#98971a",
    brightYellow: "#d79921",
    brightBlue: "#458588",
    brightMagenta: "#b16286",
    brightCyan: "#689d6a",
    brightWhite: "#fbf1c7"
  }
});

const catppuccinLatte = paletteVars("light", {
  background: "#eff1f5",
  surface: "#e6e9ef",
  raised: "#dce0e8",
  border: "#ccd0da",
  foreground: "#4c4f69",
  muted: "#5c5f77",
  accent: "#8839ef",
  link: "#1e66f5",
  editorSelection: "#d0d4e2",
  error: "#d20f39",
  warning: "#b35a00",
  info: "#1e66f5",
  success: "#2f7d1f",
  ansi: {
    black: "#5c5f77",
    red: "#d20f39",
    green: "#40a02b",
    yellow: "#b36b00",
    blue: "#1e66f5",
    magenta: "#8839ef",
    cyan: "#0f7f85",
    white: "#acb0be",
    brightBlack: "#6c6f85",
    brightRed: "#b80b31",
    brightGreen: "#348822",
    brightYellow: "#965800",
    brightBlue: "#1856ce",
    brightMagenta: "#762fd3",
    brightCyan: "#0b6b70",
    brightWhite: "#eff1f5"
  }
});

// Warm, low-glare paper with restrained accents.
const paper = paletteVars("light", {
  background: "#f5f0e6",
  surface: "#ece5d6",
  raised: "#e4dccb",
  border: "#d8cfbd",
  foreground: "#403b33",
  muted: "#665f55",
  accent: "#765b3d",
  link: "#386b8c",
  editorSelection: "#e3d5ba",
  error: "#a63d40",
  warning: "#866316",
  info: "#386b8c",
  success: "#52783d",
  ansi: {
    black: "#282622",
    red: "#a63d40",
    green: "#52783d",
    yellow: "#866316",
    blue: "#386b8c",
    magenta: "#795080",
    cyan: "#39766f",
    white: "#d8d1c3",
    brightBlack: "#706a60",
    brightRed: "#bd4f4b",
    brightGreen: "#648947",
    brightYellow: "#9d741b",
    brightBlue: "#4b7b9a",
    brightMagenta: "#8d6092",
    brightCyan: "#4a8780",
    brightWhite: "#fffaf0"
  }
});

const githubDark = paletteVars("dark", {
  background: "#0d1117",
  surface: "#010409",
  raised: "#21262d",
  input: "#0d1117",
  border: "#30363d",
  foreground: "#e6edf3",
  muted: "#9198a1",
  accent: "#1f6feb",
  link: "#4493f8",
  editorSelection: "#1f3a5f",
  error: "#f85149",
  warning: "#d29922",
  info: "#58a6ff",
  success: "#3fb950",
  ansi: {
    black: "#484f58",
    red: "#ff7b72",
    green: "#3fb950",
    yellow: "#d29922",
    blue: "#58a6ff",
    magenta: "#bc8cff",
    cyan: "#39c5cf",
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ffa198",
    brightGreen: "#56d364",
    brightYellow: "#e3b341",
    brightBlue: "#79c0ff",
    brightMagenta: "#d2a8ff",
    brightCyan: "#56d4dd",
    brightWhite: "#ffffff"
  }
});

const oneDark = paletteVars("dark", {
  background: "#282c34",
  surface: "#21252b",
  raised: "#333842",
  border: "#3a3f4b",
  foreground: "#abb2bf",
  muted: "#8b919c",
  accent: "#4d78cc",
  link: "#61afef",
  editorSelection: "#3e4451",
  error: "#e06c75",
  warning: "#e5c07b",
  info: "#61afef",
  success: "#98c379",
  ansi: {
    black: "#282c34",
    red: "#e06c75",
    green: "#98c379",
    yellow: "#e5c07b",
    blue: "#61afef",
    magenta: "#c678dd",
    cyan: "#56b6c2",
    white: "#abb2bf",
    brightBlack: "#5c6370",
    brightRed: "#e06c75",
    brightGreen: "#98c379",
    brightYellow: "#e5c07b",
    brightBlue: "#61afef",
    brightMagenta: "#c678dd",
    brightCyan: "#56b6c2",
    brightWhite: "#ffffff"
  }
});

const dracula = paletteVars("dark", {
  background: "#282a36",
  surface: "#21222c",
  raised: "#343746",
  border: "#3c3f52",
  foreground: "#f8f8f2",
  muted: "#a0a6c6",
  accent: "#bd93f9",
  link: "#8be9fd",
  selection: "#44475a",
  editorSelection: "#44475a",
  error: "#ff5555",
  warning: "#f1fa8c",
  info: "#8be9fd",
  success: "#50fa7b",
  ansi: {
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff"
  }
});

const nord = paletteVars("dark", {
  background: "#2e3440",
  surface: "#272c36",
  raised: "#3b4252",
  border: "#3b4252",
  foreground: "#d8dee9",
  muted: "#9aa5b8",
  accent: "#88c0d0",
  accentForeground: "#2e3440",
  editorSelection: "#434c5e",
  error: "#bf616a",
  warning: "#ebcb8b",
  info: "#81a1c1",
  success: "#a3be8c",
  ansi: {
    black: "#3b4252",
    red: "#bf616a",
    green: "#a3be8c",
    yellow: "#ebcb8b",
    blue: "#81a1c1",
    magenta: "#b48ead",
    cyan: "#88c0d0",
    white: "#e5e9f0",
    brightBlack: "#4c566a",
    brightRed: "#bf616a",
    brightGreen: "#a3be8c",
    brightYellow: "#ebcb8b",
    brightBlue: "#81a1c1",
    brightMagenta: "#b48ead",
    brightCyan: "#8fbcbb",
    brightWhite: "#eceff4"
  }
});

const tokyoNight = paletteVars("dark", {
  background: "#1a1b26",
  surface: "#16161e",
  raised: "#292e42",
  border: "#292e42",
  foreground: "#a9b1d6",
  muted: "#787c99",
  accent: "#7aa2f7",
  accentForeground: "#1a1b26",
  editorSelection: "#283457",
  error: "#f7768e",
  warning: "#e0af68",
  info: "#7aa2f7",
  success: "#9ece6a",
  ansi: {
    black: "#15161e",
    red: "#f7768e",
    green: "#9ece6a",
    yellow: "#e0af68",
    blue: "#7aa2f7",
    magenta: "#bb9af7",
    cyan: "#7dcfff",
    white: "#a9b1d6",
    brightBlack: "#414868",
    brightRed: "#ff899d",
    brightGreen: "#b9f27c",
    brightYellow: "#ffbf7a",
    brightBlue: "#8db0ff",
    brightMagenta: "#c7a9ff",
    brightCyan: "#a4daff",
    brightWhite: "#c0caf5"
  }
});

const gruvboxDark = paletteVars("dark", {
  background: "#282828",
  surface: "#1d2021",
  raised: "#3c3836",
  border: "#3c3836",
  foreground: "#ebdbb2",
  muted: "#a89984",
  accent: "#d79921",
  accentForeground: "#282828",
  link: "#83a598",
  editorSelection: "#504945",
  error: "#fb4934",
  warning: "#fabd2f",
  info: "#83a598",
  success: "#b8bb26",
  ansi: {
    black: "#282828",
    red: "#cc241d",
    green: "#98971a",
    yellow: "#d79921",
    blue: "#458588",
    magenta: "#b16286",
    cyan: "#689d6a",
    white: "#a89984",
    brightBlack: "#928374",
    brightRed: "#fb4934",
    brightGreen: "#b8bb26",
    brightYellow: "#fabd2f",
    brightBlue: "#83a598",
    brightMagenta: "#d3869b",
    brightCyan: "#8ec07c",
    brightWhite: "#ebdbb2"
  }
});

const catppuccinMocha = paletteVars("dark", {
  background: "#1e1e2e",
  surface: "#181825",
  raised: "#313244",
  border: "#313244",
  foreground: "#cdd6f4",
  muted: "#a6adc8",
  accent: "#cba6f7",
  accentForeground: "#11111b",
  link: "#89b4fa",
  editorSelection: "#45475a",
  error: "#f38ba8",
  warning: "#f9e2af",
  info: "#89b4fa",
  success: "#a6e3a1",
  ansi: {
    black: "#45475a",
    red: "#f38ba8",
    green: "#a6e3a1",
    yellow: "#f9e2af",
    blue: "#89b4fa",
    magenta: "#f5c2e7",
    cyan: "#94e2d5",
    white: "#bac2de",
    brightBlack: "#585b70",
    brightRed: "#f38ba8",
    brightGreen: "#a6e3a1",
    brightYellow: "#f9e2af",
    brightBlue: "#89b4fa",
    brightMagenta: "#f5c2e7",
    brightCyan: "#94e2d5",
    brightWhite: "#a6adc8"
  }
});

const monokai = paletteVars("dark", {
  background: "#272822",
  surface: "#1e1f1c",
  raised: "#3e3d32",
  border: "#414339",
  foreground: "#f8f8f2",
  muted: "#a59f85",
  accent: "#a6e22e",
  accentForeground: "#272822",
  link: "#66d9ef",
  editorSelection: "#49483e",
  error: "#f92672",
  warning: "#e6db74",
  info: "#66d9ef",
  success: "#a6e22e",
  ansi: {
    black: "#272822",
    red: "#f92672",
    green: "#a6e22e",
    yellow: "#e6db74",
    blue: "#66d9ef",
    magenta: "#ae81ff",
    cyan: "#a1efe4",
    white: "#f8f8f2",
    brightBlack: "#75715e",
    brightRed: "#f92672",
    brightGreen: "#a6e22e",
    brightYellow: "#e6db74",
    brightBlue: "#66d9ef",
    brightMagenta: "#ae81ff",
    brightCyan: "#a1efe4",
    brightWhite: "#f9f8f5"
  }
});

const solarizedDark = paletteVars("dark", {
  background: "#002b36",
  surface: "#00212b",
  raised: "#073642",
  border: "#0e4250",
  foreground: "#93a1a1",
  muted: "#839496",
  accent: "#268bd2",
  link: "#2aa198",
  editorSelection: "#274642",
  error: "#dc322f",
  warning: "#b58900",
  info: "#268bd2",
  success: "#859900",
  ansi: {
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3"
  }
});

export const APP_THEMES: readonly AppTheme[] = [
  { id: "light-modern", name: "Light Modern", mode: "light", vars: LIGHT_MODERN_VARS },
  { id: "light-classic", name: "Light Classic", mode: "light", vars: LIGHT_VARS },
  { id: "github-light", name: "GitHub Light", mode: "light", vars: githubLight },
  { id: "solarized-light", name: "Solarized Light", mode: "light", vars: solarizedLight },
  { id: "gruvbox-light", name: "Gruvbox Light", mode: "light", vars: gruvboxLight },
  { id: "catppuccin-latte", name: "Catppuccin Latte", mode: "light", vars: catppuccinLatte },
  { id: "paper", name: "Paper", mode: "light", vars: paper },
  { id: "dark-modern", name: "Dark Modern", mode: "dark", vars: DARK_MODERN_VARS },
  { id: "black", name: "Black (OLED)", mode: "dark", vars: DARK_VARS },
  { id: "github-dark", name: "GitHub Dark", mode: "dark", vars: githubDark },
  { id: "one-dark", name: "One Dark", mode: "dark", vars: oneDark },
  { id: "dracula", name: "Dracula", mode: "dark", vars: dracula },
  { id: "nord", name: "Nord", mode: "dark", vars: nord },
  { id: "tokyo-night", name: "Tokyo Night", mode: "dark", vars: tokyoNight },
  { id: "gruvbox-dark", name: "Gruvbox Dark", mode: "dark", vars: gruvboxDark },
  { id: "catppuccin-mocha", name: "Catppuccin Mocha", mode: "dark", vars: catppuccinMocha },
  { id: "monokai", name: "Monokai", mode: "dark", vars: monokai },
  { id: "solarized-dark", name: "Solarized Dark", mode: "dark", vars: solarizedDark }
];

export const DEFAULT_APP_THEME_IDS: Readonly<Record<AppThemeMode, string>> = {
  light: "light-modern",
  dark: "dark-modern"
};

const THEMES_BY_ID = new Map(APP_THEMES.map((theme) => [theme.id, theme]));

export function isBuiltInTheme(id: string): boolean {
  return THEMES_BY_ID.has(id);
}

/**
 * The theme for `mode` among the built-ins and `extraThemes`; unknown ids and themes of
 * the other mode fall back to the default.
 */
export function resolveAppTheme(
  mode: AppThemeMode,
  id?: string,
  extraThemes: readonly AppTheme[] = []
): AppTheme {
  const theme =
    id === undefined ? undefined : (THEMES_BY_ID.get(id) ?? extraThemes.find((extra) => extra.id === id));
  return theme?.mode === mode ? theme : THEMES_BY_ID.get(DEFAULT_APP_THEME_IDS[mode])!;
}

/** Paints `theme` on the document: the light class, CSS variables and color scheme. */
export function applyAppTheme(theme: AppTheme): void {
  document.documentElement.classList.toggle("light", theme.mode === "light");
  applyVarMap(theme.vars, theme.mode);
}
