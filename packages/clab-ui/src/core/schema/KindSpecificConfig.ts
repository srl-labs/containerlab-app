/**
 * Kind-specific config keys read from the containerlab schema.
 *
 * containerlab accepts some node keys only for certain kinds (`custom-prompt`
 * for nokia_srlinux, `daemons` for frr, ...). The schema lists them in the
 * `kind-specific-config-*` definitions: each definition forbids the keys its
 * kinds do not accept, and `node-config` picks the definition by kind. The
 * forms are built from this, so a key or kind added upstream shows up once
 * the schema is synced.
 */
import { isRecord } from "../utilities/typeHelpers";

const DEFINITION_PREFIX = "kind-specific-config-";
const REF_PREFIX = "#/definitions/";
/** Nesting limit for $ref / allOf resolution, against cycles */
const MAX_DEPTH = 8;

/** Value control of a single field or of a field in a list item. */
export type KindConfigScalarControl =
  | { type: "boolean"; defaultValue?: boolean }
  | { type: "string"; defaultValue?: string }
  | { type: "integer"; minimum?: number; maximum?: number }
  /** A number when the text is a whole number, text otherwise (slot `1` or `A`) */
  | { type: "integerOrString" }
  | { type: "enum"; options: Array<string | number> };

export type KindConfigControl =
  | KindConfigScalarControl
  /** A list of strings; with options, a pick from a fixed set */
  | { type: "stringList"; options?: string[] }
  /** A list of flat objects, one row per item */
  | { type: "objectList"; fields: KindConfigItemField[] };

export interface KindConfigItemField {
  key: string;
  label: string;
  description?: string;
  required: boolean;
  control: KindConfigScalarControl;
}

export interface KindConfigField {
  /** YAML key, e.g. `custom-prompt` */
  key: string;
  label: string;
  description?: string;
  /** How to edit the value; undefined when no form fits (the value is kept as written) */
  control?: KindConfigControl;
}

interface KindRule {
  /** Lowercase kind names; undefined for the rule that covers all other kinds */
  kinds?: string[];
  denied: Set<string>;
  /** Per-kind schema of a key, e.g. which component shape a kind takes */
  overrides: Record<string, unknown>;
}

export interface KindSpecificConfigSchema {
  /** Every kind-specific key, in schema order */
  keys: string[];
  /** Whether a kind accepts a key; containerlab reads kind names in lower case */
  accepts: (kind: string, key: string) => boolean;
  /** Kinds that name the key; "other kinds" stands for the catch-all rule */
  kindsAccepting: (key: string) => string[];
  /** Fields a kind accepts, in schema order */
  fieldsForKind: (kind: string) => KindConfigField[];
  /** Fields any kind accepts, for defaults and groups without a kind */
  allFields: () => KindConfigField[];
  /** Component keys the kind accepts (slot, type, mda, cpu, ...) */
  componentKeys: (kind: string) => Set<string>;
}

type JsonSchema = Record<string, unknown>;

function asSchema(value: unknown): JsonSchema | undefined {
  return isRecord(value) ? value : undefined;
}

function resolveRef(root: JsonSchema, value: unknown, depth = 0): JsonSchema | undefined {
  const schema = asSchema(value);
  if (!schema || depth > MAX_DEPTH) return schema;
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith(REF_PREFIX)) return schema;
  const target = resolveRef(root, asSchema(root.definitions)?.[ref.slice(REF_PREFIX.length)], depth + 1);
  const { $ref: _ref, ...rest } = schema;
  return { ...target, ...rest };
}

/** Merge `allOf` parts into one schema; later parts win per key. */
function flatten(root: JsonSchema, value: unknown, depth = 0): JsonSchema | undefined {
  const schema = resolveRef(root, value, depth);
  if (!schema || depth > MAX_DEPTH || !Array.isArray(schema.allOf)) return schema;
  const { allOf, ...rest } = schema;
  let merged: JsonSchema = {};
  for (const part of allOf) {
    const flat = flatten(root, part, depth + 1);
    if (!flat) continue;
    const properties = { ...asSchema(merged.properties), ...asSchema(flat.properties) };
    merged = { ...merged, ...flat, properties };
  }
  return { ...merged, ...rest };
}

/** Keys a schema forbids through `not: {anyOf: [{required: [...]}]}` or `not: {required}` */
function forbiddenKeys(schema: JsonSchema | undefined): string[] {
  const not = asSchema(schema?.not);
  if (!not) return [];
  const parts = Array.isArray(not.anyOf) ? not.anyOf : [not];
  return parts.flatMap((part) => {
    const required = asSchema(part)?.required;
    return Array.isArray(required)
      ? required.filter((key): key is string => typeof key === "string")
      : [];
  });
}

