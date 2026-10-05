// User themes: a built-in theme with color roles and single tokens overridden on top.
import {
  DEFAULT_APP_THEME_IDS,
  isBuiltInTheme,
  resolveAppTheme,
  type AppTheme,
  type AppThemeMode
} from "./appThemes";
import { DARK_VARS, TERMINAL_ANSI_TOKENS, type TerminalAnsiColors, type VarMap } from "./devTheme";
import {
  isHexColor,
  isLightColor,
  isThemeColor,
  legibleOn,
  mix,
  readableOn,
  rebase,
  toOpaqueHex,
  toVsCodeColor
} from "./themeColor";

type AnsiName = keyof TerminalAnsiColors;

export type ThemeRoleKey =
  | "background"
  | "surface"
  | "input"
  | "raised"
  | "border"
  | "hover"
  | "selection"
  | "badge"
  | "foreground"
  | "muted"
  | "link"
  | "accent"
  | "accentForeground"
  | "error"
  | "warning"
  | "info"
  | "success"
  | "editorSelection"
  | `ansi.${AnsiName}`;

export interface CustomTheme {
  id: string;
  name: string;
  mode: AppThemeMode;
  /** Built-in theme underneath everything else. */
  base: string;
  /** Colors from an imported VS Code theme, by VS Code color id, painted over the base. */
  baseline?: Record<string, string>;
  /** Color roles, each `#rrggbb`. */
  colors: Partial<Record<ThemeRoleKey, string>>;
  /** Single-token overrides by VS Code color id, painted last. */
  tokens: Record<string, string>;
}

export interface ThemeRole {
  key: ThemeRoleKey;
  label: string;
  description?: string;
  /** Every token the role writes; the first one shows its current color. */
  tokens: readonly string[];
  apply: (vars: VarMap, color: string, mode: AppThemeMode) => void;
}

const TOKEN_PREFIX = "--vscode-";
const EDITOR_BACKGROUND = "--vscode-editor-background";
const FOREGROUND = "--vscode-foreground";

/** Every color token a theme defines; font tokens are not colors. */
export const THEME_COLOR_TOKENS: readonly string[] = Object.keys(DARK_VARS).filter(
  (token) => !token.startsWith(`${TOKEN_PREFIX}font-`)
);
const COLOR_TOKEN_SET = new Set(THEME_COLOR_TOKENS);

/** `editor.background` → `--vscode-editor-background`. */
export function colorIdToken(id: string): string {
  return TOKEN_PREFIX + id.replaceAll(".", "-");
}

/** `--vscode-editor-background` → `editor.background`. */
export function tokenColorId(token: string): string {
  return token.slice(TOKEN_PREFIX.length).replace("-", ".");
}

function setTokens(tokens: readonly string[]): ThemeRole["apply"] {
  return (vars, color) => {
    for (const token of tokens) vars[token] = color;
  };
}

function statusTint(vars: VarMap, color: string, mode: AppThemeMode): string {
  return mix(vars[EDITOR_BACKGROUND], color, mode === "dark" ? 0.2 : 0.14);
}

// Surfaces keep their offset from the editor background when it moves, so sidebars,
// inputs, hovers and borders stay distinguishable.
const SURFACE_TOKENS = [
  EDITOR_BACKGROUND,
  "--vscode-sideBar-background",
  "--vscode-panel-background",
  "--vscode-panel-border",
  "--vscode-button-secondaryBackground",
  "--vscode-button-secondaryHoverBackground",
  "--vscode-input-background",
  "--vscode-input-border",
  "--vscode-dropdown-background",
  "--vscode-dropdown-border",
  "--vscode-list-hoverBackground",
  "--vscode-list-activeSelectionBackground",
  "--vscode-list-inactiveSelectionBackground",
  "--vscode-badge-background",
  "--vscode-statusBar-background",
  "--vscode-tab-activeBackground",
  "--vscode-tab-inactiveBackground",
  "--vscode-tab-hoverBackground",
  "--vscode-textCodeBlock-background",
  "--vscode-settings-textInputBackground",
  "--vscode-settings-textInputBorder",
  "--vscode-notifications-background",
  "--vscode-notifications-border",
  "--vscode-editorWidget-background",
  "--vscode-editorWidget-border",
  "--vscode-menu-background",
  "--vscode-menu-border",
  "--vscode-inputValidation-errorBackground",
  "--vscode-inputValidation-warningBackground",
  "--vscode-inputValidation-infoBackground",
  "--vscode-editor-selectionBackground",
  "--vscode-editor-inactiveSelectionBackground"
] as const;

