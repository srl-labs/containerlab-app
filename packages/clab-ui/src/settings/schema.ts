/** Host-neutral settings schema and validation, shared by the form and extension host. */
export interface SettingSchema {
  type: string;
  default?: unknown;
  description?: string;
  markdownDescription?: string;
  enum?: string[];
  enumDescriptions?: string[];
  minimum?: number;
  maximum?: number;
  items?: SettingSchema;
  properties?: Record<string, SettingSchema>;
  required?: string[];
  additionalProperties?: boolean | SettingSchema;
}
export type SettingsCategory =
  "general" | "appearance" | "labs" | "topology" | "terminal" | "capture";
export interface SettingDefinition extends SettingSchema {
  key: string;
  title: string;
  category: SettingsCategory;
  reloadRequired: boolean;
}
export interface SettingValue {
  value: unknown;
  effectiveValue: unknown;
  overridden: boolean;
  workspaceOverride: boolean;
  scopeValue?: unknown;
}
export type SettingsTarget = "user" | "workspace";
export interface SettingsSnapshot {
  definitions: SettingDefinition[];
  values: Record<string, SettingValue>;
  target: SettingsTarget;
  workspaceAvailable: boolean;
  workspaceName?: string;
  remoteName?: string;
  version: string;
  vscodeVersion: string;
  reloadRequired?: boolean;
}
export interface SettingsChange {
  key: string;
  target: SettingsTarget;
  value?: unknown;
  reset?: boolean;
  expected: { overridden: boolean; scopeValue?: unknown };
}
const TITLES: Record<string, string> = {
  showWelcomePage: "Welcome page",
  skipUpdateCheck: "Skip update checks",
  binaryPath: "Containerlab binary",
  skipCleanupWarning: "Skip cleanup confirmation",
  "deploy.extraArgs": "Deploy arguments",
  "destroy.extraArgs": "Destroy arguments",
  drawioDefaultTheme: "Draw.io theme",
  "gotty.port": "GoTTY port",
  runtime: "Container runtime",
  dockerSocketPath: "Container socket",
  refreshMode: "Refresh mode",
  pollInterval: "Polling interval",
  enableInterfaceStats: "Interface statistics",
  "editor.customNodes": "Custom node templates",
  "editor.updateLinkEndpointsOnKindChange": "Update link endpoints",
  "editor.lockLabByDefault": "Lock canvas by default",
  "node.execCommandMapping": "Shell commands by node kind",
  "node.sshUserMapping": "SSH users by node kind",
  "node.telnetPort": "Telnet port",
  "extras.fcli.extraDockerArgs": "fcli container arguments",
  "capture.remoteHostname": "Capture hostname",
  "capture.packetflixPort": "Packetflix port",
  "capture.preferredAction": "Default capture method",
  "capture.wireshark.dockerImage": "Wireshark image",
  "capture.wireshark.pullPolicy": "Image pull policy",
  "capture.wireshark.theme": "Wireshark theme",
  "capture.wireshark.stayOpenInBackground": "Keep Wireshark running",
  "capture.wireshark.vncCaptureHostname": "Wireshark VNC hostname",
  "capture.edgeshark.extraEnvironmentVars": "Edgeshark environment variables",
  "appearance.colorScheme": "Color scheme",
  "appearance.fontSize": "Interface font size",
  "appearance.fontFamily": "Interface font family",
  "appearance.reduceMotion": "Reduce motion",
};
const RELOAD_KEYS = new Set([
  "binaryPath",
  "runtime",
  "dockerSocketPath",
  "refreshMode",
  "pollInterval",
  "enableInterfaceStats",
]);
function categoryFor(key: string): SettingsCategory {
  if (key.startsWith("appearance.")) return "appearance";
  if (key.startsWith("capture.")) return "capture";
  if (key.startsWith("editor.") || key === "drawioDefaultTheme")
    return "topology";
  if (
    key.startsWith("node.") ||
    key.startsWith("extras.") ||
    key.startsWith("gotty.")
  )
    return "terminal";
  if (
    key.startsWith("deploy.") ||
    key.startsWith("destroy.") ||
    key === "skipCleanupWarning"
  )
    return "labs";
  return "general";
}
export function createSettingsCatalog(
  groups: Array<{ properties: Record<string, SettingSchema> }>,
): SettingDefinition[] {
  return groups.flatMap((group) =>
    Object.entries(group.properties).map(([key, schema]) => {
      const shortKey = key.replace(/^containerlab\./, "");
      return {
        ...schema,
        key,
        title: TITLES[shortKey] ?? shortKey,
        category: categoryFor(shortKey),
        reloadRequired: RELOAD_KEYS.has(shortKey),
      };
    }),
  );
}
export function isSettingsRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function validateSetting(
  schema: SettingSchema,
  value: unknown,
  label = "Value",
): string | undefined {
  if (schema.type === "array") {
    if (!Array.isArray(value)) return `${label} must be a list.`;
    for (const [index, item] of value.entries()) {
      const error =
        schema.items &&
        validateSetting(schema.items, item, `${label}, item ${index + 1}`);
      if (error) return error;
    }
  } else if (schema.type === "object") {
    if (!isSettingsRecord(value)) return `${label} must be an object.`;
    for (const key of schema.required ?? []) {
      if (!(key in value) || value[key] === "")
        return `${label}: ${key} is required.`;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (!key.trim()) return `${label}: keys cannot be empty.`;
      if (["__proto__", "constructor", "prototype"].includes(key))
        return `${label}: unsupported key ${key}.`;
      const child =
        schema.properties?.[key] ??
        (typeof schema.additionalProperties === "object"
          ? schema.additionalProperties
          : undefined);
      if (!child && schema.additionalProperties === false)
        return `${label}: unknown property ${key}.`;
      const error = child && validateSetting(child, entry, `${label}: ${key}`);
      if (error) return error;
    }
  } else if (typeof value !== schema.type)
    return `${label} must be a ${schema.type}.`;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return `${label} must be a finite number.`;
    if (schema.minimum !== undefined && value < schema.minimum)
      return `${label} must be at least ${schema.minimum}.`;
    if (schema.maximum !== undefined && value > schema.maximum)
      return `${label} must be at most ${schema.maximum}.`;
  }
  if (schema.enum && !schema.enum.includes(String(value)))
    return `${label} must be one of: ${schema.enum.join(", ")}.`;
  return undefined;
}
export function validateSettingsChange(
  definition: SettingDefinition,
  value: unknown,
): string | undefined {
  const error = validateSetting(definition, value, definition.title);
  if (error) return error;
  if (definition.type === "number" && !Number.isInteger(value))
    return `${definition.title} must be a whole number.`;
  if (
    definition.key === "containerlab.appearance.fontSize" &&
    typeof value === "number" &&
    value !== 0 &&
    value < 10
  )
    return "Use 0 to follow VS Code, or a size from 10 to 24.";
  if (
    definition.key === "containerlab.editor.customNodes" &&
    Array.isArray(value)
  ) {
    const names = new Set<string>();
    let defaults = 0;
    for (const item of value as Record<string, unknown>[]) {
      const name = String(item.name).trim();
      if (!name || !String(item.kind).trim())
        return "Every template needs a name and a node kind.";
      if (names.has(name)) return `Template names must be unique: ${name}.`;
      names.add(name);
      if (item.setDefault === true) defaults++;
    }
    if (defaults > 1) return "Choose only one default node template.";
  }
  return undefined;
}
