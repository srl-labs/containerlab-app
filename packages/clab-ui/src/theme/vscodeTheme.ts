// VS Code MUI theme config.
// Palette values are CSS var() references — VS Code swaps them for light/dark.
import { createTheme, type ThemeOptions } from "@mui/material/styles";
import {
  controlRadius,
  dialogRadius,
  floatingRadius,
  floatingShadow,
  overlayShadow,
  shadowColor
} from "./surfaces";
import { UI_FONT_FAMILY, typographyFor } from "./typography";
import { vscodePalette } from "./vscodePalette";
export { vscodePalette } from "./vscodePalette";

const TEXT = vscodePalette.text.primary;
const MUTED = vscodePalette.text.secondary;
const ICON = "var(--vscode-icon-foreground, currentColor)";
const HOVER = vscodePalette.action.hover;
const SELECTED = vscodePalette.action.selected;
const FOCUS = vscodePalette.action.focus;
const ERROR = vscodePalette.error.main;
const LINK = "var(--vscode-textLink-foreground)";
const LINK_ACTIVE = "var(--vscode-textLink-activeForeground, var(--vscode-textLink-foreground))";
const PROGRESS = "var(--vscode-progressBar-background, var(--clab-ui-button-background))";
const BUTTON_BACKGROUND = vscodePalette.primary.main;
const BUTTON_FOREGROUND = vscodePalette.primary.contrastText;
const BUTTON_HOVER_BACKGROUND = `var(--vscode-button-hoverBackground, ${BUTTON_BACKGROUND})`;
const SECONDARY_BACKGROUND = vscodePalette.secondary.main;
const SECONDARY_FOREGROUND = vscodePalette.secondary.contrastText;
const SECONDARY_HOVER_BACKGROUND = `var(--vscode-button-secondaryHoverBackground, ${SECONDARY_BACKGROUND})`;
// VS Code leaves input borders undefined in some themes; fall back to the panel border.
const INPUT_BORDER =
  "var(--clab-ui-input-border, var(--vscode-input-border, var(--vscode-panel-border, transparent)))";
const CONTROL_BORDER_HOVER = `color-mix(in srgb, ${TEXT} 32%, ${INPUT_BORDER})`;
const WIDGET_BACKGROUND = `var(--vscode-editorWidget-background, ${vscodePalette.background.paper})`;
const WIDGET_FOREGROUND = `var(--vscode-editorWidget-foreground, ${TEXT})`;
const WIDGET_BORDER = `var(--vscode-editorWidget-border, ${vscodePalette.divider})`;
const CONTROL_TRANSITION =
  "background-color 120ms ease, border-color 120ms ease, color 120ms ease, box-shadow 120ms ease, opacity 120ms ease";

const EXPLORER_FONT_FAMILY =
  "var(--clab-ui-font-family, var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif))";
const EXPLORER_FONT_SIZE = "var(--clab-ui-font-size, var(--vscode-font-size, 13px))";
const EXPLORER_SCOPE_SELECTORS = [
  "body[data-webview-kind='containerlab-explorer']",
  ".containerlab-explorer-root"
] as const;

const explorerScopedSelector = (suffix: string) =>
  EXPLORER_SCOPE_SELECTORS.map((selector) => `${selector}${suffix}`).join(", ");

