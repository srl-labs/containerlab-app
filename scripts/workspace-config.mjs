import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const readJson = (file) =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, file), "utf8"));
export const workspaceConfig = YAML.parse(
  fs.readFileSync(path.join(projectRoot, "pnpm-workspace.yaml"), "utf8"),
);
export const workspacePackages = fs
  .globSync(
    workspaceConfig.packages.map((pattern) => `${pattern}/package.json`),
    { cwd: projectRoot },
  )
  .sort()
  .map((file) => ({
    relativePath: path.dirname(file).replaceAll("\\", "/"),
    packageJson: readJson(file),
  }));
export function resolveCatalog(name, specifier) {
  if (!specifier.startsWith("catalog:")) return specifier;
  const catalog = specifier.slice("catalog:".length);
  return (
    catalog ? workspaceConfig.catalogs?.[catalog] : workspaceConfig.catalog
  )?.[name];
}