const TEXT_TOKENS = [
  FOREGROUND,
  "--vscode-editor-foreground",
  "--vscode-sideBar-foreground",
  "--vscode-icon-foreground",
  "--vscode-input-foreground",
  "--vscode-dropdown-foreground",
  "--vscode-button-secondaryForeground",
  "--vscode-statusBar-foreground",
  "--vscode-tab-activeForeground",
  "--vscode-settings-textInputForeground",
  "--vscode-notifications-foreground",
  "--vscode-editorWidget-foreground",
  "--vscode-menu-foreground"
] as const;

const BORDER_TOKENS = [
  "--vscode-panel-border",
  "--vscode-input-border",
  "--vscode-dropdown-border",
  "--vscode-settings-textInputBorder",
  "--vscode-notifications-border",
  "--vscode-editorWidget-border",
  "--vscode-menu-border"
] as const;

const ANSI_LABELS: Readonly<Record<AnsiName, string>> = {
  black: "Black",
  red: "Red",
  green: "Green",
  yellow: "Yellow",
  blue: "Blue",
  magenta: "Magenta",
  cyan: "Cyan",
  white: "White",
  brightBlack: "Bright black",
  brightRed: "Bright red",
  brightGreen: "Bright green",
  brightYellow: "Bright yellow",
  brightBlue: "Bright blue",
  brightMagenta: "Bright magenta",
  brightCyan: "Bright cyan",
  brightWhite: "Bright white"
};