// Component overrides
export const structuralOverrides: NonNullable<ThemeOptions["components"]> = {
  MuiCssBaseline: {
    styleOverrides: {
      // Bridge vars for non-MUI components (React Flow canvas)
      ":root": {
        "--clab-ui-editor-background": "var(--vscode-editor-background)",
        "--clab-ui-editor-foreground": "var(--vscode-editor-foreground)",
        "--clab-ui-panel-background": "var(--vscode-sideBar-background)",
        "--clab-ui-panel-border": "var(--vscode-panel-border)",
        "--clab-ui-button-background": "var(--vscode-button-background)",
        "--clab-ui-button-foreground": "var(--vscode-button-foreground)",
        "--clab-ui-input-background": "var(--vscode-input-background)",
        "--clab-ui-input-foreground": "var(--vscode-input-foreground)",
        "--clab-ui-input-border": "var(--vscode-input-border)",
        "--clab-ui-focus-border": "var(--vscode-focusBorder)",
        "--clab-ui-font-family": "var(--vscode-font-family)",
        "--clab-ui-font-size": "var(--vscode-font-size)",
        "--topoviewer-surface-panel": vscodePalette.background.paper,
        "--topoviewer-surface-elevated": vscodePalette.background.paper,
        "--topoviewer-grid-color": vscodePalette.divider,
        "--topoviewer-node-label-background": "var(--vscode-badge-background)",
        "--topoviewer-node-label-foreground": vscodePalette.text.primary,
        "--topoviewer-node-label-outline": vscodePalette.background.default,
        "--topoviewer-edge-label-background": vscodePalette.background.default,
        "--topoviewer-edge-label-foreground": vscodePalette.text.primary,
        "--topoviewer-edge-label-outline": vscodePalette.background.default,
        // Lifted slightly off the canvas so boxes read in every theme, even when panels match it.
        "--topoviewer-node-box-background": `color-mix(in srgb, ${vscodePalette.background.default} 94%, ${vscodePalette.text.primary})`,
        "--topoviewer-node-box-border": `color-mix(in srgb, ${vscodePalette.background.default} 78%, ${vscodePalette.text.primary})`,
        "--topoviewer-node-box-foreground": vscodePalette.text.primary
      },
      body: { fontFamily: UI_FONT_FAMILY },
      // The topology canvas keeps the text styles it was designed with, independent of the UI type scale.
      ".react-flow": {
        fontFamily: "'Roboto', sans-serif",
        fontSize: "1rem",
        lineHeight: 1.5,
        letterSpacing: "0.00938em"
      },
      "*::-webkit-scrollbar": { width: 10, height: 10 },
      "*::-webkit-scrollbar-track": { background: "transparent" },
      // A transparent border insets the thumb so it reads as a slim pill.
      "*::-webkit-scrollbar-thumb": {
        borderRadius: 999,
        border: "2px solid transparent",
        backgroundClip: "padding-box",
        backgroundColor: "var(--vscode-scrollbarSlider-background)"
      },
      "*::-webkit-scrollbar-thumb:hover": {
        backgroundColor: "var(--vscode-scrollbarSlider-hoverBackground)"
      },
      "*::-webkit-scrollbar-thumb:active": {
        backgroundColor: "var(--vscode-scrollbarSlider-activeBackground)"
      },
      "*::-webkit-scrollbar-corner": { background: "transparent" },
      [explorerScopedSelector("")]: {
        fontFamily: EXPLORER_FONT_FAMILY
      },
      [explorerScopedSelector(" .MuiTypography-root")]: {
        fontFamily: EXPLORER_FONT_FAMILY
      },
      [explorerScopedSelector(" .MuiInputBase-root")]: {
        fontFamily: EXPLORER_FONT_FAMILY
      },
      [explorerScopedSelector(" .MuiInputBase-input")]: {
        fontFamily: EXPLORER_FONT_FAMILY,
        fontSize: EXPLORER_FONT_SIZE
      },
      [explorerScopedSelector(" .explorer-node-label")]: {
        fontSize: EXPLORER_FONT_SIZE,
        lineHeight: 1.25
      },
      [explorerScopedSelector(" .explorer-node-inline-icon")]: {
        flex: "0 0 auto"
      },
      [explorerScopedSelector(" .explorer-node-inline-icon-favorite")]: {
        color: "var(--vscode-charts-yellow, var(--vscode-editorWarning-foreground))"
      },
      [explorerScopedSelector(" .explorer-node-inline-icon-shared")]: {
        color: "var(--vscode-icon-foreground, var(--vscode-foreground))"
      },
      [explorerScopedSelector(" .explorer-section-title")]: {
        fontSize: "12px",
        fontWeight: 600,
        lineHeight: 1.2,
        letterSpacing: "0.01em",
        color: "var(--vscode-descriptionForeground)"
      },
      "@keyframes shortcutFade": {
        "0%": { opacity: 0, transform: "translateY(8px) scale(0.95)" },
        "15%": { opacity: 1, transform: "translateY(0) scale(1)" },
        "85%": { opacity: 1, transform: "translateY(0) scale(1)" },
        "100%": { opacity: 0, transform: "translateY(-4px) scale(0.98)" }
      }
    }
  },
  MuiButtonBase: {
    // Ripples read as Material; the UI follows its host editor, which uses flat state colors.
    defaultProps: { disableRipple: true }
  },
  MuiButton: {
    defaultProps: { disableElevation: true, variant: "contained" },
    styleOverrides: {
      root: {
        textTransform: "none",
        fontWeight: 500,
        letterSpacing: 0,
        lineHeight: 1.4,
        minWidth: 0,
        borderRadius: controlRadius,
        whiteSpace: "nowrap",
        transition: CONTROL_TRANSITION,
        "&.Mui-focusVisible": { outline: `1px solid ${FOCUS}`, outlineOffset: 2 },
        "&.Mui-disabled": { opacity: 0.5 },
        "& .MuiButton-startIcon": { marginLeft: -2, marginRight: 6 },
        "& .MuiButton-endIcon": { marginLeft: 6, marginRight: -2 },
        "& .MuiButton-startIcon > *:nth-of-type(1), & .MuiButton-endIcon > *:nth-of-type(1)": {
          fontSize: 16
        },
        variants: [
          { props: { size: "small" }, style: { minHeight: 28, padding: "3px 10px", fontSize: 12 } },
          { props: { size: "medium" }, style: { minHeight: 32, padding: "5px 14px", fontSize: 13 } },
          { props: { size: "large" }, style: { minHeight: 38, padding: "8px 18px", fontSize: 14 } },
          {
            props: { variant: "contained", color: "primary" },
            style: {
              backgroundColor: BUTTON_BACKGROUND,
              color: BUTTON_FOREGROUND,
              "&:hover": { backgroundColor: BUTTON_HOVER_BACKGROUND },
              "&.Mui-disabled": { backgroundColor: BUTTON_BACKGROUND, color: BUTTON_FOREGROUND }
            }
          },
          {
            props: { variant: "contained", color: "secondary" },
            style: {
              backgroundColor: SECONDARY_BACKGROUND,
              color: SECONDARY_FOREGROUND,
              "&:hover": { backgroundColor: SECONDARY_HOVER_BACKGROUND },
              "&.Mui-disabled": { backgroundColor: SECONDARY_BACKGROUND, color: SECONDARY_FOREGROUND }
            }
          },
          {
            props: { variant: "contained", color: "error" },
            style: {
              backgroundColor: ERROR,
              color: "#ffffff",
              "&:hover": { backgroundColor: `color-mix(in srgb, ${ERROR} 86%, #000000)` },
              "&.Mui-disabled": { backgroundColor: ERROR, color: "#ffffff" }
            }
          },
          {
            props: { variant: "outlined" },
            style: {
              color: TEXT,
              borderColor: INPUT_BORDER,
              "&:hover": { borderColor: CONTROL_BORDER_HOVER, backgroundColor: HOVER },
              "&.Mui-disabled": { color: TEXT, borderColor: INPUT_BORDER }
            }
          },
          {
            props: { variant: "outlined", color: "error" },
            style: {
              color: ERROR,
              borderColor: `color-mix(in srgb, ${ERROR} 55%, transparent)`,
              "&:hover": { borderColor: ERROR, backgroundColor: `color-mix(in srgb, ${ERROR} 10%, transparent)` }
            }
          },
          {
            props: { variant: "text" },
            style: {
              color: TEXT,
              "&:hover": { backgroundColor: HOVER },
              "&.Mui-disabled": { color: TEXT }
            }
          },
          { props: { variant: "text", size: "small" }, style: { padding: "3px 8px" } },
          { props: { variant: "text", size: "medium" }, style: { padding: "5px 10px" } },
          {
            props: { variant: "text", color: "error" },
            style: {
              color: ERROR,
              "&:hover": { backgroundColor: `color-mix(in srgb, ${ERROR} 10%, transparent)` }
            }
          },
          { props: { color: "inherit" }, style: { color: "inherit" } }
        ]
      }
    }
  },
  MuiButtonGroup: {
    defaultProps: { disableElevation: true },
    styleOverrides: { root: { borderRadius: controlRadius } }
  },
  MuiIconButton: {
    styleOverrides: {
      root: {
        borderRadius: controlRadius,
        color: ICON,
        transition: CONTROL_TRANSITION,
        "&:hover": { backgroundColor: HOVER },
        "&.Mui-focusVisible": { outline: `1px solid ${FOCUS}`, outlineOffset: -1 },
        "&.Mui-disabled": { color: ICON, opacity: 0.4 },
        variants: [
          { props: { size: "small" }, style: { padding: 4 } },
          { props: { color: "primary" }, style: { color: BUTTON_BACKGROUND } },
          { props: { color: "error" }, style: { color: ERROR, "&:hover": { backgroundColor: `color-mix(in srgb, ${ERROR} 12%, transparent)` } } },
          { props: { color: "inherit" }, style: { color: "inherit" } }
        ]
      }
    }
  },
  MuiToggleButtonGroup: {
    styleOverrides: {
      root: { borderRadius: controlRadius },
      grouped: { borderColor: INPUT_BORDER }
    }
  },
  MuiToggleButton: {
    styleOverrides: {
      root: {
        textTransform: "none",
        fontWeight: 500,
        fontSize: 12,
        lineHeight: 1.4,
        gap: 6,
        color: MUTED,
        borderColor: INPUT_BORDER,
        borderRadius: controlRadius,
        transition: CONTROL_TRANSITION,
        "&:hover": { backgroundColor: HOVER, color: TEXT },
        "&.Mui-selected, &.Mui-selected:hover": {
          color: TEXT,
          backgroundColor: SELECTED
        },
        "&.Mui-focusVisible": { outline: `1px solid ${FOCUS}`, outlineOffset: -1, zIndex: 1 },
        variants: [
          { props: { size: "small" }, style: { minHeight: 32, padding: "5px 10px" } },
          { props: { size: "medium" }, style: { minHeight: 32, padding: "5px 12px" } }
        ]
      }
    }
  },
  MuiChip: {
    styleOverrides: {
      root: {
        color: vscodePalette.text.primary,
        maxWidth: "100%",
        borderRadius: controlRadius,
        fontSize: 12,
        fontWeight: 500,
        variants: [{ props: { size: "small" }, style: { height: 22 } }]
      },
      label: { paddingLeft: 8, paddingRight: 8 },
      icon: {
        color: "inherit"
      },
      deleteIcon: {
        color: "var(--vscode-icon-foreground, currentColor)",
        fontSize: 16
      },
      filled: {
        color: "var(--vscode-badge-foreground)",
        backgroundColor: "var(--vscode-badge-background)",
        "& .MuiChip-icon, & .MuiChip-deleteIcon": {
          color: "currentColor"
        }
      },
      outlined: {
        color: vscodePalette.text.primary,
        borderColor: vscodePalette.divider,
        "& .MuiChip-icon": {
          color: "inherit"
        }
      }
    }
  },
  MuiTabs: {
    styleOverrides: {
      root: { minHeight: 36 },
      indicator: { height: 2, borderRadius: "2px 2px 0 0", backgroundColor: FOCUS },
      scrollButtons: {
        width: 24,
        color: ICON,
        "&.Mui-disabled": { opacity: 0 }
      }
    }
  },
  MuiTab: {
    styleOverrides: {
      root: {
        minHeight: 36,
        minWidth: 0,
        padding: "6px 12px",
        textTransform: "none",
        fontSize: 13,
        fontWeight: 500,
        letterSpacing: 0,
        lineHeight: 1.4,
        color: MUTED,
        opacity: 1,
        transition: "color 120ms ease",
        "&:hover": { color: TEXT },
        "&.Mui-selected": { color: TEXT },
        "&.Mui-focusVisible": { outline: `1px solid ${FOCUS}`, outlineOffset: -1 },
        "&.Mui-disabled": { opacity: 0.5, color: MUTED },
        "& .MuiTab-icon": { fontSize: 16 }
      }
    }
  },
  MuiTooltip: {
    defaultProps: { enterDelay: 400, enterNextDelay: 150, disableInteractive: true },
    styleOverrides: {
      tooltip: {
        backgroundColor: WIDGET_BACKGROUND,
        color: WIDGET_FOREGROUND,
        border: `1px solid ${WIDGET_BORDER}`,
        boxShadow: floatingShadow,
        borderRadius: controlRadius,
        fontSize: 12,
        fontWeight: 400,
        lineHeight: 1.4,
        padding: "4px 8px",
        maxWidth: 320
      },
      arrow: {
        color: WIDGET_BACKGROUND,
        "&::before": { border: `1px solid ${WIDGET_BORDER}` }
      }
    }
  },
  MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
  // MUI derives standard/filled Alert colors by running darken()/lighten() on
  // palette.*.main at render — those can't parse our var() palette, so the text
  // and background collapse to the same color (unreadable until selected). Set
  // explicit, theme-aware colors from VS Code's purpose-built validation vars.
  MuiAlert: {
    styleOverrides: {
      root: {
        borderRadius: controlRadius,
        fontSize: 13,
        lineHeight: 1.45,
        padding: "6px 12px",
        alignItems: "flex-start",
        "& .MuiAlert-icon": { padding: "8px 0", marginRight: 10, fontSize: 18, opacity: 1 },
        "& .MuiAlert-message": { padding: "8px 0", minWidth: 0 },
        "& .MuiAlert-action": { paddingTop: 2, marginRight: -6 },
        "& .MuiAlertTitle-root": { fontSize: 13, fontWeight: 600, marginBottom: 2, marginTop: 0 },
        "&.MuiAlert-standard.MuiAlert-colorError": {
          backgroundColor: "var(--vscode-inputValidation-errorBackground)",
          color: "var(--vscode-inputValidation-errorForeground, var(--vscode-foreground))",
          border: "1px solid var(--vscode-inputValidation-errorBorder)",
          "& .MuiAlert-icon": { color: vscodePalette.error.main }
        },
        "&.MuiAlert-filled.MuiAlert-colorError": {
          backgroundColor: "var(--vscode-inputValidation-errorBackground)",
          color: "var(--vscode-inputValidation-errorForeground, var(--vscode-foreground))",
          border: "1px solid var(--vscode-inputValidation-errorBorder)"
        },
        "&.MuiAlert-standard.MuiAlert-colorWarning": {
          backgroundColor: "var(--vscode-inputValidation-warningBackground)",
          color: "var(--vscode-inputValidation-warningForeground, var(--vscode-foreground))",
          border: "1px solid var(--vscode-inputValidation-warningBorder)",
          "& .MuiAlert-icon": { color: vscodePalette.warning.main }
        },
        "&.MuiAlert-filled.MuiAlert-colorWarning": {
          backgroundColor: "var(--vscode-inputValidation-warningBackground)",
          color: "var(--vscode-inputValidation-warningForeground, var(--vscode-foreground))",
          border: "1px solid var(--vscode-inputValidation-warningBorder)"
        },
        "&.MuiAlert-standard.MuiAlert-colorInfo": {
          backgroundColor: "var(--vscode-inputValidation-infoBackground)",
          color: "var(--vscode-inputValidation-infoForeground, var(--vscode-foreground))",
          border: "1px solid var(--vscode-inputValidation-infoBorder)",
          "& .MuiAlert-icon": { color: vscodePalette.info.main }
        },
        "&.MuiAlert-filled.MuiAlert-colorInfo": {
          backgroundColor: "var(--vscode-inputValidation-infoBackground)",
          color: "var(--vscode-inputValidation-infoForeground, var(--vscode-foreground))",
          border: "1px solid var(--vscode-inputValidation-infoBorder)"
        },
        "&.MuiAlert-standard.MuiAlert-colorSuccess": {
          backgroundColor: vscodePalette.background.paper,
          color: vscodePalette.text.primary,
          border: `1px solid ${vscodePalette.success.main}`,
          "& .MuiAlert-icon": { color: vscodePalette.success.main }
        },
        "&.MuiAlert-filled.MuiAlert-colorSuccess": {
          backgroundColor: vscodePalette.background.paper,
          color: vscodePalette.text.primary,
          border: `1px solid ${vscodePalette.success.main}`
        },
        // Outlined alerts read like standard ones: tinted validation colors instead of MUI's derived blue.
        "&.MuiAlert-outlined": { backgroundColor: "transparent", color: vscodePalette.text.primary },
        "&.MuiAlert-outlined.MuiAlert-colorError": {
          borderColor: "var(--vscode-inputValidation-errorBorder)",
          "& .MuiAlert-icon": { color: vscodePalette.error.main }
        },
        "&.MuiAlert-outlined.MuiAlert-colorWarning": {
          borderColor: "var(--vscode-inputValidation-warningBorder)",
          "& .MuiAlert-icon": { color: vscodePalette.warning.main }
        },
        "&.MuiAlert-outlined.MuiAlert-colorInfo": {
          borderColor: "var(--vscode-inputValidation-infoBorder)",
          "& .MuiAlert-icon": { color: vscodePalette.info.main }
        },
        "&.MuiAlert-outlined.MuiAlert-colorSuccess": {
          borderColor: vscodePalette.success.main,
          "& .MuiAlert-icon": { color: vscodePalette.success.main }
        }
      }
    }
  },
  MuiAppBar: {
    styleOverrides: {
      root: { backgroundColor: vscodePalette.background.paper, color: vscodePalette.text.primary }
    }
  },
  MuiDrawer: {
    styleOverrides: {
      paper: { backgroundColor: vscodePalette.background.paper, color: vscodePalette.text.primary }
    }
  },
  MuiInputBase: {
    styleOverrides: {
      root: {
        color: "var(--vscode-input-foreground)",
        fontSize: 13,
        lineHeight: 1.4375
      },
      input: {
        "&::placeholder": { color: "var(--vscode-input-placeholderForeground)", opacity: 1 }
      }
    }
  },
  MuiOutlinedInput: {
    defaultProps: {
      notched: true
    },
    styleOverrides: {
      // Transparent fields keep the notched label sitting cleanly in the outline.
      root: {
        borderRadius: controlRadius,
        backgroundColor: "transparent",
        transition: CONTROL_TRANSITION,
        "&:hover .MuiOutlinedInput-notchedOutline": {
          borderColor: CONTROL_BORDER_HOVER
        },
        "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
          borderColor: FOCUS,
          borderWidth: 1
        },
        "&.Mui-error .MuiOutlinedInput-notchedOutline": {
          borderColor: ERROR
        },
        "&.Mui-disabled": { opacity: 0.6 },
        "&.Mui-disabled .MuiOutlinedInput-notchedOutline": { borderColor: INPUT_BORDER },
        // MUI 9 marks textareas as inputs too; multiline roots carry their own padding.
        "&.MuiInputBase-sizeSmall > .MuiInputBase-input:not(textarea)": {
          padding: "6.5px 12px"
        },
        "&.MuiInputBase-sizeSmall.MuiInputBase-adornedStart": { paddingLeft: 10 },
        "&.MuiInputBase-sizeSmall.MuiInputBase-adornedStart > .MuiInputBase-input": { paddingLeft: 0 },
        "&.MuiInputBase-sizeSmall.MuiInputBase-adornedEnd": { paddingRight: 6 },
        "&.MuiInputBase-sizeSmall.MuiInputBase-multiline": { padding: "6.5px 12px" },
        "& .MuiInputAdornment-root": { color: MUTED },
        "& .MuiInputAdornment-root .MuiSvgIcon-root": { fontSize: 18 }
      },
      notchedOutline: {
        borderColor: INPUT_BORDER,
        // Notch geometry matches the label: 7px + 5px legend padding + 1px border = the 13px label inset,
        // and the legend uses the label's shrunken font so the gap fits the text exactly.
        padding: "0 7px",
        "& legend": { fontSize: "0.85em" }
      }
    }
  },
  MuiInputLabel: {
    defaultProps: { shrink: true },
    styleOverrides: {
      root: {
        fontSize: 13,
        color: MUTED,
        "&.Mui-focused": { color: FOCUS },
        "&.Mui-error": { color: ERROR },
        "&.Mui-disabled": { color: MUTED, opacity: 0.6 },
        // 13px label at 0.85 renders at 11px, centered on the top border.
        "&.MuiInputLabel-outlined.MuiInputLabel-shrink": {
          transform: "translate(13px, -8px) scale(0.85)",
          maxWidth: "calc(117% - 30px)"
        }
      }
    }
  },
  MuiFormLabel: {
    styleOverrides: {
      root: { fontSize: 13, "&.Mui-focused": { color: MUTED } },
      asterisk: { color: ERROR }
    }
  },
  MuiFormHelperText: {
    styleOverrides: {
      root: { fontSize: 11, lineHeight: 1.45, marginTop: 4, marginLeft: 2, marginRight: 2, color: MUTED }
    }
  },
  MuiFormControlLabel: {
    styleOverrides: {
      root: { marginLeft: -6 },
      label: { fontSize: 13 }
    }
  },
  MuiInputAdornment: {
    styleOverrides: { root: { color: MUTED } }
  },
  MuiTextField: { defaultProps: { size: "small", variant: "outlined" } },
  MuiSelect: {
    defaultProps: { size: "small" },
    styleOverrides: { icon: { color: MUTED, right: 6 } }
  },
  MuiNativeSelect: { styleOverrides: { icon: { color: MUTED } } },
  MuiAutocomplete: {
    defaultProps: { size: "small" },
    styleOverrides: {
      // The input carries the 32px field metrics, so the root adds no vertical padding of its own.
      root: {
        "& .MuiAutocomplete-inputRoot.MuiOutlinedInput-root.MuiInputBase-sizeSmall": {
          paddingTop: 0,
          paddingBottom: 0,
          paddingLeft: 0,
          "& .MuiAutocomplete-input": { paddingTop: "6.5px", paddingBottom: "6.5px", paddingLeft: 12 }
        }
      },
      paper: {
        backgroundColor: vscodePalette.background.paper,
        color: vscodePalette.text.primary,
        border: `1px solid ${vscodePalette.divider}`,
        borderRadius: floatingRadius,
        boxShadow: floatingShadow,
        marginTop: 4
      },
      listbox: { padding: 4, fontSize: 13 },
      option: {
        minHeight: "28px !important",
        borderRadius: 4,
        fontSize: 13,
        "&.Mui-focused": { backgroundColor: `${HOVER} !important` },
        "&[aria-selected='true']": { backgroundColor: `${SELECTED} !important` }
      },
      noOptions: { fontSize: 13, color: MUTED, padding: "8px 12px" },
      loading: { fontSize: 13, color: MUTED, padding: "8px 12px" },
      groupLabel: {
        backgroundColor: vscodePalette.background.paper,
        color: MUTED,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: "28px",
        letterSpacing: "0.04em",
        textTransform: "uppercase"
      },
      tag: { margin: 2 },
      endAdornment: { "& .MuiIconButton-root": { padding: 2 } }
    }
  },
  MuiSwitch: {
    styleOverrides: {
      root: {
        width: 34,
        height: 20,
        padding: 0,
        margin: 6,
        overflow: "visible",
        "&.MuiSwitch-sizeSmall": { width: 30, height: 18 },
        // MUI pads small switch bases by 4px at higher specificity; keep the knob centered in the track.
        "&.MuiSwitch-sizeSmall .MuiSwitch-switchBase": { padding: 3 },
        "&.MuiSwitch-sizeSmall .MuiSwitch-thumb": { width: 12, height: 12 },
        "&.MuiSwitch-sizeSmall .MuiSwitch-switchBase.Mui-checked": { transform: "translateX(12px)" }
      },
      switchBase: {
        padding: 3,
        color: "#ffffff",
        "&:hover": { backgroundColor: "transparent" },
        "&.Mui-checked": {
          transform: "translateX(14px)",
          color: BUTTON_FOREGROUND,
          "&:hover": { backgroundColor: "transparent" }
        },
        "&.Mui-checked + .MuiSwitch-track": { backgroundColor: BUTTON_BACKGROUND, opacity: 1 },
        "&.Mui-disabled + .MuiSwitch-track": { opacity: 0.4 },
        "&.Mui-disabled .MuiSwitch-thumb": { opacity: 0.8 },
        "&.Mui-focusVisible + .MuiSwitch-track": { outline: `1px solid ${FOCUS}`, outlineOffset: 2 }
      },
      thumb: {
        width: 14,
        height: 14,
        boxShadow: `0 1px 2px ${shadowColor}`
      },
      track: {
        borderRadius: 999,
        opacity: 1,
        backgroundColor: `color-mix(in srgb, ${TEXT} 28%, transparent)`,
        transition: CONTROL_TRANSITION
      }
    }
  },
  MuiCheckbox: {
    styleOverrides: {
      root: {
        padding: 6,
        color: "var(--vscode-checkbox-border, currentColor)",
        "&:hover": { backgroundColor: "transparent" },
        "&.Mui-checked, &.MuiCheckbox-indeterminate": { color: BUTTON_BACKGROUND },
        "&.Mui-focusVisible": { outline: `1px solid ${FOCUS}`, outlineOffset: -4, borderRadius: 4 },
        "& .MuiSvgIcon-root": { fontSize: 18 }
      }
    }
  },
  MuiRadio: {
    styleOverrides: {
      root: {
        padding: 6,
        color: "var(--vscode-checkbox-border, currentColor)",
        "&:hover": { backgroundColor: "transparent" },
        "&.Mui-checked": { color: BUTTON_BACKGROUND },
        "&.Mui-focusVisible": { outline: `1px solid ${FOCUS}`, outlineOffset: -4, borderRadius: 999 },
        "& .MuiSvgIcon-root": { fontSize: 18 }
      }
    }
  },
  MuiSlider: {
    styleOverrides: {
      root: { height: 4, padding: "10px 0" },
      rail: { opacity: 1, backgroundColor: `color-mix(in srgb, ${TEXT} 18%, transparent)` },
      track: { border: "none" },
      thumb: {
        width: 14,
        height: 14,
        backgroundColor: "#ffffff",
        border: `2px solid ${BUTTON_BACKGROUND}`,
        boxShadow: `0 1px 3px ${shadowColor}`,
        "&::before": { boxShadow: "none" },
        "&:hover, &.Mui-focusVisible": {
          boxShadow: `0 0 0 4px color-mix(in srgb, ${BUTTON_BACKGROUND} 22%, transparent)`
        },
        "&.Mui-active": {
          boxShadow: `0 0 0 6px color-mix(in srgb, ${BUTTON_BACKGROUND} 22%, transparent)`
        }
      },
      valueLabel: {
        fontSize: 11,
        fontWeight: 500,
        padding: "2px 6px",
        borderRadius: 4,
        backgroundColor: WIDGET_BACKGROUND,
        color: WIDGET_FOREGROUND,
        border: `1px solid ${WIDGET_BORDER}`
      },
      mark: { backgroundColor: MUTED },
      markLabel: { fontSize: 11, color: MUTED }
    }
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: {
        height: 3,
        borderRadius: 999,
        backgroundColor: `color-mix(in srgb, ${TEXT} 12%, transparent)`
      },
      bar: { borderRadius: 999, backgroundColor: PROGRESS }
    }
  },
  MuiCircularProgress: {
    styleOverrides: { root: { color: PROGRESS } }
  },
  MuiMenu: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      paper: {
        backgroundColor: vscodePalette.background.paper,
        color: vscodePalette.text.primary,
        border: `1px solid ${vscodePalette.divider}`,
        borderRadius: floatingRadius,
        boxShadow: floatingShadow
      },
      list: { padding: 4 }
    }
  },
  MuiMenuItem: {
    styleOverrides: {
      root: {
        minHeight: 28,
        padding: "4px 8px",
        borderRadius: 5,
        fontSize: 13,
        lineHeight: 1.4,
        gap: 0,
        "&:hover": { backgroundColor: HOVER },
        // Like native menus, the focused row is marked by its fill; high contrast keeps an outline.
        "&.Mui-focusVisible": { backgroundColor: HOVER },
        "body.vscode-high-contrast &.Mui-focusVisible, body.vscode-high-contrast-light &.Mui-focusVisible": {
          outline: `1px solid ${FOCUS}`,
          outlineOffset: -1
        },
        "@media (forced-colors: active)": {
          "&.Mui-focusVisible": { outline: "1px solid Highlight", outlineOffset: -1 }
        },
        "&.Mui-selected, &.Mui-selected:hover, &.Mui-selected.Mui-focusVisible": { backgroundColor: SELECTED },
        "&.Mui-disabled": { opacity: 0.45 },
        "& .MuiListItemIcon-root": { minWidth: 26, color: ICON },
        "& .MuiListItemIcon-root .MuiSvgIcon-root": { fontSize: 16 },
        "& .MuiListItemText-primary": { fontSize: 13 },
        "& + .MuiDivider-root": { marginTop: 4, marginBottom: 4 },
        "@media (min-width: 600px)": { minHeight: 28 }
      }
    }
  },
  MuiListItemButton: {
    styleOverrides: {
      root: {
        borderRadius: controlRadius,
        transition: CONTROL_TRANSITION,
        "&:hover": { backgroundColor: HOVER },
        "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: SELECTED },
        "&.Mui-focusVisible": { backgroundColor: HOVER, outline: `1px solid ${FOCUS}`, outlineOffset: -1 }
      }
    }
  },
  MuiListItemIcon: {
    styleOverrides: { root: { color: ICON, minWidth: 32 } }
  },
  MuiListItemText: {
    styleOverrides: {
      primary: { fontSize: 13 },
      secondary: { fontSize: 12, color: MUTED }
    }
  },
  MuiListSubheader: {
    styleOverrides: {
      root: {
        backgroundColor: "transparent",
        color: MUTED,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        lineHeight: "28px",
        textTransform: "uppercase"
      }
    }
  },
  MuiDivider: {
    styleOverrides: {
      root: { borderColor: vscodePalette.divider },
      // Menus get spaced, inset rules between groups.
      middle: { marginLeft: 8, marginRight: 8 }
    }
  },
  MuiPopover: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      paper: {
        backgroundColor: vscodePalette.background.paper,
        color: vscodePalette.text.primary,
        border: `1px solid ${vscodePalette.divider}`,
        borderRadius: floatingRadius,
        boxShadow: floatingShadow
      }
    }
  },
  MuiDialog: {
    styleOverrides: {
      paper: {
        backgroundColor: vscodePalette.background.paper,
        color: vscodePalette.text.primary,
        border: `1px solid ${vscodePalette.divider}`,
        borderRadius: dialogRadius,
        boxShadow: overlayShadow
      }
    },
    defaultProps: {
      slotProps: { backdrop: { sx: { backgroundColor: "rgba(0, 0, 0, 0.45)" } } }
    }
  },
  MuiDialogTitle: {
    styleOverrides: {
      root: {
        fontSize: 15,
        fontWeight: 600,
        lineHeight: 1.4,
        letterSpacing: "-0.005em",
        padding: "14px 20px"
      }
    }
  },
  MuiDialogContent: {
    styleOverrides: {
      root: { padding: "16px 20px", fontSize: 13 },
      dividers: { borderColor: vscodePalette.divider, padding: "16px 20px" }
    }
  },
  MuiDialogContentText: {
    styleOverrides: { root: { fontSize: 13, color: MUTED } }
  },
  MuiDialogActions: {
    styleOverrides: {
      root: {
        padding: "12px 20px",
        gap: 8,
        "& > :not(style) ~ :not(style)": { marginLeft: 0 }
      }
    }
  },
  MuiBackdrop: { styleOverrides: { root: { backgroundColor: "transparent" } } },
  MuiAccordion: {
    defaultProps: { disableGutters: true, elevation: 0, square: true },
    styleOverrides: {
      root: {
        backgroundColor: "transparent",
        border: `1px solid ${vscodePalette.divider}`,
        borderRadius: controlRadius,
        "&::before": { display: "none" },
        "& + &": { marginTop: 8 }
      }
    }
  },
  MuiAccordionSummary: {
    styleOverrides: {
      root: { minHeight: 36, padding: "0 12px", fontSize: 13, fontWeight: 600 },
      content: { margin: "8px 0" },
      expandIconWrapper: { color: MUTED }
    }
  },
  MuiAccordionDetails: {
    styleOverrides: { root: { padding: "4px 12px 12px" } }
  },
  MuiCard: {
    defaultProps: { elevation: 0 },
    styleOverrides: {
      root: { border: `1px solid ${vscodePalette.divider}`, borderRadius: floatingRadius }
    }
  },
  MuiTableCell: {
    styleOverrides: {
      root: { fontSize: 13, borderColor: vscodePalette.divider, padding: "6px 12px" },
      head: { fontSize: 12, fontWeight: 600, color: MUTED },
      stickyHeader: { backgroundColor: vscodePalette.background.paper },
      sizeSmall: { padding: "4px 10px" }
    }
  },
  MuiTableRow: {
    styleOverrides: {
      root: {
        "&.MuiTableRow-hover:hover": { backgroundColor: HOVER },
        "&.Mui-selected, &.Mui-selected:hover": { backgroundColor: SELECTED }
      }
    }
  },
  MuiLink: {
    defaultProps: { underline: "hover" },
    styleOverrides: {
      root: { color: LINK, "&:hover": { color: LINK_ACTIVE } }
    }
  },
  MuiBadge: {
    styleOverrides: {
      badge: { fontSize: 10, fontWeight: 600, height: 16, minWidth: 16, padding: "0 4px" }
    }
  },
  MuiAvatar: {
    styleOverrides: { root: { fontSize: 12, fontWeight: 600 } }
  },
  MuiSnackbarContent: {
    styleOverrides: {
      root: {
        backgroundColor: WIDGET_BACKGROUND,
        color: WIDGET_FOREGROUND,
        border: `1px solid ${WIDGET_BORDER}`,
        borderRadius: floatingRadius,
        boxShadow: floatingShadow,
        fontSize: 13
      }
    }
  }};

