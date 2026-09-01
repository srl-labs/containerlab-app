import assert from "node:assert/strict";
import test from "node:test";
import type * as monaco from "monaco-editor";

import {
  CONTAINERLAB_SCHEMA_URI,
  buildContainerlabSchemaCompletionItems,
  buildMonacoYamlOptions,
  extractTopologyNodeNames,
  getContainerlabYamlCompletionContext,
  getYamlCompletionRange
} from "./monaco/yamlLanguageSupport";
import { containerlabSchema } from "../core/schema";

const SAMPLE_YAML = `name: demo
topology:
  nodes:
    srl2:
      kind: nokia_srlinux
    srl1:
      kind: nokia_srlinux
  links:
    - endpoints:
        - 
    - type: veth
      endpoints:
        - node: 
          interface: e1-1
`;

test("buildMonacoYamlOptions attaches containerlab schema snippets without mutating input", () => {
  const schema = {
    type: "object",
    properties: {
      topology: { type: "object" }
    },
    definitions: {
      "node-config": { type: "object" },
      "link-endpoint": { type: "object" }
    }
  };

  const options = buildMonacoYamlOptions(schema);
  const configuredSchema = options.schemas?.[0]?.schema as Record<string, unknown>;

  assert.equal(options.completion, true);
  assert.equal(options.hover, true);
  assert.equal(options.validate, true);
  assert.equal(options.enableSchemaRequest, false);
  assert.equal(options.schemas?.[0]?.uri, CONTAINERLAB_SCHEMA_URI);
  assert.deepEqual(options.schemas?.[0]?.fileMatch, [
    "*.clab.yml",
    "*.clab.yaml",
    "**/*.clab.yml",
    "**/*.clab.yaml",
    "file:///**/*.clab.yml",
    "file:///**/*.clab.yaml",
    "file:///containerlab-editor/*.clab.yml",
    "file:///containerlab-editor/*.clab.yaml"
  ]);
  assert.equal("defaultSnippets" in schema, false);
  assert.match(JSON.stringify(configuredSchema), /containerlab topology/);
  assert.match(JSON.stringify(configuredSchema), /node config/);
});

test("extractTopologyNodeNames returns sorted node names", () => {
  assert.deepEqual(extractTopologyNodeNames(SAMPLE_YAML), ["srl1", "srl2"]);
});

test("completion context detects brief and extended link endpoint node positions", () => {
  assert.equal(getContainerlabYamlCompletionContext(SAMPLE_YAML, 10, 11), "briefEndpoint");
  assert.equal(getContainerlabYamlCompletionContext(SAMPLE_YAML, 13, 17), "extendedEndpointNode");
  assert.equal(getContainerlabYamlCompletionContext(SAMPLE_YAML, 5, 12), null);
});

test("getYamlCompletionRange replaces the current endpoint token", () => {
  assert.deepEqual(
    getYamlCompletionRange(
      "        - srl",
      { lineNumber: 1, column: 14 } as unknown as monaco.Position
    ),
    {
      startLineNumber: 1,
      startColumn: 11,
      endLineNumber: 1,
      endColumn: 14
    }
  );
});

function completionLabels(
  text: string,
  lineNumber: number,
  column: number
): Array<string | monaco.languages.CompletionItemLabel> {
  const lineText = text.split(/\r?\n/)[lineNumber - 1] ?? "";
  const items = buildContainerlabSchemaCompletionItems({
    text,
    lineNumber,
    column,
    schema: containerlabSchema,
    range: getYamlCompletionRange(
      lineText,
      { lineNumber, column } as unknown as monaco.Position
    ),
    kinds: {
      property: 1 as monaco.languages.CompletionItemKind,
      enumMember: 2 as monaco.languages.CompletionItemKind,
      snippet: 3 as monaco.languages.CompletionItemKind
    },
    snippetInsertTextRule: 4 as monaco.languages.CompletionItemInsertTextRule
  });
  return items.map((item) => item.label);
}

test("schema completions suggest root and node properties", () => {
  const rootLabels = completionLabels("name: demo\n", 2, 1);
  assert(rootLabels.includes("containerlab topology"));
  assert(rootLabels.includes("topology"));

  const nodeLabels = completionLabels("topology:\n  nodes:\n    srl1:\n      ", 4, 7);
  assert(nodeLabels.includes("kind"));
  assert(nodeLabels.includes("image"));
  assert(nodeLabels.includes("node config"));
});

test("schema completions do not fall back to root properties inside node configs", () => {
  const directNodeLabels = completionLabels(
    [
      "topology:",
      "  nodes:",
      "    srl1:",
      "      kind: nokia_srlinux",
      "      type: ixr-d1",
      "      image: ghcr.io/nokia/srlinux:latest",
      "    client1:",
      "      kind: linux",
      "      image: ghcr.io/srl-labs/network-multitool:latest",
      "      type: iasd                  ",
      "    asdasd:",
      "      "
    ].join("\n"),
    12,
    7
  );
  assert(directNodeLabels.includes("kind"));
  assert(directNodeLabels.includes("image"));
  assert(!directNodeLabels.includes("topology"));

  const nestedUnknownLabels = completionLabels(
    "topology:\n  nodes:\n    asdasd:\n      below asdad:\n        ",
    5,
    9
  );
  assert(!nestedUnknownLabels.includes("topology"));
});

test("schema completions suggest enum and kind-specific type values", () => {
  const kindLabels = completionLabels("topology:\n  nodes:\n    srl1:\n      kind: ", 4, 13);
  assert(kindLabels.includes("nokia_srlinux"));
  assert(kindLabels.includes("linux"));

  const typeLabels = completionLabels(
    "topology:\n  nodes:\n    srl1:\n      kind: nokia_srlinux\n      type: ",
    5,
    13
  );
  assert(typeLabels.includes("ixr-d2"));
  assert(typeLabels.includes("ixr-h4"));
});
