import assert from "node:assert/strict";
import { posix as path } from "node:path";
import test from "node:test";

import { TopologyHostCore } from "../../core/host/TopologyHostCore";
import type { FileSystemAdapter } from "../../core/io/types";
import type { LabSettings, LabSettingsUpdate } from "../../core/types/labSettings";
import type {
  BasicSettingsState,
  MgmtFormState,
  MgmtSettingsState
} from "../../components/panels/lab-settings/types";

import {
  buildInitialBasic,
  buildInitialMgmt,
  buildLabSettingsUpdate,
  createMgmtNetworkForm,
  validateMgmtNetworks
} from "./labSettingsForm";

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
  /** Edits of the first management network */
  mgmt?: Partial<MgmtSettingsState>;
  /** Structural edits of the network list, applied after `mgmt` */
  networks?: (form: MgmtFormState) => MgmtFormState;
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
  const initialMgmt = buildInitialMgmt(labSettings);
  const edited: MgmtFormState = {
    ...initialMgmt,
    networks: initialMgmt.networks.map((network, index) =>
      index === 0 ? { ...network, ...edits.mgmt } : network
    )
  };
  const mgmt = edits.networks ? edits.networks(edited) : edited;
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

test("editing one field only touches that key", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { ipv4Gateway: "172.31.20.254" } });
  assert.deepEqual(result.update, { mgmt: [{ source: 0, changes: { "ipv4-gw": "172.31.20.254" } }] });
  assert.equal(
    result.yaml,
    FULL_MGMT.replace("ipv4-gw: 172.31.20.1", "ipv4-gw: 172.31.20.254")
  );
});

test("a new field is appended without disturbing existing keys", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { ipv4Range: "172.31.20.128/25" } });
  assert.deepEqual(result.update, {
    mgmt: [{ source: 0, changes: { "ipv4-range": "172.31.20.128/25" } }]
  });
  assert.equal(
    result.yaml,
    FULL_MGMT.replace("    foo: bar\n", "    foo: bar\n  ipv4-range: 172.31.20.128/25\n")
  );
});

test("clearing a field removes only that key", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { networkName: "" } });
  assert.deepEqual(result.update, { mgmt: [{ source: 0, changes: { network: null } }] });
  assert.equal(result.yaml, FULL_MGMT.replace("  network: lab-mgmt\n", ""));
});

test("switching IPv4 back to default removes the form-owned IPv4 keys only", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { ipv4Type: "default" } });
  assert.deepEqual(result.update, {
    mgmt: [{ source: 0, changes: { "ipv4-subnet": null, "ipv4-gw": null } }]
  });
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

const BRIDGE_MGMT = `name: lab
mgmt:
  network: lab-mgmt
  ipv4-subnet: auto
  mtu: 9000
  bridge: br-lab # custom bridge
  external-access: false
  tailscale:
    auth-mode: sso
${TOPOLOGY}`;

test("switching a bridge network to macvlan drops the bridge-only keys", async () => {
  const result = await roundTrip(BRIDGE_MGMT, {
    mgmt: { driver: "macvlan", macvlanParent: "eth1", ipv4Type: "default" }
  });
  assert.equal(
    result.yaml,
    `name: lab
mgmt:
  network: lab-mgmt
  tailscale:
    auth-mode: sso
  driver: macvlan
  macvlan-parent: eth1
${TOPOLOGY}`
  );
});

test("switching a macvlan network to bridge drops every macvlan key", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { driver: "bridge" } });
  for (const key of ["driver:", "macvlan-parent", "macvlan-mode", "macvlan-aux"]) {
    assert.ok(!result.yaml.includes(key), `expected ${key} to be removed`);
  }
  assert.equal(
    result.yaml,
    FULL_MGMT.replace(
      "  driver: macvlan\n  macvlan-parent: eth1\n  macvlan-mode: bridge\n  macvlan-aux: false\n",
      ""
    )
  );
});

test("macvlan and allocation settings write only what differs from the defaults", async () => {
  const yaml = `name: lab\n${TOPOLOGY}`;
  const defaults = await roundTrip(yaml, {
    mgmt: { driver: "macvlan", macvlanParent: "eth1" }
  });
  assert.equal(
    defaults.yaml,
    `name: lab\nmgmt:\n  driver: macvlan\n  macvlan-parent: eth1\n${TOPOLOGY}`
  );

  const custom = await roundTrip(yaml, {
    mgmt: {
      driver: "macvlan",
      macvlanParent: "eth1",
      macvlanMode: "private",
      macvlanAux: false,
      ipv6Type: "custom",
      ipv6Subnet: "3fff:192:0:2::/64",
      ipv6Range: "3fff:192:0:2::8000/65",
      ipamProvider: "runtime",
      ipamDad: false,
      skipWhenUnused: true
    }
  });
  assert.equal(
    custom.yaml,
    `name: lab
mgmt:
  driver: macvlan
  macvlan-parent: eth1
  macvlan-mode: private
  macvlan-aux: false
  ipv6-subnet: 3fff:192:0:2::/64
  ipv6-range: 3fff:192:0:2::8000/65
  ipam:
    provider: runtime
    dad: false
  skip-when-unused: true
${TOPOLOGY}`
  );
});

