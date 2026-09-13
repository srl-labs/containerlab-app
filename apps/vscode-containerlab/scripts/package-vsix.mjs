import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectRoot, resolveCatalog, workspacePackages } from "../../../scripts/workspace-config.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "containerlab-vsix-"));
try {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  for (const field of [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies"
  ]) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      const version =
        spec === "workspace:*"
          ? workspacePackages.find((pkg) => pkg.packageJson.name === name)?.packageJson.version
          : resolveCatalog(name, spec);
      if (!version) throw new Error(`Cannot resolve ${name}@${spec}`);
      manifest[field][name] = version;
    }
  }
  // Build runs before staging; VSCE must not rebuild inside the isolated directory.
  delete manifest.scripts;
  for (const file of [
    "dist",
    "resources",
    "CHANGELOG.md",
    "LICENSE",
    ".vscodeignore"
  ]) {
    fs.cpSync(path.join(root, file), path.join(stage, file), { recursive: true });
  }
  fs.copyFileSync(path.join(projectRoot, "README.md"), path.join(stage, "README.md"));
  fs.writeFileSync(path.join(stage, "package.json"), JSON.stringify(manifest, null, 2));
  const output = path.resolve(
    root,
    process.argv[2] ?? `vscode-containerlab-${manifest.version}.vsix`
  );
  execFileSync(
    process.execPath,
    [
      require.resolve("@vscode/vsce/vsce"), "package", "--no-dependencies", "--out", output,
      "--baseContentUrl", "https://github.com/srl-labs/containerlab-app/blob/main/",
      "--baseImagesUrl", "https://raw.githubusercontent.com/srl-labs/containerlab-app/main/"
    ],
    { cwd: stage, stdio: "inherit" }
  );
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
