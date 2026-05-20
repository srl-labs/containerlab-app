import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const scannedRoots = [
  "packages/standalone-runtime/src",
  "apps/web/src",
  "apps/desktop/src",
  "packages/app-server/src"
];
const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const nativePromptPattern = /\b(?:window|globalThis)\s*\.\s*(?:alert|confirm|prompt)\s*\(/;

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return collectSourceFiles(fullPath);
      }
      if (!entry.isFile() || !sourceExtensions.has(path.extname(entry.name))) {
        return [];
      }
      return [fullPath];
    })
  );
  return files.flat();
}

test("live source does not use native browser prompt APIs", async () => {
  const sourceFiles = (
    await Promise.all(
      scannedRoots.map((root) => collectSourceFiles(path.join(appRoot, root)))
    )
  ).flat();
  const offenders: string[] = [];

  for (const filePath of sourceFiles) {
    const content = await readFile(filePath, "utf8");
    if (nativePromptPattern.test(content)) {
      offenders.push(path.relative(appRoot, filePath));
    }
  }

  assert.deepEqual(offenders, []);
});
