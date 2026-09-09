import type * as monaco from "monaco-editor";
import type { JSONSchema, MonacoYamlOptions } from "monaco-yaml";
import * as YAML from "yaml";
import { extractTypesByKindFromSchema } from "../../core/schema/SchemaParser";
import { isRecord } from "../../core/utilities/typeHelpers";

export const CONTAINERLAB_SCHEMA_URI = "https://containerlab.dev/clab.schema.json";
const CONTAINERLAB_SCHEMA_FILE_MATCH = [
  "*.clab.yml",
  "*.clab.yaml",
  "**/*.clab.yml",
  "**/*.clab.yaml",
  "file:///**/*.clab.yml",
  "file:///**/*.clab.yaml",
  "file:///containerlab-editor/*.clab.yml",
  "file:///containerlab-editor/*.clab.yaml"
];

type SchemaRecord = Record<string, unknown>;

type CompletionContext = "briefEndpoint" | "extendedEndpointNode";
type CompletionValue = string | number | boolean;

export interface SchemaHoverInfo {
  description?: string;
  markdownDescription?: string;
  enumValues?: string[];
}

interface ContainerlabCompletionKinds {
  property: monaco.languages.CompletionItemKind;
  enumMember: monaco.languages.CompletionItemKind;
  snippet: monaco.languages.CompletionItemKind;
}

export interface BuildSchemaCompletionItemsOptions {
  text: string;
  lineNumber: number;
  column: number;
  schema?: object;
  range: monaco.IRange;
  kinds: ContainerlabCompletionKinds;
  snippetInsertTextRule: monaco.languages.CompletionItemInsertTextRule;
}

const ROOT_SNIPPETS = [
  {
    label: "containerlab topology",
    description: "Create a basic containerlab topology",
    bodyText:
      "name: ${1:lab}\ntopology:\n  nodes:\n    ${2:srl1}:\n      kind: ${3:nokia_srlinux}\n      image: ${4:ghcr.io/nokia/srlinux:latest}\n",
    sortText: "000-containerlab-topology"
  }
];

const TOPOLOGY_SNIPPETS = [
  {
    label: "nodes",
    description: "Add a topology nodes section",
    bodyText:
      "nodes:\n  ${1:srl1}:\n    kind: ${2:nokia_srlinux}\n    image: ${3:ghcr.io/nokia/srlinux:latest}",
    sortText: "000-nodes"
  },
  {
    label: "links",
    description: "Add a topology links section",
    bodyText: "links:\n  - endpoints: [${1:srl1}:${2:e1-1}, ${3:srl2}:${4:e1-1}]",
    sortText: "001-links"
  }
];

const NODE_CONFIG_SNIPPETS = [
  {
    label: "node config",
    description: "Create a node config with kind and image",
    bodyText: "kind: ${1:nokia_srlinux}\nimage: ${2:ghcr.io/nokia/srlinux:latest}",
    sortText: "000-node-config"
  }
];

const LINK_ENDPOINT_SNIPPETS = [
  {
    label: "endpoint",
    description: "Create an extended link endpoint",
    bodyText: "node: ${1:srl1}\ninterface: ${2:e1-1}",
    sortText: "000-link-endpoint"
  }
];

