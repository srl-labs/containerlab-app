/**
 * Import/export helpers for custom node templates.
 * Shared by the UI and both hosts (VS Code extension, standalone app) so the
 * file format and merge semantics stay identical everywhere.
 */
import type { CustomNodeTemplate } from "../types/editors";
import type { CustomIconInfo } from "../types/icons";
import { isRecord } from "./typeHelpers";

export const NODE_TEMPLATES_EXPORT_FILE_TYPE = "clab-node-templates";
export const NODE_TEMPLATES_EXPORT_VERSION = 2;
export const NODE_TEMPLATES_EXPORT_FILENAME = "clab-node-templates.json";

export interface CustomNodeTemplateExportIcon {
  name: string;
  dataUri: string;
  format: "svg" | "png";
}

export interface NodeTemplatesExportFile {
  fileType: typeof NODE_TEMPLATES_EXPORT_FILE_TYPE;
  version: number;
  templates: CustomNodeTemplate[];
  icons?: CustomNodeTemplateExportIcon[];
}

export interface ParseCustomNodeTemplatesExportFileResult {
  templates: CustomNodeTemplate[];
  icons: CustomNodeTemplateExportIcon[];
}

export interface MergeCustomNodeTemplatesResult {
  customNodes: CustomNodeTemplate[];
  added: number;
  replaced: number;
}

export function isCustomNodeTemplate(value: unknown): value is CustomNodeTemplate {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.kind === "string" &&
    value.kind.trim().length > 0
  );
}

function isCustomNodeTemplateExportIcon(value: unknown): value is CustomNodeTemplateExportIcon {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.dataUri === "string" &&
    value.dataUri.trim().length > 0 &&
    (value.format === "svg" || value.format === "png")
  );
}

export function collectCustomIconsForTemplates(
  templates: CustomNodeTemplate[],
  customIcons: CustomIconInfo[]
): CustomNodeTemplateExportIcon[] {
  const availableIcons = new Map<string, CustomNodeTemplateExportIcon>();
  for (const icon of customIcons) {
    availableIcons.set(icon.name, {
      name: icon.name,
      dataUri: icon.dataUri,
      format: icon.format
    });
  }

  const includedIcons = new Map<string, CustomNodeTemplateExportIcon>();
  for (const template of templates) {
    const iconName = typeof template.icon === "string" && template.icon.length > 0 ? template.icon : "pe";
    const icon = availableIcons.get(iconName);
    if (icon !== undefined) {
      includedIcons.set(icon.name, icon);
    }
  }
  return Array.from(includedIcons.values());
}

export function serializeCustomNodeTemplates(
  templates: CustomNodeTemplate[],
  icons: CustomNodeTemplateExportIcon[] = []
): string {
  const file: NodeTemplatesExportFile = {
    fileType: NODE_TEMPLATES_EXPORT_FILE_TYPE,
    version: NODE_TEMPLATES_EXPORT_VERSION,
    templates
  };
  if (icons.length > 0) {
    file.icons = icons;
  }
  return JSON.stringify(file, null, 2);
}

function extractTemplateEntries(parsed: unknown): { templates: unknown[]; icons: unknown[] } {
  if (Array.isArray(parsed)) {
    return { templates: parsed, icons: [] };
  }
  if (isRecord(parsed) && Array.isArray(parsed.templates)) {
    if (parsed.fileType !== undefined && parsed.fileType !== NODE_TEMPLATES_EXPORT_FILE_TYPE) {
      throw new Error(`Not a node templates file (fileType: ${String(parsed.fileType)})`);
    }
    const icons = Array.isArray(parsed.icons) ? parsed.icons : [];
    return { templates: parsed.templates, icons };
  }
  throw new Error('Expected a node templates file with a "templates" array');
}

function parseCustomNodeTemplateEntries(entries: unknown[]): CustomNodeTemplate[] {
  if (entries.length === 0) {
    throw new Error("File contains no node templates");
  }

  const templates: CustomNodeTemplate[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!isCustomNodeTemplate(entry)) {
      throw new Error(`Template at index ${index} is missing a valid "name" or "kind"`);
    }
    templates.push(entry);
  }

  // Last occurrence wins when the file itself repeats a name.
  const byName = new Map<string, CustomNodeTemplate>();
  for (const template of templates) {
    byName.set(template.name, template);
  }
  return Array.from(byName.values());
}

function parseCustomNodeTemplateIconEntries(entries: unknown[]): CustomNodeTemplateExportIcon[] {
  const icons: CustomNodeTemplateExportIcon[] = [];
  for (const [index, entry] of entries.entries()) {
    if (!isCustomNodeTemplateExportIcon(entry)) {
      throw new Error(`Icon at index ${index} is missing a valid "name", "dataUri", or "format"`);
    }
    icons.push(entry);
  }

  const byName = new Map<string, CustomNodeTemplateExportIcon>();
  for (const icon of icons) {
    byName.set(icon.name, icon);
  }
  return Array.from(byName.values());
}

export function parseCustomNodeTemplatesExportFile(
  content: string
): ParseCustomNodeTemplatesExportFileResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("File is not valid JSON");
  }

  const entries = extractTemplateEntries(parsed);
  return {
    templates: parseCustomNodeTemplateEntries(entries.templates),
    icons: parseCustomNodeTemplateIconEntries(entries.icons)
  };
}

/**
 * Parse exported node templates from file content.
 * Accepts the wrapped export format or a bare template array.
 * Throws with a user-facing message when the content is not valid.
 */
export function parseCustomNodeTemplatesExport(content: string): CustomNodeTemplate[] {
  return parseCustomNodeTemplatesExportFile(content).templates;
}

/**
 * Merge imported templates into the existing list.
 * Imported templates replace same-named existing ones in place; new templates
 * are appended. The result keeps at most one default: the current default wins
 * unless it was itself replaced by an imported template without the flag.
 */
export function mergeCustomNodeTemplates(
  existing: CustomNodeTemplate[],
  imported: CustomNodeTemplate[]
): MergeCustomNodeTemplatesResult {
  const existingDefaultName = existing.find((t) => t.setDefault === true)?.name;
  const merged = [...existing];
  let added = 0;
  let replaced = 0;

  for (const template of imported) {
    const index = merged.findIndex((t) => t.name === template.name);
    if (index >= 0) {
      merged[index] = template;
      replaced += 1;
    } else {
      merged.push(template);
      added += 1;
    }
  }

  const flagged = merged.filter((t) => t.setDefault === true).map((t) => t.name);
  let defaultName: string | undefined;
  if (existingDefaultName !== undefined && flagged.includes(existingDefaultName)) {
    defaultName = existingDefaultName;
  } else {
    defaultName = existingDefaultName ?? flagged[0];
  }

  const customNodes = merged.map((template) => {
    const isDefault = template.name === defaultName;
    if ((template.setDefault === true) === isDefault) return template;
    return { ...template, setDefault: isDefault };
  });

  return { customNodes, added, replaced };
}
