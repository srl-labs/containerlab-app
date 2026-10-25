import assert from "node:assert/strict";
import test from "node:test";

import {
  closDraftKinds,
  closDraftSummary,
  closDraftToRequest,
  closFileName,
  closGenerateCommand,
  defaultClosDraft,
  validateClosDraft,
  withSuggestedImages
} from "./closGenerator";
import { defaultShareOptionsDraft, shareOptionsErrors, shareOptionsFromDraft } from "./shareOptions";

test("the default Clos draft is a valid two-tier SR Linux fabric", () => {
  const draft = defaultClosDraft("labs");
  assert.equal(draft.fileName, "labs/clos.clab.yml");
  assert.deepEqual(validateClosDraft(draft), {});
  assert.deepEqual(closDraftSummary(draft), { nodes: 6, links: 8 });
  assert.deepEqual(closDraftToRequest(draft), {
    name: "clos",
    tiers: [
      { count: 4, kind: "nokia_srlinux" },
      { count: 2, kind: "nokia_srlinux" }
    ],
    images: { nokia_srlinux: "ghcr.io/nokia/srlinux:latest" }
  });
});

test("Clos links connect every node with every node of the next tier", () => {
  const draft = defaultClosDraft();
  draft.tiers = [
    { count: "4", kind: "", type: "" },
    { count: "2", kind: "", type: "" },
    { count: "3", kind: "", type: "" }
  ];
  assert.deepEqual(closDraftSummary(draft), { nodes: 9, links: 14 });
});

test("new kinds get suggested images, and images are only sent for used kinds", () => {
  const draft = withSuggestedImages({
    ...defaultClosDraft(),
    tiers: [
      { count: "2", kind: "nokia_srlinux", type: "ixr-d3l" },
      { count: "1", kind: "linux", type: "" }
    ],
    images: { nokia_srlinux: "srl:24", arista_ceos: "ceos:4" },
    licenses: { nokia_srlinux: " /opt/srl.lic " },
    nodePrefix: " leaf ",
    ipv4Subnet: "172.20.30.0/24"
  });
  assert.deepEqual(closDraftKinds(draft), ["nokia_srlinux", "linux"]);
  assert.ok(draft.images.linux);
  const request = closDraftToRequest(draft);
  assert.deepEqual(Object.keys(request.images), ["nokia_srlinux", "linux"]);
  assert.deepEqual(request.licenses, { nokia_srlinux: "/opt/srl.lic" });
  assert.equal(request.nodePrefix, "leaf");
  assert.equal(request.tiers[0].type, "ixr-d3l");
  assert.match(closGenerateCommand(request), /--nodes 2:nokia_srlinux:ixr-d3l,1:linux --image /);
  assert.match(closGenerateCommand(request), /--node-prefix leaf --ipv4-subnet 172\.20\.30\.0\/24$/);
});

test("Clos drafts report what containerlab would reject", () => {
  const draft = defaultClosDraft();
  draft.name = "bad name";
  draft.fileName = "../escape.clab.yml";
  draft.tiers = [{ count: "0", kind: "", type: "" }, { count: "2", kind: "a:b", type: "" }];
  draft.images = { nokia_srlinux: "" };
  draft.ipv4Subnet = "300.1.1.0/24";
  const errors = validateClosDraft(draft);
  assert.deepEqual(Object.keys(errors).sort(), [
    "fileName",
    "image:a:b",
    "image:nokia_srlinux",
    "ipv4Subnet",
    "name",
    "tier0",
    "tier1"
  ]);
});

test("the topology file follows the lab name", () => {
  assert.equal(closFileName("", "dc1"), "dc1.clab.yml");
  assert.equal(closFileName("labs/", " "), "labs/clos.clab.yml");
});

test("sshx options only carry the read-only choice", () => {
  const draft = { ...defaultShareOptionsDraft(), enableReaders: true, port: "nope" };
  assert.deepEqual(shareOptionsErrors("sshx", draft), {});
  assert.deepEqual(shareOptionsFromDraft("sshx", draft), { enableReaders: true });
  assert.deepEqual(shareOptionsFromDraft("sshx", defaultShareOptionsDraft()), {});
});

test("GoTTY options check port, credentials and shell", () => {
  const draft = {
    ...defaultShareOptionsDraft(),
    customCredentials: true,
    username: "lab",
    password: "S3cret!",
    shell: " sh "
  };
  assert.deepEqual(shareOptionsErrors("gotty", draft), {});
  assert.deepEqual(shareOptionsFromDraft("gotty", draft), {
    port: 8080,
    username: "lab",
    password: "S3cret!",
    shell: "sh"
  });
  const unsafe = { ...draft, port: "0", username: "a b", password: "$(id)", shell: "bash -c x" };
  assert.deepEqual(Object.keys(shareOptionsErrors("gotty", unsafe)).sort(), [
    "password",
    "port",
    "shell",
    "username"
  ]);
  assert.deepEqual(shareOptionsFromDraft("gotty", defaultShareOptionsDraft(9000)), { port: 9000 });
});
