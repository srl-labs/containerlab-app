import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
];

const rootPackage = readJson(path.join(projectRoot, "package.json"));
const packageLock = readJson(path.join(projectRoot, "package-lock.json"));
const workspacePackages = expandWorkspaces(rootPackage.workspaces ?? []);
const workspaceByName = new Map(workspacePackages.map((workspacePackage) => [
  workspacePackage.packageJson.name,
  workspacePackage
]));
const failures = [];

assertTagMatchesRootVersion();
assertTopLevelLockVersion();
assertLockPackage("", rootPackage);

for (const workspacePackage of workspacePackages) {
  assertWorkspaceVersion(workspacePackage);
  assertWorkspaceDependencyVersions(workspacePackage);
  assertLockPackage(workspacePackage.relativePath, workspacePackage.packageJson);
}

if (failures.length > 0) {
  console.error("Release version check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Release version check passed for ${rootPackage.version}.`);

function assertTagMatchesRootVersion() {
  const tagName = process.env.GITHUB_REF_NAME ?? parseTagName(process.env.GITHUB_REF);
  if (!tagName?.startsWith("v")) {
    return;
  }

  const tagVersion = tagName.slice(1);
  if (tagVersion !== rootPackage.version) {
    failures.push(
      `git tag ${tagName} does not match root package version ${rootPackage.version}`
    );
  }
}

function assertTopLevelLockVersion() {
  if (packageLock.version !== rootPackage.version) {
    failures.push(
      `package-lock.json version ${packageLock.version} does not match root package version ${rootPackage.version}`
    );
  }
}

function assertWorkspaceVersion(workspacePackage) {
  if (workspacePackage.packageJson.version !== rootPackage.version) {
    failures.push(
      `${workspacePackage.label} version ${workspacePackage.packageJson.version} does not match root version ${rootPackage.version}`
    );
  }
}

function assertWorkspaceDependencyVersions(workspacePackage) {
  for (const field of dependencyFields) {
    const dependencies = workspacePackage.packageJson[field] ?? {};
    for (const [dependencyName, dependencyVersion] of Object.entries(dependencies)) {
      const dependencyWorkspace = workspaceByName.get(dependencyName);
      if (!dependencyWorkspace) {
        continue;
      }

      if (dependencyVersion !== dependencyWorkspace.packageJson.version) {
        failures.push(
          `${workspacePackage.label} declares ${dependencyName}@${dependencyVersion} in ${field}, expected ${dependencyWorkspace.packageJson.version}`
        );
      }
    }
  }
}

function assertLockPackage(relativePath, packageJson) {
  const lockPackage = packageLock.packages?.[relativePath];
  const label = relativePath === "" ? "root lockfile package" : `${packageJson.name} lockfile package`;

  if (!lockPackage) {
    failures.push(`${label} is missing from package-lock.json`);
    return;
  }

  if (lockPackage.version !== packageJson.version) {
    failures.push(
      `${label} version ${lockPackage.version} does not match package.json version ${packageJson.version}`
    );
  }

  for (const field of dependencyFields) {
    const dependencies = packageJson[field] ?? {};
    const lockDependencies = lockPackage[field] ?? {};
    for (const [dependencyName, dependencyVersion] of Object.entries(dependencies)) {
      if (!workspaceByName.has(dependencyName)) {
        continue;
      }

      if (lockDependencies[dependencyName] !== dependencyVersion) {
        failures.push(
          `${label} has ${dependencyName}@${lockDependencies[dependencyName] ?? "<missing>"} in ${field}, expected ${dependencyVersion}`
        );
      }
    }
  }
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
      const packageJsonPath = path.join(workspacePath, "package.json");
      if (!fs.existsSync(packageJsonPath)) {
        continue;
      }

      const packageJson = readJson(packageJsonPath);
      packages.push({
        packageJson,
        path: workspacePath,
        relativePath: path.relative(projectRoot, workspacePath),
        label: `${packageJson.name ?? entry.name} (${path.relative(projectRoot, workspacePath)})`
      });
    }
  }

  return packages.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

function parseTagName(ref) {
  const tagPrefix = "refs/tags/";
  if (!ref?.startsWith(tagPrefix)) {
    return undefined;
  }
  return ref.slice(tagPrefix.length);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
