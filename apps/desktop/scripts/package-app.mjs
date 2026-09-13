import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = fs.mkdtempSync(path.join(os.tmpdir(), "containerlab-desktop-"));
try {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  const config = manifest.build;
  config.directories = {
    ...config.directories,
    output: path.resolve(root, config.directories.output),
    buildResources: path.join(root, "build"),
  };
  config.icon = path.resolve(root, config.icon);
  config.afterPack = path.resolve(root, config.afterPack);
  for (const resource of config.extraResources)
    resource.from = path.resolve(root, resource.from);
  for (const platform of ["linux", "mac", "win"])
    config[platform].icon = path.resolve(root, config[platform].icon);
  config.nsis.include = path.resolve(root, config.nsis.include);
  fs.writeFileSync(
    path.join(stage, "electron-builder.json"),
    JSON.stringify(config),
  );
  // main.cjs bundles the server; Electron is supplied by electron-builder.
  for (const field of ["dependencies", "devDependencies", "scripts", "build"])
    delete manifest[field];
  fs.writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  fs.cpSync(path.join(root, "dist"), path.join(stage, "dist"), {
    recursive: true,
  });
  execFileSync(
    process.execPath,
    [
      require.resolve("electron-builder/cli.js"),
      ...process.argv.slice(2),
      "--config",
      path.join(stage, "electron-builder.json"),
    ],
    { cwd: stage, stdio: "inherit" },
  );
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
