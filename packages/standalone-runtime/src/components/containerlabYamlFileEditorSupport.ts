import Ajv from "ajv";
import type * as monaco from "@srl-labs/clab-ui/monaco/core";
import { containerlabSchema } from "@srl-labs/clab-ui/session";
import {
  buildContainerlabSchemaCompletionItems,
  buildNodeNameCompletionItems,
  extractTopologyNodeNames,
  formatSchemaHoverMarkdown,
  getContainerlabYamlCompletionContext,
  getSchemaHoverInfo,
  getYamlCompletionRange,
  getYamlPathAtLine
} from "@srl-labs/clab-ui/yaml";
import * as YAML from "yaml";

type MonacoApi = typeof monaco;
type SchemaRecord = Record<string, unknown>;

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

function parseYamlData(text: string): unknown {
  try {
    return YAML.parse(text);
  } catch {
    return undefined;
  }
}

function buildContainerlabYamlCompletionItems(
  monacoApi: MonacoApi,
  model: monaco.editor.ITextModel,
  position: monaco.Position,
): monaco.languages.CompletionItem[] {
  const text = model.getValue();
  const range = getYamlCompletionRange(model.getLineContent(position.lineNumber), position);
  const kinds = monacoApi.languages.CompletionItemKind;
  const suggestions = buildContainerlabSchemaCompletionItems({
    text,
    lineNumber: position.lineNumber,
    column: position.column,
    schema: CONTAINERLAB_SCHEMA,
    range,
    kinds: { property: kinds.Property, enumMember: kinds.EnumMember, snippet: kinds.Snippet },
    snippetInsertTextRule: monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
  });
  const context = getContainerlabYamlCompletionContext(text, position.lineNumber, position.column);
  if (context !== null) {
    suggestions.unshift(...buildNodeNameCompletionItems(
      extractTopologyNodeNames(text), context, range, kinds.Value,
    ));
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
