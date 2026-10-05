import { useEffect, useMemo, useState } from "react";
import { createTheme } from "@mui/material/styles";
import { typographyFor } from "./typography";
import { vscodeTheme } from "./vscodeTheme";
import { CLAB_UI_VAR_ALIASES } from "./devTheme";
import { DARK_MODERN_VARS, LIGHT_MODERN_VARS } from "./modernThemes";

interface Appearance {
  colorScheme: "vscode" | "light" | "dark";
  fontSize: number;
  fontFamily: string;
  reduceMotion: boolean;
}
type AppearanceWindow = Window & { __CLAB_APPEARANCE__?: Appearance };
export function useAppearance() {
  const [appearance, setAppearance] = useState(() =>
    typeof window === "undefined"
      ? undefined
      : (window as AppearanceWindow).__CLAB_APPEARANCE__,
  );
  const [nativeFontSize, setNativeFontSize] = useState(13);
  const enabled = appearance !== undefined;
  useEffect(() => {
    if (!enabled) return;
    const updateFontSize = () =>
      setNativeFontSize(
        parseFloat(
          getComputedStyle(document.body).getPropertyValue(
            "--vscode-font-size",
          ),
        ) || 13,
      );
    updateFontSize();
    const observer = new MutationObserver(updateFontSize);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    return () => observer.disconnect();
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    const listener = (
      event: MessageEvent<{ type?: string; appearance?: Appearance }>,
    ) => {
      if (
        event.data?.type === "containerlab:appearance" &&
        event.data.appearance
      ) {
        (window as AppearanceWindow).__CLAB_APPEARANCE__ =
          event.data.appearance;
        setAppearance(event.data.appearance);
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [enabled]);
  useEffect(() => {
    if (!appearance) return;
    const style = document.createElement("style");
    style.dataset.containerlabAppearance = "true";
    document.head.append(style);
    const sheet = style.sheet;
    if (!sheet) return () => style.remove();
    sheet.insertRule(":root, body {}");
    const declaration = (sheet.cssRules[0] as CSSStyleRule).style;
    if (appearance.colorScheme !== "vscode") {
      // Overrides use the same Modern palettes the standalone apps default to.
      const vars = appearance.colorScheme === "light" ? LIGHT_MODERN_VARS : DARK_MODERN_VARS;
      for (const [key, value] of Object.entries(vars)) {
        if (!key.startsWith("--vscode-font-"))
          declaration.setProperty(key, value, "important");
      }
      for (const [alias, key] of Object.entries(CLAB_UI_VAR_ALIASES)) {
        if (!key.startsWith("--vscode-font-"))
          declaration.setProperty(alias, vars[key], "important");
      }
      declaration.setProperty("color-scheme", appearance.colorScheme);
    }
    declaration.setProperty(
      "--clab-ui-font-family",
      appearance.fontFamily || "var(--vscode-font-family)",
      "important",
    );
    declaration.setProperty(
      "--clab-ui-font-size",
      appearance.fontSize
        ? `${appearance.fontSize}px`
        : "var(--vscode-font-size)",
      "important",
    );
    if (appearance.reduceMotion)
      sheet.insertRule(
        "*, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }",
        sheet.cssRules.length,
      );
    return () => style.remove();
  }, [appearance]);
  return useMemo(() => {
    if (!appearance) return vscodeTheme;
    const typography = createTheme({
      typography: typographyFor(appearance.fontSize || nativeFontSize),
    }).typography;
    return { ...vscodeTheme, typography };
  }, [appearance, nativeFontSize]);
}
