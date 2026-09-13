import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import {
  projectRoot,
  readJson,
  workspacePackages,
  resolveCatalog,
  workspaceConfig,
} from "./workspace-config.mjs";

const root = readJson("package.json");
const lock = YAML.parse(
  fs.readFileSync(path.join(projectRoot, "pnpm-lock.yaml"), "utf8"),
);
const byName = new Map(
  workspacePackages.map((pkg) => [pkg.packageJson.name, pkg]),
);
const failures = [];
const tag = process.env.GITHUB_REF?.startsWith("refs/tags/")
  ? process.env.GITHUB_REF.slice(10)
  : undefined;
if (tag) {
  const releases = [
    ["vscode-v", byName.get("vscode-containerlab").packageJson.version],
    ["clab-ui-v", byName.get("@srl-labs/clab-ui").packageJson.version],
    ["v", root.version],
  ];
  const release = releases.find(([prefix]) => tag.startsWith(prefix));
  if (release && tag.slice(release[0].length) !== release[1])
    failures.push(`Tag ${tag} does not match version ${release[1]}`);
}
for (const pkg of [
  { relativePath: ".", packageJson: root },
  ...workspacePackages,
]) {
  const manifest = pkg.packageJson;
  if (manifest.private && manifest.version !== root.version)
    failures.push(`${manifest.name} must match app version ${root.version}`);
  const importer = lock.importers?.[pkg.relativePath];
  if (!importer) {
    failures.push(`Missing lockfile importer ${pkg.relativePath}`);
    continue;
  }
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (byName.has(name) && spec !== "workspace:*")
        failures.push(`${manifest.name}: ${name} must use workspace:*`);
      const entry = importer[field]?.[name];
      if (entry?.specifier !== (workspaceConfig.overrides?.[name] ?? spec))
        failures.push(
          `${manifest.name}: lockfile specifier for ${name} is stale`,
        );
      if (byName.has(name)) {
        const expected = `link:${path.relative(pkg.relativePath, byName.get(name).relativePath).replaceAll("\\", "/")}`;
        if (entry?.version !== expected)
          failures.push(
            `${manifest.name}: ${name} must resolve to ${expected}`,
          );
      } else if (!resolveCatalog(name, spec))
        failures.push(`${manifest.name}: missing catalog entry for ${name}`);
    }
  }
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`Release and workspace link checks passed for ${root.version}.`);