export const THEME_ROLE_GROUPS: ReadonlyArray<{ label: string; roles: readonly ThemeRole[] }> = [
  {
    label: "Surfaces",
    roles: [
      {
        key: "background",
        label: "Background",
        description: "Canvas, editors and dialogs. Panels, inputs and borders move with it.",
        tokens: SURFACE_TOKENS,
        apply: (vars, color) => {
          const base = vars[EDITOR_BACKGROUND];
          for (const token of SURFACE_TOKENS) {
            vars[token] = rebase(vars[token], base, color) ?? vars[token];
          }
          vars[EDITOR_BACKGROUND] = color;
        }
      },
      {
        key: "surface",
        label: "Sidebar and panels",
        description: "Explorer, palette, side panels and widgets.",
        tokens: [
          "--vscode-sideBar-background",
          "--vscode-panel-background",
          "--vscode-statusBar-background",
          "--vscode-tab-inactiveBackground",
          "--vscode-editorWidget-background"
        ],
        apply: setTokens([
          "--vscode-sideBar-background",
          "--vscode-panel-background",
          "--vscode-statusBar-background",
          "--vscode-tab-inactiveBackground",
          "--vscode-editorWidget-background"
        ])
      },
      {
        key: "input",
        label: "Inputs",
        description: "Text fields and dropdowns.",
        tokens: [
          "--vscode-input-background",
          "--vscode-dropdown-background",
          "--vscode-settings-textInputBackground"
        ],
        apply: setTokens([
          "--vscode-input-background",
          "--vscode-dropdown-background",
          "--vscode-settings-textInputBackground"
        ])
      },
      {
        key: "raised",
        label: "Secondary buttons",
        description: "Secondary buttons and code blocks.",
        tokens: [
          "--vscode-button-secondaryBackground",
          "--vscode-textCodeBlock-background",
          "--vscode-button-secondaryHoverBackground"
        ],
        apply: (vars, color) => {
          vars["--vscode-button-secondaryBackground"] = color;
          vars["--vscode-textCodeBlock-background"] = color;
          vars["--vscode-button-secondaryHoverBackground"] = mix(color, vars[FOREGROUND], 0.08);
        }
      },
      {
        key: "border",
        label: "Borders",
        description: "Dividers and outlines.",
        tokens: BORDER_TOKENS,
        apply: setTokens(BORDER_TOKENS)
      },
      {
        key: "hover",
        label: "Hover",
        description: "Rows and tabs under the pointer.",
        tokens: ["--vscode-list-hoverBackground", "--vscode-tab-hoverBackground"],
        apply: setTokens(["--vscode-list-hoverBackground", "--vscode-tab-hoverBackground"])
      },
      {
        key: "selection",
        label: "Selection",
        description: "Selected rows and items.",
        tokens: [
          "--vscode-list-inactiveSelectionBackground",
          "--vscode-list-activeSelectionBackground",
          "--vscode-list-inactiveSelectionForeground",
          "--vscode-list-activeSelectionForeground"
        ],
        apply: (vars, color) => {
          const text = legibleOn(color, vars[FOREGROUND]);
          vars["--vscode-list-inactiveSelectionBackground"] = color;
          vars["--vscode-list-activeSelectionBackground"] = color;
          vars["--vscode-list-inactiveSelectionForeground"] = text;
          vars["--vscode-list-activeSelectionForeground"] = text;
        }
      },
      {
        key: "badge",
        label: "Node labels and badges",
        description: "Labels under canvas nodes and filled chips.",
        tokens: ["--vscode-badge-background", "--vscode-badge-foreground"],
        apply: (vars, color) => {
          vars["--vscode-badge-background"] = color;
          vars["--vscode-badge-foreground"] = legibleOn(color, vars[FOREGROUND]);
        }
      }
    ]
  },
  {
    label: "Text",
    roles: [
      {
        key: "foreground",
        label: "Text",
        description: "Body text and icons.",
        tokens: TEXT_TOKENS,
        apply: setTokens(TEXT_TOKENS)
      },
      {
        key: "muted",
        label: "Secondary text",
        description: "Descriptions, placeholders and inactive tabs.",
        tokens: [
          "--vscode-descriptionForeground",
          "--vscode-tab-inactiveForeground",
          "--vscode-input-placeholderForeground",
          "--vscode-disabledForeground"
        ],
        apply: (vars, color) => {
          vars["--vscode-descriptionForeground"] = color;
          vars["--vscode-tab-inactiveForeground"] = color;
          vars["--vscode-input-placeholderForeground"] = color;
          vars["--vscode-disabledForeground"] = mix(color, vars[EDITOR_BACKGROUND], 0.35);
        }
      },
      {
        key: "link",
        label: "Links",
        tokens: ["--vscode-textLink-foreground", "--vscode-textLink-activeForeground"],
        apply: setTokens(["--vscode-textLink-foreground", "--vscode-textLink-activeForeground"])
      }
    ]
  },
  {
    label: "Accent",
    roles: [
      {
        key: "accent",
        label: "Accent",
        description: "Primary buttons, focus rings, toggles and progress.",
        tokens: [
          "--vscode-button-background",
          "--vscode-focusBorder",
          "--vscode-progressBar-background",
          "--vscode-tab-activeBorderTop",
          "--vscode-menu-selectionBackground",
          "--vscode-button-foreground",
          "--vscode-menu-selectionForeground",
          "--vscode-button-hoverBackground"
        ],
        apply: (vars, color) => {
          const text = readableOn(color);
          for (const token of [
            "--vscode-button-background",
            "--vscode-focusBorder",
            "--vscode-progressBar-background",
            "--vscode-tab-activeBorderTop",
            "--vscode-menu-selectionBackground"
          ]) {
            vars[token] = color;
          }
          vars["--vscode-button-foreground"] = text;
          vars["--vscode-menu-selectionForeground"] = text;
          vars["--vscode-button-hoverBackground"] = mix(color, text, 0.12);
        }
      },
      {
        key: "accentForeground",
        label: "Text on accent",
        description: "Labels on primary buttons and highlighted menu items.",
        tokens: [
          "--vscode-button-foreground",
          "--vscode-menu-selectionForeground",
          "--vscode-button-hoverBackground"
        ],
        apply: (vars, color) => {
          vars["--vscode-button-foreground"] = color;
          vars["--vscode-menu-selectionForeground"] = color;
          vars["--vscode-button-hoverBackground"] = mix(vars["--vscode-button-background"], color, 0.12);
        }
      }
    ]
  },
  {
    label: "Status",
    roles: [
      {
        key: "error",
        label: "Errors",
        tokens: [
          "--vscode-editorError-foreground",
          "--vscode-errorForeground",
          "--vscode-inputValidation-errorBorder",
          "--vscode-inputValidation-errorBackground"
        ],
        apply: (vars, color, mode) => {
          vars["--vscode-editorError-foreground"] = color;
          vars["--vscode-errorForeground"] = color;
          vars["--vscode-inputValidation-errorBorder"] = color;
          vars["--vscode-inputValidation-errorBackground"] = statusTint(vars, color, mode);
        }
      },
      {
        key: "warning",
        label: "Warnings",
        tokens: [
          "--vscode-editorWarning-foreground",
          "--vscode-charts-yellow",
          "--vscode-inputValidation-warningBorder",
          "--vscode-inputValidation-warningBackground"
        ],
        apply: (vars, color, mode) => {
          vars["--vscode-editorWarning-foreground"] = color;
          vars["--vscode-charts-yellow"] = color;
          vars["--vscode-inputValidation-warningBorder"] = color;
          vars["--vscode-inputValidation-warningBackground"] = statusTint(vars, color, mode);
        }
      },
      {
        key: "info",
        label: "Info",
        tokens: [
          "--vscode-editorInfo-foreground",
          "--vscode-inputValidation-infoBorder",
          "--vscode-inputValidation-infoBackground"
        ],
        apply: (vars, color, mode) => {
          vars["--vscode-editorInfo-foreground"] = color;
          vars["--vscode-inputValidation-infoBorder"] = color;
          vars["--vscode-inputValidation-infoBackground"] = statusTint(vars, color, mode);
        }
      },
      {
        key: "success",
        label: "Success",
        description: "Running nodes and passed checks.",
        tokens: ["--vscode-testing-iconPassed", "--vscode-charts-green"],
        apply: setTokens(["--vscode-testing-iconPassed", "--vscode-charts-green"])
      }
    ]
  },
  {
    label: "Editor and terminal",
    roles: [
      {
        key: "editorSelection",
        label: "Text selection",
        description: "Selected text in the YAML editor and terminals.",
        tokens: [
          "--vscode-editor-selectionBackground",
          "--vscode-terminal-selectionBackground",
          "--vscode-editor-inactiveSelectionBackground"
        ],
        apply: (vars, color) => {
          vars["--vscode-editor-selectionBackground"] = color;
          vars["--vscode-terminal-selectionBackground"] = color;
          vars["--vscode-editor-inactiveSelectionBackground"] = mix(vars[EDITOR_BACKGROUND], color, 0.5);
        }
      }
    ]
  }
];

