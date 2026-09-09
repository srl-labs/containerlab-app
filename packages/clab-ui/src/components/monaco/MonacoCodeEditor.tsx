import React, { useCallback, useEffect, useRef } from "react";
import * as monaco from "monaco-editor";
import "monaco-editor/min/vs/editor/editor.main.css";
// @ts-ignore Monaco's bundled YAML grammar module is untyped.
import * as yamlMonaco from "monaco-editor/esm/vs/basic-languages/yaml/yaml.js";
import { configureMonacoYaml, type MonacoYaml } from "monaco-yaml";
import * as YAML from "yaml";
import Ajv from "ajv";

import { useClabUiHost } from "../../host";
import { parseLuminance } from "../../utils/color";
import {
  buildContainerlabSchemaCompletionItems,
  buildMonacoYamlOptions,
  buildNodeNameCompletionItems,
  extractTopologyNodeNames,
  formatSchemaHoverMarkdown,
  getContainerlabYamlCompletionContext,
  getSchemaHoverInfo,
  getYamlCompletionRange,
  getYamlPathAtLine
} from "./yamlLanguageSupport";

declare global {
  interface Window {
    monacoEditorWorkerUrl?: string;
    monacoJsonWorkerUrl?: string;
    monacoYamlWorkerUrl?: string;
    enableMonacoYamlLanguageService?: boolean;
    __CLAB_MONACO_DEBUG__?: boolean;
    __clabMonacoDebug?: {
      editor: monaco.editor.IStandaloneCodeEditor;
      model: monaco.editor.ITextModel;
      getMarkers: () => monaco.editor.IMarker[];
      setValue: (value: string) => void;
      setPosition: (lineNumber: number, column: number) => void;
      triggerSuggest: () => void;
      triggerHover: () => void;
    };
  }
}

let monacoConfigured = false;
let yamlRegistered = false;
let monacoYamlInstance: MonacoYaml | null = null;
let monacoYamlSchemaRef: object | undefined;
let nextModelId = 1;
const SUGGEST_WIDGET_TAB_CONTEXT =
  "editorTextFocus && suggestWidgetVisible && !editorReadonly && !editorTabMovesFocus";
const SUGGEST_WIDGET_SUPPRESSED_BODY_CLASS = "clab-monaco-suggestions-disabled";
const SUGGEST_WIDGET_SUPPRESSION_STYLE_ID = "clab-monaco-suggestions-disabled-style";

