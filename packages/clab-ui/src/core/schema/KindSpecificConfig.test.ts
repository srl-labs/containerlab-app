import assert from "node:assert/strict";
import test from "node:test";

import { kindSpecificConfig } from "./bundledSchema";
import { kindConfigLabel, parseKindSpecificConfig } from "./KindSpecificConfig";

function fieldKeys(kind: string): string[] {
  return kindSpecificConfig.fieldsForKind(kind).map((field) => field.key);
}

function field(kind: string, key: string) {
  const found = kindSpecificConfig.fieldsForKind(kind).find((entry) => entry.key === key);
  assert.ok(found, `${kind} has no field ${key}`);
  return found;
}

test("kind-specific keys come from the bundled schema in schema order", () => {
  assert.deepEqual(kindSpecificConfig.keys, [
    "components",
    "config-mode",
    "gen-component-config",
    "sfm",
    "pid-offset",
    "mgmt-intf",
    "bootstrap-config",
    "inject-ssh-keys",
    "custom-prompt",
    "eda-default-grpc-server",
    "port-count",
    "breakouts",
    "copy-to-flash",
    "daemons",
    "kubeconfig",
    "wait"
  ]);
});

test("each kind gets the keys containerlab accepts for it", () => {
  assert.deepEqual(fieldKeys("nokia_srlinux"), [
    "components",
    "custom-prompt",
    "eda-default-grpc-server"
  ]);
  assert.deepEqual(fieldKeys("nokia_sros"), ["components", "config-mode", "sfm", "inject-ssh-keys"]);
  assert.deepEqual(fieldKeys("nokia_srsim"), [
    "components",
    "config-mode",
    "gen-component-config",
    "sfm"
  ]);
  assert.deepEqual(fieldKeys("cisco_iol"), ["pid-offset", "mgmt-intf", "bootstrap-config"]);
  assert.deepEqual(fieldKeys("nvidia_cumulusvx"), ["port-count", "breakouts"]);
  assert.deepEqual(fieldKeys("arista_ceos"), ["copy-to-flash"]);
  assert.deepEqual(fieldKeys("frrouting"), ["daemons"]);
  assert.deepEqual(fieldKeys("k8s-kind"), ["kubeconfig", "wait"]);
  assert.deepEqual(fieldKeys("linux"), []);
  assert.deepEqual(fieldKeys("some_future_kind"), []);
});

test("kind names match case-insensitively, like containerlab", () => {
  assert.deepEqual(fieldKeys("FRR"), ["daemons"]);
  assert.equal(kindSpecificConfig.accepts("Nokia_SRLinux", "custom-prompt"), true);
  assert.equal(kindSpecificConfig.accepts("linux", "custom-prompt"), false);
  assert.equal(kindSpecificConfig.accepts("nokia_srlinux", "image"), false);
});

test("controls follow the value schema", () => {
  assert.deepEqual(field("nokia_srlinux", "custom-prompt").control, {
    type: "boolean",
    defaultValue: true
  });
  assert.deepEqual(field("nokia_srlinux", "eda-default-grpc-server").control, { type: "boolean" });
  assert.deepEqual(field("nokia_sros", "config-mode").control, {
    type: "enum",
    options: ["model-driven", "classic", "mixed"]
  });
  assert.equal(field("nokia_sros", "sfm").control?.type, "enum");
  assert.deepEqual(field("nvidia_cumulusvx", "port-count").control, {
    type: "integer",
    minimum: 1,
    maximum: 999
  });
  assert.deepEqual(field("cisco_iol", "mgmt-intf").control, {
    type: "string",
    defaultValue: "Ethernet0/0"
  });
  assert.deepEqual(field("arista_ceos", "copy-to-flash").control, { type: "stringList" });
  const daemons = field("frr", "daemons").control;
  assert.ok(daemons?.type === "stringList");
  assert.equal(daemons.options?.includes("bgpd"), true);
});