function ansiNames(): AnsiName[] {
  const names: AnsiName[] = [];
  let name: AnsiName;
  for (name in TERMINAL_ANSI_TOKENS) names.push(name);
  return names;
}

const ANSI_NAMES = ansiNames();

/** Terminal colors, normal then bright. */
export const ANSI_ROLES: readonly ThemeRole[] = ANSI_NAMES.map((name) => ({
  key: `ansi.${name}` as const,
  label: ANSI_LABELS[name],
  tokens: [TERMINAL_ANSI_TOKENS[name]],
  apply: setTokens([TERMINAL_ANSI_TOKENS[name]])
}));

const ROLES: readonly ThemeRole[] = [...THEME_ROLE_GROUPS.flatMap((group) => group.roles), ...ANSI_ROLES];
const ROLES_BY_KEY = new Map(ROLES.map((role) => [role.key, role]));
const ROLE_KEYS = new Set<string>(ROLES.map((role) => role.key));
const ROLE_LABELS = new Map<string, string>([
  ...THEME_ROLE_GROUPS.flatMap((group) => group.roles.map((role): [string, string] => [role.key, role.label])),
  ...ANSI_ROLES.map((role): [string, string] => [role.key, `Terminal ${role.label.toLowerCase()}`])
]);

/** A role's name for people, or undefined for unknown keys. */
export function themeRoleLabel(key: string): string | undefined {
  return ROLE_LABELS.get(key);
}
// The background moves surfaces and the text color feeds legibility checks, so both go first.
const APPLY_ORDER: readonly ThemeRole[] = [
  ROLES_BY_KEY.get("background")!,
  ROLES_BY_KEY.get("foreground")!,
  ...ROLES.filter((role) => role.key !== "background" && role.key !== "foreground")
];