// Hoisted regexes for the per-line scans below (run once per line on every
// completion/hover request).
const BLANK_OR_COMMENT_LINE_REGEX = /^\s*(?:#.*)?$/;
const YAML_KEY_LINE_REGEX = /^(\s*)(?:-\s*)?([^\s:#][^:]*):/;
const LEADING_SPACES_REGEX = /^ */;
const COMPLETION_WORD_CHAR_REGEX = /[A-Za-z0-9_.|-]/;
const ENDPOINTS_KEY_LINE_REGEX = /^\s*(?:-\s*)?endpoints:\s*(?:$|\[)/;

// Cache compiled schema pattern regexes — patterns come from a static schema,
// so this stays bounded while avoiding re-compilation on every lookup.
const schemaPatternRegexCache = new Map<string, RegExp>();

function getSchemaPatternRegex(pattern: string): RegExp {
  let regex = schemaPatternRegexCache.get(pattern);
  if (!regex) {
    regex = new RegExp(pattern);
    schemaPatternRegexCache.set(pattern, regex);
  }
  return regex;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function cloneJsonSchema(schema: object): JSONSchema {
  return JSON.parse(JSON.stringify(schema)) as JSONSchema;
}

function getSchemaRecord(root: SchemaRecord, path: string[]): SchemaRecord | null {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return isRecord(current) ? current : null;
}

function appendDefaultSnippets(target: SchemaRecord | null, snippets: unknown[]): void {
  if (!target) return;
  const existing = target.defaultSnippets;
  target.defaultSnippets = Array.isArray(existing) ? [...existing, ...snippets] : snippets;
}

function buildContainerlabYamlSchema(schema: object): JSONSchema {
  const cloned = cloneJsonSchema(schema);
  const root = cloned as SchemaRecord;

  appendDefaultSnippets(root, ROOT_SNIPPETS);
  appendDefaultSnippets(getSchemaRecord(root, ["properties", "topology"]), TOPOLOGY_SNIPPETS);
  appendDefaultSnippets(getSchemaRecord(root, ["definitions", "node-config"]), NODE_CONFIG_SNIPPETS);
  appendDefaultSnippets(getSchemaRecord(root, ["definitions", "link-endpoint"]), LINK_ENDPOINT_SNIPPETS);

  return cloned;
}

export function buildMonacoYamlOptions(schema?: object): MonacoYamlOptions {
  return {
    completion: true,
    enableSchemaRequest: false,
    format: true,
    hover: true,
    validate: true,
    yamlVersion: "1.2",
    schemas: schema
      ? [
          {
            fileMatch: CONTAINERLAB_SCHEMA_FILE_MATCH,
            schema: buildContainerlabYamlSchema(schema),
            uri: CONTAINERLAB_SCHEMA_URI
          }
        ]
      : []
  };
}

export function extractTopologyNodeNames(text: string): string[] {
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

function getLineIndent(line: string): number {
  const match = LEADING_SPACES_REGEX.exec(line);
  return match ? match[0].length : 0;
}

function getYamlKeyStack(lines: string[], lineIndex: number): string[] {
  return getYamlKeyStackEntries(lines, lineIndex).map((entry) => entry.key);
}

function getYamlKeyStackEntries(
  lines: string[],
  lineIndex: number
): Array<{ indent: number; key: string }> {
  const stack: Array<{ indent: number; key: string }> = [];

  for (let index = 0; index <= lineIndex; index++) {
    const line = lines[index];
    if (BLANK_OR_COMMENT_LINE_REGEX.test(line)) continue;

    const match = YAML_KEY_LINE_REGEX.exec(line);
    if (!match) continue;

    const sequenceKeyOffset = line.slice(match[1].length).startsWith("- ") ? 2 : 0;
    const indent = match[1].length + sequenceKeyOffset;
    const key = match[2].trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    stack.push({ indent, key });
  }

  return stack;
}

function getYamlParentPathAtLine(lines: string[], lineIndex: number): string[] {
  const stack = getYamlKeyStackEntries(lines, lineIndex - 1);
  const line = lines[lineIndex] ?? "";
  const effectiveIndent = getLineIndent(line) + (line.trimStart().startsWith("- ") ? 2 : 0);

  while (stack.length > 0 && stack[stack.length - 1].indent >= effectiveIndent) {
    stack.pop();
  }

  return stack.map((entry) => entry.key);
}

function isInTopologyLinks(stack: string[]): boolean {
  const topologyIndex = stack.indexOf("topology");
  return topologyIndex >= 0 && stack.indexOf("links", topologyIndex + 1) >= 0;
}

function isEndpointArrayItem(lines: string[], lineIndex: number, linePrefix: string): boolean {
  if (/endpoints:\s*\[[^\]]*$/.test(linePrefix)) return true;
  if (!/^\s*-\s*["']?[A-Za-z0-9_.|-]*$/.test(linePrefix)) return false;

  const currentIndent = getLineIndent(lines[lineIndex]);
  for (let index = lineIndex - 1; index >= 0; index--) {
    const line = lines[index];
    if (BLANK_OR_COMMENT_LINE_REGEX.test(line)) continue;
    const indent = getLineIndent(line);
    if (indent < currentIndent && ENDPOINTS_KEY_LINE_REGEX.test(line)) return true;
    if (indent < currentIndent) return false;
  }
  return false;
}

export function getContainerlabYamlCompletionContext(
  text: string,
  lineNumber: number,
  column: number
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

  if (stack.includes("endpoints") && isEndpointArrayItem(lines, lineIndex, linePrefix)) {
    return "briefEndpoint";
  }

  return null;
}

export function getYamlCompletionRange(
  lineText: string,
  position: monaco.Position
): monaco.IRange {
  const prefix = lineText.slice(0, Math.max(0, position.column - 1));
  let startIndex = prefix.length;
  while (startIndex > 0 && COMPLETION_WORD_CHAR_REGEX.test(prefix[startIndex - 1])) {
    startIndex--;
  }

  return {
    startLineNumber: position.lineNumber,
    startColumn: startIndex + 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  };
}

export function buildNodeNameCompletionItems(
  nodeNames: string[],
  context: CompletionContext,
  range: monaco.IRange,
  completionKind: monaco.languages.CompletionItemKind
): monaco.languages.CompletionItem[] {
  return nodeNames.map((nodeName) => ({
    label: nodeName,
    kind: completionKind,
    detail: "containerlab node",
    documentation:
      context === "briefEndpoint"
        ? "Existing topology node. Add the interface after the colon."
        : "Existing topology node.",
    insertText: context === "briefEndpoint" ? `${nodeName}:` : nodeName,
    range,
    sortText: `000-${nodeName}`
  }));
}

function resolveRef(ref: string, root: SchemaRecord): SchemaRecord | null {
  if (!ref.startsWith("#/")) return null;
  const parts = ref.slice(2).split("/");
  let cur: unknown = root;
  for (const part of parts) {
    if (!isRecord(cur)) return null;
    cur = cur[part];
  }
  return isRecord(cur) ? cur : null;
}

function deref(schema: SchemaRecord, root: SchemaRecord): SchemaRecord {
  const ref = schema["$ref"];
  if (typeof ref === "string" && ref !== "") {
    const resolved = resolveRef(ref, root);
    if (resolved) return deref(resolved, root);
  }
  return schema;
}

function lookupInDirect(rawSchema: SchemaRecord, key: string, root: SchemaRecord): SchemaRecord | null {
  const schema = deref(rawSchema, root);
  const props = schema.properties;
  if (isRecord(props) && isRecord(props[key])) return deref(props[key], root);
  return null;
}

function searchPatternProps(
  schema: SchemaRecord,
  key: string,
  root: SchemaRecord
): SchemaRecord | null {
  const patternProps = schema.patternProperties;
  if (!isRecord(patternProps)) return null;

  for (const pattern of Object.keys(patternProps)) {
    try {
      if (getSchemaPatternRegex(pattern).test(key) && isRecord(patternProps[pattern])) {
        return deref(patternProps[pattern], root);
      }
    } catch {
      // Skip invalid schema regexes.
    }
  }
  return null;
}

function checkConstraint(constraint: SchemaRecord, yamlValue: unknown): boolean {
  const pattern = constraint.pattern;
  if (typeof pattern === "string") {
    if (typeof yamlValue !== "string") return false;
    if (!getSchemaPatternRegex(pattern).test(yamlValue)) return false;
  }

  const enumValues = constraint.enum;
  if (Array.isArray(enumValues) && !enumValues.includes(yamlValue)) return false;
  return true;
}

function matchesIfCondition(ifBlock: SchemaRecord, yamlSiblings: SchemaRecord): boolean {
  const requiredRaw = ifBlock.required;
  const requiredKeys = Array.isArray(requiredRaw)
    ? requiredRaw.filter((entry): entry is string => typeof entry === "string")
    : [];
  const ifProps = ifBlock.properties;
  if (!isRecord(ifProps)) return false;

  for (const propKey of Object.keys(ifProps)) {
    const constraint = ifProps[propKey];
    if (!isRecord(constraint)) continue;
    const hasValue = Object.prototype.hasOwnProperty.call(yamlSiblings, propKey);
    if (!hasValue && requiredKeys.includes(propKey)) return false;
    if (!checkConstraint(constraint, yamlSiblings[propKey])) return false;
  }
  return true;
}

function searchIfThenElse(
  schema: SchemaRecord,
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
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

function searchAllOfItem(
  sub: SchemaRecord,
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
): { result: SchemaRecord; fromCondition: boolean } | null {
  const fromCondition = searchIfThenElse(sub, key, root, yamlSiblings);
  if (fromCondition) return { result: fromCondition, fromCondition: true };

  const props = sub.properties;
  if (isRecord(props) && isRecord(props[key])) {
    return { result: deref(props[key], root), fromCondition: false };
  }
  return null;
}

function searchAllOf(
  items: unknown[],
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
): SchemaRecord | null {
  let fallback: SchemaRecord | null = null;
  for (const item of items) {
    if (!isRecord(item)) continue;
    const hit = searchAllOfItem(deref(item, root), key, root, yamlSiblings);
    if (!hit) continue;
    if (hit.fromCondition && yamlSiblings) return hit.result;
    fallback ??= hit.result;
  }
  return fallback;
}

function searchCombinators(
  schema: SchemaRecord,
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
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

function lookupProperty(
  rawSchema: SchemaRecord,
  key: string,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
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
  return itemSchema ? lookupProperty(itemSchema, key, root, yamlSiblings) : null;
}

function getArrayItemSchema(rawSchema: SchemaRecord, root: SchemaRecord): SchemaRecord | null {
  const schema = deref(rawSchema, root);
  const items = schema.items;
  if (isRecord(items)) return deref(items, root);
  return null;
}

function getSchemaAtPath(
  pathSegments: string[],
  schema: SchemaRecord,
  yamlData: unknown
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
    (container === "nodes" || container === "groups" || container === "kinds") &&
    path.length === topologyIndex + 3
  );
}

function getFallbackSchemaAtPath(root: SchemaRecord, pathSegments: string[]): SchemaRecord | null {
  if (pathSegments.length === 0) return root;

  if (isDirectNodeConfigPath(pathSegments)) {
    const definitions = root.definitions;
    const nodeConfig = isRecord(definitions) ? definitions["node-config"] : null;
    return isRecord(nodeConfig) ? deref(nodeConfig, root) : null;
  }

  return null;
}

function getCompletionSchemaAtPath(
  root: SchemaRecord,
  pathSegments: string[],
  yamlData: unknown
): SchemaRecord | null {
  return getSchemaAtPath(pathSegments, root, yamlData) ?? getFallbackSchemaAtPath(root, pathSegments);
}

export function getSchemaHoverInfo(
  pathSegments: string[],
  schema: SchemaRecord,
  yamlData: unknown
): SchemaHoverInfo | null {
  const currentSchema = getSchemaAtPath(pathSegments, schema, yamlData);
  if (!currentSchema) return null;

  const description =
    typeof currentSchema.description === "string" ? currentSchema.description : undefined;
  const markdownDescription =
    typeof currentSchema.markdownDescription === "string"
      ? currentSchema.markdownDescription
      : undefined;
  const enumValues = getEnumLikeValues(currentSchema, schema).map(String);
  if (!description && !markdownDescription && enumValues.length === 0) return null;
  return {
    description,
    markdownDescription,
    enumValues: enumValues.length > 0 ? enumValues : undefined
  };
}

export function getYamlPathAtLine(text: string, line: number): string[] | null {
  const lines = text.split("\n");
  if (line < 1 || line > lines.length) return null;

  const currentLine = lines[line - 1];
  const keyMatch = YAML_KEY_LINE_REGEX.exec(currentLine);
  if (!keyMatch) return null;

  const currentIndent = keyMatch[1].length + (currentLine.trimStart().startsWith("- ") ? 2 : 0);
  const currentKey = keyMatch[2].trimEnd();
  const segments: string[] = [currentKey];

  let targetIndent = currentIndent;
  for (let index = line - 2; index >= 0; index--) {
    const parentLine = lines[index];
    const parentMatch = YAML_KEY_LINE_REGEX.exec(parentLine);
    if (!parentMatch) continue;

    const indent = parentMatch[1].length + (parentLine.trimStart().startsWith("- ") ? 2 : 0);
    if (indent < targetIndent) {
      segments.unshift(parentMatch[2].trimEnd());
      targetIndent = indent;
      if (indent === 0) break;
    }
  }

  return segments;
}

type PropertySchemaEntry = { key: string; schema: SchemaRecord };
type PropertySchemaMap = Map<string, SchemaRecord>;

function mergePropertyEntries(target: PropertySchemaMap, entries: PropertySchemaEntry[]): void {
  for (const entry of entries) {
    target.set(entry.key, entry.schema);
  }
}

function collectDirectPropertySchemas(schema: SchemaRecord, root: SchemaRecord): PropertySchemaEntry[] {
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
  yamlSiblings?: SchemaRecord | null
): PropertySchemaEntry[] {
  const thenBlock = schema.then;
  if (!isRecord(schema.if) || !isRecord(thenBlock)) return [];

  const elseBlock = schema.else;
  const conditionMatches = yamlSiblings ? matchesIfCondition(schema.if, yamlSiblings) : null;
  const selected = conditionMatches === false && isRecord(elseBlock) ? elseBlock : thenBlock;
  return collectPropertySchemas(selected, root, yamlSiblings);
}

function collectAllOfPropertySchemas(
  schema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
): PropertySchemaEntry[] {
  const result = new Map<string, SchemaRecord>();

  const allOf = schema.allOf;
  if (!Array.isArray(allOf)) return [];

  for (const item of allOf) {
    if (!isRecord(item)) continue;
    const resolved = deref(item, root);
    mergePropertyEntries(result, collectPropertySchemas(resolved, root, yamlSiblings));
    mergePropertyEntries(result, collectConditionalPropertySchemas(resolved, root, yamlSiblings));
  }

  return [...result.entries()].map(([key, propertySchema]) => ({ key, schema: propertySchema }));
}

function collectCombinatorPropertySchemas(
  schema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
): PropertySchemaEntry[] {
  const result = new Map<string, SchemaRecord>();

  for (const keyword of ["oneOf", "anyOf"] as const) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    for (const item of branches) {
      if (!isRecord(item)) continue;
      mergePropertyEntries(result, collectPropertySchemas(item, root, yamlSiblings));
    }
  }

  return [...result.entries()].map(([key, propertySchema]) => ({ key, schema: propertySchema }));
}

function collectArrayItemPropertySchemas(
  schema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
): PropertySchemaEntry[] {
  const itemSchema = getArrayItemSchema(schema, root);
  return itemSchema ? collectPropertySchemas(itemSchema, root, yamlSiblings) : [];
}

function collectPropertySchemas(
  rawSchema: SchemaRecord,
  root: SchemaRecord,
  yamlSiblings?: SchemaRecord | null
): PropertySchemaEntry[] {
  const schema = deref(rawSchema, root);
  const result = new Map<string, SchemaRecord>();

  mergePropertyEntries(result, collectDirectPropertySchemas(schema, root));
  mergePropertyEntries(result, collectAllOfPropertySchemas(schema, root, yamlSiblings));
  mergePropertyEntries(result, collectCombinatorPropertySchemas(schema, root, yamlSiblings));
  mergePropertyEntries(result, collectArrayItemPropertySchemas(schema, root, yamlSiblings));

  return [...result.entries()].map(([key, propertySchema]) => ({ key, schema: propertySchema }));
}

function getEnumLikeValues(rawSchema: SchemaRecord, root: SchemaRecord): CompletionValue[] {
  const schema = deref(rawSchema, root);
  const values: CompletionValue[] = [];

  if (Array.isArray(schema.enum)) {
    values.push(
      ...schema.enum.filter(
        (value): value is CompletionValue =>
          typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      )
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

function getYamlDataAtPath(yamlData: unknown, pathSegments: string[]): unknown {
  let current = yamlData;
  for (const segment of pathSegments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

function getValueCompletionKey(linePrefix: string): string | null {
  const match = /^(\s*)(?:-\s*)?([^\s:#][^:]*):\s*([^#]*)$/.exec(linePrefix);
  if (!match) return null;
  return match[2].trim();
}

function getCompletionDisplayText(value: CompletionValue): string {
  return typeof value === "string" ? value : String(value);
}

function getCompletionInsertText(value: CompletionValue): string {
  if (typeof value === "string") return value;
  return String(value);
}

function inferKeyInsertText(key: string, propertySchema: SchemaRecord, root: SchemaRecord): string {
  const schema = deref(propertySchema, root);
  const type = schema.type;
  if (type === "object" || isRecord(schema.properties) || isRecord(schema.patternProperties)) {
    return `${key}:\n  `;
  }
  if (type === "array" || isRecord(schema.items)) {
    return `${key}:\n  - `;
  }
  return `${key}: `;
}

function buildPropertyCompletion(
  key: string,
  propertySchema: SchemaRecord,
  root: SchemaRecord,
  range: monaco.IRange,
  kind: monaco.languages.CompletionItemKind
): monaco.languages.CompletionItem {
  let description: string | undefined;
  if (typeof propertySchema.markdownDescription === "string") {
    description = propertySchema.markdownDescription;
  } else if (typeof propertySchema.description === "string") {
    description = propertySchema.description;
  }

  return {
    label: key,
    kind,
    detail: "containerlab property",
    documentation: description,
    insertText: inferKeyInsertText(key, propertySchema, root),
    range,
    sortText: `100-${key}`
  };
}

function buildValueCompletion(
  value: CompletionValue,
  range: monaco.IRange,
  kind: monaco.languages.CompletionItemKind
): monaco.languages.CompletionItem {
  const label = getCompletionDisplayText(value);
  return {
    label,
    kind,
    detail: "containerlab value",
    insertText: getCompletionInsertText(value),
    range,
    sortText: `010-${label}`
  };
}

function buildSnippetCompletion(
  label: string,
  detail: string,
  insertText: string,
  sortText: string,
  range: monaco.IRange,
  kind: monaco.languages.CompletionItemKind,
  snippetInsertTextRule: monaco.languages.CompletionItemInsertTextRule
): monaco.languages.CompletionItem {
  return {
    label,
    kind,
    detail,
    insertText,
    insertTextRules: snippetInsertTextRule,
    range,
    sortText
  };
}

function getLinkTypeValues(root: SchemaRecord): CompletionValue[] {
  const definitions = root.definitions;
  if (!isRecord(definitions)) return [];

  const values: CompletionValue[] = [];
  for (const [key, definition] of Object.entries(definitions)) {
    if (!key.startsWith("link-type-") || !isRecord(definition)) continue;
    const props = deref(definition, root).properties;
    const typeSchema = isRecord(props) && isRecord(props.type) ? props.type : null;
    if (typeSchema) values.push(...getEnumLikeValues(typeSchema, root));
  }
  return [...new Map(values.map((value) => [String(value), value])).values()].sort((a, b) =>
    String(a).localeCompare(String(b))
  );
}

function isNodeConfigPath(path: string[]): boolean {
  const topologyIndex = path.indexOf("topology");
  if (topologyIndex < 0) return false;
  const container = path[topologyIndex + 1];
  return (
    (container === "nodes" || container === "groups" || container === "kinds") &&
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
  yamlData: unknown
): SchemaRecord | null {
  const parentSchema = getCompletionSchemaAtPath(root, parentPath, yamlData);
  const yamlSiblings = getYamlDataAtPath(yamlData, parentPath);
  if (!parentSchema) return null;
  return lookupProperty(parentSchema, valueKey, root, isRecord(yamlSiblings) ? yamlSiblings : null);
}

function getSchemaEnumCompletions(
  root: SchemaRecord,
  parentPath: string[],
  valueKey: string,
  yamlData: unknown
): CompletionValue[] {
  if (valueKey === "type" && isNodeConfigPath(parentPath)) {
    const parentData = getYamlDataAtPath(yamlData, parentPath);
    const kind = isRecord(parentData) && typeof parentData.kind === "string" ? parentData.kind : "";
    const typeValues = kind ? (extractTypesByKindFromSchema(root)[kind] ?? []) : [];
    if (typeValues.length > 0) return typeValues;
  }

  if (valueKey === "type" && isLinkItemPath(parentPath)) {
    return getLinkTypeValues(root);
  }

  const propertySchema = getPropertySchemaForValue(root, parentPath, valueKey, yamlData);
  return propertySchema ? getEnumLikeValues(propertySchema, root) : [];
}

function parseYamlData(text: string): unknown {
  try {
    return YAML.parse(text);
  } catch {
    return undefined;
  }
}

export function buildContainerlabSchemaCompletionItems({
  text,
  lineNumber,
  column,
  schema,
  range,
  kinds,
  snippetInsertTextRule
}: BuildSchemaCompletionItemsOptions): monaco.languages.CompletionItem[] {
  if (!schema || !isRecord(schema)) return [];

  const root = schema;
  const lines = text.split(/\r?\n/);
  const lineIndex = lineNumber - 1;
  if (lineIndex < 0 || lineIndex >= lines.length) return [];

  const linePrefix = lines[lineIndex].slice(0, Math.max(0, column - 1));
  const yamlData = parseYamlData(text);
  const parentPath = getYamlParentPathAtLine(lines, lineIndex);
  const valueKey = getValueCompletionKey(linePrefix);

  if (valueKey !== null) {
    return getSchemaEnumCompletions(root, parentPath, valueKey, yamlData).map((value) =>
      buildValueCompletion(value, range, kinds.enumMember)
    );
  }

  const parentSchema = getCompletionSchemaAtPath(root, parentPath, yamlData);
  if (!parentSchema) return [];

  const yamlSiblings = getYamlDataAtPath(yamlData, parentPath);
  const properties = collectPropertySchemas(
    parentSchema,
    root,
    isRecord(yamlSiblings) ? yamlSiblings : null
  );

  const suggestions = properties.map((property) =>
    buildPropertyCompletion(property.key, property.schema, root, range, kinds.property)
  );

  if (parentPath.length === 0) {
    suggestions.unshift(
      buildSnippetCompletion(
        "containerlab topology",
        "Create a basic containerlab topology",
        "name: ${1:lab}\ntopology:\n  nodes:\n    ${2:srl1}:\n      kind: ${3:nokia_srlinux}\n      image: ${4:ghcr.io/nokia/srlinux:latest}",
        "000-containerlab-topology",
        range,
        kinds.snippet,
        snippetInsertTextRule
      )
    );
  }

  if (parentPath.at(-1) === "topology") {
    suggestions.unshift(
      buildSnippetCompletion(
        "links",
        "Add a topology links section",
        "links:\n  - endpoints: [${1:srl1}:${2:e1-1}, ${3:srl2}:${4:e1-1}]",
        "001-links",
        range,
        kinds.snippet,
        snippetInsertTextRule
      ),
      buildSnippetCompletion(
        "nodes",
        "Add a topology nodes section",
        "nodes:\n  ${1:srl1}:\n    kind: ${2:nokia_srlinux}\n    image: ${3:ghcr.io/nokia/srlinux:latest}",
        "000-nodes",
        range,
        kinds.snippet,
        snippetInsertTextRule
      )
    );
  }

  if (isNodeConfigPath(parentPath)) {
    suggestions.unshift(
      buildSnippetCompletion(
        "node config",
        "Create a node config with kind and image",
        "kind: ${1:nokia_srlinux}\nimage: ${2:ghcr.io/nokia/srlinux:latest}",
        "000-node-config",
        range,
        kinds.snippet,
        snippetInsertTextRule
      )
    );
  }

  if (isLinkItemPath(parentPath)) {
    suggestions.unshift(
      buildSnippetCompletion(
        "veth link",
        "Create a veth link",
        "type: veth\nendpoints:\n  - node: ${1:srl1}\n    interface: ${2:e1-1}\n  - node: ${3:srl2}\n    interface: ${4:e1-1}",
        "000-veth-link",
        range,
        kinds.snippet,
        snippetInsertTextRule
      )
    );
  }

  return suggestions;
}

export function formatSchemaHoverMarkdown(info: SchemaHoverInfo): string | null {
  const parts: string[] = [];
  if (isNonEmptyString(info.markdownDescription)) {
    parts.push(info.markdownDescription);
  } else if (isNonEmptyString(info.description)) {
    parts.push(info.description);
  }
  if (info.enumValues !== undefined && info.enumValues.length > 0) {
    const enumList = info.enumValues.map((value) => "`" + value + "`").join(", ");
    parts.push("Allowed values: " + enumList);
  }
  return parts.length > 0 ? parts.join("\n\n") : null;
}
