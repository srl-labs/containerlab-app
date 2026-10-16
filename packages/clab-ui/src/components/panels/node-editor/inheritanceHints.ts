// Helper texts that show which values a node inherits and from where.
import { deepEqual } from "../../../core/io/YamlDocumentIO";
import {
  describeInheritanceSource,
  type InheritedListField,
  type InheritedMapField,
  type InheritedScalarField
} from "../../../core/utilities/nodeInheritance";
import type { NodeScalarValue } from "../../../core/types/editors";

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
