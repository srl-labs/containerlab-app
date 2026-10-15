import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import { TopologyHostCore } from "../../core/host/TopologyHostCore";
import type { FileSystemAdapter } from "../../core/io/types";
import type { LabSettings, LabSettingsUpdate } from "../../core/types/labSettings";
import type {
  BasicSettingsState,
  MgmtSettingsState
} from "../../components/panels/lab-settings/types";

import { buildInitialBasic, buildInitialMgmt, buildLabSettingsUpdate } from "./labSettingsForm";

class MemoryFs implements FileSystemAdapter {
  readonly files = new Map<string, string>();

  async readFile(filePath: string): Promise<string> {
    const content = this.files.get(filePath);
    if (content === undefined) {
      throw Object.assign(new Error(`ENOENT: no such file ${filePath}`), { code: "ENOENT" });
    }
    return content;
  }
  async writeFile(filePath: string, content: string): Promise<void> {
    this.files.set(filePath, content);
  }
  async unlink(filePath: string): Promise<void> {
    this.files.delete(filePath);
  }
  async rename(oldPath: string, newPath: string): Promise<void> {
    const content = await this.readFile(oldPath);
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }
  async exists(filePath: string): Promise<boolean> {
    return this.files.has(filePath);
  }
  dirname(filePath: string): string {
    return path.dirname(filePath);
  }
  basename(filePath: string): string {
    return path.basename(filePath);
  }
  join(...segments: string[]): string {
    return path.join(...segments);
  }
}

const YAML_PATH = "/labs/lab.clab.yml";

const TOPOLOGY = `topology:
  nodes:
    srl1:
      kind: nokia_srlinux
  links: []
`;

interface FormEdits {
  basic?: Partial<BasicSettingsState>;
  mgmt?: Partial<MgmtSettingsState>;
}

interface RoundTrip {
  yaml: string;
  update: LabSettingsUpdate | null;
  labSettings: LabSettings | undefined;
}

/** YAML in -> load into the Lab Settings form -> edit -> Apply -> YAML out. */
async function roundTrip(yaml: string, edits: FormEdits = {}): Promise<RoundTrip> {
  const fs = new MemoryFs();
  await fs.writeFile(YAML_PATH, yaml);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: YAML_PATH,
    mode: "edit",
    deploymentState: "undeployed"
  });
  const snapshot = await host.getSnapshot();
  const labSettings = snapshot.labSettings;
  const basic = { ...buildInitialBasic(labSettings), ...edits.basic };
  const mgmt = { ...buildInitialMgmt(labSettings), ...edits.mgmt };
  const update = buildLabSettingsUpdate(labSettings, basic, mgmt);
  if (update) {
    const response = await host.applyCommand(
      { command: "setLabSettings", payload: update },
      snapshot.revision
    );
    assert.equal(response.type, "topology-host:ack");
  }
  return { yaml: await fs.readFile(YAML_PATH), update, labSettings };
}

/** The `mgmt:` block, including nested lines and comments, as written in the file. */
function mgmtBlock(yaml: string): string {
  const lines = yaml.split("\n");
  const start = lines.findIndex((line) => line.startsWith("mgmt:"));
  if (start < 0) return "";
  let end = start + 1;
  while (end < lines.length && (lines[end].startsWith(" ") || lines[end].startsWith("#"))) end++;
  return lines.slice(start, end).join("\n");
}

const FULL_MGMT = `name: lab # the lab
prefix: acme
mgmt:
  # management network
  network: lab-mgmt
  driver: macvlan
  macvlan-parent: eth1
  macvlan-mode: bridge
  macvlan-aux: false
  ipv4-subnet: 172.31.20.0/24 # routed
  ipv4-gw: 172.31.20.1
  ipv6-range: 3fff:172:31:20::/80
  ipam:
    provider: runtime
    dad: true
  tailscale:
    auth-mode: sso
  skip-when-unused: true
  external-access: true
  driver-opts:
    com.docker.network.bridge.name: br-lab
    foo: bar
${TOPOLOGY}`;

const MULTI_MGMT = `name: multi
mgmt:
  - network: net1
    ipv4-subnet: 172.31.10.0/24
  # second network
  - network: net2
    driver: macvlan
    macvlan-parent: eth1
    ipv4-subnet: 172.31.20.0/24
${TOPOLOGY}`;

test("apply without changes leaves the file byte-identical", async () => {
  const result = await roundTrip(FULL_MGMT);
  assert.equal(result.update, null);
  assert.equal(result.yaml, FULL_MGMT);
});

test("changing only the lab name keeps the mgmt block byte-identical", async () => {
  const result = await roundTrip(FULL_MGMT, { basic: { labName: "renamed" } });
  assert.deepEqual(result.update, { name: "renamed" });
  assert.equal(result.yaml, FULL_MGMT.replace("name: lab # the lab", "name: renamed # the lab"));
  assert.equal(mgmtBlock(result.yaml), mgmtBlock(FULL_MGMT));
});

test("changing only the lab name keeps an explicit default prefix", async () => {
  const yaml = `name: lab\nprefix: clab\n${TOPOLOGY}`;
  const result = await roundTrip(yaml, { basic: { labName: "renamed" } });
  assert.equal(result.yaml, `name: renamed\nprefix: clab\n${TOPOLOGY}`);
});

