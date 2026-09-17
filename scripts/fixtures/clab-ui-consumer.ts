import {
  buildContainerlabSchemaCompletionItems,
  getSchemaHoverInfo,
} from "@containerlab/clab-ui/yaml";
import {
  getKindImageGuidance,
  isPlaceholderImageReference,
} from "@containerlab/clab-ui/image-manager/catalog";

import { containerlabSchema as bundledSchema } from "@containerlab/clab-ui/session";
import { createClabUiRuntime } from "@containerlab/clab-ui/host";

if (typeof bundledSchema !== "object" || typeof createClabUiRuntime !== "function")
  throw new Error("Missing host/session runtime exports");

// Check the standalone YAML helpers against a minimal schema as well.
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
