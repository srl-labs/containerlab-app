import {
  buildContainerlabSchemaCompletionItems,
  getSchemaHoverInfo,
} from "@srl-labs/clab-ui/yaml";
import {
  getKindImageGuidance,
  isPlaceholderImageReference,
} from "@srl-labs/clab-ui/image-manager/catalog";

// Exercise the YAML entrypoint without importing host-specific session declarations.
const containerlabSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Lab name" },
    topology: { type: "object", properties: { nodes: { type: "object" } } },
  },
};

const suggestions = buildContainerlabSchemaCompletionItems({
  text: "",
  lineNumber: 1,
  column: 1,
  schema: containerlabSchema,
  range: { startLineNumber: 1, endLineNumber: 1, startColumn: 1, endColumn: 1 },
  kinds: { property: 9, enumMember: 15, snippet: 27 },
  snippetInsertTextRule: 4,
});
if (!suggestions.some((item) => item.label === "topology"))
  throw new Error("Missing schema completions");
if (!getSchemaHoverInfo(["name"], containerlabSchema, {}))
  throw new Error("Missing schema hover");
if (
  typeof getKindImageGuidance !== "function" ||
  typeof isPlaceholderImageReference !== "function"
) {
  throw new Error("Missing catalog exports");
}
