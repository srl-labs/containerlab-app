import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { resolveRelease } from "./release-targets.mjs";
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
const tag = process.env.RELEASE_TAG || (process.env.GITHUB_REF?.startsWith("refs/tags/")
  ? process.env.GITHUB_REF.slice(10)
  : undefined);
let release;
if (tag) {
  try {
    release = resolveRelease(tag, readJson, process.argv[2], process.env.RELEASE_PRERELEASE || undefined);
  } catch (error) {
    failures.push(error.message);
  }
} else if (process.argv[2]) {
  failures.push("A target-specific release check requires RELEASE_TAG or a Git tag ref.");
}
for (const pkg of [
  { relativePath: ".", packageJson: root },
  ...workspacePackages,
]) {
  const manifest = pkg.packageJson;
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
if (release && process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(release).map(([key, value]) => `${key}=${value}\n`).join(""));
}
console.log(`Workspace checks passed${release ? ` for ${release.target} ${release.version}` : ""}.`);