test("lists of flat objects get one input per item key", () => {
  const breakouts = field("nvidia_cumulusvx", "breakouts").control;
  assert.ok(breakouts?.type === "objectList");
  assert.deepEqual(
    breakouts.fields.map((item) => [item.key, item.required, item.control]),
    [
      ["port", true, { type: "integerOrString" }],
      ["channels", true, { type: "enum", options: [2, 4, 8] }]
    ]
  );

  // SR Linux line cards are slot + type; the SR OS card tree has its own tab
  const srlComponents = field("nokia_srlinux", "components").control;
  assert.ok(srlComponents?.type === "objectList");
  assert.deepEqual(
    srlComponents.fields.map((item) => item.key),
    ["slot", "type"]
  );
  assert.equal(field("nokia_srsim", "components").control, undefined);
  assert.equal(field("nokia_sros", "components").control, undefined);
});

test("labels and descriptions read well", () => {
  assert.equal(kindConfigLabel("eda-default-grpc-server"), "EDA Default gRPC Server");
  assert.equal(kindConfigLabel("mgmt-intf"), "Management Interface");
  assert.equal(kindConfigLabel("copy-to-flash"), "Copy to Flash");
  assert.equal(kindConfigLabel("pid-offset"), "PID Offset");
  assert.equal(
    field("frr", "daemons").description,
    "List of FRR routing daemons to enable; when omitted, all daemons are enabled."
  );
});

test("sections without a kind offer every key some kind accepts", () => {
  const all = kindSpecificConfig.allFields().map((entry) => entry.key);
  assert.deepEqual(all, kindSpecificConfig.keys);
  assert.deepEqual(kindSpecificConfig.kindsAccepting("sfm"), ["nokia_srsim", "nokia_sros"]);
  assert.deepEqual(kindSpecificConfig.kindsAccepting("daemons"), ["frr", "frrouting"]);
});

test("component keys follow each kind's component schema", () => {
  assert.deepEqual(
    [...kindSpecificConfig.componentKeys("nokia_sros")].sort(),
    ["cpu", "max-nics", "mda", "ram", "slot", "type", "xiom"]
  );
  assert.deepEqual(
    [...kindSpecificConfig.componentKeys("nokia_srsim")].sort(),
    ["env", "mda", "slot", "type", "xiom"]
  );
  assert.deepEqual([...kindSpecificConfig.componentKeys("nokia_srlinux")].sort(), ["slot", "type"]);
  assert.deepEqual([...kindSpecificConfig.componentKeys("linux")], []);
});

test("a kind added to the schema gets its form without code changes", () => {
  const schema = {
    definitions: {
      "node-config": {
        properties: {
          kind: { type: "string" },
          "turbo-mode": { type: "boolean", description: "Go faster, defaults to `false` (acme kind)." },
          lanes: { type: "array", items: { type: "string", enum: ["a", "b"] } }
        },
        allOf: [
          {
            if: { properties: { kind: { pattern: "^acme_router$" } }, required: ["kind"] },
            then: { $ref: "#/definitions/kind-specific-config-acme_router" }
          },
          {
            if: {
              properties: { kind: { not: { pattern: "^(acme_router)$" } } },
              required: ["kind"]
            },
            then: { $ref: "#/definitions/kind-specific-config-other" }
          }
        ]
      },
      "kind-specific-config-acme_router": { not: { anyOf: [] } },
      "kind-specific-config-other": {
        not: { anyOf: [{ required: ["turbo-mode"] }, { required: ["lanes"] }] }
      }
    }
  };
  const parsed = parseKindSpecificConfig(schema);
  assert.deepEqual(parsed.keys, ["turbo-mode", "lanes"]);
  assert.deepEqual(
    parsed.fieldsForKind("acme_router").map((entry) => [entry.key, entry.control]),
    [
      ["turbo-mode", { type: "boolean", defaultValue: false }],
      ["lanes", { type: "stringList", options: ["a", "b"] }]
    ]
  );
  assert.equal(parsed.fieldsForKind("acme_router")[0].description, "Go faster, defaults to `false`.");
  assert.deepEqual(parsed.fieldsForKind("linux"), []);
});
