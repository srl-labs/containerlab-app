import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const localClabUiDistRoot = path.resolve(projectRoot, "../clab-ui/dist");
const viteCacheRoot = path.join(projectRoot, "node_modules/.vite");
const localClabUiHashFile = path.join(viteCacheRoot, "clab-ui-dist.hash");

const requiredFiles = [
  "index.js",
  "host/index.js",
  "session/index.js",
  "theme/index.js",
  "explorer/index.js",
  "inspect/index.js",
  "welcome/index.js",
  "node-impairments/index.js",
  "wireshark-vnc/index.js",
  "styles/global.css",
  "index.d.ts",
  "host/index.d.ts",
  "session/index.d.ts",
  "theme/index.d.ts",
  "explorer/index.d.ts",
  "inspect/index.d.ts",
  "welcome/index.d.ts",
  "node-impairments/index.d.ts",
  "wireshark-vnc/index.d.ts"
];

const missingFiles = requiredFiles.filter(
  (relativeFile) => !fs.existsSync(path.join(localClabUiDistRoot, relativeFile))
);

if (missingFiles.length === 0) {
  console.log(`Using local clab-ui dist at ${localClabUiDistRoot}`);
  invalidateViteCacheIfLocalClabUiChanged();
  process.exit(0);
}

console.error("Local clab-ui build output is missing required files:");
for (const missingFile of missingFiles) {
  console.error(`- ${path.join(localClabUiDistRoot, missingFile)}`);
}
console.error("");
console.error("Build clab-ui before running local mode:");
console.error("  cd ../clab-ui");
console.error("  npm install");
console.error("  npm run build");
process.exit(1);

function collectFiles(root, relativeDir = "") {
  const absoluteDir = path.join(root, relativeDir);
  const entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(root, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(relativePath);
    }
  }

  return files.sort();
}

function hashLocalClabUiDist() {
  const hash = crypto.createHash("sha256");
  for (const relativeFile of collectFiles(localClabUiDistRoot)) {
    const absoluteFile = path.join(localClabUiDistRoot, relativeFile);
    hash.update(relativeFile);
    hash.update("\0");
    hash.update(fs.readFileSync(absoluteFile));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function removeViteOptimizedDeps() {
  if (!fs.existsSync(viteCacheRoot)) {
    return false;
  }

  let removed = false;
  for (const entry of fs.readdirSync(viteCacheRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && (entry.name === "deps" || entry.name.startsWith("deps_temp_"))) {
      fs.rmSync(path.join(viteCacheRoot, entry.name), { recursive: true, force: true });
      removed = true;
    }
  }
  return removed;
}

function invalidateViteCacheIfLocalClabUiChanged() {
  const nextHash = hashLocalClabUiDist();
  const previousHash = fs.existsSync(localClabUiHashFile)
    ? fs.readFileSync(localClabUiHashFile, "utf8").trim()
    : "";

  if (previousHash === nextHash) {
    return;
  }

  const removed = removeViteOptimizedDeps();
  fs.mkdirSync(viteCacheRoot, { recursive: true });
  fs.writeFileSync(localClabUiHashFile, `${nextHash}\n`);

  if (removed) {
    console.log("Local clab-ui dist changed; cleared Vite optimized dependency cache.");
  }
}