function applyTokenMap(vars: VarMap, tokens: Record<string, string> | undefined): void {
  for (const [id, value] of Object.entries(tokens ?? {})) {
    const token = colorIdToken(id);
    if (COLOR_TOKEN_SET.has(token) && isThemeColor(value)) vars[token] = value;
  }
}

function applyRoles(vars: VarMap, colors: CustomTheme["colors"], mode: AppThemeMode): void {
  for (const role of APPLY_ORDER) {
    const color = colors[role.key];
    if (isHexColor(color)) role.apply(vars, color, mode);
  }
}

export function customThemeVars(theme: CustomTheme): VarMap {
  const vars = { ...resolveAppTheme(theme.mode, theme.base).vars };
  applyTokenMap(vars, theme.baseline);
  applyRoles(vars, theme.colors, theme.mode);
  applyTokenMap(vars, theme.tokens);
  return vars;
}

export function customAppTheme(theme: CustomTheme): AppTheme {
  return { id: theme.id, name: theme.name, mode: theme.mode, vars: customThemeVars(theme) };
}

/** A role's current color as `#rrggbb`, for color pickers. */
export function roleColor(vars: VarMap, role: ThemeRole): string {
  return toOpaqueHex(vars[role.tokens[0]], toOpaqueHex(vars[EDITOR_BACKGROUND]) ?? "#000000") ?? "#000000";
}

/** Sets or clears a role. Setting it drops single-token overrides the role would hide. */
export function withRoleColor(theme: CustomTheme, key: ThemeRoleKey, color: string | undefined): CustomTheme {
  const colors = { ...theme.colors };
  if (color === undefined) {
    delete colors[key];
    return { ...theme, colors };
  }
  colors[key] = color;
  const written = new Set(ROLES_BY_KEY.get(key)?.tokens.map(tokenColorId));
  const tokens = Object.fromEntries(Object.entries(theme.tokens).filter(([id]) => !written.has(id)));
  return { ...theme, colors, tokens };
}

export function withTokenColor(theme: CustomTheme, id: string, value: string | undefined): CustomTheme {
  const tokens = { ...theme.tokens };
  if (value === undefined) delete tokens[id];
  else tokens[id] = value;
  return { ...theme, tokens };
}

export function customizedColorCount(theme: CustomTheme): number {
  return Object.keys(theme.colors).length + Object.keys(theme.tokens).length;
}

function newThemeId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_NAME_LENGTH = 60;

function uniqueName(name: string, existing: readonly CustomTheme[]): string {
  const taken = new Set(existing.map((theme) => theme.name));
  if (!taken.has(name)) return name;
  let index = 2;
  while (taken.has(`${name} ${index}`)) index += 1;
  return `${name} ${index}`;
}

/** A new custom theme that starts as a copy of `from`, built-in or custom. */
export function createCustomTheme(from: AppTheme, existing: readonly CustomTheme[]): CustomTheme {
  const custom = existing.find((theme) => theme.id === from.id);
  if (custom) {
    return { ...structuredClone(custom), id: newThemeId(), name: uniqueName(`${custom.name} copy`, existing) };
  }
  return {
    id: newThemeId(),
    name: uniqueName(`${from.name} (custom)`, existing),
    mode: from.mode,
    base: from.id,
    colors: {},
    tokens: {}
  };
}

// Import and export ------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanName(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_NAME_LENGTH) : undefined;
}

function cleanTokens(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => COLOR_TOKEN_SET.has(colorIdToken(entry[0])) && isThemeColor(entry[1])
    )
  );
}

function cleanRoleColors(value: unknown): CustomTheme["colors"] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => ROLE_KEYS.has(entry[0]) && isHexColor(entry[1])
    )
  );
}

function themeBase(value: unknown, mode: AppThemeMode): string {
  return typeof value === "string" && isBuiltInTheme(value) && resolveAppTheme(mode, value).id === value
    ? value
    : DEFAULT_APP_THEME_IDS[mode];
}

