import React from "react";
import { createRoot } from "react-dom/client";
import { SettingsApp } from "../../src/settings/SettingsApp";
import {
  createSettingsCatalog,
  type SettingsSnapshot,
  type SettingsTarget,
  type SettingSchema,
  type SettingsChange,
  type LabHostsSnapshot,
  validateSettingsChange,
} from "../../src/settings/schema";
import { MuiThemeProvider } from "../../src/theme/MuiThemeProvider";
import type { EndpointConfig } from "../../src/workspace/types";
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
// The JSON import types keys missing from a group as optional `undefined`.
const configuration: Array<{
  properties: Partial<Record<string, SettingSchema>>;
}> = manifest.contributes.configuration;
const definitions = createSettingsCatalog(
  configuration.map((group) => ({
    properties: Object.fromEntries(
      Object.entries(group.properties).filter(
        (entry): entry is [string, SettingSchema] => entry[1] !== undefined,
      ),
    ),
  })),
);
const saved: Record<SettingsTarget, Record<string, unknown>> = {
  user: {},
  workspace: {},
};
let target: SettingsTarget = "user";
/** Local and one lab host, managed by the fake extension below. */
const labHosts: { hosts: EndpointConfig[]; local: NonNullable<LabHostsSnapshot["local"]> } = {
  hosts: [
    {
      id: "local",
      kind: "local",
      url: "",
      label: "Local",
      username: "alice",
      sessionDuration: "",
      status: "connected",
      connected: true,
    },
    {
      id: "api-lab1",
      kind: "api",
      url: "https://lab1.example.com:8090",
      label: "lab1",
      username: "alice",
      sessionDuration: "24h",
      status: "saved",
      connected: false,
    },
  ],
  local: { shown: true, available: true, problems: [], containerlabVersion: "0.78.0" },
};
function labHost(id: unknown): EndpointConfig {
  const host = labHosts.hosts.find((entry) => entry.id === id);
  if (!host) throw new Error(`No lab host ${String(id)}`);
  return host;
}
/** What the extension does for the Lab Hosts page; passwords "wrong" fail. */
function labHostAction(payload: Record<string, unknown>): unknown {
  switch (payload.action) {
    case "labHosts.add": {
      if (payload.password === "wrong") throw new Error("Invalid credentials");
      const url = String(payload.url);
      labHosts.hosts.push({
        id: `api-${labHosts.hosts.length}`,
        kind: "api",
        url,
        label: String(payload.label ?? "") || new URL(url).host,
        username: String(payload.username),
        sessionDuration: String(payload.sessionDuration ?? "24h"),
        status: "connected",
        connected: true,
      });
      break;
    }
    case "labHosts.signIn": {
      if (payload.password === "wrong") throw new Error("Invalid credentials");
      Object.assign(labHost(payload.endpointId), { status: "connected", connected: true });
      break;
    }
    case "labHosts.signOut":
      Object.assign(labHost(payload.endpointId), { status: "saved", connected: false });
      break;
    case "labHosts.update":
      Object.assign(
        labHost(payload.endpointId),
        Object.fromEntries(
          ["label", "url", "username", "sessionDuration"]
            .filter((key) => payload[key] !== undefined)
            .map((key) => [key, payload[key]]),
        ),
      );
      break;
    case "labHosts.remove":
      if (payload.endpointId === "local") labHosts.local.shown = false;
      labHosts.hosts = labHosts.hosts.filter((entry) => entry.id !== payload.endpointId);
      break;
    case "labHosts.showLocal":
      labHosts.local.shown = true;
      labHosts.hosts.unshift({
        id: "local",
        kind: "local",
        url: "",
        label: "Local",
        username: "alice",
        sessionDuration: "",
        status: "connected",
        connected: true,
      });
      break;
    case "labHosts.cluster.contexts":
      // Two contexts in the default kubeconfig; a chosen file has one.
      if (payload.kubeconfig === "/home/alice/.kube/lab.yaml") {
        return { kubeconfig: payload.kubeconfig, contexts: [{ name: "lab-prod", cluster: "prod", current: true }] };
      }
      if (payload.kubeconfig !== undefined) {
        return { kubeconfig: payload.kubeconfig, contexts: [], error: `No kubeconfig found (looked at ${String(payload.kubeconfig)}).` };
      }
      return {
        kubeconfig: "/home/alice/.kube/config",
        contexts: [
          { name: "kind-c9s-app", cluster: "kind-c9s-app", current: true },
          { name: "team-cluster", cluster: "team", namespace: "team-a", current: false },
        ],
      };
    case "labHosts.cluster.chooseKubeconfig":
      return { path: "/home/alice/.kube/lab.yaml" };
    case "labHosts.cluster.check":
    case "labHosts.check": {
      // The namespace "team-a" lacks pods/exec; anything else is ready.
      const settings = (payload.settings ?? labHost(payload.endpointId)) as { namespace?: string };
      const denied = settings.namespace === "team-a";
      return [
        { id: "containerlab", label: "containerlab 0.83.0 or newer", status: "ok", message: "containerlab 0.83.0" },
        { id: "kubeconfig", label: "kubeconfig loads and has the context", status: "ok", message: "Context kind-c9s-app" },
        { id: "cluster", label: "The cluster answers", status: "ok", message: "Kubernetes v1.33.1" },
        { id: "clabernetes", label: "clabernetes 0.11.0 or newer", status: "ok", message: "clabernetes 0.11.0" },
        denied
          ? {
              id: "access:pods/exec",
              label: "May create pods/exec in namespace team-a",
              status: "failed",
              message: "alice cannot create pods/exec in namespace team-a.",
              fix: "A cluster admin binds clabernetes-lab-editor to you in team-a:",
              command: "kubectl create rolebinding clab-lab-editor-alice --clusterrole clabernetes-lab-editor --user alice -n team-a",
            }
          : { id: "access:pods/exec", label: "May create pods/exec in lab namespaces", status: "ok" },
      ];
    }
    case "labHosts.cluster.save": {
      const settings = payload.settings as Record<string, unknown>;
      const id = typeof payload.endpointId === "string" ? payload.endpointId : `c9s-${labHosts.hosts.length}`;
      const host: EndpointConfig = {
        id,
        kind: "local",
        runtime: "c9s",
        url: `local://c9s/${String(settings.kubeContext)}`,
        label: typeof settings.label === "string" ? settings.label : String(settings.kubeContext),
        username: "alice",
        sessionDuration: "",
        status: "connected",
        connected: true,
        editable: true,
        ...settings,
      };
      labHosts.hosts = [...labHosts.hosts.filter((entry) => entry.id !== id), host];
      break;
    }
    case "labHosts.metrics":
      return {
        serverInfo: { version: "0.2.1", uptime: "3h", startTime: "" },
        metrics: {
          cpu: { usagePercent: 12.5, numCPU: 8 },
          mem: { totalMem: 32e9, usedMem: 8e9, availableMem: 24e9, usagePercent: 25 },
          disk: { path: "/", totalDisk: 5e11, usedDisk: 2e11, freeDisk: 3e11, usagePercent: 40 },
        },
      };
    default:
      break;
  }
  return snapshot();
}
const subscribers = new Set<(snapshot: SettingsSnapshot) => void>();
// The page to open on (?category=labHosts), only for the first snapshot.
let initialCategory = new URLSearchParams(location.search).get("category") ?? undefined;
function takeInitialCategory(): string | undefined {
  const category = initialCategory;
  initialCategory = undefined;
  return category;
}
function snapshot(): SettingsSnapshot {
  return {
    definitions,
    target,
    workspaceAvailable: true,
    workspaceName: "network-labs",
    labHosts: {
      hosts: labHosts.hosts.map((host) => ({ ...host })),
      local: { ...labHosts.local },
      clusters: { defaultKubeconfig: "/home/alice/.kube/config" },
    },
    category: takeInitialCategory(),
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
  if (String(payload.action).startsWith("labHosts.")) {
    const result = labHostAction(payload);
    // Reading health stats changes nothing, so it sends no new snapshot.
    if (payload.action !== "labHosts.metrics") emit();
    return result as SettingsSnapshot;
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