test("ipam keys change one by one", async () => {
  const result = await roundTrip(FULL_MGMT, { mgmt: { ipamProvider: "containerlab" } });
  assert.deepEqual(result.update, {
    mgmt: [{ source: 0, changes: { ipam: { provider: null } } }]
  });
  assert.equal(result.yaml, FULL_MGMT.replace("    provider: runtime\n", ""));

  const off = await roundTrip(FULL_MGMT, {
    mgmt: { ipamProvider: "containerlab", skipWhenUnused: false }
  });
  assert.ok(off.yaml.includes("  ipam:\n    dad: true\n"));
  assert.ok(!off.yaml.includes("skip-when-unused"));
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
  assert.deepEqual(result.update, {
    mgmt: [{ source: 0, changes: { "driver-opts": { extra: "1", foo: null } } }]
  });
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

const MULTI_TOPOLOGY = `topology:
  defaults:
    mgmt-net: net1
  kinds:
    nokia_srlinux:
      mgmt-net: net2 # srl on net2
  groups:
    edge:
      mgmt-net: net1
  nodes:
    r1:
      kind: linux
    r2:
      kind: nokia_srlinux
    r3:
      kind: linux
      mgmt-net: net2
  links: []
`;

const MULTI = `name: multi
mgmt:
  - network: net1
    ipv4-subnet: 172.31.10.0/24
  # second network
  - network: net2
    driver: macvlan
    macvlan-parent: eth1 # host uplink
    ipv4-subnet: 172.31.20.0/24
${MULTI_TOPOLOGY}`;

test("a list of management networks is read in order", async () => {
  const result = await roundTrip(MULTI);
  assert.equal(result.update, null);
  assert.equal(result.yaml, MULTI);
  assert.equal(result.labSettings?.mgmt, undefined);
  assert.deepEqual(
    result.labSettings?.mgmtNetworks?.map((network) => network.network),
    ["net1", "net2"]
  );
  assert.equal(result.labSettings?.defaultMgmtNet, "net1");
});

test("editing the second network only touches its keys", async () => {
  const result = await roundTrip(MULTI, {
    networks: (form) => ({
      ...form,
      networks: form.networks.map((network, index) =>
        index === 1 ? { ...network, ipv4Subnet: "172.31.30.0/24" } : network
      )
    })
  });
  assert.deepEqual(result.update, {
    mgmt: [
      { source: 0, changes: {} },
      { source: 1, changes: { "ipv4-subnet": "172.31.30.0/24" } }
    ]
  });
  assert.equal(result.yaml, MULTI.replace("172.31.20.0/24", "172.31.30.0/24"));
});

test("adding a network turns a single mgmt map into a list and keeps its keys", async () => {
  const result = await roundTrip(FULL_MGMT, {
    networks: (form) => ({
      ...form,
      networks: [...form.networks, createMgmtNetworkForm("net2")]
    })
  });
  assert.deepEqual(result.update, {
    mgmt: [{ source: 0, changes: {} }, { changes: { network: "net2" } }]
  });
  const [header, comment, first, ...rest] = mgmtBlock(FULL_MGMT).split("\n");
  // The comment stays on top and the first key gets the list marker.
  const expected = [
    header,
    comment,
    first.replace("  network:", "  - network:"),
    ...rest.map((line) => `  ${line}`),
    "  - network: net2"
  ].join("\n");
  assert.equal(mgmtBlock(result.yaml), expected);
});

test("two new networks in a lab without mgmt are written as a list", async () => {
  const result = await roundTrip(`name: lab\n${TOPOLOGY}`, {
    networks: (form) => ({
      ...form,
      networks: [{ ...form.networks[0], networkName: "a" }, createMgmtNetworkForm("b")]
    })
  });
  assert.equal(result.yaml, `name: lab\nmgmt:\n  - network: a\n  - network: b\n${TOPOLOGY}`);
});

test("reordering networks moves each entry with its keys and comments", async () => {
  const result = await roundTrip(MULTI, {
    networks: (form) => ({ ...form, networks: [form.networks[1], form.networks[0]] })
  });
  assert.equal(
    mgmtBlock(result.yaml),
    `mgmt:
  # second network
  - network: net2
    driver: macvlan
    macvlan-parent: eth1 # host uplink
    ipv4-subnet: 172.31.20.0/24
  - network: net1
    ipv4-subnet: 172.31.10.0/24`
  );
});

test("removing a network keeps the list form and drops a default that pointed at it", async () => {
  const result = await roundTrip(MULTI, {
    networks: (form) => ({ defaultMgmtNet: "", networks: [form.networks[1]] })
  });
  assert.deepEqual(result.update, {
    mgmt: [{ source: 1, changes: {} }],
    defaultMgmtNet: null
  });
  assert.ok(mgmtBlock(result.yaml).startsWith("mgmt:\n  # second network\n  - network: net2\n"));
  assert.ok(!result.yaml.includes("defaults:"));
});

test("renaming a network renames the mgmt-net references to it", async () => {
  const result = await roundTrip(MULTI, {
    networks: (form) => ({
      defaultMgmtNet: "core",
      networks: [{ ...form.networks[0], networkName: "core" }, form.networks[1]]
    })
  });
  assert.deepEqual(result.update, {
    mgmt: [
      { source: 0, changes: { network: "core" } },
      { source: 1, changes: {} }
    ],
    mgmtNetRenames: { net1: "core" }
  });
  assert.equal(result.yaml, MULTI.replaceAll("net1", "core"));
});

test("swapping two network names swaps the references", async () => {
  const result = await roundTrip(MULTI, {
    networks: (form) => ({
      defaultMgmtNet: "net2",
      networks: [
        { ...form.networks[0], networkName: "net2" },
        { ...form.networks[1], networkName: "net1" }
      ]
    })
  });
  assert.deepEqual(result.update?.mgmtNetRenames, { net1: "net2", net2: "net1" });
  assert.equal(result.update?.defaultMgmtNet, undefined);
  assert.equal(
    result.yaml,
    MULTI.replaceAll("net1", "@")
      .replaceAll("net2", "net1")
      .replaceAll("@", "net2")
      .replace("# srl on net1", "# srl on net2")
  );
});

test("the default for nodes is written to topology.defaults", async () => {
  const yaml = `name: lab
mgmt:
  - network: a
  - network: b
${TOPOLOGY}`;
  const set = await roundTrip(yaml, {
    networks: (form) => ({ ...form, defaultMgmtNet: "b" })
  });
  assert.deepEqual(set.update, { defaultMgmtNet: "b" });
  assert.ok(set.yaml.includes("topology:\n  defaults:\n    mgmt-net: b\n  nodes:\n"));

  const cleared = await roundTrip(MULTI, {
    networks: (form) => ({ ...form, defaultMgmtNet: "" })
  });
  assert.deepEqual(cleared.update, { defaultMgmtNet: null });
  assert.ok(!cleared.yaml.includes("defaults:"));
  assert.ok(cleared.yaml.includes("nokia_srlinux:\n      mgmt-net: net2 # srl on net2"));
});

test("several networks need unique names and bridges", () => {
  const form: MgmtFormState = {
    defaultMgmtNet: "",
    networks: [
      { ...createMgmtNetworkForm("a"), bridge: "br0" },
      { ...createMgmtNetworkForm(""), bridge: "br0" },
      createMgmtNetworkForm("a")
    ]
  };
  assert.deepEqual(validateMgmtNetworks(form), [
    {
      networkName: "Another management network uses this name",
      bridge: "Another management network uses this bridge"
    },
    {
      networkName: "Required when the lab has several management networks",
      bridge: "Another management network uses this bridge"
    },
    { networkName: "Another management network uses this name" }
  ]);
  assert.deepEqual(
    validateMgmtNetworks({ defaultMgmtNet: "", networks: [createMgmtNetworkForm("")] }),
    [{}]
  );
});

test("macvlan networks need a valid, unshared parent and no auto subnet", () => {
  const macvlan = (name: string, parent: string) => ({
    ...createMgmtNetworkForm(name),
    driver: "macvlan" as const,
    macvlanParent: parent
  });
  const form: MgmtFormState = {
    defaultMgmtNet: "",
    networks: [
      { ...macvlan("a", ""), ipv4Type: "auto" },
      macvlan("b", "eth1/2"),
      macvlan("c", "eth1"),
      macvlan("d", "eth1"),
      {
        ...macvlan("e", "eth2"),
        macvlanMode: "vepa",
        driverOptions: [
          { key: "parent", value: "eth2" },
          { key: "macvlan_mode", value: "bridge" }
        ]
      },
      // A bridge network keeps its bridge name; it is not compared with macvlan parents.
      { ...createMgmtNetworkForm("f"), bridge: "eth1" }
    ]
  };
  assert.deepEqual(validateMgmtNetworks(form), [
    {
      macvlanParent: "Required for macvlan networks",
      ipv4Type: "Macvlan networks cannot auto-assign a subnet"
    },
    { macvlanParent: "Not a valid interface name" },
    { macvlanParent: "Another management network uses this parent interface" },
    { macvlanParent: "Another management network uses this parent interface" },
    { driverOptions: "macvlan_mode conflicts with the macvlan settings above" },
    {}
  ]);
});

test("a hidden bridge name on a macvlan network does not clash", () => {
  const form: MgmtFormState = {
    defaultMgmtNet: "",
    networks: [
      { ...createMgmtNetworkForm("a"), bridge: "br0" },
      { ...createMgmtNetworkForm("b"), driver: "macvlan", macvlanParent: "eth1", bridge: "br0" }
    ]
  };
  assert.deepEqual(validateMgmtNetworks(form), [{}, {}]);
});
