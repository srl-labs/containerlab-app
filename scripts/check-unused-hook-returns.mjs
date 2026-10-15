import fs from "node:fs";
import path from "node:path";
import { parseSync } from "oxc-parser";
import { projectRoot, workspacePackages } from "./workspace-config.mjs";

// Reports fields that a custom hook returns but no caller reads. knip and the
// compiler only see whether the hook itself is used, not which of its returned
// fields are. The check is syntactic: a hook result that is passed on as a
// whole (spread, returned, given to a function, ...) counts as using every field.

const HOOK_NAME = /^use[A-Z0-9]/;
const SKIPPED_DIRECTORIES = /(^|\/)(node_modules|dist|out|build|release|coverage|\.vscode-test)$/;
const WRAPPERS = new Set([
  "ParenthesizedExpression",
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "AwaitExpression"
]);
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);
const workspaceNames = new Set(workspacePackages.map(({ packageJson }) => packageJson.name));

/** hook name -> [{ file, line, field }] */
const returnedFields = new Map();
/** hook name -> Set of fields read by callers */
const readFields = new Map();
/** hooks whose result escapes somewhere, so every field counts as read */
const escapedHooks = new Set();

function walk(node, visit, ancestors = []) {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, ancestors);
    return;
  }
  if (node === null || typeof node !== "object" || typeof node.type !== "string") return;
  if (visit(node, ancestors) === false) return;
  ancestors.push(node);
  for (const key in node) {
    const value = node[key];
    if (value !== null && typeof value === "object") walk(value, visit, ancestors);
  }
  ancestors.pop();
}

function propertyName(node, computed) {
  if (!computed && node.type === "Identifier") return node.name;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  return undefined;
}

function markRead(hook, field) {
  let fields = readFields.get(hook);
  if (!fields) readFields.set(hook, (fields = new Set()));
  fields.add(field);
}

/** Records the fields read by destructuring; returns false when that cannot be determined. */
function readPattern(hook, pattern) {
  if (pattern.type !== "ObjectPattern") return false;
  for (const property of pattern.properties) {
    const field = property.type === "Property" && propertyName(property.key, property.computed);
    if (field === undefined || field === false) return false;
    markRead(hook, field);
  }
  return true;
}

/** Follows `const result = useHook()` through `result.field` reads in the enclosing function. */
function readBinding(hook, binding, scope) {
  let escaped = false;
  walk(scope, (node, ancestors) => {
    if (escaped) return false;
    if (node === binding || node.type !== "Identifier" || node.name !== binding.name) return;
    const parent = ancestors.at(-1);
    if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
    if ((parent.type === "Property" && parent.key === node && !parent.shorthand) || parent.type === "TSPropertySignature") return;
    const field = parent.type === "MemberExpression" && parent.object === node && propertyName(parent.property, parent.computed);
    if (field) markRead(hook, field);
    else escaped = true;
  });
  return !escaped;
}

function recordCall(hook, call, ancestors) {
  let node = call;
  let index = ancestors.length - 1;
  while (WRAPPERS.has(ancestors[index]?.type)) node = ancestors[index--];
  const parent = ancestors[index];
  const scope = ancestors.findLast((ancestor) => FUNCTIONS.has(ancestor.type)) ?? ancestors[0];

  if (parent.type === "ExpressionStatement") return;
  if (parent.type === "MemberExpression" && parent.object === node) {
    const field = propertyName(parent.property, parent.computed);
    if (field !== undefined) return markRead(hook, field);
  } else if (parent.type === "VariableDeclarator" && parent.init === node) {
    if (parent.id.type === "Identifier" ? readBinding(hook, parent.id, scope) : readPattern(hook, parent.id)) return;
  } else if (parent.type === "AssignmentExpression" && parent.right === node) {
    if (readPattern(hook, parent.left)) return;
  }
  escapedHooks.add(hook);
}