function getCssVar(name: string, fallback: string): string {
  const value = window.getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

function detectColorMode(isDevMock: boolean): "light" | "dark" {
  if (isDevMock) {
    return document.documentElement.classList.contains("light") ? "light" : "dark";
  }

  const bg = getCssVar(
    "--clab-ui-editor-background",
    getCssVar("--vscode-editor-background", "#1e1e1e")
  );
  const lum = parseLuminance(bg);
  if (lum !== null) return lum > 0.5 ? "light" : "dark";
  return "dark";
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isDisposable(value: unknown): value is monaco.IDisposable {
  return isObj(value) && "dispose" in value && typeof value.dispose === "function";
}

function isMonacoYaml(value: unknown): value is MonacoYaml {
  return (
    isDisposable(value) &&
    "update" in value &&
    typeof value.update === "function" &&
    "getOptions" in value &&
    typeof value.getOptions === "function"
  );
}

function installSuggestWidgetKeybindings(): monaco.IDisposable[] {
  return [
    monaco.editor.addKeybindingRule({
      keybinding: monaco.KeyCode.Tab,
      command: "tab",
      when: SUGGEST_WIDGET_TAB_CONTEXT
    }),
    monaco.editor.addKeybindingRule({
      keybinding: monaco.KeyMod.Shift | monaco.KeyCode.Tab,
      command: "outdent",
      when: SUGGEST_WIDGET_TAB_CONTEXT
    })
  ];
}

function triggerPaste(
  editor: monaco.editor.ICodeEditor,
  text: string,
  clipboardEvent?: ClipboardEvent
): void {
  editor.trigger("keyboard", "paste", {
    text,
    pasteOnNewLine: false,
    multicursorText: null,
    clipboardEvent
  });
}

function installPlainSpaceKeyHandler(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable {
  return editor.onKeyDown((event) => {
    if (event.keyCode !== monaco.KeyCode.Space) return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.altGraphKey) return;
    if (event.browserEvent.isComposing) return;
    if (editor.getOption(monaco.editor.EditorOption.readOnly)) return;

    event.preventDefault();
    event.stopPropagation();
    editor.trigger("keyboard", "type", { text: " " });
  });
}

function hideSuggestWidget(editor: monaco.editor.IStandaloneCodeEditor): void {
  editor.trigger("containerlab-yaml", "hideSuggestWidget", {});
}

function ensureSuggestSuppressionStyle(): void {
  if (document.getElementById(SUGGEST_WIDGET_SUPPRESSION_STYLE_ID) !== null) return;

  const style = document.createElement("style");
  style.id = SUGGEST_WIDGET_SUPPRESSION_STYLE_ID;
  style.textContent = `
    body.${SUGGEST_WIDGET_SUPPRESSED_BODY_CLASS} .suggest-widget {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function syncSuggestSuppressionClass(): void {
  ensureSuggestSuppressionStyle();
  document.body.classList.toggle(
    SUGGEST_WIDGET_SUPPRESSED_BODY_CLASS,
    completionDisabledModelUris.size > 0
  );
}

function installDisabledSuggestSuppressor(
  editor: monaco.editor.IStandaloneCodeEditor,
  isSuggestionsEnabled: () => boolean
): monaco.IDisposable {
  const suppress = () => {
    if (isSuggestionsEnabled()) return;
    hideSuggestWidget(editor);
  };

  const keyDisposable = editor.onKeyDown((event) => {
    if (isSuggestionsEnabled()) return;
    if (event.keyCode !== monaco.KeyCode.Space || (!event.ctrlKey && !event.metaKey)) return;

    event.preventDefault();
    event.stopPropagation();
    suppress();
  });

  return {
    dispose: () => {
      keyDisposable.dispose();
    }
  };
}

function hasConfiguredYamlWorker(): boolean {
  if (window.monacoYamlWorkerUrl !== undefined && window.monacoYamlWorkerUrl !== "") return true;

  const existingEnvironment = Reflect.get(globalThis, "MonacoEnvironment");
  return (
    isObj(existingEnvironment) &&
    "getWorker" in existingEnvironment &&
    typeof existingEnvironment.getWorker === "function"
  );
}

function ensureMonacoConfiguredOnce(): void {
  if (monacoConfigured) return;

  // Worker wiring for VS Code webview build (dev mode sets MonacoEnvironment already).
  const existingEnvironment = Reflect.get(globalThis, "MonacoEnvironment");
  const hasWorker =
    isObj(existingEnvironment) &&
    "getWorker" in existingEnvironment &&
    typeof existingEnvironment.getWorker === "function";
  if (!hasWorker) {
    const editorUrl = window.monacoEditorWorkerUrl;
    const jsonUrl = window.monacoJsonWorkerUrl;
    const yamlUrl = window.monacoYamlWorkerUrl;
    if (editorUrl !== undefined && editorUrl !== "" && jsonUrl !== undefined && jsonUrl !== "") {
      Reflect.set(globalThis, "MonacoEnvironment", {
        getWorker: (_workerId: string, label: string) => {
          if (label === "json") return new Worker(jsonUrl);
          if (label === "yaml" && yamlUrl) return new Worker(yamlUrl);
          return new Worker(editorUrl);
        }
      });
    }
  }

  // YAML syntax highlighting and language configuration.
  if (!yamlRegistered) {
    if (!monaco.languages.getLanguages().some((l) => l.id === "yaml")) {
      monaco.languages.register({ id: "yaml" });
      monaco.languages.setMonarchTokensProvider(
        "yaml",
        yamlMonaco.language as monaco.languages.IMonarchLanguage
      );
      monaco.languages.setLanguageConfiguration(
        "yaml",
        yamlMonaco.conf as monaco.languages.LanguageConfiguration
      );
    }
    yamlRegistered = true;
  }

  // Avoid JSON diagnostics that require extra config and can be noisy for annotations.
  monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false });

  monacoConfigured = true;
}

/** Hardcoded Monaco colours per mode – used in dev where CSS vars lag behind the class toggle. */
const DEV_MONACO_COLORS = {
  light: {
    bg: "#ffffff",
    fg: "#333333",
    sel: "#add6ff",
    inactiveSel: "#e5ebf1",
    selectionHighlight: "#add6ff66",
    wordHighlight: "#57575740",
    wordHighlightStrong: "#0e639c40"
  },
  dark: {
    bg: "#1e1e1e",
    fg: "#cccccc",
    sel: "#264f78",
    inactiveSel: "#3a3d41",
    selectionHighlight: "#add6ff26",
    wordHighlight: "#575757b8",
    wordHighlightStrong: "#004972b8"
  }
} as const;

function applyVscodeThemeToMonaco(isDevMock: boolean): void {
  const mode = detectColorMode(isDevMock);
  const themeName = mode === "light" ? "topoviewer-vscode-light" : "topoviewer-vscode-dark";
  const c = DEV_MONACO_COLORS[mode];

  // In dev mode, CssBaseline re-renders asynchronously so CSS variables still
  // hold the *previous* theme's values when the MutationObserver fires.
  // Use hardcoded colours keyed off the detected mode instead.
  const dev = isDevMock;
  const background = dev
    ? c.bg
    : getCssVar("--clab-ui-editor-background", getCssVar("--vscode-editor-background", c.bg));
  const foreground = dev
    ? c.fg
    : getCssVar("--clab-ui-editor-foreground", getCssVar("--vscode-editor-foreground", c.fg));
  monaco.editor.defineTheme(themeName, {
    base: mode === "light" ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editor.selectionBackground": c.sel,
      "editor.inactiveSelectionBackground": c.inactiveSel,
      "editor.selectionHighlightBackground": c.selectionHighlight,
      "editor.wordHighlightBackground": c.wordHighlight,
      "editor.wordHighlightStrongBackground": c.wordHighlightStrong
    }
  });
  monaco.editor.setTheme(themeName);
}

const VALIDATION_DEBOUNCE_MS = 250;
const MARKER_OWNER = "containerlab-yaml-schema";

const validatorCache = new WeakMap<object, ReturnType<Ajv["compile"]>>();
const ajv = new Ajv({ allErrors: true, strict: false });

function getValidator(schema: object): ReturnType<Ajv["compile"]> {
  let validate = validatorCache.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
  }
  return validate;
}

function offsetToLineCol(text: string, offset: number): { line: number; col: number } {
  let line = 1;
  let col = 1;
  const end = Math.min(offset, text.length);
  for (let index = 0; index < end; index++) {
    if (text[index] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  return { line, col };
}

const STRUCTURAL_AJV_KEYWORDS = new Set(["if", "then", "else", "allOf", "anyOf", "oneOf", "not"]);

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
  if (error.keyword === "additionalProperties" && typeof additionalProperty === "string") {
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
  instancePath: string
): { startLine: number; startCol: number; endLine: number; endCol: number } {
  const pathParts = instancePath.split("/").filter(Boolean);
  const node = doc.getIn(pathParts, true);
  if (YAML.isNode(node) && node.range) {
    const start = offsetToLineCol(text, node.range[0]);
    const end = offsetToLineCol(text, node.range[1]);
    return { startLine: start.line, startCol: start.col, endLine: end.line, endCol: end.col };
  }
  return { startLine: 1, startCol: 1, endLine: 1, endCol: 1 };
}

function validateYaml(text: string, schema: object): monaco.editor.IMarkerData[] {
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
        severity: monaco.MarkerSeverity.Error
      }
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
      severity: monaco.MarkerSeverity.Error
    });
  }

  if (doc.errors.length > 0) return markers;

  const jsonData: unknown = doc.toJSON();
  if (jsonData === undefined) return markers;

  const validate = getValidator(schema);
  const isValid = validate(jsonData);
  if (isValid === true || validate.errors === null || validate.errors === undefined) {
    return markers;
  }

  const leafErrors = validate.errors.filter((error) => !STRUCTURAL_AJV_KEYWORDS.has(error.keyword));
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
      severity: monaco.MarkerSeverity.Warning
    });
  }

  return markers;
}

const YAML_INSTANCE_KEY = "__monacoContainerlabYamlInstance__";
const COMPLETION_DISPOSABLE_KEY = "__monacoContainerlabYamlCompletionDisposable__";
const HOVER_DISPOSABLE_KEY = "__monacoContainerlabYamlHoverDisposable__";
let activeSchema: Record<string, unknown> | null = null;
const completionDisabledModelUris = new Set<string>();

function setModelCompletionsEnabled(model: monaco.editor.ITextModel, enabled: boolean): void {
  const uri = model.uri.toString();
  if (enabled) {
    completionDisabledModelUris.delete(uri);
  } else {
    completionDisabledModelUris.add(uri);
  }
  syncSuggestSuppressionClass();
}

function configureContainerlabYaml(schema?: object): void {
  if (window.enableMonacoYamlLanguageService !== true) {
    const existing = monacoYamlInstance ?? Reflect.get(window, YAML_INSTANCE_KEY);
    if (isMonacoYaml(existing)) {
      existing.dispose();
    }
    monacoYamlInstance = null;
    monacoYamlSchemaRef = undefined;
    Reflect.deleteProperty(window, YAML_INSTANCE_KEY);
    return;
  }

  if (!hasConfiguredYamlWorker()) return;

  const existing = monacoYamlInstance ?? Reflect.get(window, YAML_INSTANCE_KEY);
  if (isMonacoYaml(existing)) {
    monacoYamlInstance = existing;
  }

  if (monacoYamlInstance !== null && monacoYamlSchemaRef === schema) return;

  const options = buildMonacoYamlOptions(schema);
  if (monacoYamlInstance === null) {
    monacoYamlInstance = configureMonacoYaml(
      monaco as unknown as Parameters<typeof configureMonacoYaml>[0],
      options
    );
    Reflect.set(window, YAML_INSTANCE_KEY, monacoYamlInstance);
  } else {
    void monacoYamlInstance.update(options);
  }
  monacoYamlSchemaRef = schema;
}

function ensureContainerlabYamlHoverProvider(): void {
  const existing: unknown = Reflect.get(window, HOVER_DISPOSABLE_KEY);
  if (isDisposable(existing)) existing.dispose();

  Reflect.set(
    window,
    HOVER_DISPOSABLE_KEY,
    monaco.languages.registerHoverProvider("yaml", {
      provideHover(model, position) {
        if (!activeSchema) return null;
        const text = model.getValue();
        const path = getYamlPathAtLine(text, position.lineNumber);
        if (!path || path.length === 0) return null;

        let yamlData: unknown;
        try {
          yamlData = YAML.parse(text);
        } catch {
          yamlData = undefined;
        }

        const info = getSchemaHoverInfo(path, activeSchema, yamlData);
        if (!info) return null;

        const value = formatSchemaHoverMarkdown(info);
        if (!value) return null;

        const word = model.getWordAtPosition(position);
        return {
          range: word
            ? new monaco.Range(
                position.lineNumber,
                word.startColumn,
                position.lineNumber,
                word.endColumn
              )
            : new monaco.Range(
                position.lineNumber,
                1,
                position.lineNumber,
                model.getLineMaxColumn(position.lineNumber)
              ),
          contents: [{ value }]
        };
      }
    })
  );
}

const YAML_COMPLETION_TRIGGER_CHARACTERS = [
  ":",
  "-",
  "[",
  ",",
  "_",
  ..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("")
];

function ensureContainerlabYamlCompletionProvider(): void {
  const existing: unknown = Reflect.get(window, COMPLETION_DISPOSABLE_KEY);
  if (isDisposable(existing)) existing.dispose();

  Reflect.set(
    window,
    COMPLETION_DISPOSABLE_KEY,
    monaco.languages.registerCompletionItemProvider("yaml", {
      triggerCharacters: YAML_COMPLETION_TRIGGER_CHARACTERS,
      provideCompletionItems(model, position, context) {
        if (completionDisabledModelUris.has(model.uri.toString())) return undefined;

        const suggestions = buildYamlCompletionItems(model, position);
        if (
          suggestions.length === 0 &&
          context.triggerKind !== monaco.languages.CompletionTriggerKind.Invoke
        ) {
          return undefined;
        }
        return { suggestions };
      }
    })
  );
}

function buildYamlCompletionItems(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): monaco.languages.CompletionItem[] {
  const text = model.getValue();
  const lineText = model.getLineContent(position.lineNumber);
  const range = getYamlCompletionRange(lineText, position);
  const schemaSuggestions = buildContainerlabSchemaCompletionItems({
    text,
    lineNumber: position.lineNumber,
    column: position.column,
    schema: activeSchema ?? undefined,
    range,
    kinds: {
      property: monaco.languages.CompletionItemKind.Property,
      enumMember: monaco.languages.CompletionItemKind.EnumMember,
      snippet: monaco.languages.CompletionItemKind.Snippet
    },
    snippetInsertTextRule: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
  });

  const context = getContainerlabYamlCompletionContext(text, position.lineNumber, position.column);
  if (context === null) return schemaSuggestions;

  const nodeNames = extractTopologyNodeNames(text);
  if (nodeNames.length === 0) return schemaSuggestions;

  return [
    ...buildNodeNameCompletionItems(
      nodeNames,
      context,
      range,
      monaco.languages.CompletionItemKind.Reference
    ),
    ...schemaSuggestions
  ];
}

function createModelUri(language: "yaml" | "json"): monaco.Uri {
  const id = nextModelId++;
  const suffix = language === "yaml" ? "clab.yml" : "json";
  return monaco.Uri.parse(`file:///containerlab-editor/model-${id}.${suffix}`);
}

export interface MonacoCodeEditorProps {
  value: string;
  language: "yaml" | "json";
  readOnly?: boolean;
  suggestionsEnabled?: boolean;
  jsonSchema?: object;
  onChange?: (value: string) => void;
}

export const MonacoCodeEditor: React.FC<MonacoCodeEditorProps> = ({
  value,
  language,
  readOnly = false,
  suggestionsEnabled = true,
  jsonSchema,
  onChange
}) => {
  const host = useClabUiHost();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);
  const modelUriRef = useRef<monaco.Uri | null>(null);
  const applyingExternalRef = useRef(false);
  const lastExternalAppliedRef = useRef<string>(value);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jsonSchemaRef = useRef(jsonSchema);
  const suggestionsEnabledRef = useRef(suggestionsEnabled);
  const isDevMock = host.meta?.isDevMock === true;

  const getEditorFontFamily = () => {
    const fallback = "Consolas, Monaco, 'Courier New', monospace";
    return getCssVar("--vscode-editor-font-family", fallback) || fallback;
  };

  const getEditorFontSize = () => {
    const raw =
      getCssVar("--vscode-editor-font-size", "") || getCssVar("--vscode-font-size", "13px");
    const parsed = parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 13;
  };

  activeSchema = isObj(jsonSchema) ? jsonSchema : null;
  jsonSchemaRef.current = jsonSchema;
  suggestionsEnabledRef.current = suggestionsEnabled;

  const scheduleValidation = useCallback(() => {
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    validationTimerRef.current = setTimeout(() => {
      const model = modelRef.current;
      const schema = jsonSchemaRef.current;
      if (!model) return;
      if (schema === undefined || language !== "yaml") {
        monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
        return;
      }
      monaco.editor.setModelMarkers(model, MARKER_OWNER, validateYaml(model.getValue(), schema));
    }, VALIDATION_DEBOUNCE_MS);
  }, [language]);

  useEffect(() => {
    ensureMonacoConfiguredOnce();
    if (language === "yaml") {
      configureContainerlabYaml(jsonSchema);
      ensureContainerlabYamlHoverProvider();
      ensureContainerlabYamlCompletionProvider();
      scheduleValidation();
    }
  }, [jsonSchema, language, scheduleValidation]);

  useEffect(() => {
    ensureMonacoConfiguredOnce();
    applyVscodeThemeToMonaco(isDevMock);

    const observer = new MutationObserver(() => {
      applyVscodeThemeToMonaco(isDevMock);
      const editor = editorRef.current;
      if (editor) {
        editor.updateOptions({
          fontFamily: getEditorFontFamily(),
          fontSize: getEditorFontSize()
        });
      }
    });
    observer.observe(document.body, { attributes: true, attributeFilter: ["class", "style"] });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"]
    });
    return () => observer.disconnect();
  }, [isDevMock]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    ensureMonacoConfiguredOnce();
    if (language === "yaml") {
      configureContainerlabYaml(jsonSchema);
      ensureContainerlabYamlHoverProvider();
      ensureContainerlabYamlCompletionProvider();
    }
    applyVscodeThemeToMonaco(isDevMock);

    modelUriRef.current = createModelUri(language);
    modelRef.current = monaco.editor.createModel(value, language, modelUriRef.current);
    setModelCompletionsEnabled(modelRef.current, suggestionsEnabled);
    lastExternalAppliedRef.current = value;

    editorRef.current = monaco.editor.create(container, {
      model: modelRef.current,
      readOnly,
      automaticLayout: true,
      contextmenu: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: getEditorFontFamily(),
      fontSize: getEditorFontSize(),
      tabSize: 2,
      insertSpaces: true,
      renderWhitespace: "selection",
      wordWrap: "on",
      fixedOverflowWidgets: true,
      folding: true,
      links: true,
      formatOnPaste: false,
      formatOnType: false,
      acceptSuggestionOnEnter: suggestionsEnabled ? "on" : "off",
      tabCompletion: "off",
      hover: { enabled: true, delay: 300 },
      inlineSuggest: { enabled: false },
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      suggest: {
        showProperties: true,
        showWords: false,
        snippetsPreventQuickSuggestions: false
      },
      wordBasedSuggestions: "off",
      bracketPairColorization: { enabled: true }
    });

    const editor = editorRef.current;
    const suggestWidgetKeyDisposables = installSuggestWidgetKeybindings();
    const plainSpaceKeyDisposable = installPlainSpaceKeyHandler(editor);
    const disabledSuggestSuppressor = installDisabledSuggestSuppressor(
      editor,
      () => suggestionsEnabledRef.current
    );
    if ((isDevMock || window.__CLAB_MONACO_DEBUG__ === true) && modelRef.current) {
      const model = modelRef.current;
      window.__clabMonacoDebug = {
        editor,
        model,
        getMarkers: () => monaco.editor.getModelMarkers({ resource: model.uri }),
        setValue: (nextValue: string) => {
          editor.setValue(nextValue);
          lastExternalAppliedRef.current = nextValue;
        },
        setPosition: (lineNumber: number, column: number) => {
          editor.setPosition({ lineNumber, column });
          editor.focus();
        },
        triggerSuggest: () => {
          if (!suggestionsEnabledRef.current) {
            hideSuggestWidget(editor);
            return;
          }
          editor.trigger("containerlab-test", "editor.action.triggerSuggest", {});
        },
        triggerHover: () => {
          editor.trigger("containerlab-test", "editor.action.showHover", {});
        }
      };
    }

    const disposable = editor.onDidChangeModelContent(() => {
      if (applyingExternalRef.current) return;
      const next = editor.getValue();
      if (onChange !== undefined) onChange(next);
      scheduleValidation();
    });

    // -----------------------------------------------------------------------
    // Paste workaround for VS Code webview sandbox.
    //
    // Monaco's built-in paste calls navigator.clipboard.readText() which is
    // blocked inside VS Code webviews. VS Code intercepts Ctrl+V itself,
    // reads the system clipboard, and dispatches a synthetic ClipboardEvent
    // with clipboardData pre-populated. We listen for that event and insert
    // the text programmatically so paste works reliably.
    // -----------------------------------------------------------------------
    const editorDomNode = editor.getDomNode();

    const handlePaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text/plain");
      if (text === undefined || text.length === 0) return;
      if (editor.getOption(monaco.editor.EditorOption.readOnly)) return;

      event.preventDefault();
      event.stopPropagation();
      triggerPaste(editor, text, event);
    };

    if (editorDomNode) {
      editorDomNode.addEventListener("paste", handlePaste);
    }

    // Override Monaco's context-menu "Paste" action so it also works in the
    // webview sandbox. The override tries navigator.clipboard.readText()
    // (may succeed when triggered by a user gesture like a menu click) and
    // falls back gracefully.
    const pasteActionDisposable = editor.addAction({
      id: "editor.action.clipboardPasteAction.override",
      label: "Paste",
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV],
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 3,
      run: async (ed) => {
        if (ed.getOption(monaco.editor.EditorOption.readOnly)) return;
        try {
          const clipText = await navigator.clipboard.readText();
          if (clipText) {
            triggerPaste(ed, clipText);
          }
        } catch {
          // clipboard.readText() blocked; the DOM paste listener handles
          // Ctrl+V via the synthetic ClipboardEvent from VS Code instead.
        }
      }
    });

    scheduleValidation();

    return () => {
      if (editorDomNode) {
        editorDomNode.removeEventListener("paste", handlePaste);
      }
      pasteActionDisposable.dispose();
      for (const keybindingDisposable of suggestWidgetKeyDisposables) {
        keybindingDisposable.dispose();
      }
      plainSpaceKeyDisposable.dispose();
      disabledSuggestSuppressor.dispose();
      disposable.dispose();
      editorRef.current?.dispose();
      editorRef.current = null;
      if (modelRef.current) {
        setModelCompletionsEnabled(modelRef.current, true);
        modelRef.current.dispose();
      }
      modelRef.current = null;
      modelUriRef.current = null;
      if (window.__clabMonacoDebug?.editor === editor) {
        delete window.__clabMonacoDebug;
      }
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDevMock]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;

    setModelCompletionsEnabled(model, suggestionsEnabled);
    editor.updateOptions({
      inlineSuggest: { enabled: false },
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      acceptSuggestionOnEnter: suggestionsEnabled ? "on" : "off"
    });

    if (!suggestionsEnabled) {
      hideSuggestWidget(editor);
      window.setTimeout(() => {
        if (!suggestionsEnabledRef.current) hideSuggestWidget(editor);
      }, 0);
      window.setTimeout(() => {
        if (!suggestionsEnabledRef.current) hideSuggestWidget(editor);
      }, 75);
    }
  }, [suggestionsEnabled]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.updateOptions({ readOnly });
  }, [readOnly]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;

    // Avoid clobbering user edits. If the model diverged from the last external
    // value, treat it as locally edited and don't overwrite while focused.
    if (editor.hasTextFocus() || editor.hasWidgetFocus()) {
      const locallyEdited = model.getValue() !== lastExternalAppliedRef.current;
      if (locallyEdited) return;
    }

    const current = model.getValue();
    const next = value;
    if (current === next) return;
    const locallyEdited = current !== lastExternalAppliedRef.current;
    if (locallyEdited && next === lastExternalAppliedRef.current) return;

    applyingExternalRef.current = true;
    model.pushEditOperations(
      [],
      [
        {
          range: model.getFullModelRange(),
          text: next
        }
      ],
      () => null
    );
    applyingExternalRef.current = false;
    lastExternalAppliedRef.current = next;
    scheduleValidation();
  }, [scheduleValidation, value]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
};
