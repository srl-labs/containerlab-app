import React from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "../../src/settings/SettingsApp";
import {
  createSettingsCatalog,
  type SettingsSnapshot,
  type SettingsTarget,
  type SettingSchema,
  type SettingsChange,
  validateSettingsChange,
} from "../../src/settings/schema";
import { MuiThemeProvider } from "../../src/theme/MuiThemeProvider";
import { applyThemeVars } from "../../src/theme/devTheme";
import manifest from "../../../../apps/vscode-containerlab/package.json";

applyThemeVars(
  new URLSearchParams(location.search).get("theme") === "light"
    ? "light"
    : "dark",
);
const appearance = {
  colorScheme: "vscode",
  fontSize: 0,
  fontFamily: "",
  reduceMotion: false,
};
Object.assign(window, { __CLAB_APPEARANCE__: appearance });
const definitions = createSettingsCatalog(
  manifest.contributes.configuration as Array<{
    properties: Record<string, SettingSchema>;
  }>,
);
const saved: Record<SettingsTarget, Record<string, unknown>> = {
  user: {},
  workspace: {},
};
let target: SettingsTarget = "user";
const subscribers = new Set<(snapshot: SettingsSnapshot) => void>();
function snapshot(): SettingsSnapshot {
  return {
    definitions,
    target,
    workspaceAvailable: true,
    workspaceName: "network-labs",
    remoteName: "ssh-remote",
    version: manifest.version,
    vscodeVersion: "1.105.1",
    values: Object.fromEntries(
      definitions.map((definition) => [
        definition.key,
        {
          value:
            saved[target][definition.key] ??
            (target === "workspace" ? saved.user[definition.key] : undefined) ??
            definition.default,
          effectiveValue:
            saved.workspace[definition.key] ??
            saved.user[definition.key] ??
            definition.default,
          overridden: definition.key in saved[target],
          scopeValue: saved[target][definition.key],
          workspaceOverride:
            target === "user" && definition.key in saved.workspace,
        },
      ]),
    ),
  };
}
function emit() {
  for (const subscriber of subscribers) subscriber(snapshot());
}
Object.assign(window, {
  settingsHarness: {
    saved,
    external: (key: string, value: unknown) => {
      saved[target][key] = value;
      emit();
    },
    failNext: false,
  },
});
async function request(
  payload: Record<string, unknown>,
): Promise<SettingsSnapshot> {
  await new Promise((resolve) => setTimeout(resolve, 15));
  if (
    (window as unknown as { settingsHarness: { failNext: boolean } })
      .settingsHarness.failNext
  ) {
    (
      window as unknown as { settingsHarness: { failNext: boolean } }
    ).settingsHarness.failNext = false;
    throw new Error("Could not write settings. Check file permissions.");
  }
  if (payload.action === "read") target = payload.target as SettingsTarget;
  if (payload.action === "change") {
    const change = payload.change as SettingsChange;
    const definition = definitions.find((entry) => entry.key === change.key)!;
    if (!change.reset) {
      const error = validateSettingsChange(definition, change.value);
      if (error) throw new Error(error);
      saved[change.target][change.key] = change.value;
    } else delete saved[change.target][change.key];
    const nextAppearance = Object.fromEntries(
      Object.entries(appearance).map(([key, fallback]) => [
        key,
        saved.workspace[`containerlab.appearance.${key}`] ??
          saved.user[`containerlab.appearance.${key}`] ??
          fallback,
      ]),
    );
    window.postMessage(
      { type: "containerlab:appearance", appearance: nextAppearance },
      "*",
    );
    emit();
  }
  return snapshot();
}
function subscribe(listener: (snapshot: SettingsSnapshot) => void) {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
createRoot(document.getElementById("root")!).render(
  <MuiThemeProvider>
    <SettingsApp initial={snapshot()} request={request} subscribe={subscribe} />
  </MuiThemeProvider>,
);
