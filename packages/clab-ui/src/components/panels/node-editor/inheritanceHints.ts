// Helper texts that show which values a node inherits and from where.
import { deepEqual } from "../../../core/io/YamlDocumentIO";
import {
  describeInheritanceSource,
  type InheritedListField,
  type InheritedMapField,
  type InheritedScalarField
} from "../../../core/utilities/nodeInheritance";
import type { NodeScalarValue } from "../../../core/types/editors";
import { readConfigPath } from "../../../core/utilities/nodeOtherConfig";
import { isRecord } from "../../../core/utilities/typeHelpers";

import type { TabProps } from "./types";

function isEmpty(value: unknown): boolean {
  return (
    value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)
  );
}

/** "From kind linux", "Overrides group edge" or "Falls back to defaults"; undefined when not inherited. */
export function inheritedFieldHint(
  { data, inheritance }: Pick<TabProps, "data" | "inheritance">,
  field: InheritedScalarField | "kind" | "group"
): string | undefined {
  const source = inheritance?.fieldSource(field);
  if (!inheritance || !source) return undefined;
  const label = describeInheritanceSource(source);
  const current: unknown = Reflect.get(data, field);
  if (isEmpty(current)) return `Falls back to ${label}`;
  return deepEqual(current, Reflect.get(inheritance.values, field))
    ? `From ${label}`
    : `Overrides ${label}`;
}

/** Inherited entries of a key/value field, for KeyValueList */
export function inheritedMapEntries(
  { inheritance }: Pick<TabProps, "inheritance">,
  field: InheritedMapField
): Record<string, { source: string; value: NodeScalarValue }> | undefined {
  if (!inheritance) return undefined;
  const values = inheritance.values[field] ?? {};
  const entries: Record<string, { source: string; value: NodeScalarValue }> = {};
  for (const [key, source] of Object.entries(inheritance.mapEntries(field))) {
    if (Object.hasOwn(values, key)) {
      entries[key] = { source: describeInheritanceSource(source), value: values[key] };
    }
  }
  return entries;
}

/** Inherited items of a list field, for DynamicList */
export function inheritedListItems(
  { inheritance }: Pick<TabProps, "inheritance">,
  field: InheritedListField
): Map<string, string> | undefined {
  if (!inheritance) return undefined;
  const items = new Map<string, string>();
  for (const [item, source] of inheritance.listItems(field)) {
    items.set(item, describeInheritanceSource(source));
  }
  return items;
}

/** Hint for a kind-specific key (custom-prompt, daemons, ...), which is inherited whole. */
export function inheritedKindConfigHint(
  { data, inheritance }: Pick<TabProps, "data" | "inheritance">,
  key: string
): string | undefined {
  const source = inheritance?.kindConfigSource(key);
  if (!inheritance || !source) return undefined;
  const label = describeInheritanceSource(source);
  const current = data.kindConfig?.[key];
  if (isEmpty(current)) return `Falls back to ${label}`;
  return deepEqual(current, inheritance.values.kindConfig?.[key])
    ? `From ${label}`
    : `Overrides ${label}`;
}

/** Hint for a value of the Other tab at a YAML path (hostname, privileged, ...). */
export function inheritedPathHint(
  { data, inheritance }: Pick<TabProps, "data" | "inheritance">,
  path: readonly string[]
): string | undefined {
  const source = inheritance?.pathSource(path);
  if (!inheritance || !source) return undefined;
  const label = describeInheritanceSource(source);
  const current = readConfigPath(data.otherConfig, path);
  if (isEmpty(current)) return `Falls back to ${label}`;
  return deepEqual(current, readConfigPath(inheritance.values.otherConfig, path))
    ? `From ${label}`
    : `Overrides ${label}`;
}

/**
 * Inherited entries of a map of the Other tab (tmpfs, config.vars), for
 * KeyValueList, with each value as the text the list shows.
 */
export function inheritedPathEntries(
  { inheritance }: Pick<TabProps, "inheritance">,
  path: readonly string[],
  format: (value: unknown) => string
): Record<string, { source: string; value: string }> | undefined {
  if (!inheritance) return undefined;
  const values = readConfigPath(inheritance.values.otherConfig, path);
  const entries: Record<string, { source: string; value: string }> = {};
  if (!isRecord(values)) return entries;
  for (const [key, source] of Object.entries(inheritance.pathEntries(path))) {
    if (Object.hasOwn(values, key)) {
      entries[key] = { source: describeInheritanceSource(source), value: format(values[key]) };
    }
  }
  return entries;
}

/** Inherited items of a list of the Other tab (volumes, security-opts) */
export function inheritedKeyItems(
  { inheritance }: Pick<TabProps, "inheritance">,
  key: string
): Map<string, string> | undefined {
  if (!inheritance) return undefined;
  const items = new Map<string, string>();
  for (const [item, source] of inheritance.keyItems(key)) {
    items.set(item, describeInheritanceSource(source));
  }
  return items;
}
