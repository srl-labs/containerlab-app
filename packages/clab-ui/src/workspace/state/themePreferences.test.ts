import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStandaloneTheme,
  parseStandaloneThemeMode,
  parseTabOrientation,
  readPersistedStandaloneTheme,
  appearanceTheme,
  readStandaloneAppearance,
  resolveStandaloneTheme
} from "./themePreferences";

function withGlobalProperty<T>(
  name: "document" | "localStorage" | "window",
  value: unknown,
  run: () => T
): T {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value
  });
  try {
    return run();
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      delete (globalThis as Record<string, unknown>)[name];
    }
  }
}

test("parseStandaloneTheme accepts light and dark", () => {
  assert.equal(parseStandaloneTheme("light"), "light");
  assert.equal(parseStandaloneTheme("dark"), "dark");
});

test("parseTabOrientation accepts horizontal and vertical", () => {
  assert.equal(parseTabOrientation("horizontal"), "horizontal");
  assert.equal(parseTabOrientation("vertical"), "vertical");
  assert.equal(parseTabOrientation("side"), undefined);
});

test("readPersistedStandaloneTheme returns undefined for invalid persisted values", () => {
  withGlobalProperty(
    "localStorage",
    {
      getItem: () => "invalid"
    },
    () => {
      assert.equal(readPersistedStandaloneTheme(), undefined);
    }
  );
});

test("resolveStandaloneTheme prefers persisted value over document class", () => {
  withGlobalProperty(
    "localStorage",
    {
      getItem: () => "dark"
    },
    () => {
      withGlobalProperty(
        "document",
        {
          documentElement: {
            classList: {
              contains: () => true
            }
          }
        },
        () => {
          assert.equal(resolveStandaloneTheme(), "dark");
        }
      );
    }
  );
});

test("resolveStandaloneTheme falls back to document light class when nothing persisted", () => {
  withGlobalProperty(
    "localStorage",
    {
      getItem: () => null
    },
    () => {
      withGlobalProperty(
        "document",
        {
          documentElement: {
            classList: {
              contains: (className: string) => className === "light"
            }
          }
        },
        () => {
          assert.equal(resolveStandaloneTheme(), "light");
        }
      );
    }
  );
});

test("parseStandaloneThemeMode accepts system alongside light and dark", () => {
  assert.equal(parseStandaloneThemeMode("system"), "system");
  assert.equal(parseStandaloneThemeMode("light"), "light");
  assert.equal(parseStandaloneThemeMode("auto"), undefined);
});

test("readPersistedStandaloneTheme resolves system to the current OS scheme", () => {
  withGlobalProperty("localStorage", { getItem: () => "system" }, () => {
    withGlobalProperty("window", { matchMedia: () => ({ matches: true }) }, () => {
      assert.equal(readPersistedStandaloneTheme(), "light");
    });
    withGlobalProperty("window", { matchMedia: () => ({ matches: false }) }, () => {
      assert.equal(readPersistedStandaloneTheme(), "dark");
    });
  });
});

test("readStandaloneAppearance defaults to the VS Code Modern themes", () => {
  withGlobalProperty("localStorage", { getItem: () => null }, () => {
    const appearance = readStandaloneAppearance();
    assert.equal(appearance.lightTheme, "light-modern");
    assert.equal(appearance.darkTheme, "dark-modern");
    assert.deepEqual(appearance.customThemes, []);
  });
});

test("readStandaloneAppearance keeps saved custom themes and drops mismatched selections", () => {
  const stored: Record<string, string> = {
    "clab-standalone-theme": "system",
    "clab-standalone-light-theme": "custom-ocean",
    "clab-standalone-dark-theme": "custom-ocean",
    "clab-standalone-custom-themes": JSON.stringify([
      {
        id: "custom-ocean",
        name: "Ocean",
        mode: "dark",
        base: "nord",
        colors: { background: "#102030", accent: "teal" },
        tokens: { "editor.foreground": "#eeeeee", "not.a.token": "#ffffff" }
      },
      { id: "dracula", name: "Shadows a built-in" },
      "broken"
    ])
  };
  withGlobalProperty("localStorage", { getItem: (key: string) => stored[key] ?? null }, () => {
    const appearance = readStandaloneAppearance();
    assert.equal(appearance.mode, "system");
    assert.equal(appearance.lightTheme, "light-modern");
    assert.equal(appearance.darkTheme, "custom-ocean");
    assert.deepEqual(appearance.customThemes, [
      {
        id: "custom-ocean",
        name: "Ocean",
        mode: "dark",
        base: "nord",
        colors: { background: "#102030" },
        tokens: { "editor.foreground": "#eeeeee" }
      }
    ]);
    assert.equal(appearanceTheme(appearance, "dark").vars["--vscode-editor-background"], "#102030");
  });
});
