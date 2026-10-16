import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { LabBackendError } from "@srl-labs/containerlab-lab-backend";
import type { CustomNodesResponse, IconListResponse } from "@srl-labs/containerlab-lab-backend";

import type { EndpointUiStore } from "./uiStore.ts";

type CustomNode = Record<string, unknown>;
type IconInfo = IconListResponse["icons"][number];

const ICON_EXTENSIONS = [".svg", ".png"];
const BUILT_IN_ICONS = new Set([
  "pe",
  "dcgw",
  "leaf",
  "switch",
  "bridge",
  "spine",
  "super-spine",
  "server",
  "pon",
  "controller",
  "rgw",
  "ue",
  "cloud",
  "client"
]);
const DEPRECATED_SRLINUX_TYPES: Record<string, string> = {
  ixsa1: "ixs-a1",
  ixrd1: "ixr-d1",
  ixrd2: "ixr-d2",
  ixrd3: "ixr-d3",
  ixrd2l: "ixr-d2l",
  ixrd3l: "ixr-d3l",
  ixrd4: "ixr-d4",
  ixrd5: "ixr-d5",
  ixrh2: "ixr-h2",
  ixrh3: "ixr-h3",
  ixrh4: "ixr-h4",
  ixrh432d: "ixr-h4-32d",
  ixrh5: "ixr-h5",
  ixrh532d: "ixr-h5-32d",
  ixrh564d: "ixr-h5-64d",
  ixrh564o: "ixr-h5-64o",
  ixr6: "ixr-6",
  ixr6e: "ixr-6e",
  ixr10: "ixr-10",
  ixr10e: "ixr-10e",
  ixr18e: "ixr-18e",
  sxr1x44s: "sxr-1x-44s",
  sxr1d32d: "sxr-1d-32d",
  ixrx1b: "ixr-x1b",
  ixrx3b: "ixr-x3b"
};

function defaultCustomNodes(): CustomNode[] {
  return [
    {
      name: "SRLinux Latest",
      kind: "nokia_srlinux",
      type: "ixr-d1",
      image: "ghcr.io/nokia/srlinux:latest",
      icon: "router",
      baseName: "srl",
      interfacePattern: "e1-{n}",
      setDefault: true
    },
    {
      name: "Network Multitool",
      kind: "linux",
      image: "ghcr.io/srl-labs/network-multitool:latest",
      icon: "client",
      baseName: "client",
      interfacePattern: "eth{n}",
      setDefault: false
    }
  ];
}

function stringField(node: CustomNode, key: string): string {
  const value = node[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Renames deprecated SR Linux types and keeps only the first default node. */
function normalizeCustomNodes(nodes: CustomNode[]): CustomNode[] {
  let defaultSeen = false;
  return nodes.map((source) => {
    const node = { ...source };
    const alias = DEPRECATED_SRLINUX_TYPES[stringField(node, "type")];
    if (stringField(node, "kind") === "nokia_srlinux" && alias !== undefined) node.type = alias;
    if (node.setDefault === true) {
      if (defaultSeen) node.setDefault = false;
      defaultSeen = true;
    }
    return node;
  });
}

function response(nodes: CustomNode[]): CustomNodesResponse {
  const normalized = normalizeCustomNodes(nodes);
  const defaultNode = normalized.find((node) => node.setDefault === true);
  return {
    customNodes: normalized as CustomNodesResponse["customNodes"],
    defaultNode: defaultNode ? stringField(defaultNode, "name") : ""
  };
}

function validate(node: CustomNode): void {
  if (!stringField(node, "name")) throw new LabBackendError("Custom node name is required", 400);
  if (!stringField(node, "kind")) throw new LabBackendError("Custom node kind is required", 400);
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

/** An icon file name as a safe icon name: lower case, `[a-z0-9_-]`, single dashes. */
function sanitizeIconName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName)).toLowerCase();
  let result = "";
  for (const char of base) {
    if (/[a-z0-9_-]/.test(char)) {
      result += char;
    } else if (!result.endsWith("-")) {
      result += "-";
    }
  }
  return result.replace(/-{2,}/g, "-").replace(/^-+|-+$/g, "");
}

function isValidIconName(name: string): boolean {
  return /^[a-z0-9_-]+$/.test(name);
}

async function iconPath(directory: string, name: string): Promise<{ file: string; ext: string } | undefined> {
  if (!isValidIconName(name)) return undefined;
  for (const ext of ICON_EXTENSIONS) {
    const file = path.join(directory, `${name}${ext}`);
    try {
      await fs.access(file);
      return { file, ext };
    } catch {
      // Try the next extension.
    }
  }
  return undefined;
}

