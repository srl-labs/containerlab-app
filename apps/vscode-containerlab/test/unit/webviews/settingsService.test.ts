/* global describe, it, before, after, beforeEach */
import assert from "node:assert/strict";
import Module from "node:module";
import fs from "node:fs";
import type * as vscode from "vscode";
import type { SettingsService as Service } from "../../../src/webviews/settings/settingsService";
import type { SettingSchema, SettingsTarget } from "@containerlab/clab-ui/settings/schema";

describe("SettingsService", () => {
  const manifest = JSON.parse(fs.readFileSync("package.json", "utf8")) as {
    contributes: { configuration: Array<{ properties: Record<string, SettingSchema> }> };
  };
  const defaults = Object.assign(
    {},
    ...manifest.contributes.configuration.map((group) =>
      Object.fromEntries(
        Object.entries(group.properties).map(([key, value]) => [key, value.default])
      )
    )
  ) as Record<string, unknown>;
  const values: Record<SettingsTarget, Record<string, unknown>> = { user: {}, workspace: {} };
  const moduleInternals = Module as unknown as {
    _load: (request: string, parent: unknown, isMain: boolean) => unknown;
  };
  const originalLoad = moduleInternals._load;
  let ServiceConstructor: typeof Service;
  let service: Service;
  let workspaceAvailable = true;
  let fail = false;
  let writes = 0;
  const stub = {
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    env: { remoteName: "ssh-remote" },
    version: "1.105.1",
    workspace: {
      get workspaceFolders() {
        return workspaceAvailable ? [{ name: "test" }] : [];
      },
      name: "test",
      getConfiguration() {
        return {
          get(key: string) {
            return values.workspace[key] ?? values.user[key] ?? defaults[key];
          },
          inspect(key: string) {
            return {
              defaultValue: defaults[key],
              globalValue: values.user[key],
              workspaceValue: values.workspace[key]
            };
          },
          async update(key: string, value: unknown, target: number) {
            if (fail) throw new Error("Permission denied");
            writes++;
            const record = target === 1 ? values.user : values.workspace;
            if (value === undefined) delete record[key];
            else record[key] = value;
          }
        };
      }
    }
  };
  before(() => {
    moduleInternals._load = function (request, parent, isMain) {
      if (request === "vscode") return stub;
      return originalLoad.call(this, request, parent, isMain);
    };
    const filename = require.resolve("../../../src/webviews/settings/settingsService");
    delete require.cache[filename];
    ServiceConstructor = (require(filename) as { SettingsService: typeof Service }).SettingsService;
  });
  after(() => {
    moduleInternals._load = originalLoad;
  });
  beforeEach(() => {
    values.user = {};
    values.workspace = {};
    workspaceAvailable = true;
    fail = false;
    writes = 0;
    service = new ServiceConstructor({
      extension: { packageJSON: manifest }
    } as unknown as vscode.ExtensionContext);
  });
  function change(key: string, value: unknown, target: SettingsTarget = "user", reset = false) {
    const current = service.snapshot(target).values[key];
    return service.change({
      key,
      value,
      target,
      reset,
      expected: { overridden: current.overridden, scopeValue: current.scopeValue }
    });
  }
  it("writes only the requested scope, reports workspace overrides, and resets to inheritance", async () => {
    const key = "containerlab.node.telnetPort";
    await change(key, 5023);
    assert.equal(service.snapshot("workspace").values[key].value, 5023);
    await change(key, 6000, "workspace");
    const user = service.snapshot("user").values[key];
    assert.equal(user.value, 5023);
    assert.equal(user.effectiveValue, 6000);
    assert.equal(user.workspaceOverride, true);
    await change(key, undefined, "workspace", true);
    assert.equal(service.snapshot("workspace").values[key].value, 5023);
    assert.equal(service.snapshot("workspace").values[key].overridden, false);
    assert.equal(values.user[key], 5023);
  });
  it("merges inherited mapping keys without writing or erasing other scopes", async () => {
    const key = "containerlab.node.sshUserMapping";
    await change(key, { linux: "root", nokia_srlinux: "admin" });
    await change(key, { linux: "lab" }, "workspace");
    assert.deepEqual(service.snapshot("workspace").values[key].value, {
      linux: "lab",
      nokia_srlinux: "admin"
    });
    assert.deepEqual(values.workspace[key], { linux: "lab" });
  });
  it("rejects stale edits, unknown keys, invalid values, and unavailable workspace scopes", async () => {
    const key = "containerlab.node.telnetPort";
    const stale = { key, target: "user", value: 6000, expected: { overridden: false } };
    await change(key, 5001);
    await assert.rejects(service.change(stale), /changed elsewhere/);
    await assert.rejects(service.change({ ...stale, key: "editor.fontSize" }), /not managed/);
    await assert.rejects(change(key, 65536), /at most/);
    assert.equal(writes, 1);
    workspaceAvailable = false;
    assert.throws(() => service.snapshot("workspace"), /Open a folder/);
  });
  it("propagates write failures and tracks reload requirements", async () => {
    fail = true;
    await assert.rejects(change("containerlab.runtime", "podman"), /Permission denied/);
    assert.equal(writes, 0);
    fail = false;
    await change("containerlab.runtime", "podman");
    assert.equal(service.snapshot("user").reloadRequired, true);
    await change("containerlab.runtime", undefined, "user", true);
    assert.equal(service.snapshot("user").reloadRequired, false);
  });
});
