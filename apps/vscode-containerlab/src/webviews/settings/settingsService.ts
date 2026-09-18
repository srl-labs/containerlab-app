import * as vscode from "vscode";
import {
  createSettingsCatalog,
  isSettingsRecord,
  validateSettingsChange,
  type SettingSchema,
  type SettingsChange,
  type SettingsSnapshot,
  type SettingsTarget,
  type SettingValue
} from "@containerlab/clab-ui/settings/schema";

export class SettingsService {
  private readonly definitions;
  private readonly changed = new Set<string>();
  private readonly initialValues = new Map<string, unknown>();

  constructor(private readonly context: vscode.ExtensionContext) {
    const manifest = context.extension.packageJSON as {
      contributes: { configuration: Array<{ properties: Record<string, SettingSchema> }> };
    };
    this.definitions = createSettingsCatalog(manifest.contributes.configuration);
    for (const setting of this.definitions) {
      if (setting.reloadRequired)
        this.initialValues.set(setting.key, vscode.workspace.getConfiguration().get(setting.key));
    }
  }

  snapshot(target: SettingsTarget): SettingsSnapshot {
    if (
      target === "workspace" &&
      !vscode.workspace.workspaceFolders?.length &&
      !vscode.workspace.workspaceFile
    ) {
      throw new Error("Open a folder or workspace before editing workspace settings.");
    }
    const config = vscode.workspace.getConfiguration();
    const values: Record<string, SettingValue> = {};
    for (const definition of this.definitions) {
      const inspected = config.inspect(definition.key);
      const scopeValue = target === "user" ? inspected?.globalValue : inspected?.workspaceValue;
      const defaultValue = inspected?.defaultValue ?? definition.default;
      const userValue = mergeValue(defaultValue, inspected?.globalValue);
      values[definition.key] = {
        value: target === "user" ? userValue : mergeValue(userValue, inspected?.workspaceValue),
        effectiveValue: config.get(definition.key),
        overridden: scopeValue !== undefined,
        workspaceOverride: target === "user" && inspected?.workspaceValue !== undefined,
        ...(scopeValue !== undefined ? { scopeValue } : {})
      };
    }
    return {
      definitions: this.definitions,
      values,
      target,
      workspaceAvailable: Boolean(
        vscode.workspace.workspaceFolders?.length || vscode.workspace.workspaceFile
      ),
      workspaceName: vscode.workspace.name,
      remoteName: vscode.env.remoteName,
      version: (this.context.extension.packageJSON as { version: string }).version,
      vscodeVersion: vscode.version,
      reloadRequired: [...this.changed].some(
        (key) => JSON.stringify(config.get(key)) !== JSON.stringify(this.initialValues.get(key))
      )
    };
  }

  async change(input: unknown): Promise<SettingsSnapshot> {
    if (
      !isSettingsRecord(input) ||
      typeof input.key !== "string" ||
      !["user", "workspace"].includes(String(input.target)) ||
      !isSettingsRecord(input.expected)
    ) {
      throw new Error("Invalid settings request.");
    }
    const change = input as unknown as SettingsChange;
    const definition = this.definitions.find((setting) => setting.key === change.key);
    if (!definition) throw new Error("This setting is not managed by Containerlab.");
    const current = this.snapshot(change.target).values[change.key];
    if (
      current.overridden !== change.expected.overridden ||
      JSON.stringify(current.scopeValue) !== JSON.stringify(change.expected.scopeValue)
    ) {
      throw new Error("This setting changed elsewhere. Refresh its value before saving again.");
    }
    if (!change.reset) {
      const error = validateSettingsChange(definition, change.value);
      if (error) throw new Error(error);
    }
    await vscode.workspace
      .getConfiguration()
      .update(
        change.key,
        change.reset ? undefined : change.value,
        change.target === "user"
          ? vscode.ConfigurationTarget.Global
          : vscode.ConfigurationTarget.Workspace
      );
    if (definition.reloadRequired) this.changed.add(change.key);
    return this.snapshot(change.target);
  }
}

function mergeValue(base: unknown, override: unknown): unknown {
  if (override === undefined) return base;
  if (isSettingsRecord(base) && isSettingsRecord(override)) {
    const merged = { ...base };
    for (const [key, value] of Object.entries(override)) merged[key] = mergeValue(base[key], value);
    return merged;
  }
  return override;
}
