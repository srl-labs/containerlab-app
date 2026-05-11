import assert from "node:assert/strict";
import test from "node:test";

import {
  parseStandaloneTheme,
  readPersistedStandaloneTheme,
  resolveStandaloneTheme
} from "./standaloneTheme";

function withGlobalProperty<T>(name: "document" | "localStorage", value: unknown, run: () => T): T {
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