/** `^nokia_srsim$` or `^(frr|frrouting)$` → kind names */
function kindsFromPattern(pattern: string): string[] {
  return pattern
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/^\((.*)\)$/, "$1")
    .split("|")
    .map((kind) => kind.trim().toLowerCase())
    .filter((kind) => /^[\w.-]+$/.test(kind));
}

/** One `if kind matches → then kind-specific-config-*` entry of node-config */
function parseRule(definitions: JsonSchema, item: unknown): KindRule | undefined {
  const entry = asSchema(item);
  const ref = asSchema(entry?.then)?.$ref;
  if (typeof ref !== "string" || !ref.startsWith(REF_PREFIX + DEFINITION_PREFIX)) return undefined;
  const definition = asSchema(definitions[ref.slice(REF_PREFIX.length)]);
  const kindCondition = asSchema(asSchema(asSchema(entry?.if)?.properties)?.kind);
  if (!definition || !kindCondition) return undefined;
  const pattern = kindCondition.pattern;
  // A `not` pattern is the rule for every kind the other rules do not name
  const kinds = typeof pattern === "string" ? kindsFromPattern(pattern) : undefined;
  if (kinds?.length === 0) return undefined;
  return {
    kinds,
    denied: new Set(forbiddenKeys(definition)),
    overrides: asSchema(definition.properties) ?? {}
  };
}

function parseRules(root: JsonSchema, nodeConfig: JsonSchema): KindRule[] {
  const definitions = asSchema(root.definitions) ?? {};
  const allOf: unknown[] = Array.isArray(nodeConfig.allOf) ? nodeConfig.allOf : [];
  return allOf
    .map((item) => parseRule(definitions, item))
    .filter((rule): rule is KindRule => rule !== undefined);
}

const WORD_LABELS: Partial<Record<string, string>> = {
  eda: "EDA",
  grpc: "gRPC",
  pid: "PID",
  ssh: "SSH",
  sfm: "SFM",
  nics: "NICs",
  ram: "RAM",
  cpu: "CPU",
  intf: "Interface",
  gen: "Generate",
  mgmt: "Management",
  to: "to"
};

