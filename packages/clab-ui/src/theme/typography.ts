import type { TypographyVariantsOptions } from "@mui/material/styles";

/** The host font: VS Code's UI font in the extension, the platform UI font in standalone apps. */
export const UI_FONT_FAMILY =
  "var(--clab-ui-font-family, var(--vscode-font-family, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif))";

/** Monospace for YAML, interface names, images and other literal values. */
export const MONO_FONT_FAMILY =
  "var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace)";

/**
 * One type scale for every surface, derived from the host font size (13px by default)
 * so it follows VS Code's zoom and the appearance font size.
 */
export function typographyFor(base = 13): TypographyVariantsOptions {
  const size = (offset: number) => `${Math.max(base + offset, 9)}px`;
  const heading = { fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.3 };
  return {
    fontFamily: UI_FONT_FAMILY,
    fontSize: base,
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 600,
    h1: { ...heading, fontSize: size(19) },
    h2: { ...heading, fontSize: size(15) },
    h3: { ...heading, fontSize: size(11) },
    h4: { ...heading, fontSize: size(9) },
    h5: { ...heading, fontSize: size(5) },
    h6: { ...heading, fontSize: size(2), letterSpacing: "-0.005em", lineHeight: 1.35 },
    subtitle1: { fontSize: size(0), fontWeight: 600, lineHeight: 1.4 },
    subtitle2: { fontSize: size(-1), fontWeight: 600, lineHeight: 1.4 },
    body1: { fontSize: size(0), lineHeight: 1.5 },
    body2: { fontSize: size(-1), lineHeight: 1.5 },
    caption: { fontSize: size(-2), lineHeight: 1.45 },
    overline: {
      fontSize: size(-2),
      fontWeight: 600,
      letterSpacing: "0.06em",
      lineHeight: 1.6,
      textTransform: "uppercase"
    },
    button: { fontSize: size(0), fontWeight: 500, lineHeight: 1.4, textTransform: "none", letterSpacing: 0 }
  };
}