function collectReturnedFields(hook, fn, file, lineOf) {
  const record = (object) => {
    for (const property of object.properties) {
      const field = property.type === "Property" && propertyName(property.key, property.computed);
      if (!field) continue;
      let fields = returnedFields.get(hook);
      if (!fields) returnedFields.set(hook, (fields = []));
      fields.push({ file, line: lineOf(property.start), field });
    }
  };
  const unwrap = (node) => (WRAPPERS.has(node?.type) ? unwrap(node.expression) : node);
  if (fn.expression) {
    const body = unwrap(fn.body);
    if (body.type === "ObjectExpression") record(body);
    return;
  }
  walk(fn.body, (node) => {
    if (FUNCTIONS.has(node.type)) return false;
    const argument = node.type === "ReturnStatement" && unwrap(node.argument);
    if (argument?.type === "ObjectExpression") record(argument);
  });
}

function isExternalImport(source) {
  if (source.startsWith(".")) return false;
  const name = source.startsWith("@") ? source.split("/", 2).join("/") : source.split("/")[0];
  return !workspaceNames.has(name);
}

function scanFile(file) {
  const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
  const { program, errors } = parseSync(file, source);
  if (errors.length > 0) throw new Error(`${file}: ${errors[0].message}`);

  const lineStarts = [0];
  for (let index = source.indexOf("\n"); index !== -1; index = source.indexOf("\n", index + 1)) lineStarts.push(index + 1);
  const lineOf = (offset) => {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (lineStarts[middle] <= offset) low = middle;
      else high = middle - 1;
    }
    return low + 1;
  };

  // Hooks from third-party packages share names with local ones (useTheme, ...).
  const externalHooks = new Set();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || !isExternalImport(statement.source.value)) continue;
    for (const specifier of statement.specifiers) externalHooks.add(specifier.local.name);
  }

  walk(program, (node, ancestors) => {
    if (node.type === "FunctionDeclaration" && node.id && HOOK_NAME.test(node.id.name)) {
      collectReturnedFields(node.id.name, node, file, lineOf);
    } else if (
      node.type === "VariableDeclarator" &&
      node.id.type === "Identifier" &&
      HOOK_NAME.test(node.id.name) &&
      FUNCTIONS.has(node.init?.type)
    ) {
      collectReturnedFields(node.id.name, node.init, file, lineOf);
    }

    if (node.type !== "Identifier" || !HOOK_NAME.test(node.name) || externalHooks.has(node.name)) return;
    const parent = ancestors.at(-1);
    if (parent.type === "CallExpression" && parent.callee === node) {
      recordCall(node.name, parent, ancestors.slice(0, -1));
    } else if (
      !(parent.type === "FunctionDeclaration" && parent.id === node) &&
      !(parent.type === "VariableDeclarator" && parent.id === node) &&
      !(parent.type === "MemberExpression" && parent.property === node && !parent.computed) &&
      !(parent.type === "Property" && parent.key === node && !parent.shorthand) &&
      !parent.type.startsWith("Import") &&
      !parent.type.startsWith("Export") &&
      !parent.type.startsWith("TS")
    ) {
      // Referenced without being called (passed around, aliased, ...).
      escapedHooks.add(node.name);
    }
  });
}

const files = fs
  .globSync("{apps,packages}/*/**/*.{ts,tsx,mts,cts}", {
    cwd: projectRoot,
    exclude: (entry) => SKIPPED_DIRECTORIES.test(entry)
  })
  .filter((file) => !file.endsWith(".d.ts"))
  .sort();
for (const file of files) scanFile(file);

const unused = [];
for (const [hook, fields] of returnedFields) {
  if (escapedHooks.has(hook)) continue;
  const read = readFields.get(hook);
  for (const { file, line, field } of fields) {
    if (!read?.has(field)) unused.push(`${file}:${line}  ${hook}() returns "${field}", but no caller reads it`);
  }
}

if (unused.length > 0) {
  console.error(`Unused hook return fields:\n${unused.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`No unused hook return fields in ${files.length} files.`);
}
