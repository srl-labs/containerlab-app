import Ajv from "ajv";
import type * as monaco from "@srl-labs/clab-ui/monaco/core";
import {
  containerlabSchema,
  extractTypesByKindFromSchema,
} from "@srl-labs/clab-ui/session";
import * as YAML from "yaml";

type MonacoApi = typeof monaco;
type SchemaRecord = Record<string, unknown>;
type CompletionContext = "briefEndpoint" | "extendedEndpointNode";
type CompletionValue = string | number | boolean;

const MARKER_OWNER = "containerlab-file-yaml-schema";
const VALIDATION_DEBOUNCE_MS = 250;
const STRUCTURAL_AJV_KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
]);
const CONTAINERLAB_SCHEMA = containerlabSchema as SchemaRecord;
const registeredModelUris = new Set<string>();
const validatorCache = new WeakMap<object, ReturnType<Ajv["compile"]>>();
const ajv = new Ajv({ allErrors: true, strict: false });

let hoverDisposable: monaco.IDisposable | null = null;
let completionDisposable: monaco.IDisposable | null = null;

const YAML_COMPLETION_TRIGGER_CHARACTERS = [
  ":",
  "-",
  "[",
  ",",
  "_",
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split(""),
];

const ROOT_SNIPPET = {
  label: "containerlab topology",
  detail: "Create a basic containerlab topology",
  insertText:
    "name: ${1:lab}\ntopology:\n  nodes:\n    ${2:srl1}:\n      kind: ${3:nokia_srlinux}\n      image: ${4:ghcr.io/nokia/srlinux:latest}",
  sortText: "000-containerlab-topology",
};

const TOPOLOGY_SNIPPETS = [
  {
    label: "nodes",
    detail: "Add a topology nodes section",
    insertText:
      "nodes:\n  ${1:srl1}:\n    kind: ${2:nokia_srlinux}\n    image: ${3:ghcr.io/nokia/srlinux:latest}",
    sortText: "000-nodes",
  },
  {
    label: "links",
    detail: "Add a topology links section",
    insertText:
      "links:\n  - endpoints: [${1:srl1}:${2:e1-1}, ${3:srl2}:${4:e1-1}]",
    sortText: "001-links",
  },
];

function isRecord(value: unknown): value is SchemaRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

export function isContainerlabTopologyFile(pathValue: string): boolean {
  return /\.clab\.ya?ml$/i.test(pathValue);
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%2F/gi, "/");
}

function createModelUri(
  monacoApi: MonacoApi,
  endpointId: string,
  pathValue: string,
): monaco.Uri {
  const normalizedEndpoint = encodePathSegment(endpointId.trim() || "endpoint");
  const normalizedPath = pathValue
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(encodePathSegment)
    .join("/");
  return monacoApi.Uri.parse(
    `file:///containerlab-file-editor/${normalizedEndpoint}/${normalizedPath || "topology.clab.yml"}`,
  );
}

export function createContainerlabYamlModel(
  monacoApi: MonacoApi,
  endpointId: string,
  pathValue: string,
  content: string,
): monaco.editor.ITextModel {
  const uri = createModelUri(monacoApi, endpointId, pathValue);
  monacoApi.editor.getModel(uri)?.dispose();
  return monacoApi.editor.createModel(content, "yaml", uri);
}

function getValidator(schema: object): ReturnType<Ajv["compile"]> {
  let validate = validatorCache.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
  }
  return validate;
}

function offsetToLineCol(
  text: string,
  offset: number,
): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const end = Math.min(offset, text.length);
  for (let index = 0; index < end; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      col = 1;
    } else {
      col += 1;
    }
  }
  return { line, col };
}

function formatAjvError(error: {
  keyword: string;
  message?: string;
  params?: Record<string, unknown>;
}): string {
  const allowedValues = error.params?.["allowedValues"];
  if (error.keyword === "enum" && Array.isArray(allowedValues)) {
    const list = allowedValues.map((value) => `"${String(value)}"`).join(", ");
    return `Value is not accepted. Valid values: ${list}`;
  }

  const additionalProperty = error.params?.["additionalProperty"];
  if (
    error.keyword === "additionalProperties" &&
    typeof additionalProperty === "string"
  ) {
    return `Unknown property "${additionalProperty}"`;
  }

  const missingProperty = error.params?.["missingProperty"];
  if (error.keyword === "required" && typeof missingProperty === "string") {
    return `Missing required property "${missingProperty}"`;
  }

  const expectedType = error.params?.["type"];
  if (error.keyword === "type" && typeof expectedType === "string") {
    return `Must be ${expectedType}`;
  }

  return error.message ?? "Schema validation error";
}