test("a list of management networks is preserved and never sent by the form", async () => {
  const result = await roundTrip(MULTI_MGMT, {
    basic: { labName: "renamed" },
    mgmt: { networkName: "other", mtu: "9000" }
  });
  assert.equal(result.labSettings?.mgmt, undefined);
  assert.deepEqual(
    result.labSettings?.mgmtNetworks?.map((network) => network.network),
    ["net1", "net2"]
  );
  assert.deepEqual(result.update, { name: "renamed" });
  assert.equal(result.yaml, MULTI_MGMT.replace("name: multi", "name: renamed"));
});

test("the host refuses to rewrite a list of management networks", async () => {
  const fs = new MemoryFs();
  await fs.writeFile(YAML_PATH, MULTI_MGMT);
  const host = new TopologyHostCore({
    fs,
    yamlFilePath: YAML_PATH,
    mode: "edit",
    deploymentState: "undeployed"
  });
  const { revision } = await host.getSnapshot();
  await host.applyCommand(
    { command: "setLabSettings", payload: { mgmt: { network: "x", mtu: null } } },
    revision
  );
  assert.equal(mgmtBlock(await fs.readFile(YAML_PATH)), mgmtBlock(MULTI_MGMT));
});

test("editing one field only touches that key", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { ipv4Gateway: "172.31.20.254" } });
  assert.deepEqual(result.update, { mgmt: { "ipv4-gw": "172.31.20.254" } });
  assert.equal(
    result.yaml,
    FULL_MGMT.replace("ipv4-gw: 172.31.20.1", "ipv4-gw: 172.31.20.254")
  );
});

test("a new field is appended without disturbing existing keys", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { mtu: "9000" } });
  assert.deepEqual(result.update, { mgmt: { mtu: 9000 } });
  assert.equal(
    result.yaml,
    FULL_MGMT.replace("    foo: bar\n", "    foo: bar\n  mtu: 9000\n")
  );
});

test("clearing a field removes only that key", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { networkName: "" } });
  assert.deepEqual(result.update, { mgmt: { network: null } });
  assert.equal(result.yaml, FULL_MGMT.replace("  network: lab-mgmt\n", ""));
});

test("switching IPv4 back to default removes the form-owned IPv4 keys only", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { ipv4Type: "default" } });
  assert.deepEqual(result.update, { mgmt: { "ipv4-subnet": null, "ipv4-gw": null } });
  assert.equal(
    result.yaml,
    FULL_MGMT.replace("  ipv4-subnet: 172.31.20.0/24 # routed\n  ipv4-gw: 172.31.20.1\n", "")
  );
  for (const key of [
    "driver: macvlan",
    "macvlan-parent: eth1",
    "macvlan-mode: bridge",
    "macvlan-aux: false",
    "ipv6-range: 3fff:172:31:20::/80",
    "provider: runtime",
    "auth-mode: sso",
    "skip-when-unused: true"
  ]) {
    assert.ok(result.yaml.includes(key), `expected ${key} to survive`);
  }
});

test("driver options are merged per key", async () => {
  const result = await roundTrip(FULL_MGMT, {
    mgmt: {
      driverOptions: [
        { key: "com.docker.network.bridge.name", value: "br-lab" },
        { key: "extra", value: "1" }
      ]
    }
  });
  assert.deepEqual(result.update, { mgmt: { "driver-opts": { extra: "1", foo: null } } });
  assert.equal(result.yaml, FULL_MGMT.replace("    foo: bar\n", "    extra: \"1\"\n"));
});

test("form at defaults does not create an empty mgmt block", async () => {
  const yaml = `name: lab\n${TOPOLOGY}`;
  const result = await roundTrip(yaml, { basic: { labName: "renamed" } });
  assert.equal(result.yaml, `name: renamed\n${TOPOLOGY}`);
});

test("setting a field without an existing mgmt block creates one after the name", async () => {
  const yaml = `name: lab\n${TOPOLOGY}`;
  const result = await roundTrip(yaml, { mgmt: { networkName: "lab-mgmt" } });
  assert.equal(result.yaml, `name: lab\nmgmt:\n  network: lab-mgmt\n${TOPOLOGY}`);
});

test("clearing every field removes mgmt when nothing else remains", async () => {
  const yaml = `name: lab\nmgmt:\n  network: lab-mgmt\n  ipv4-subnet: auto\n${TOPOLOGY}`;
  const result = await roundTrip(yaml, { mgmt: { networkName: "", ipv4Type: "default" } });
  assert.equal(result.yaml, `name: lab\n${TOPOLOGY}`);
});

test("clearing every form field keeps mgmt when other keys remain", async () => {
  const yaml = `name: lab\nmgmt:\n  network: lab-mgmt\n  skip-when-unused: true\n${TOPOLOGY}`;
  const result = await roundTrip(yaml, { mgmt: { networkName: "" } });
  assert.equal(result.yaml, `name: lab\nmgmt:\n  skip-when-unused: true\n${TOPOLOGY}`);
});

test("prefix changes only touch the prefix key", async () => {
  const custom = await roundTrip(FULL_MGMT, { basic: { customPrefix: "other" } });
  assert.deepEqual(custom.update, { prefix: "other" });
  assert.equal(custom.yaml, FULL_MGMT.replace("prefix: acme", "prefix: other"));

  const reset = await roundTrip(FULL_MGMT, { basic: { prefixType: "default" } });
  assert.deepEqual(reset.update, { prefix: null });
  assert.equal(reset.yaml, FULL_MGMT.replace("prefix: acme\n", ""));
});
