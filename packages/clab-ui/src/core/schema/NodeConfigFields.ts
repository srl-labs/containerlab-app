/**
 * Generic node keys read from the containerlab schema.
 *
 * Node keys without a hand-built form (hostname, privileged, tmpfs,
 * config.vars, ...) get one built from the `node-config` properties of the
 * schema, so a key added upstream shows up once the schema is synced.
 */
import {
  asSchema,
  cleanDescription,
  fieldControl,
  flatten,
  kindConfigLabel,
  typesOf,
  type JsonSchema,
  type KindConfigControl
} from "./KindSpecificConfig";

export type NodeConfigControl =
  | KindConfigControl
  /**
   * A map; `text` values are plain text (tmpfs options), `yaml` values may be
   * any YAML value (template variables) and are edited as YAML.
   */
  | { type: "map"; values: "text" | "yaml" };

export interface NodeConfigField {
  /** YAML path below the node, e.g. `["hostname"]` or `["config", "vars"]` */
  path: string[];
  label: string;
  description?: string;
  control: NodeConfigControl;
}

/** Nesting limit for objects whose properties become fields of their own */
const MAX_PATH_DEPTH = 3;

/** Wording the schema does not give, by dotted path */
const FIELD_TEXT: Partial<Record<string, { label?: string; description?: string }>> = {
  "config.vars": {
    label: "Startup Config Variables",
    description:
      "Variables for startup-config templates, read as .Config.Vars. Values are YAML, e.g., 65001 or [2, 4]."
  }
};

/** `[parent cgroup](https://...) for the container` → "parent cgroup for the container" */
function plainText(text: unknown): string | undefined {
  if (typeof text !== "string") return undefined;
  return text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/`/g, "");
}

function describe(schema: JsonSchema): string | undefined {
  return cleanDescription(plainText(schema.description) ?? plainText(schema.markdownDescription));
}

/** A free-form map takes text values when every value schema is a string. */
function mapValues(root: JsonSchema, schema: JsonSchema): "text" | "yaml" {
  const patterns = asSchema(schema.patternProperties);
  const valueSchemas = patterns ? Object.values(patterns) : [];
  if (valueSchemas.length === 0) return "yaml";
  const allText = valueSchemas.every((value) => {
    const types = typesOf(flatten(root, value) ?? {});
    return types.length === 1 && types[0] === "string";
  });
  return allText ? "text" : "yaml";
}

function objectFields(root: JsonSchema, path: string[], schema: JsonSchema): NodeConfigField[] {
  const properties = asSchema(schema.properties);
  if (properties && Object.keys(properties).length > 0 && path.length < MAX_PATH_DEPTH) {
    return Object.entries(properties).flatMap(([key, value]) =>
      buildFields(root, [...path, key], value)
    );
  }
  return [mapField(root, path, schema)];
}

function mapField(root: JsonSchema, path: string[], schema: JsonSchema): NodeConfigField {
  return withText({
    path,
    label: path.map(kindConfigLabel).join(" "),
    ...optionalDescription(describe(schema)),
    control: { type: "map", values: mapValues(root, schema) }
  });
}

function optionalDescription(description: string | undefined): { description?: string } {
  return description !== undefined ? { description } : {};
}

function withText(field: NodeConfigField): NodeConfigField {
  const text = FIELD_TEXT[field.path.join(".")];
  return text ? { ...field, ...text } : field;
}

function buildFields(root: JsonSchema, path: string[], value: unknown): NodeConfigField[] {
  const schema = flatten(root, value);
  if (!schema) return [];
  const types = typesOf(schema);
  if (types.length === 1 && types[0] === "object") return objectFields(root, path, schema);
  const description = describe(schema);
  const control = fieldControl(root, schema, description);
  // An item with several shapes or nested lists has no single form; it stays as written
  if (!control || control.type === "objectList") return [];
  return [
    withText({
      path,
      label: path.map(kindConfigLabel).join(" "),
      ...optionalDescription(description),
      control
    })
  ];
}

/**
 * Fields for the `node-config` keys of the schema that no other form edits,
 * in schema order. Keys without a fitting form are left out and kept as written.
 */
export function parseNodeConfigFields(
  schema: Record<string, unknown>,
  excludedKeys: ReadonlySet<string>
): NodeConfigField[] {
  const nodeConfig = asSchema(asSchema(schema.definitions)?.["node-config"]) ?? {};
  const properties = asSchema(nodeConfig.properties) ?? {};
  return Object.entries(properties)
    .filter(([key]) => !excludedKeys.has(key))
    .flatMap(([key, value]) => buildFields(schema, [key], value));
}