/** `eda-default-grpc-server` → "EDA Default gRPC Server" */
export function kindConfigLabel(key: string): string {
  return key
    .split("-")
    .map((word, index) => {
      const known = WORD_LABELS[word];
      if (known !== undefined && !(index === 0 && word === "to")) return known;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/** Drop the "(nokia_srlinux kind)" note: the form already shows the key for its kind. */
function cleanDescription(description: unknown): string | undefined {
  if (typeof description !== "string") return undefined;
  const text = description.replace(/\s*\([^()]*\bkinds?\)\s*\.?\s*$/, "").trim();
  if (text === "") return undefined;
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** "defaults to `true`" or "defaults to Ethernet0/0" → the default */
function describedDefault(description: string | undefined): string | undefined {
  const match = description?.match(/defaults to `?([^`\s,()]+?)`?(?=[\s,.)]|$)/);
  return match?.[1];
}

function enumValues(schema: JsonSchema): Array<string | number> | undefined {
  if (!Array.isArray(schema.enum)) return undefined;
  const values = schema.enum.filter(
    (value): value is string | number => typeof value === "string" || typeof value === "number"
  );
  return values.length > 0 ? values : undefined;
}

function typesOf(schema: JsonSchema): string[] {
  if (typeof schema.type === "string") return [schema.type];
  if (Array.isArray(schema.type)) return schema.type.filter((t): t is string => typeof t === "string");
  if (!Array.isArray(schema.anyOf)) return [];
  return schema.anyOf.flatMap((option) => {
    const part = asSchema(option);
    return part ? typesOf(part) : [];
  });
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function scalarControl(
  schema: JsonSchema,
  description: string | undefined
): KindConfigScalarControl | undefined {
  const options = enumValues(schema);
  if (options) return { type: "enum", options };
  const types = typesOf(schema);
  if (types.includes("integer") && types.includes("string")) return { type: "integerOrString" };
  if (types.includes("boolean")) {
    const fallback = describedDefault(description);
    return fallback === "true" || fallback === "false"
      ? { type: "boolean", defaultValue: fallback === "true" }
      : { type: "boolean" };
  }
  if (types.includes("integer") || types.includes("number")) {
    return {
      type: "integer",
      ...(numberOf(schema.minimum) !== undefined ? { minimum: numberOf(schema.minimum) } : {}),
      ...(numberOf(schema.maximum) !== undefined ? { maximum: numberOf(schema.maximum) } : {})
    };
  }
  if (types.includes("string") || types.length === 0) {
    const fallback = describedDefault(description);
    return fallback !== undefined ? { type: "string", defaultValue: fallback } : { type: "string" };
  }
  return undefined;
}

function itemFields(root: JsonSchema, item: JsonSchema): KindConfigItemField[] | undefined {
  const properties = asSchema(item.properties);
  if (!properties || Object.keys(properties).length === 0) return undefined;
  const required = Array.isArray(item.required) ? item.required : [];
  const fields: KindConfigItemField[] = [];
  for (const [key, value] of Object.entries(properties)) {
    const property = flatten(root, value);
    if (!property) return undefined;
    const description = cleanDescription(property.description);
    const control = scalarControl(property, description);
    // Nested lists or maps need their own editor (SR OS MDAs and XIOMs)
    if (!control || typesOf(property).some((t) => t === "array" || t === "object")) {
      return undefined;
    }
    fields.push({
      key,
      label: kindConfigLabel(key),
      ...(description !== undefined ? { description } : {}),
      required: required.includes(key),
      control
    });
  }
  return fields;
}

function fieldControl(
  root: JsonSchema,
  schema: JsonSchema,
  description: string | undefined
): KindConfigControl | undefined {
  if (!typesOf(schema).includes("array")) return scalarControl(schema, description);
  const items = flatten(root, schema.items);
  if (!items) return { type: "stringList" };
  // An item that may take several shapes has no single form
  if (Array.isArray(items.anyOf) && items.properties === undefined) return undefined;
  const options = enumValues(items);
  if (options) return { type: "stringList", options: options.map(String) };
  if (typesOf(items).includes("object") || items.properties !== undefined) {
    const fields = itemFields(root, items);
    return fields ? { type: "objectList", fields } : undefined;
  }
  return { type: "stringList" };
}

/** Parse the kind-specific config keys and the kinds that accept them from the schema. */
export function parseKindSpecificConfig(schema: Record<string, unknown>): KindSpecificConfigSchema {
  const definitions = asSchema(schema.definitions) ?? {};
  const nodeConfig = asSchema(definitions["node-config"]) ?? {};
  const properties = asSchema(nodeConfig.properties) ?? {};
  const rules = parseRules(schema, nodeConfig);

  const keySet = new Set<string>();
  for (const rule of rules) {
    for (const key of rule.denied) keySet.add(key);
    for (const key of Object.keys(rule.overrides)) keySet.add(key);
  }
  const order = Object.keys(properties);
  const keys = [...keySet].sort((a, b) => {
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    return (ia < 0 ? order.length : ia) - (ib < 0 ? order.length : ib) || a.localeCompare(b);
  });

  const ruleFor = (kind: string): KindRule | undefined => {
    const name = kind.trim().toLowerCase();
    return (
      rules.find((rule) => rule.kinds?.includes(name) === true) ??
      rules.find((rule) => rule.kinds === undefined)
    );
  };
  const accepts = (kind: string, key: string): boolean => {
    const rule = ruleFor(kind);
    return keySet.has(key) && rule !== undefined && !rule.denied.has(key);
  };

  const buildField = (key: string, override: unknown): KindConfigField => {
    const base = asSchema(properties[key]) ?? {};
    const merged = flatten(schema, { ...base, ...asSchema(override) }) ?? base;
    const description = cleanDescription(merged.description ?? base.description);
    const control = fieldControl(schema, merged, description);
    return {
      key,
      label: kindConfigLabel(key),
      ...(description !== undefined ? { description } : {}),
      ...(control ? { control } : {})
    };
  };

  return {
    keys,
    accepts,
    kindsAccepting: (key) =>
      rules
        .filter((rule) => !rule.denied.has(key))
        .flatMap((rule) => rule.kinds ?? ["other kinds"]),
    fieldsForKind: (kind) => {
      const rule = ruleFor(kind);
      if (!rule) return [];
      return keys
        .filter((key) => !rule.denied.has(key))
        .map((key) => buildField(key, rule.overrides[key]));
    },
    allFields: () =>
      keys
        .filter((key) => rules.some((rule) => !rule.denied.has(key)))
        .map((key) => buildField(key, undefined)),
    componentKeys: (kind) => {
      const rule = ruleFor(kind);
      if (!rule || rule.denied.has("components")) return new Set();
      const merged = flatten(schema, { ...asSchema(properties.components), ...asSchema(rule.overrides.components) });
      const items = asSchema(merged?.items);
      const parts = Array.isArray(items?.allOf) ? items.allOf : [items];
      const accepted = new Set<string>();
      const denied = new Set<string>();
      for (const part of parts) {
        const flat = flatten(schema, part);
        for (const key of Object.keys(asSchema(flat?.properties) ?? {})) accepted.add(key);
        for (const key of forbiddenKeys(flat)) denied.add(key);
      }
      return new Set([...accepted].filter((key) => !denied.has(key)));
    }
  };
}
