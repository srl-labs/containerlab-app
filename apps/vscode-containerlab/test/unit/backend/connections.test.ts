/* global describe, it, before, after, afterEach */
/**
 * Lab host settings: `containerlab.connections` entries for clab-api-servers
 * and for Kubernetes clusters (`kind: "local", runtime: "c9s"`).
 */
import { createHash } from "crypto";
import fs from "fs";
import Module from "module";
import os from "os";
import path from "path";

import { expect } from "chai";

const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  parent: any,
  isMain: boolean,
  options: any
) {
  if (request === "vscode") {
    return path.join(__dirname, "..", "..", "helpers", "vscode-stub.js");
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

import {
  clusterConnectionFromSetting,
  ConnectionManager,
  isClusterConnection,
  LOCAL_CONNECTION
} from "../../../src/backend/connections";
import {
  clusterBackendOptions,
  connectionDescription,
  initConnections
} from "../../../src/backend/labBackends";
import { addConnection } from "../../../src/commands/connections";

const vscodeStub = require("../../helpers/vscode-stub");

function fakeContext() {
  const state = new Map<string, unknown>();
  return {
    globalState: {
      get: (key: string, fallback?: unknown) => (state.has(key) ? state.get(key) : fallback),
      update: async (key: string, value: unknown) => void state.set(key, value)
    },
    secrets: { get: async () => undefined, store: async () => {}, delete: async () => {} }
  } as any;
}

describe("lab host settings", () => {
  const originalGetConfiguration = vscodeStub.workspace.getConfiguration;
  let settings: Record<string, unknown> = {};

  before(() => {
    vscodeStub.workspace.onDidChangeConfiguration ??= () => ({ dispose() {} });
    vscodeStub.ConfigurationTarget ??= { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
  });

  afterEach(() => {
    vscodeStub.workspace.getConfiguration = originalGetConfiguration;
  });

  after(() => {
    (Module as any)._resolveFilename = originalResolve;
  });

  function useSettings(values: Record<string, unknown>) {
    settings = values;
    vscodeStub.workspace.getConfiguration = () => ({
      get: <T>(key: string, fallback?: T): T | undefined =>
        (key in settings ? settings[key] : fallback) as T | undefined,
      update: async (key: string, value: unknown) => {
        settings[key] = value;
      }
    });
  }

  it("reads a cluster entry as a local connection with runtime c9s", () => {
    const cluster = clusterConnectionFromSetting({
      kind: "local",
      runtime: "c9s",
      kubeContext: " kind-c9s-app ",
      namespace: "team-a",
      exposeType: "LoadBalancer",
      persistence: false
    });
    expect(cluster).to.deep.include({
      label: "Cluster kind-c9s-app (c9s)",
      kind: "local",
      runtime: "c9s",
      kubeContext: "kind-c9s-app",
      namespace: "team-a",
      exposeType: "LoadBalancer",
      persistence: false
    });
    expect(cluster?.id).to.match(/^c9s-[0-9a-f]{12}$/);
    expect(isClusterConnection(cluster!)).to.equal(true);
    expect(isClusterConnection(LOCAL_CONNECTION)).to.equal(false);
  });

  it("ignores cluster entries without a context, and unknown expose types", () => {
    expect(clusterConnectionFromSetting({ kind: "local", runtime: "c9s" })).to.equal(undefined);
    expect(clusterConnectionFromSetting({ url: "https://lab:8090" })).to.equal(undefined);
    const cluster = clusterConnectionFromSetting({
      kind: "local",
      runtime: "c9s",
      kubeContext: "prod",
      exposeType: "NodePort",
      label: "Prod"
    });
    expect(cluster?.label).to.equal("Prod");
    expect(cluster?.exposeType).to.equal(undefined);
  });

  it("lists Local, clusters and clab-api-servers side by side", () => {
    useSettings({
      connections: [
        { url: "https://lab-host:8090", label: "Lab host" },
        { kind: "local", runtime: "c9s", kubeContext: "kind-c9s-app" },
        { kind: "local", runtime: "c9s", kubeContext: "kind-c9s-app", label: "duplicate" },
        { kind: "local", runtime: "c9s" }
      ]
    });
    const manager = new ConnectionManager(fakeContext());
    const list = manager.list();
    expect(list.map((connection) => [connection.kind, connection.label])).to.deep.equal([
      ["local", "Local"],
      ["api", "Lab host"],
      ["local", "Cluster kind-c9s-app (c9s)"]
    ]);
    expect(manager.status(list[2])).to.equal("connected");
    expect(manager.grouped).to.equal(true);
    manager.dispose();
  });

  it("adds and removes a cluster in the settings", async () => {
    useSettings({ connections: [{ url: "https://lab-host:8090" }] });
    const manager = new ConnectionManager(fakeContext());
    const cluster = await manager.addClusterConnection({
      kubeContext: "kind-c9s-app",
      namespace: "team-a"
    });
    expect(settings.connections).to.deep.equal([
      { url: "https://lab-host:8090" },
      { kind: "local", runtime: "c9s", kubeContext: "kind-c9s-app", namespace: "team-a" }
    ]);
    expect(cluster.namespace).to.equal("team-a");
    await manager.removeConnection(cluster);
    expect(settings.connections).to.deep.equal([{ url: "https://lab-host:8090" }]);
    manager.dispose();
  });

  it("describes where a connection's labs run", () => {
    const cluster = clusterConnectionFromSetting({
      kind: "local",
      runtime: "c9s",
      kubeContext: "prod",
      namespace: "labs"
    })!;
    expect(connectionDescription(cluster)).to.equal("Kubernetes · prod/labs");
    expect(connectionDescription(LOCAL_CONNECTION)).to.equal("this machine");
    expect(
      connectionDescription({ id: "a", label: "a", kind: "api", url: "https://h:8090" })
    ).to.equal("https://h:8090");
  });

  it("keeps the id of a cluster without a kubeconfig, and tells files with the same context apart", () => {
    const plain = clusterConnectionFromSetting({
      kind: "local",
      runtime: "c9s",
      kubeContext: "kind"
    })!;
    // The id existing entries were saved under.
    expect(plain.id).to.equal(
      `c9s-${createHash("sha256").update("kind").digest("hex").slice(0, 12)}`
    );
    expect(plain.kubeconfig).to.equal(undefined);
    const fromHome = clusterConnectionFromSetting({
      kind: "local",
      runtime: "c9s",
      kubeContext: "kind",
      kubeconfig: "~/kube/a.yaml"
    })!;
    expect(fromHome.kubeconfig).to.equal(path.join(os.homedir(), "kube/a.yaml"));
    const absolute = clusterConnectionFromSetting({
      kind: "local",
      runtime: "c9s",
      kubeContext: "kind",
      kubeconfig: path.join(os.homedir(), "kube/a.yaml")
    })!;
    const other = clusterConnectionFromSetting({
      kind: "local",
      runtime: "c9s",
      kubeContext: "kind",
      kubeconfig: "/k/b.yaml"
    })!;
    expect(fromHome.id).to.equal(absolute.id);
    expect(new Set([plain.id, fromHome.id, other.id]).size).to.equal(3);
    expect(connectionDescription(other)).to.equal("Kubernetes · kind · b.yaml");
    expect(clusterBackendOptions(other).c9s).to.deep.equal({
      kubeContext: "kind",
      kubeconfig: "/k/b.yaml"
    });
    expect(clusterBackendOptions(plain).c9s).to.deep.equal({ kubeContext: "kind" });
  });

  it("adds and removes clusters of two kubeconfig files with the same context", async () => {
    useSettings({ connections: [{ kind: "local", runtime: "c9s", kubeContext: "kind" }] });
    const manager = new ConnectionManager(fakeContext());
    const a = await manager.addClusterConnection({ kubeContext: "kind", kubeconfig: "/k/a.yaml" });
    const b = await manager.addClusterConnection({ kubeContext: "kind", kubeconfig: "/k/b.yaml" });
    // Adding the same file again replaces its entry.
    await manager.addClusterConnection({
      kubeContext: "kind",
      kubeconfig: "/k/a.yaml",
      label: "A"
    });
    expect(settings.connections).to.deep.equal([
      { kind: "local", runtime: "c9s", kubeContext: "kind" },
      { kind: "local", runtime: "c9s", kubeContext: "kind", kubeconfig: "/k/b.yaml" },
      { kind: "local", runtime: "c9s", kubeContext: "kind", kubeconfig: "/k/a.yaml", label: "A" }
    ]);
    expect(manager.list().filter(isClusterConnection)).to.have.length(3);
    await manager.removeConnection(b);
    await manager.removeConnection(a);
    expect(settings.connections).to.deep.equal([
      { kind: "local", runtime: "c9s", kubeContext: "kind" }
    ]);
    manager.dispose();
  });

  it("leaves clusters out where containerlab does not run", async () => {
    useSettings({
      connections: [
        { url: "https://lab-host:8090" },
        { kind: "local", runtime: "c9s", kubeContext: "kind" },
        { kind: "local", runtime: "c9s", kubeContext: "prod" }
      ]
    });
    const manager = new ConnectionManager(fakeContext(), { localSupported: false });
    expect(manager.list().map((connection) => connection.kind)).to.deep.equal(["api"]);
    expect(manager.ignoredClusters()).to.equal(
      "2 Kubernetes cluster lab hosts are left out: containerlab runs on Linux only. Use a clab-api-server lab host, or run the app in WSL or a Linux VM."
    );
    let error: unknown;
    await manager.addClusterConnection({ kubeContext: "kind" }).catch((caught: unknown) => {
      error = caught;
    });
    expect(String(error)).to.match(/containerlab runs on Linux only/);
    expect(new ConnectionManager(fakeContext()).ignoredClusters()).to.equal(undefined);
    manager.dispose();
  });

  describe("Add Lab Host", () => {
    const window = vscodeStub.window;
    const saved = {
      showQuickPick: window.showQuickPick,
      showOpenDialog: window.showOpenDialog,
      showInputBox: window.showInputBox
    };
    const originalKubeconfig = process.env.KUBECONFIG;
    let dir: string;

    before(() => {
      vscodeStub.QuickPickItemKind ??= { Separator: -1, Default: 0 };
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "vscode-c9s-kubeconfig-"));
      const kubeconfig = (contexts: string[]) =>
        [
          "apiVersion: v1",
          "kind: Config",
          `current-context: ${contexts[0]}`,
          "clusters:",
          "  - name: c",
          "    cluster: { server: https://127.0.0.1:6443 }",
          "users:",
          "  - name: u",
          "    user: { token: t }",
          "contexts:",
          ...contexts.map((name) => `  - name: ${name}\n    context: { cluster: c, user: u }`),
          ""
        ].join("\n");
      fs.writeFileSync(path.join(dir, "default"), kubeconfig(["default-ctx"]));
      fs.writeFileSync(path.join(dir, "other"), kubeconfig(["kind-c9s-app", "second"]));
      process.env.KUBECONFIG = path.join(dir, "default");
    });

    after(() => {
      Object.assign(window, saved);
      if (originalKubeconfig === undefined) delete process.env.KUBECONFIG;
      else process.env.KUBECONFIG = originalKubeconfig;
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("offers the default kubeconfig's contexts and a kubeconfig file, and keeps the file", async () => {
      useSettings({ connections: [] });
      const manager = initConnections(fakeContext());
      const pickedLists: string[][] = [];
      window.showQuickPick = async (items: any[]) => {
        pickedLists.push(items.map((item) => item.label));
        if (pickedLists.length === 1) return items.find((item) => item.value === "c9s");
        if (pickedLists.length === 2) return items.find((item) => item.chooseFile);
        return items.find((item) => item.label === "kind-c9s-app");
      };
      window.showOpenDialog = async () => [{ fsPath: path.join(dir, "other") }];
      window.showInputBox = async () => "";
      const connection = await addConnection();
      expect(pickedLists[1]).to.deep.equal([
        "default-ctx",
        "",
        "$(folder-opened) Choose kubeconfig file…"
      ]);
      expect(pickedLists[2]).to.deep.equal(["kind-c9s-app", "second"]);
      expect(connection).to.deep.include({
        kubeContext: "kind-c9s-app",
        kubeconfig: path.join(dir, "other")
      });
      expect(settings.connections).to.deep.equal([
        {
          kind: "local",
          runtime: "c9s",
          kubeContext: "kind-c9s-app",
          kubeconfig: path.join(dir, "other")
        }
      ]);
      await manager.removeConnection(connection!);
    });

    it("stores no file for a context of the default kubeconfig", async () => {
      useSettings({ connections: [] });
      let step = 0;
      window.showQuickPick = async (items: any[]) => {
        step++;
        return step === 1
          ? items.find((item) => item.value === "c9s")
          : items.find((item) => item.label === "default-ctx");
      };
      window.showInputBox = async () => "team-a";
      await addConnection();
      expect(settings.connections).to.deep.equal([
        { kind: "local", runtime: "c9s", kubeContext: "default-ctx", namespace: "team-a" }
      ]);
    });
  });
});
