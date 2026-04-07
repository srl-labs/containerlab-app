import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const localClabUiDistRoot = path.resolve(projectRoot, "../clab-ui/dist");

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
