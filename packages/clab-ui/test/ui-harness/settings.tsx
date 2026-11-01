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
import type { LabHostSettingRows } from "../../src/host/labHostSettings";
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
      label: "This computer",
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
// ?hosts=all adds a Kubernetes lab host and a c9s API Server, as in a full setup.
if (new URLSearchParams(location.search).get("hosts") === "all") {
  labHosts.hosts.push(
    {
      id: "c9s-kind",
      kind: "local",
      runtime: "c9s",
      url: "local://c9s/kind-c9s-app",
      label: "kind-c9s-app",
      kubeContext: "kind-c9s-app",
      kubeconfig: "~/.kube/config",
      username: "alice",
      sessionDuration: "",
      status: "connected",
      connected: true,
      editable: true,
    },
    {
      id: "api-c9s",
      kind: "api",
      runtime: "c9s",
      url: "http://localhost:18190",
      label: "localhost:18190",
      username: "c9sdemo",
      sessionDuration: "24h",
      status: "connected",
      connected: true,
      cluster: "c9s-provisioner",
      namespacePattern: "c9s-c9sdemo-{lab}",
      exposeType: "None",
      persistence: true,
      defaultTimeout: "10m",
      noTopologyCR: false,
      capture: {
        wiresharkVnc: true,
        wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:latest",
        wiresharkPullPolicy: "always",
      },
    },
    {
      id: "api-docker",
      kind: "api",
      runtime: "docker",
      url: "https://lab2.example.com:8090",
      label: "lab2",
      username: "alice",
      sessionDuration: "24h",
      status: "connected",
      connected: true,
      defaultTimeout: "5m",
      capture: {
        wiresharkVnc: true,
        wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:latest",
        wiresharkPullPolicy: "missing",
        packetflixPort: 5001,
        edgesharkEnv: ["HTTP_PROXY", "NO_PROXY"],
      },
    },
  );
}
/** Each lab host's own settings, as the extension keeps them; This computer's are under "local". */
const hostValues: Record<string, Record<string, unknown>> = { local: { runtime: "docker" } };
const HOST_DEFAULTS: Record<"this-computer" | "cluster" | "server", Record<string, string>> = {
  "this-computer": {
    runtime: "Docker",
    socket: "/var/run/docker.sock",
    binaryPath: "containerlab on PATH",
    timeout: "2m (containerlab default)",
    deployArgs: "None",
    destroyArgs: "None",
    captureMethod: "Automatic",
    wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:latest",
    wiresharkPullPolicy: "always",
    vncHostname: "localhost",
    captureHostname: "Found automatically",
    packetflixPort: "5001",
    edgesharkEnv: "HTTP_PROXY=, http_proxy=",
  },
  cluster: {
    timeout: "10m (containerlab default)",
    exposeType: "clabernetes default",
    persistence: "On",
    imagePullSecret: "None",
    noTopologyCR: "Off",
    deployArgs: "None",
    destroyArgs: "None",
    captureMethod: "Automatic",
    wiresharkImage: "ghcr.io/srl-labs/wireshark-vnc-docker:latest",
  },
  server: { captureMethod: "Automatic" },
};
function hostSettings(): Record<string, LabHostSettingRows> {
  const result: Record<string, LabHostSettingRows> = {};
  for (const host of [{ id: "local", kind: "local" as const }, ...labHosts.hosts]) {
    let kind: keyof typeof HOST_DEFAULTS = host.kind === "api" ? "server" : "cluster";
    if (host.id === "local") kind = "this-computer";
    const values = hostValues[host.id] ?? {};
    const rows: LabHostSettingRows = {};
    for (const [id, defaultLabel] of Object.entries(HOST_DEFAULTS[kind])) {
      const value = values[id] as string | number | boolean | undefined;
      rows[id as keyof LabHostSettingRows] = { ...(value !== undefined ? { value } : {}), defaultLabel };
    }
    if (kind === "cluster") rows.binaryPath = { shown: "containerlab on PATH" };
    result[host.id] = rows;
  }
  return result;
}
function labHost(id: unknown): EndpointConfig {
  const host = labHosts.hosts.find((entry) => entry.id === id);
  if (!host) throw new Error(`No lab host ${String(id)}`);
  return host;
}
/** A Kubernetes lab host's deploy defaults from its form: fields of its entry, as its page shows them. */
function keepClusterDeployDefaults(id: string, settings: Record<string, unknown>) {
  const values = (hostValues[id] ??= {});
  const deployDefaults: Record<string, unknown> = {
    timeout: settings.deployTimeout,
    exposeType: settings.exposeType,
    imagePullSecret: settings.imagePullSecret,
    noTopologyCR: settings.noTopologyCR,
    persistence: settings.persistence === false ? false : undefined,
  };
  for (const [setting, value] of Object.entries(deployDefaults)) {
    if (value !== undefined) values[setting] = value;
  }
}
/** What the extension does for the lab host pages; passwords "wrong" fail. */
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
        label: "This computer",
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
      keepClusterDeployDefaults(id, settings);
      break;
    }
    case "labHosts.setting": {
      const id = String(payload.endpointId);
      const values = (hostValues[id] ??= {});
      if (payload.reset === true) delete values[String(payload.setting)];
      else values[String(payload.setting)] = payload.value;
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
      settings: hostSettings(),
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