/** Restores themes saved by this app; anything malformed is dropped. */
export function parseCustomThemes(value: unknown): CustomTheme[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): CustomTheme[] => {
    if (!isRecord(entry) || typeof entry.id !== "string" || isBuiltInTheme(entry.id)) return [];
    const mode = entry.mode === "light" ? "light" : "dark";
    const baseline = cleanTokens(entry.baseline);
    return [
      {
        id: entry.id,
        name: cleanName(entry.name) ?? "Custom theme",
        mode,
        base: themeBase(entry.base, mode),
        ...(Object.keys(baseline).length > 0 ? { baseline } : {}),
        colors: cleanRoleColors(entry.colors),
        tokens: cleanTokens(entry.tokens)
      }
    ];
  });
}

/**
 * One theme as a VS Code color theme: VS Code and other editors read `colors`, and this
 * app restores the editable layers from `containerlab`.
 */
function exportedTheme(theme: CustomTheme): Record<string, unknown> {
  const vars = customThemeVars(theme);
  const colors = Object.fromEntries(
    THEME_COLOR_TOKENS.flatMap((token) => {
      const value = toVsCodeColor(vars[token]);
      return value === null ? [] : [[tokenColorId(token), value]];
    })
  );
  return {
    name: theme.name,
    type: theme.mode,
    colors,
    containerlab: {
      version: 1,
      base: theme.base,
      ...(theme.baseline ? { baseline: theme.baseline } : {}),
      colors: theme.colors,
      tokens: theme.tokens
    }
  };
}

export function exportCustomThemes(themes: readonly CustomTheme[]): string {
  const content = themes.length === 1 ? exportedTheme(themes[0]) : themes.map(exportedTheme);
  return `${JSON.stringify(content, null, 2)}\n`;
}

