import type { SettingDefinition, SettingValue } from "./schema";
export type SettingsFilter = "all" | "modified-view" | "modified-all";

export function filterSettings(
  definitions: SettingDefinition[],
  values: Record<string, SettingValue>,
  category: string,
  search: string,
  filter: SettingsFilter,
) {
  const query = search.trim().toLowerCase();
  const currentModified = definitions.filter(
    (definition) =>
      definition.category === category && values[definition.key].overridden,
  ).length;
  const allModified = definitions.filter(
    (definition) => values[definition.key].overridden,
  ).length;
  const visible = definitions.filter((definition) => {
    if (filter !== "all" && !values[definition.key].overridden) return false;
    if (filter === "modified-view" && definition.category !== category)
      return false;
    if (
      filter === "all" &&
      query.length === 0 &&
      definition.category !== category
    )
      return false;
    return (
      query.length === 0 ||
      `${definition.title} ${definition.key} ${definition.description ?? definition.markdownDescription ?? ""}`
        .toLowerCase()
        .includes(query)
    );
  });
  return { visible, currentModified, allModified };
}