async function listIcons(directory: string, source: "global" | "workspace"): Promise<IconInfo[]> {
  let names: string[];
  try {
    names = (await fs.readdir(directory)).sort();
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const icons: IconInfo[] = [];
  for (const name of names) {
    const ext = path.extname(name).toLowerCase();
    if (!ICON_EXTENSIONS.includes(ext)) continue;
    const body = await fs.readFile(path.join(directory, name));
    icons.push({
      name: name.slice(0, -ext.length),
      source,
      dataUri: `data:${ext === ".png" ? "image/png" : "image/svg+xml"};base64,${body.toString("base64")}`,
      format: ext === ".png" ? "png" : "svg"
    } as IconInfo);
  }
  return icons;
}

export interface LocalUiStoreOptions {
  /** Folder of the user's containerlab data; custom nodes and icons live here. Default `~/.clab`. */
  clabDirectory?: string;
  /** Lab workspace root; a lab's icons live in `<lab>/.clab-icons`. */
  workspaceRoot: string;
}

/**
 * Custom node templates and icons on this machine, in the same files and with
 * the same rules as clab-api-server, so both see the same templates.
 */
export function createLocalUiStore(options: LocalUiStoreOptions): EndpointUiStore {
  const clabDirectory = options.clabDirectory ?? path.join(os.homedir(), ".clab");
  const customNodesFile = path.join(clabDirectory, "ui", "custom-nodes.json");
  const globalIcons = path.join(clabDirectory, "icons");
  const labIcons = (labName: string) => {
    if (!/^[a-zA-Z0-9_-]+$/.test(labName)) throw new LabBackendError(`Invalid lab name '${labName}'`, 400);
    return path.join(options.workspaceRoot, labName, ".clab-icons");
  };

  const load = async (): Promise<CustomNode[]> => {
    try {
      const parsed = JSON.parse(await fs.readFile(customNodesFile, "utf8")) as unknown;
      return Array.isArray(parsed) ? (parsed as CustomNode[]) : [];
    } catch (error) {
      if (isMissing(error)) return defaultCustomNodes();
      throw error;
    }
  };
  const save = async (nodes: CustomNode[]): Promise<CustomNodesResponse> => {
    const normalized = normalizeCustomNodes(nodes);
    await fs.mkdir(path.dirname(customNodesFile), { recursive: true, mode: 0o750 });
    await fs.writeFile(customNodesFile, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o640 });
    return response(normalized);
  };

  return {
    async getCustomNodes() {
      return response(await load());
    },
    async replaceCustomNodes(customNodes) {
      customNodes.forEach(validate);
      return save(customNodes);
    },
    async saveCustomNode(customNode) {
      validate(customNode);
      const { oldName, ...node } = customNode;
      const match = typeof oldName === "string" && oldName.trim() ? oldName.trim() : stringField(node, "name");
      let nodes = await load();
      if (node.setDefault === true) nodes = nodes.map((entry) => ({ ...entry, setDefault: false }));
      const index = nodes.findIndex((entry) => stringField(entry, "name") === match);
      if (index >= 0) nodes[index] = node;
      else nodes.push(node);
      return save(nodes);
    },
    async deleteCustomNode(name) {
      return save((await load()).filter((entry) => stringField(entry, "name") !== name));
    },
    async setDefaultCustomNode(name) {
      const nodes = await load();
      if (!nodes.some((entry) => stringField(entry, "name") === name)) {
        throw new LabBackendError("Custom node not found", 404);
      }
      return save(nodes.map((entry) => ({ ...entry, setDefault: stringField(entry, "name") === name })));
    },
    async listLabIcons(labName) {
      const merged = new Map<string, IconInfo>();
      for (const icon of await listIcons(globalIcons, "global")) merged.set(icon.name, icon);
      for (const icon of await listIcons(labIcons(labName), "workspace")) merged.set(icon.name, icon);
      return { icons: [...merged.values()].sort((left, right) => left.name.localeCompare(right.name)) };
    },
    async uploadGlobalIcon(request) {
      const ext = path.extname(request.fileName).toLowerCase();
      if (!ICON_EXTENSIONS.includes(ext)) {
        throw new LabBackendError("Only .svg and .png icons are supported", 400);
      }
      const base = sanitizeIconName(request.fileName);
      if (!base) throw new LabBackendError("Invalid icon name", 400);
      if (BUILT_IN_ICONS.has(base)) {
        throw new LabBackendError(`'${base}' is a built-in icon name`, 409);
      }
      await fs.mkdir(globalIcons, { recursive: true, mode: 0o750 });
      let iconName = base;
      for (let counter = 1; await iconPath(globalIcons, iconName); counter += 1) {
        iconName = `${base}-${counter}`;
      }
      await fs.writeFile(path.join(globalIcons, `${iconName}${ext}`), Buffer.from(request.dataBase64, "base64"), {
        mode: 0o640
      });
      return { success: true, iconName };
    },
    async deleteGlobalIcon(iconName) {
      let deleted = false;
      if (isValidIconName(iconName)) {
        for (const ext of ICON_EXTENSIONS) {
          try {
            await fs.unlink(path.join(globalIcons, `${iconName}${ext}`));
            deleted = true;
          } catch (error) {
            if (!isMissing(error)) throw error;
          }
        }
      }
      if (!deleted) throw new LabBackendError("Icon not found", 404);
    },
    async reconcileLabIcons(labName, usedIcons) {
      const directory = labIcons(labName);
      const used = new Set(
        usedIcons.map((name) => name.trim()).filter((name) => isValidIconName(name) && !BUILT_IN_ICONS.has(name))
      );
      if (used.size > 0) await fs.mkdir(directory, { recursive: true, mode: 0o750 });
      for (const name of used) {
        if (await iconPath(directory, name)) continue;
        const source = await iconPath(globalIcons, name);
        if (source) await fs.copyFile(source.file, path.join(directory, `${name}${source.ext}`));
      }
      for (const icon of await listIcons(directory, "workspace")) {
        if (used.has(icon.name)) continue;
        for (const ext of ICON_EXTENSIONS) {
          await fs.rm(path.join(directory, `${icon.name}${ext}`), { force: true });
        }
      }
      try {
        if ((await fs.readdir(directory)).length === 0) await fs.rmdir(directory);
      } catch {
        // Already gone.
      }
    }
  };
}
