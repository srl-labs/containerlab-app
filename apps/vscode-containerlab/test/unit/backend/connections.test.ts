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
import { addConnection, removeConnection } from "../../../src/commands/connections";

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
      kind: "kubernetes",
      kubeContext: " kind-c9s-app ",
      namespace: "team-a",
      exposeType: "LoadBalancer",
      persistence: false
    });
    expect(cluster).to.deep.include({
      label: "kind-c9s-app",
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
    // Entries of earlier builds keep working.
    expect(
      clusterConnectionFromSetting({ kind: "local", runtime: "c9s", kubeContext: "kind-c9s-app", namespace: "team-a", exposeType: "LoadBalancer", persistence: false })
    ).to.deep.equal(cluster);
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
      ["local", "kind-c9s-app"]
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
      { kind: "kubernetes", kubeContext: "kind-c9s-app", namespace: "team-a" }
    ]);
    expect(cluster.namespace).to.equal("team-a");
    await manager.removeConnection(cluster);
    expect(settings.connections).to.deep.equal([{ url: "https://lab-host:8090" }]);
    manager.dispose();
  });

  describe("Remove and hide", () => {
    const window = vscodeStub.window;
    const saved = { showWarningMessage: window.showWarningMessage, showQuickPick: window.showQuickPick };
    afterEach(() => Object.assign(window, saved));

    function answer(choice: string): string[] {
      const asked: string[] = [];
      window.showWarningMessage = async (message: string, options: any, ...items: string[]) => {
        asked.push(`${message} | ${options?.detail ?? ""}`);
        return items.includes(choice) ? choice : undefined;
      };
      return asked;
    }

    it("removing a cluster from its explorer item removes only the cluster, and keeps This computer", async () => {
      useSettings({
        localConnection: true,
        connections: [{ kind: "kubernetes", kubeContext: "kind-c9s-app" }, { url: "https://lab-host:8090" }]
      });
      const manager = initConnections(fakeContext());
      const cluster = manager.list().find(isClusterConnection);
      expect(cluster).to.not.equal(undefined);
      const asked = answer("Remove");
      await removeConnection({ connectionId: cluster!.id });
      expect(settings.localConnection).to.equal(true);
      expect(settings.connections).to.deep.equal([{ url: "https://lab-host:8090" }]);
      expect(asked[0]).to.match(/^Remove kind-c9s-app\? \| Its labs keep running in the cluster/);
      expect(manager.list().map((connection) => connection.id)).to.include(LOCAL_CONNECTION.id);
      manager.dispose();
    });

    it("hides This computer, and Add Lab Host > This computer brings it back while a cluster is listed", async () => {
      useSettings({ localConnection: true, connections: [{ kind: "kubernetes", kubeContext: "kind-c9s-app" }] });
      const manager = initConnections(fakeContext());
      answer("Hide");
      await removeConnection({ connectionId: LOCAL_CONNECTION.id });
      expect(settings.localConnection).to.equal(false);
      expect(settings.connections).to.deep.equal([{ kind: "kubernetes", kubeContext: "kind-c9s-app" }]);

      let offered: any;
      window.showQuickPick = async (items: any[]) => {
        offered = items.find((item) => item.value === "this-computer");
        return offered;
      };
      expect(await addConnection()).to.equal(LOCAL_CONNECTION);
      expect(offered.unavailable).to.equal(undefined);
      expect(settings.localConnection).to.equal(true);
      manager.dispose();
    });
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
    await manager.addClusterConnection({
      kubeContext: "kind",
      kubeconfig: "/k/a.yaml",
      label: "A"
    });
    // Adding the same file again replaces its entry where it is.
    expect(settings.connections).to.deep.equal([
      { kind: "local", runtime: "c9s", kubeContext: "kind" },
      { kind: "kubernetes", label: "A", kubeContext: "kind", kubeconfig: "/k/a.yaml" },
      { kind: "kubernetes", kubeContext: "kind", kubeconfig: "/k/b.yaml" }
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

    it("asks where labs should run; a cluster opens the cluster form", async () => {
      useSettings({ connections: [] });
      initConnections(fakeContext());
      const executed: unknown[][] = [];
      const commands = vscodeStub.commands as { executeCommand: (...args: unknown[]) => Promise<unknown> };
      const originalExecute = commands.executeCommand;
      commands.executeCommand = async (...args: unknown[]) => {
        executed.push(args);
        return undefined;
      };
      let labels: string[] = [];
      window.showQuickPick = async (items: any[]) => {
        labels = items.map((item) => item.label);
        return items.find((item) => item.value === "cluster");
      };
      try {
        expect(await addConnection()).to.equal(undefined);
      } finally {
        commands.executeCommand = originalExecute;
      }
      expect(labels).to.deep.equal([
        "$(device-desktop) This computer",
        "$(server-environment) Kubernetes cluster",
        "$(cloud) Lab server"
      ]);
      expect(executed).to.deep.include(["containerlab.settings.open", "labHosts", "cluster"]);
    });

    it("saves the cluster form as a kubernetes entry with its file and defaults, edited in place", async () => {
      useSettings({ connections: [{ url: "https://lab-host:8090" }] });
      const manager = initConnections(fakeContext());
      const cluster = await manager.saveClusterConnection({
        kubeContext: "kind-c9s-app",
        kubeconfig: path.join(dir, "other"),
        exposeType: "LoadBalancer",
        persistence: false,
        imagePullSecret: "regcred"
      });
      expect(cluster).to.deep.include({ kubeContext: "kind-c9s-app", imagePullSecret: "regcred", persistence: false });
      useSettings({ connections: [...(settings.connections as unknown[]), { url: "https://other:8090" }] });
      const edited = await manager.saveClusterConnection(
        { kubeContext: "second", kubeconfig: path.join(dir, "other"), namespace: "team-a", label: "Lab" },
        cluster
      );
      expect(settings.connections).to.deep.equal([
        { url: "https://lab-host:8090" },
        { kind: "kubernetes", label: "Lab", kubeContext: "second", kubeconfig: path.join(dir, "other"), namespace: "team-a" },
        { url: "https://other:8090" }
      ]);
      await manager.removeConnection(edited);
      expect(settings.connections).to.deep.equal([{ url: "https://lab-host:8090" }, { url: "https://other:8090" }]);
    });
  });
});
