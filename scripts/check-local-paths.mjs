import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Absolute paths from the build machine expose the publisher's home directory
// and point nowhere for consumers, so a packed package must not contain any.
export function assertNoLocalPaths(packageRoot, checkoutRoot) {
  const needles = new Set();
  for (const directory of [checkoutRoot, os.homedir()]) {
    // Skip shallow paths such as "/root", which also appear in ordinary text.
    if (directory.split(/[\\/]/).filter(Boolean).length < 2) continue;
    needles.add(`${directory}${path.sep}`);
    needles.add(`${directory.replaceAll("\\", "/")}/`);
  }
  const leaks = [];
  for (const entry of fs.readdirSync(packageRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    const content = fs.readFileSync(file, "latin1");
    for (const needle of needles) {
      if (content.includes(needle)) leaks.push(`${path.relative(packageRoot, file)} contains ${needle}`);
    }
  }
  if (leaks.length > 0) throw new Error(`Packed files contain local paths:\n${leaks.join("\n")}`);
}
