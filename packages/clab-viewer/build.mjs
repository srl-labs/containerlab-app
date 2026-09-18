import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { build } from "vite";

const root = import.meta.dirname;
const require = createRequire(import.meta.url);
const typescript = require("typescript/package.json");
const tsc = path.resolve(path.dirname(require.resolve("typescript/package.json")), typescript.bin.tsc);
const declarations = await mkdtemp(path.join(os.tmpdir(), "clab-viewer-types-"));

try {
  await build({ configFile: path.join(root, "vite.config.ts") });
  execFileSync(process.execPath, [tsc, "-p", "tsconfig.build.json", "--outDir", declarations], {
    cwd: root,
    stdio: "inherit"
  });
  // Publish only the portable API; the shared implementation's declaration graph
  // belongs to clab-ui and would otherwise pull editor dependencies into consumers.
  const entry = await readFile(path.join(declarations, "clab-viewer/src/index.d.ts"), "utf8");
  await writeFile(path.join(root, "dist/index.d.ts"), entry.replaceAll("../../clab-ui/src/viewer/publicTypes", "./types.js"));
  await copyFile(path.join(declarations, "clab-ui/src/viewer/publicTypes.d.ts"), path.join(root, "dist/types.d.ts"));
  await copyFile(path.join(root, "src/styles.d.ts"), path.join(root, "dist/styles.d.ts"));
  await copyFile(path.join(root, "../../LICENSE"), path.join(root, "LICENSE"));
} finally {
  await rm(declarations, { recursive: true, force: true });
}