function resolveYamlPosition(
  doc: YAML.Document,
  text: string,
  instancePath: string,
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const pathParts = instancePath
    .split("/")
    .filter(Boolean)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  const node = doc.getIn(pathParts, true);
  if (YAML.isNode(node) && node.range) {
    const start = offsetToLineCol(text, node.range[0]);
    const end = offsetToLineCol(text, node.range[1]);
    return {
      startLine: start.line,
      startCol: start.col,
      endLine: end.line,
      endCol: end.col,
    };
  }
  return { startLine: 1, startCol: 1, endLine: 1, endCol: 1 };
}

function validateYaml(
  monacoApi: MonacoApi,
  text: string,
): monaco.editor.IMarkerData[] {
  let doc: YAML.Document;
  try {
    doc = YAML.parseDocument(text, { keepSourceTokens: true });
  } catch {
    return [
      {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
        message: "Invalid YAML syntax",
        severity: monacoApi.MarkerSeverity.Error,
      },
    ];
  }

  const markers: monaco.editor.IMarkerData[] = [];
  for (const err of doc.errors) {
    const [startOffset, endOffset] = err.pos;
    const start = offsetToLineCol(text, startOffset);
    const end = offsetToLineCol(text, endOffset);
    markers.push({
      startLineNumber: start.line,
      startColumn: start.col,
      endLineNumber: end.line,
      endColumn: end.col,
      message: err.message,
      severity: monacoApi.MarkerSeverity.Error,
    });
  }

  if (doc.errors.length > 0) return markers;

  const jsonData: unknown = doc.toJSON();
  if (jsonData === undefined) return markers;

  const validate = getValidator(CONTAINERLAB_SCHEMA);
  const isValid = validate(jsonData);
  if (
    isValid === true ||
    validate.errors === null ||
    validate.errors === undefined
  ) {
    return markers;
  }

  const leafErrors = validate.errors.filter(
    (error) => !STRUCTURAL_AJV_KEYWORDS.has(error.keyword),
  );
  const errors = leafErrors.length > 0 ? leafErrors : validate.errors;
  const seen = new Set<string>();

  for (const error of errors) {
    const message = formatAjvError(error);
    const key = `${error.instancePath}::${message}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const pos = resolveYamlPosition(doc, text, error.instancePath);
    markers.push({
      startLineNumber: pos.startLine,
      startColumn: pos.startCol,
      endLineNumber: pos.endLine,
      endColumn: pos.endCol,
      message,
      severity: monacoApi.MarkerSeverity.Warning,
    });
  }

  return markers;
}

function getLineIndent(line: string): number {
  const match = /^ */.exec(line);
  return match ? match[0].length : 0;
}

function getYamlKeyStackEntries(
  lines: string[],
  lineIndex: number,
): Array<{ indent: number; key: string }> {
  const stack: Array<{ indent: number; key: string }> = [];

  for (let index = 0; index <= lineIndex; index += 1) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;

    const match = /^(\s*)(?:-\s*)?([^\s:#][^:]*):/.exec(line);
    if (!match) continue;

    const sequenceKeyOffset = line.slice(match[1].length).startsWith("- ")
      ? 2
      : 0;
    const indent = match[1].length + sequenceKeyOffset;
    const key = match[2].trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    stack.push({ indent, key });
  }

  return stack;
}

function getYamlKeyStack(lines: string[], lineIndex: number): string[] {
  return getYamlKeyStackEntries(lines, lineIndex).map((entry) => entry.key);
}

function getYamlParentPathAtLine(lines: string[], lineIndex: number): string[] {
  const stack = getYamlKeyStackEntries(lines, lineIndex - 1);
  const line = lines[lineIndex] ?? "";
  const effectiveIndent =
    getLineIndent(line) + (line.trimStart().startsWith("- ") ? 2 : 0);

  while (
    stack.length > 0 &&
    stack[stack.length - 1].indent >= effectiveIndent
  ) {
    stack.pop();
  }

  return stack.map((entry) => entry.key);
}

function isInTopologyLinks(stack: string[]): boolean {
  const topologyIndex = stack.indexOf("topology");
  return topologyIndex >= 0 && stack.indexOf("links", topologyIndex + 1) >= 0;
}

function isEndpointArrayItem(
  lines: string[],
  lineIndex: number,
  linePrefix: string,
): boolean {
  if (/endpoints:\s*\[[^\]]*$/.test(linePrefix)) return true;
  if (!/^\s*-\s*["']?[A-Za-z0-9_.|-]*$/.test(linePrefix)) return false;

  const currentIndent = getLineIndent(lines[lineIndex]);
  for (let index = lineIndex - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    const indent = getLineIndent(line);
    if (
      indent < currentIndent &&
      /^\s*(?:-\s*)?endpoints:\s*(?:$|\[)/.test(line)
    )
      return true;
    if (indent < currentIndent) return false;
  }
  return false;
}

function getContainerlabYamlCompletionContext(
  text: string,
  lineNumber: number,
  column: number,
): CompletionContext | null {
  const lines = text.split(/\r?\n/);
  const lineIndex = lineNumber - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return null;

  const linePrefix = lines[lineIndex].slice(0, Math.max(0, column - 1));
  const stack = getYamlKeyStack(lines, lineIndex);
  if (!isInTopologyLinks(stack)) return null;

  if (/(?:^|\s)node:\s*["']?[A-Za-z0-9_.|-]*$/.test(linePrefix)) {
    return "extendedEndpointNode";
  }

  if (
    stack.includes("endpoints") &&
    isEndpointArrayItem(lines, lineIndex, linePrefix)
  ) {
    return "briefEndpoint";
  }

  return null;
}

function getYamlCompletionRange(
  lineText: string,
  position: monaco.Position,
): monaco.IRange {
  const prefix = lineText.slice(0, Math.max(0, position.column - 1));
  let startIndex = prefix.length;
  while (startIndex > 0 && /[A-Za-z0-9_.|-]/.test(prefix[startIndex - 1])) {
    startIndex -= 1;
  }

  return {
    startLineNumber: position.lineNumber,
    startColumn: startIndex + 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  };
}

function extractTopologyNodeNames(text: string): string[] {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch {
    return [];
  }

  if (!isRecord(parsed)) return [];
  const topology = parsed.topology;
  if (!isRecord(topology)) return [];
  const nodes = topology.nodes;
  if (!isRecord(nodes)) return [];

  return Object.keys(nodes).sort((a, b) => a.localeCompare(b));
}

function resolveRef(ref: string, root: SchemaRecord): SchemaRecord | null {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let current: unknown = root;
  for (const part of parts) {
    if (!isRecord(current)) return null;
    current = current[part];
  }
  return isRecord(current) ? current : null;
}

function deref(schema: SchemaRecord, root: SchemaRecord): SchemaRecord {
  const ref = schema["$ref"];
  if (typeof ref === "string" && ref !== "") {
    const resolved = resolveRef(ref, root);
    if (resolved) return deref(resolved, root);
  }
  return schema;
}

function lookupInDirect(
  rawSchema: SchemaRecord,
  key: string,
  root: SchemaRecord,
): SchemaRecord | null {
  const schema = deref(rawSchema, root);
  const props = schema.properties;
  if (isRecord(props) && isRecord(props[key])) return deref(props[key], root);
  return null;
}

function searchPatternProps(
  schema: SchemaRecord,
  key: string,
  root: SchemaRecord,
): SchemaRecord | null {
  const patternProps = schema.patternProperties;
  if (!isRecord(patternProps)) return null;

  for (const pattern of Object.keys(patternProps)) {
    try {
      if (new RegExp(pattern).test(key) && isRecord(patternProps[pattern])) {
        return deref(patternProps[pattern], root);
      }
    } catch {
      // Invalid schema regexes are ignored.
    }
  }
  return null;
}

function checkConstraint(
  constraint: SchemaRecord,
  yamlValue: unknown,
): boolean {
  const pattern = constraint.pattern;
  if (typeof pattern === "string") {
    if (typeof yamlValue !== "string") return false;
    if (!new RegExp(pattern).test(yamlValue)) return false;
  }

  const enumValues = constraint.enum;
  if (Array.isArray(enumValues) && !enumValues.includes(yamlValue))
    return false;
  return true;
}

function matchesIfCondition(
  ifBlock: SchemaRecord,
  yamlSiblings: SchemaRecord,
): boolean {
  const requiredRaw = ifBlock.required;
  const requiredKeys = Array.isArray(requiredRaw)
    ? requiredRaw.filter((entry): entry is string => typeof entry === "string")
    : [];
  const ifProps = ifBlock.properties;
  if (!isRecord(ifProps)) return false;

  for (const propKey of Object.keys(ifProps)) {
    const constraint = ifProps[propKey];
    if (!isRecord(constraint)) continue;
    const hasValue = Object.prototype.hasOwnProperty.call(
      yamlSiblings,
      propKey,
    );
    if (!hasValue && requiredKeys.includes(propKey)) return false;
    if (!checkConstraint(constraint, yamlSiblings[propKey])) return false;
  }
  return true;
}

function searchIfThenElse(
  schema: SchemaRecord,
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): SchemaRecord | null {
  const ifBlock = schema.if;
  const thenBlock = schema.then;
  const elseBlock = schema.else;
  if (!isRecord(ifBlock) || !isRecord(thenBlock)) return null;

  const conditionMatches =
    yamlSiblings !== undefined && yamlSiblings !== null
      ? matchesIfCondition(ifBlock, yamlSiblings)
      : null;

  if (conditionMatches === true) {
    const found = lookupInDirect(thenBlock, key, root);
    if (found) return found;
  } else if (conditionMatches === false && isRecord(elseBlock)) {
    const found = lookupInDirect(elseBlock, key, root);
    if (found) return found;
  }

  if (conditionMatches === null) {
    const found = lookupInDirect(thenBlock, key, root);
    if (found) return found;
  }
  return null;
}

function searchAllOf(
  items: unknown[],
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): SchemaRecord | null {
  let fallback: SchemaRecord | null = null;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const resolved = deref(item, root);
    const fromCondition = searchIfThenElse(resolved, key, root, yamlSiblings);
    if (fromCondition && yamlSiblings) return fromCondition;
    if (fromCondition) {
      fallback ??= fromCondition;
      continue;
    }

    const props = resolved.properties;
    if (isRecord(props) && isRecord(props[key])) {
      fallback ??= deref(props[key], root);
    }
  }
  return fallback;
}

function searchCombinators(
  schema: SchemaRecord,
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): SchemaRecord | null {
  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    for (const item of branches) {
      if (!isRecord(item)) continue;
      const found = lookupProperty(item, key, root, yamlSiblings);
      if (found) return found;
    }
  }
  return null;
}

function getArrayItemSchema(
  rawSchema: SchemaRecord,
  root: SchemaRecord,
): SchemaRecord | null {
  const schema = deref(rawSchema, root);
  const items = schema.items;
  if (isRecord(items)) return deref(items, root);
  return null;
}

function lookupProperty(
  rawSchema: SchemaRecord,
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): SchemaRecord | null {
  const schema = deref(rawSchema, root);

  const props = schema.properties;
  if (isRecord(props) && isRecord(props[key])) return deref(props[key], root);

  const fromPattern = searchPatternProps(schema, key, root);
  if (fromPattern) return fromPattern;

  const allOf = schema.allOf;
  if (Array.isArray(allOf)) {
    const result = searchAllOf(allOf, key, root, yamlSiblings);
    if (result) return result;
  }

  const fromCondition = searchIfThenElse(schema, key, root, yamlSiblings);
  if (fromCondition) return fromCondition;

  const fromCombinator = searchCombinators(schema, key, root, yamlSiblings);
  if (fromCombinator) return fromCombinator;

  const itemSchema = getArrayItemSchema(schema, root);
  return itemSchema
    ? lookupProperty(itemSchema, key, root, yamlSiblings)
    : null;
}

function getSchemaAtPath(
  pathSegments: string[],
  schema: SchemaRecord,
  yamlData: unknown,
): SchemaRecord | null {
  let currentSchema: SchemaRecord = schema;
  let currentData = yamlData;

  for (const segment of pathSegments) {
    const yamlSiblings = isRecord(currentData) ? currentData : null;
    const next = lookupProperty(currentSchema, segment, schema, yamlSiblings);
    if (!next) return null;
    currentSchema = next;
    currentData = isRecord(currentData) ? currentData[segment] : undefined;
  }

  return currentSchema;
}

function isDirectNodeConfigPath(path: string[]): boolean {
  const topologyIndex = path.indexOf("topology");
  if (topologyIndex < 0) return false;
  const container = path[topologyIndex + 1];
  return (
    (container === "nodes" ||
      container === "groups" ||
      container === "kinds") &&
    path.length === topologyIndex + 3
  );
}

function getFallbackSchemaAtPath(
  root: SchemaRecord,
  pathSegments: string[],
): SchemaRecord | null {
  if (pathSegments.length === 0) return root;

  if (isDirectNodeConfigPath(pathSegments)) {
    const definitions = root.definitions;
    const nodeConfig = isRecord(definitions)
      ? definitions["node-config"]
      : null;
    return isRecord(nodeConfig) ? deref(nodeConfig, root) : null;
  }

  return null;
}

function getCompletionSchemaAtPath(
  root: SchemaRecord,
  pathSegments: string[],
  yamlData: unknown,
): SchemaRecord | null {
  return (
    getSchemaAtPath(pathSegments, root, yamlData) ??
    getFallbackSchemaAtPath(root, pathSegments)
  );
}

function getYamlDataAtPath(yamlData: unknown, pathSegments: string[]): unknown {
  let current = yamlData;
  for (const segment of pathSegments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function getEnumLikeValues(
  rawSchema: SchemaRecord,
  root: SchemaRecord,
): CompletionValue[] {
  const schema = deref(rawSchema, root);
  const values: CompletionValue[] = [];

  if (Array.isArray(schema.enum)) {
    values.push(
      ...schema.enum.filter(
        (value): value is CompletionValue =>
          typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean",
      ),
    );
  }

  if (
    typeof schema.const === "string" ||
    typeof schema.const === "number" ||
    typeof schema.const === "boolean"
  ) {
    values.push(schema.const);
  }

  for (const keyword of ["oneOf", "anyOf", "allOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    for (const item of branches) {
      if (isRecord(item)) values.push(...getEnumLikeValues(item, root));
    }
  }

  return [...new Map(values.map((value) => [String(value), value])).values()];
}

function getYamlPathAtLine(text: string, line: number): string[] | null {
  const lines = text.split("\n");
  if (line < 1 || line > lines.length) return null;

  const currentLine = lines[line - 1];
  const keyMatch = /^(\s*)(?:-\s*)?([^\s#:][^:]*):/.exec(currentLine);
  if (!keyMatch) return null;

  const currentIndent =
    keyMatch[1].length + (currentLine.trimStart().startsWith("- ") ? 2 : 0);
  const currentKey = keyMatch[2].trimEnd();
  const segments: string[] = [currentKey];

  let targetIndent = currentIndent;
  for (let index = line - 2; index >= 0; index -= 1) {
    const parentLine = lines[index];
    const parentMatch = /^(\s*)(?:-\s*)?([^\s#:][^:]*):/.exec(parentLine);
    if (!parentMatch) continue;

    const indent =
      parentMatch[1].length + (parentLine.trimStart().startsWith("- ") ? 2 : 0);
    if (indent < targetIndent) {
      segments.unshift(parentMatch[2].trimEnd());
      targetIndent = indent;
      if (indent === 0) break;
    }
  }

  return segments;
}

function parseYamlData(text: string): unknown {
  try {
    return YAML.parse(text);
  } catch {
    return undefined;
  }
}

function formatSchemaHoverMarkdown(info: {
  description?: string;
  markdownDescription?: string;
  enumValues?: string[];
}): string | null {
  const parts: string[] = [];
  if (isNonEmptyString(info.markdownDescription)) {
    parts.push(info.markdownDescription);
  } else if (isNonEmptyString(info.description)) {
    parts.push(info.description);
  }
  if (info.enumValues !== undefined && info.enumValues.length > 0) {
    const enumList = info.enumValues
      .map((value) => "`" + value + "`")
      .join(", ");
    parts.push("Allowed values: " + enumList);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}

function getSchemaHoverInfo(
  pathSegments: string[],
  schema: SchemaRecord,
  yamlData: unknown,
): {
  description?: string;
  markdownDescription?: string;
  enumValues?: string[];
} | null {
  const currentSchema = getSchemaAtPath(pathSegments, schema, yamlData);
  if (!currentSchema) return null;

  const description =
    typeof currentSchema.description === "string"
      ? currentSchema.description
      : undefined;
  const markdownDescription =
    typeof currentSchema.markdownDescription === "string"
      ? currentSchema.markdownDescription
      : undefined;
  const enumValues = getEnumLikeValues(currentSchema, schema).map(String);
  if (!description && !markdownDescription && enumValues.length === 0)
    return null;
  return {
    description,
    markdownDescription,
    enumValues: enumValues.length > 0 ? enumValues : undefined,
  };
}

type PropertySchemaEntry = { key: string; schema: SchemaRecord };
type PropertySchemaMap = Map<string, SchemaRecord>;

function mergePropertyEntries(
  target: PropertySchemaMap,
  entries: PropertySchemaEntry[],
): void {
  for (const entry of entries) {
    target.set(entry.key, entry.schema);
  }
}

function collectDirectPropertySchemas(
  schema: SchemaRecord,
  root: SchemaRecord,
): PropertySchemaEntry[] {
  const props = schema.properties;
  if (isRecord(props)) {
    return Object.entries(props)
      .filter((entry): entry is [string, SchemaRecord] => isRecord(entry[1]))
      .map(([key, value]) => ({ key, schema: deref(value, root) }));
  }
  return [];
}

function collectConditionalPropertySchemas(
  schema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): PropertySchemaEntry[] {
  const thenBlock = schema.then;
  if (!isRecord(schema.if) || !isRecord(thenBlock)) return [];

  const elseBlock = schema.else;
  const conditionMatches = yamlSiblings
    ? matchesIfCondition(schema.if, yamlSiblings)
    : null;
  const selected =
    conditionMatches === false && isRecord(elseBlock) ? elseBlock : thenBlock;
  return collectPropertySchemas(selected, root, yamlSiblings);
}

function collectAllOfPropertySchemas(
  schema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): PropertySchemaEntry[] {
  const result = new Map<string, SchemaRecord>();

  const allOf = schema.allOf;
  if (!Array.isArray(allOf)) return [];

  for (const item of allOf) {
    if (!isRecord(item)) continue;
    const resolved = deref(item, root);
    mergePropertyEntries(
      result,
      collectPropertySchemas(resolved, root, yamlSiblings),
    );
    mergePropertyEntries(
      result,
      collectConditionalPropertySchemas(resolved, root, yamlSiblings),
    );
  }

  return [...result.entries()].map(([key, propertySchema]) => ({
    key,
    schema: propertySchema,
  }));
}

function collectCombinatorPropertySchemas(
  schema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): PropertySchemaEntry[] {
  const result = new Map<string, SchemaRecord>();

  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    for (const item of branches) {
      if (!isRecord(item)) continue;
      mergePropertyEntries(
        result,
        collectPropertySchemas(item, root, yamlSiblings),
      );
    }
  }

  return [...result.entries()].map(([key, propertySchema]) => ({
    key,
    schema: propertySchema,
  }));
}

function collectArrayItemPropertySchemas(
  schema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): PropertySchemaEntry[] {
  const itemSchema = getArrayItemSchema(schema, root);
  return itemSchema
    ? collectPropertySchemas(itemSchema, root, yamlSiblings)
    : [];
}

function collectPropertySchemas(
  rawSchema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null,
): PropertySchemaEntry[] {
  const schema = deref(rawSchema, root);
  const result = new Map<string, SchemaRecord>();

  mergePropertyEntries(result, collectDirectPropertySchemas(schema, root));
  mergePropertyEntries(
    result,
    collectAllOfPropertySchemas(schema, root, yamlSiblings),
  );
  mergePropertyEntries(
    result,
    collectCombinatorPropertySchemas(schema, root, yamlSiblings),
  );
  mergePropertyEntries(
    result,
    collectArrayItemPropertySchemas(schema, root, yamlSiblings),
  );

  return [...result.entries()].map(([key, propertySchema]) => ({
    key,
    schema: propertySchema,
  }));
}

function inferKeyInsertText(
  key: string,
  propertySchema: SchemaRecord,
  root: SchemaRecord,
): string {
  const schema = deref(propertySchema, root);
  const type = schema.type;
  if (
    type === "object" ||
    isRecord(schema.properties) ||
    isRecord(schema.patternProperties)
  ) {
    return `${key}:\n  `;
  }
  if (type === "array" || isRecord(schema.items)) {
    return `${key}:\n  - `;
  }
  return `${key}: `;
}

function getValueCompletionKey(linePrefix: string): string | null {
  const match = /^(\s*)(?:-\s*)?([^\s:#][^:]*):\s*([^#]*)$/.exec(linePrefix);
  if (!match) return null;
  return match[2].trim();
}

function isNodeConfigPath(path: string[]): boolean {
  const topologyIndex = path.indexOf("topology");
  if (topologyIndex < 0) return false;
  const container = path[topologyIndex + 1];
  return (
    (container === "nodes" ||
      container === "groups" ||
      container === "kinds") &&
    path.length >= topologyIndex + 3
  );
}

function isLinkItemPath(path: string[]): boolean {
  const topologyIndex = path.indexOf("topology");
  return topologyIndex >= 0 && path[topologyIndex + 1] === "links";
}

function getPropertySchemaForValue(
  root: SchemaRecord,
  parentPath: string[],
  valueKey: string,
  yamlData: unknown,
): SchemaRecord | null {
  const parentSchema = getCompletionSchemaAtPath(root, parentPath, yamlData);
  const yamlSiblings = getYamlDataAtPath(yamlData, parentPath);
  if (!parentSchema) return null;
  return lookupProperty(
    parentSchema,
    valueKey,
    root,
    isRecord(yamlSiblings) ? yamlSiblings : null,
  );
}

function getLinkTypeValues(root: SchemaRecord): CompletionValue[] {
  const definitions = root.definitions;
  if (!isRecord(definitions)) return [];

  const values: CompletionValue[] = [];
  for (const [key, definition] of Object.entries(definitions)) {
    if (!key.startsWith("link-type-") || !isRecord(definition)) continue;
    const props = deref(definition, root).properties;
    const typeSchema =
      isRecord(props) && isRecord(props.type) ? props.type : null;
    if (typeSchema) values.push(...getEnumLikeValues(typeSchema, root));
  }
  return [
    ...new Map(values.map((value) => [String(value), value])).values(),
  ].sort((a, b) => String(a).localeCompare(String(b)));
}

function getSchemaEnumCompletions(
  root: SchemaRecord,
  parentPath: string[],
  valueKey: string,
  yamlData: unknown,
): CompletionValue[] {
  if (valueKey === "type" && isNodeConfigPath(parentPath)) {
    const parentData = getYamlDataAtPath(yamlData, parentPath);
    const kind =
      isRecord(parentData) && typeof parentData.kind === "string"
        ? parentData.kind
        : "";
    const typeValues = kind
      ? (extractTypesByKindFromSchema(root)[kind] ?? [])
      : [];
    if (typeValues.length > 0) return typeValues;
  }

  if (valueKey === "type" && isLinkItemPath(parentPath)) {
    return getLinkTypeValues(root);
  }

  const propertySchema = getPropertySchemaForValue(
    root,
    parentPath,
    valueKey,
    yamlData,
  );
  return propertySchema ? getEnumLikeValues(propertySchema, root) : [];
}

function buildNodeNameCompletionItems(
  monacoApi: MonacoApi,
  nodeNames: string[],
  context: CompletionContext,
  range: monaco.IRange,
): monaco.languages.CompletionItem[] {
  return nodeNames.map((nodeName) => ({
    label: nodeName,
    kind: monacoApi.languages.CompletionItemKind.Reference,
    detail: "containerlab node",
    documentation:
      context === "briefEndpoint"
        ? "Existing topology node. Add the interface after the colon."
        : "Existing topology node.",
    insertText: context === "briefEndpoint" ? `${nodeName}:` : nodeName,
    range,
    sortText: `000-${nodeName}`,
  }));
}

function buildPropertyCompletion(
  monacoApi: MonacoApi,
  key: string,
  propertySchema: SchemaRecord,
  root: SchemaRecord,
  range: monaco.IRange,
): monaco.languages.CompletionItem {
  let description: string | undefined;
  if (typeof propertySchema.markdownDescription === "string") {
    description = propertySchema.markdownDescription;
  } else if (typeof propertySchema.description === "string") {
    description = propertySchema.description;
  }

  return {
    label: key,
    kind: monacoApi.languages.CompletionItemKind.Property,
    detail: "containerlab property",
    documentation: description,
    insertText: inferKeyInsertText(key, propertySchema, root),
    range,
    sortText: `100-${key}`,
  };
}

function buildValueCompletion(
  monacoApi: MonacoApi,
  value: CompletionValue,
  range: monaco.IRange,
): monaco.languages.CompletionItem {
  const label = String(value);
  return {
    label,
    kind: monacoApi.languages.CompletionItemKind.EnumMember,
    detail: "containerlab value",
    insertText: label,
    range,
    sortText: `010-${label}`,
  };
}

function buildSnippetCompletion(
  monacoApi: MonacoApi,
  snippet: typeof ROOT_SNIPPET,
  range: monaco.IRange,
): monaco.languages.CompletionItem {
  return {
    label: snippet.label,
    kind: monacoApi.languages.CompletionItemKind.Snippet,
    detail: snippet.detail,
    insertText: snippet.insertText,
    insertTextRules:
      monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
    sortText: snippet.sortText,
  };
}

function buildContainerlabYamlCompletionItems(
  monacoApi: MonacoApi,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionItem[] {
  const text = model.getValue();
  const lines = text.split(/\r?\n/);
  const lineIndex = position.lineNumber - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return [];

  const lineText = model.getLineContent(position.lineNumber);
  const linePrefix = lines[lineIndex].slice(
    0,
    Math.max(0, position.column - 1),
  );
  const range = getYamlCompletionRange(lineText, position);
  const yamlData = parseYamlData(text);
  const parentPath = getYamlParentPathAtLine(lines, lineIndex);
  const valueKey = getValueCompletionKey(linePrefix);

  if (valueKey !== null) {
    return getSchemaEnumCompletions(
      CONTAINERLAB_SCHEMA,
      parentPath,
      valueKey,
      yamlData,
    ).map((value) => buildValueCompletion(monacoApi, value, range));
  }

  const suggestions: monaco.languages.CompletionItem[] = [];
  const context = getContainerlabYamlCompletionContext(
    text,
    position.lineNumber,
    position.column,
  );
  if (context !== null) {
    const nodeNames = extractTopologyNodeNames(text);
    suggestions.push(
      ...buildNodeNameCompletionItems(monacoApi, nodeNames, context, range),
    );
  }

  const parentSchema = getCompletionSchemaAtPath(
    CONTAINERLAB_SCHEMA,
    parentPath,
    yamlData,
  );
  if (!parentSchema) return suggestions;

  const yamlSiblings = getYamlDataAtPath(yamlData, parentPath);
  const properties = collectPropertySchemas(
    parentSchema,
    CONTAINERLAB_SCHEMA,
    isRecord(yamlSiblings) ? yamlSiblings : null,
  );

  suggestions.push(
    ...properties.map((property) =>
      buildPropertyCompletion(
        monacoApi,
        property.key,
        property.schema,
        CONTAINERLAB_SCHEMA,
        range,
      ),
    ),
  );

  if (parentPath.length === 0) {
    suggestions.unshift(buildSnippetCompletion(monacoApi, ROOT_SNIPPET, range));
  }

  if (parentPath.at(-1) === "topology") {
    suggestions.unshift(
      ...TOPOLOGY_SNIPPETS.map((snippet) =>
        buildSnippetCompletion(monacoApi, snippet, range),
      ),
    );
  }

  if (isNodeConfigPath(parentPath)) {
    suggestions.unshift(
      buildSnippetCompletion(
        monacoApi,
        {
          label: "node config",
          detail: "Create a node config with kind and image",
          insertText:
            "kind: ${1:nokia_srlinux}\nimage: ${2:ghcr.io/nokia/srlinux:latest}",
          sortText: "000-node-config",
        },
        range,
      ),
    );
  }

  if (isLinkItemPath(parentPath)) {
    suggestions.unshift(
      buildSnippetCompletion(
        monacoApi,
        {
          label: "veth link",
          detail: "Create a veth link",
          insertText:
            "type: veth\nendpoints:\n  - node: ${1:srl1}\n    interface: ${2:e1-1}\n  - node: ${3:srl2}\n    interface: ${4:e1-1}",
          sortText: "000-veth-link",
        },
        range,
      ),
    );
  }

  return suggestions;
}

function ensureProviders(monacoApi: MonacoApi): void {
  hoverDisposable ??= monacoApi.languages.registerHoverProvider("yaml", {
    provideHover(model, position) {
      if (!registeredModelUris.has(model.uri.toString())) return null;

      const text = model.getValue();
      const path = getYamlPathAtLine(text, position.lineNumber);
      if (!path || path.length === 0) return null;

      const info = getSchemaHoverInfo(
        path,
        CONTAINERLAB_SCHEMA,
        parseYamlData(text),
      );
      if (!info) return null;

      const value = formatSchemaHoverMarkdown(info);
      if (!value) return null;

      const word = model.getWordAtPosition(position);
      return {
        range: word
          ? new monacoApi.Range(
              position.lineNumber,
              word.startColumn,
              position.lineNumber,
              word.endColumn,
            )
          : new monacoApi.Range(
              position.lineNumber,
              1,
              position.lineNumber,
              model.getLineMaxColumn(position.lineNumber),
            ),
        contents: [{ value }],
      };
    },
  });

  completionDisposable ??= monacoApi.languages.registerCompletionItemProvider(
    "yaml",
    {
      triggerCharacters: YAML_COMPLETION_TRIGGER_CHARACTERS,
      provideCompletionItems(model, position, context) {
        if (!registeredModelUris.has(model.uri.toString())) return undefined;

        const suggestions = buildContainerlabYamlCompletionItems(
          monacoApi,
          model,
          position,
        );
        if (
          suggestions.length === 0 &&
          context.triggerKind !==
            monacoApi.languages.CompletionTriggerKind.Invoke
        ) {
          return undefined;
        }
        return { suggestions };
      },
    },
  );
}

export function attachContainerlabYamlSupport(
  monacoApi: MonacoApi,
  model: monaco.editor.ITextModel,
): monaco.IDisposable {
  ensureProviders(monacoApi);

  const uri = model.uri.toString();
  registeredModelUris.add(uri);
  let validationTimer: ReturnType<typeof setTimeout> | null = null;

  const runValidation = () => {
    validationTimer = null;
    monacoApi.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      validateYaml(monacoApi, model.getValue()),
    );
  };

  const scheduleValidation = () => {
    if (validationTimer !== null) {
      clearTimeout(validationTimer);
    }
    validationTimer = setTimeout(runValidation, VALIDATION_DEBOUNCE_MS);
  };

  scheduleValidation();
  const changeDisposable = model.onDidChangeContent(scheduleValidation);

  return {
    dispose: () => {
      if (validationTimer !== null) {
        clearTimeout(validationTimer);
        validationTimer = null;
      }
      changeDisposable.dispose();
      registeredModelUris.delete(uri);
      monacoApi.editor.setModelMarkers(model, MARKER_OWNER, []);
    },
  };
}