// Theme instance
// Shadow color comes from the host theme, so elevation reads right on light, dark and OLED themes.
const raisedShadow = `0 1px 2px ${shadowColor}, 0 2px 8px -2px ${shadowColor}`;
const shadows = Array.from({ length: 25 }, (_, elevation) => {
  if (elevation === 0) return "none";
  if (elevation <= 2) return raisedShadow;
  if (elevation <= 12) return floatingShadow;
  return overlayShadow;
}) as ThemeOptions["shadows"];

const baseTheme = createTheme({
  palette: { ...vscodePalette },
  typography: typographyFor(),
  shape: { borderRadius: 4 },
  shadows,
  components: structuralOverrides
});

// Patch MUI color utils — default implementations crash on CSS var() strings.
// alpha uses color-mix so hover/focus overlays resolve correctly at runtime.
baseTheme.alpha = (color: string, opacity: number | string) => {
  const opacityValue = typeof opacity === "number" ? `${Math.round(opacity * 100)}%` : opacity;
  return `color-mix(in srgb, ${color} ${opacityValue}, transparent)`;
};
baseTheme.lighten = (color: string) => color;
baseTheme.darken = (color: string) => color;
baseTheme.palette.getContrastText = () => vscodePalette.text.primary;

export const vscodeTheme = baseTheme;
