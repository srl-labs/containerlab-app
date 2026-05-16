import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const managedDependencies = ["@srl-labs/clab-ui"];
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];
const sourceRoots = ["src", "server", "test"];
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx"
]);

const rootPackage = readJson(path.join(projectRoot, "package.json"));
const workspacePackages = expandWorkspaces(rootPackage.workspaces ?? []);
const failures = [];

for (const dependencyName of managedDependencies) {
  assertRootDoesNotDeclare(dependencyName);
  assertWorkspaceDependencyPolicy(dependencyName);
}

if (failures.length > 0) {
  console.error("Dependency policy check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Dependency policy check passed.");

function assertRootDoesNotDeclare(dependencyName) {
  const fields = declaredFields(rootPackage, dependencyName);
  if (fields.length === 0) {
    return;
  }

  failures.push(
    `root package.json declares ${dependencyName} in ${fields.join(", ")}; declare it in the importing workspace package instead`
  );
}

function assertWorkspaceDependencyPolicy(dependencyName) {
  const declaredVersions = new Map();

  for (const workspacePackage of workspacePackages) {
    const packageJsonPath = path.join(workspacePackage.path, "package.json");
    const packageJson = readJson(packageJsonPath);
    const importFiles = findImportFiles(workspacePackage.path, dependencyName);
    const fields = declaredFields(packageJson, dependencyName);
    const packageLabel = `${packageJson.name ?? workspacePackage.relativePath} (${workspacePackage.relativePath})`;
    const dependencyVersion = packageJson.dependencies?.[dependencyName];

    if (importFiles.length > 0 && dependencyVersion === undefined) {
      failures.push(
        `${packageLabel} imports ${dependencyName} but does not declare it in dependencies`
      );
    }

    if (importFiles.length === 0 && fields.length > 0) {
      failures.push(
        `${packageLabel} declares ${dependencyName} in ${fields.join(", ")} but has no source import`
      );
    }

    const nonRuntimeFields = fields.filter((field) => field !== "dependencies");
    if (nonRuntimeFields.length > 0) {
      failures.push(
        `${packageLabel} declares ${dependencyName} in ${nonRuntimeFields.join(", ")}; use dependencies for workspace source imports`
      );
    }

    if (dependencyVersion !== undefined) {
      const packages = declaredVersions.get(dependencyVersion) ?? [];
      packages.push(packageLabel);
      declaredVersions.set(dependencyVersion, packages);
    }
  }

  if (declaredVersions.size > 1) {
    const versions = Array.from(declaredVersions.entries())
      .map(([version, packages]) => `${version}: ${packages.join(", ")}`)
      .join("; ");
    failures.push(`${dependencyName} versions drift across workspace packages (${versions})`);
  }
}

function declaredFields(packageJson, dependencyName) {
  return dependencyFields.filter((field) => packageJson[field]?.[dependencyName] !== undefined);
}

function expandWorkspaces(workspaces) {
  const workspacePatterns = Array.isArray(workspaces) ? workspaces : workspaces.packages ?? [];
  const packages = [];

  for (const pattern of workspacePatterns) {
    if (!pattern.endsWith("/*")) {
      throw new Error(`Unsupported workspace pattern: ${pattern}`);
    }

    const parentDir = path.join(projectRoot, pattern.slice(0, -2));
    for (const entry of fs.readdirSync(parentDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const workspacePath = path.join(parentDir, entry.name);
      if (!fs.existsSync(path.join(workspacePath, "package.json"))) {
        continue;
      }

      packages.push({
        path: workspacePath,
        relativePath: path.relative(projectRoot, workspacePath)
      });
    }
  }

  return packages.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function findImportFiles(workspacePath, dependencyName) {
  const importFiles = [];
  const importPattern = new RegExp(
    [
      `from\\s+["']${escapeRegex(dependencyName)}(?:\\/[^"']*)?["']`,
      `import\\s+["']${escapeRegex(dependencyName)}(?:\\/[^"']*)?["']`,
      `import\\s*\\(\\s*["']${escapeRegex(dependencyName)}(?:\\/[^"']*)?["']\\s*\\)`,
      `require\\s*\\(\\s*["']${escapeRegex(dependencyName)}(?:\\/[^"']*)?["']\\s*\\)`
    ].join("|")
  );

  for (const sourceRoot of sourceRoots) {
    const sourceRootPath = path.join(workspacePath, sourceRoot);
    if (!fs.existsSync(sourceRootPath)) {
      continue;
    }

    for (const sourceFile of collectSourceFiles(sourceRootPath)) {
      const source = fs.readFileSync(sourceFile, "utf8");
      if (importPattern.test(source)) {
        importFiles.push(path.relative(workspacePath, sourceFile));
      }
    }
  }

  return importFiles.sort();
}

function collectSourceFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "release") {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }

    if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function escapeRegex(literal) {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