export function themeExportFileName(themes: readonly CustomTheme[]): string {
  if (themes.length !== 1) return "containerlab-themes.json";
  const slug = themes[0].name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "theme"}-color-theme.json`;
}

/** Where the string literal opening at `start` ends, just past its closing quote. */
function stringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}

/** Where the comment opening at `start` ends, or `start` when no comment opens there. */
function commentEnd(text: string, start: number): number {
  if (text.startsWith("//", start)) {
    const end = text.indexOf("\n", start);
    return end === -1 ? text.length : end;
  }
  if (text.startsWith("/*", start)) {
    const end = text.indexOf("*/", start + 2);
    return end === -1 ? text.length : end + 2;
  }
  return start;
}

/** Drops comments and trailing commas, which VS Code theme files allow. */
function stripJsonc(text: string): string {
  let withoutComments = "";
  let index = 0;
  while (index < text.length) {
    const end = text[index] === '"' ? stringEnd(text, index) : commentEnd(text, index);
    if (end === index) {
      withoutComments += text[index];
      index += 1;
    } else {
      if (text[index] === '"') withoutComments += text.slice(index, end);
      index = end;
    }
  }
  let output = "";
  index = 0;
  while (index < withoutComments.length) {
    if (withoutComments[index] === '"') {
      const end = stringEnd(withoutComments, index);
      output += withoutComments.slice(index, end);
      index = end;
      continue;
    }
    const trailingComma =
      withoutComments[index] === "," && /^\s*[}\]]/.test(withoutComments.slice(index + 1));
    if (!trailingComma) output += withoutComments[index];
    index += 1;
  }
  return output;
}

const LIGHT_TYPES = new Set(["light", "vs", "hcLight", "hc-light"]);
const DARK_TYPES = new Set(["dark", "vs-dark", "hc", "hcDark", "hc-black"]);

function importedMode(type: unknown, colors: Record<string, unknown>): AppThemeMode {
  if (typeof type === "string" && LIGHT_TYPES.has(type)) return "light";
  if (typeof type === "string" && DARK_TYPES.has(type)) return "dark";
  const background = toOpaqueHex(
    typeof colors["editor.background"] === "string" ? colors["editor.background"] : undefined
  );
  return background !== null && isLightColor(background) ? "light" : "dark";
}

// VS Code color ids that best describe each role, most specific first.
const ROLE_SOURCES: ReadonlyArray<[ThemeRoleKey, readonly string[]]> = [
  ["background", ["editor.background"]],
  ["foreground", ["foreground", "editor.foreground"]],
  ["surface", ["sideBar.background", "panel.background", "activityBar.background"]],
  ["input", ["input.background", "dropdown.background"]],
  ["raised", ["button.secondaryBackground", "textCodeBlock.background"]],
  ["border", ["panel.border", "sideBar.border", "editorGroup.border", "widget.border", "input.border"]],
  ["hover", ["list.hoverBackground"]],
  ["selection", ["list.inactiveSelectionBackground", "list.activeSelectionBackground"]],
  ["badge", ["badge.background"]],
  ["muted", ["descriptionForeground", "tab.inactiveForeground"]],
  ["link", ["textLink.foreground"]],
  ["accent", ["button.background", "focusBorder", "progressBar.background"]],
  ["accentForeground", ["button.foreground"]],
  ["error", ["editorError.foreground", "errorForeground"]],
  ["warning", ["editorWarning.foreground"]],
  ["info", ["editorInfo.foreground"]],
  ["success", ["testing.iconPassed", "charts.green"]],
  ["editorSelection", ["editor.selectionBackground", "terminal.selectionBackground"]],
  ...ANSI_NAMES.map((name): [ThemeRoleKey, readonly string[]] => [
    `ansi.${name}`,
    [`terminal.ansi${name[0].toUpperCase()}${name.slice(1)}`]
  ])
];

/**
 * The colors a VS Code theme sets, plus every other token derived from its main colors,
 * so tokens it leaves out still match it instead of the base theme.
 */
function vsCodeBaseline(colors: Record<string, unknown>, mode: AppThemeMode): Record<string, string> {
  const base = resolveAppTheme(mode);
  const editorBackground =
    toOpaqueHex(typeof colors["editor.background"] === "string" ? colors["editor.background"] : undefined) ??
    toOpaqueHex(base.vars[EDITOR_BACKGROUND]) ??
    "#000000";
  const roles: CustomTheme["colors"] = {};
  for (const [key, ids] of ROLE_SOURCES) {
    for (const id of ids) {
      const value = colors[id];
      const opaque = typeof value === "string" ? toOpaqueHex(value, editorBackground) : null;
      if (opaque !== null) {
        roles[key] = opaque;
        break;
      }
    }
  }
  const vars = { ...base.vars };
  applyRoles(vars, roles, mode);
  applyTokenMap(vars, cleanTokens(colors));
  return Object.fromEntries(THEME_COLOR_TOKENS.map((token) => [tokenColorId(token), vars[token]]));
}

function importedTheme(entry: unknown, index: number): CustomTheme | null {
  if (!isRecord(entry)) return null;
  const colors = isRecord(entry.colors) ? entry.colors : {};
  const mode = importedMode(entry.type, colors);
  const name = cleanName(entry.name) ?? `Imported theme${index > 0 ? ` ${index + 1}` : ""}`;
  if (isRecord(entry.containerlab)) {
    const saved = entry.containerlab;
    const baseline = cleanTokens(saved.baseline);
    return {
      id: newThemeId(),
      name,
      mode,
      base: themeBase(saved.base, mode),
      ...(Object.keys(baseline).length > 0 ? { baseline } : {}),
      colors: cleanRoleColors(saved.colors),
      tokens: cleanTokens(saved.tokens)
    };
  }
  if (Object.keys(cleanTokens(colors)).length === 0) return null;
  return {
    id: newThemeId(),
    name,
    mode,
    base: DEFAULT_APP_THEME_IDS[mode],
    baseline: vsCodeBaseline(colors, mode),
    colors: {},
    tokens: {}
  };
}

/**
 * Reads themes exported by this app or VS Code color themes: one theme, a list, or
 * `{ "themes": [...] }`. Throws with a message for the user when nothing can be read.
 */
export function importCustomThemes(text: string): CustomTheme[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonc(text));
  } catch {
    throw new Error("This is not valid JSON.");
  }
  let entries: unknown[] = [parsed];
  if (Array.isArray(parsed)) entries = parsed;
  else if (isRecord(parsed) && Array.isArray(parsed.themes)) entries = parsed.themes;
  const themes = entries.flatMap((entry, index) => importedTheme(entry, index) ?? []);
  if (themes.length === 0) {
    throw new Error("No theme colors found. Expected a theme with a \"colors\" object.");
  }
  return themes;
}
