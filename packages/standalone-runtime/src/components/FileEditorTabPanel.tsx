import * as monaco from "@srl-labs/clab-ui/monaco/core";
import { useCallback, useEffect, useRef } from "react";

import { writeFileExplorerFile } from "../runtimeApi";
import {
  isFileLabTab,
  useLabTabsStore,
  type FileLabTab,
} from "../stores/labTabsStore";
import { runtimeUiActions } from "../stores/runtimeUiStore";
import {
  attachContainerlabYamlSupport,
  createContainerlabYamlModel,
  isContainerlabTopologyFile,
} from "./containerlabYamlFileEditorSupport";

interface FileEditorTabPanelProps {
  onClose: (tabId: string) => void;
  tab: FileLabTab;
}

const PANEL_BG =
  "var(--clab-ui-editor-background, var(--vscode-editor-background, #1e1e1e))";
const PANEL_FG =
  "var(--clab-ui-editor-foreground, var(--vscode-editor-foreground, #d4d4d4))";
const BORDER = "var(--vscode-panel-border, rgba(128, 128, 128, 0.35))";
const BUTTON_BG = "var(--vscode-button-background, #0e639c)";
const BUTTON_FG = "var(--vscode-button-foreground, #ffffff)";
const DISABLED_BG =
  "var(--vscode-button-secondaryBackground, rgba(128, 128, 128, 0.25))";
const ERROR_BG =
  "var(--vscode-inputValidation-errorBackground, rgba(127, 29, 29, 0.35))";
const ERROR_BORDER = "var(--vscode-inputValidation-errorBorder, #be1100)";

const LANGUAGE_PATTERNS: Array<[RegExp, string]> = [
  [/\.drawio$/, "xml"],
  [/\.(svg|xhtml|xaml|plist|gml|kml|wsdl)$/, "xml"],
  [/\.(ya?ml)$/, "yaml"],
  [/\.json$/, "json"],
  [/\.jsonc$/, "json"],
  [/\.mdx$/, "mdx"],
  [/\.md$/, "markdown"],
  [/\.html?$/, "html"],
  [/\.css$/, "css"],
  [/\.scss$/, "scss"],
  [/\.less$/, "less"],
  [/\.(xml|xsd)$/, "xml"],
  [/\.(sh|bash|zsh)$/, "shell"],
  [/\.ps1$/, "powershell"],
  [/\.bat$/, "bat"],
  [/\.(ts|tsx)$/, "typescript"],
  [/\.(js|jsx|mjs|cjs)$/, "javascript"],
  [/\.py$/, "python"],
  [/\.go$/, "go"],
  [/\.rs$/, "rust"],
  [/\.(c|cc|cpp|cxx|h|hpp)$/, "cpp"],
  [/\.cs$/, "csharp"],
  [/\.java$/, "java"],
  [/\.php$/, "php"],
  [/\.rb$/, "ruby"],
  [/\.mysql$/, "mysql"],
  [/\.pgsql$/, "pgsql"],
  [/\.sql$/, "sql"],
  [/\.tf$/, "hcl"],
  [/\.proto$/, "protobuf"],
  [/\.(ini|conf|cfg)$/, "ini"],
];

const MONACO_COLORS = {
  light: {
    bg: "#ffffff",
    fg: "#333333",
    sel: "#add6ff",
    inactiveSel: "#e5ebf1",
    selectionHighlight: "#add6ff66",
    wordHighlight: "#57575740",
    wordHighlightStrong: "#0e639c40",
  },
  dark: {
    bg: "#1e1e1e",
    fg: "#cccccc",
    sel: "#264f78",
    inactiveSel: "#3a3d41",
    selectionHighlight: "#add6ff26",
    wordHighlight: "#575757b8",
    wordHighlightStrong: "#004972b8",
  },
} as const;

function sniffLanguage(content: string): string {
  const trimmed = content.trimStart();
  if (!trimmed) {
    return "plaintext";
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return "json";
  }
  if (
    trimmed.startsWith("<") ||
    trimmed.startsWith("<?xml") ||
    trimmed.startsWith("<mxfile") ||
    trimmed.startsWith("<svg")
  ) {
    return "xml";
  }
  return "plaintext";
}

function languageForDocument(pathValue: string, content: string): string {
  const fileName =
    pathValue.split("/").pop()?.toLowerCase() ?? pathValue.toLowerCase();
  if (fileName === "dockerfile" || fileName.endsWith(".dockerfile")) {
    return "dockerfile";
  }
  return (
    LANGUAGE_PATTERNS.find(([pattern]) => pattern.test(fileName))?.[1] ??
    sniffLanguage(content)
  );
}

function getCssVar(name: string, fallback: string): string {
  const value = window
    .getComputedStyle(document.body)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function parseLuminance(color: string): number | null {
  let red = 0;
  let green = 0;
  let blue = 0;
  const trimmed = color.trim();
  const hexMatch = /^#([0-9a-f]{3,8})$/i.exec(trimmed);
  if (hexMatch) {
    const rawHex = hexMatch[1];
    const hex =
      rawHex.length === 3
        ? rawHex
            .split("")
            .map((part) => part + part)
            .join("")
        : rawHex;
    red = Number.parseInt(hex.slice(0, 2), 16);
    green = Number.parseInt(hex.slice(2, 4), 16);
    blue = Number.parseInt(hex.slice(4, 6), 16);
  } else {
    const rgbMatch = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(trimmed);
    if (!rgbMatch) {
      return null;
    }
    red = Number.parseInt(rgbMatch[1], 10);
    green = Number.parseInt(rgbMatch[2], 10);
    blue = Number.parseInt(rgbMatch[3], 10);
  }
  if (
    !Number.isFinite(red) ||
    !Number.isFinite(green) ||
    !Number.isFinite(blue)
  ) {
    return null;
  }
  return (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
}

function detectColorMode(): "light" | "dark" {
  if (document.documentElement.classList.contains("light")) {
    return "light";
  }
  const background = getCssVar(
    "--clab-ui-editor-background",
    getCssVar("--vscode-editor-background", MONACO_COLORS.dark.bg),
  );
  const luminance = parseLuminance(background);
  return luminance !== null && luminance > 0.5 ? "light" : "dark";
}

function applyFileEditorMonacoTheme(): string {
  const mode = detectColorMode();
  const colors = MONACO_COLORS[mode];
  const themeName =
    mode === "light" ? "containerlab-file-light" : "containerlab-file-dark";
  monaco.editor.defineTheme(themeName, {
    base: mode === "light" ? "vs" : "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": getCssVar(
        "--clab-ui-editor-background",
        getCssVar("--vscode-editor-background", colors.bg),
      ),
      "editor.foreground": getCssVar(
        "--clab-ui-editor-foreground",
        getCssVar("--vscode-editor-foreground", colors.fg),
      ),
      "editor.selectionBackground": colors.sel,
      "editor.inactiveSelectionBackground": colors.inactiveSel,
      "editor.selectionHighlightBackground": colors.selectionHighlight,
      "editor.wordHighlightBackground": colors.wordHighlight,
      "editor.wordHighlightStrongBackground": colors.wordHighlightStrong,
    },
  });
  monaco.editor.setTheme(themeName);
  return themeName;
}

function configureLanguage(language: string): void {
  if (language === "json") {
    monaco.json.jsonDefaults.setDiagnosticsOptions({ validate: false });
  }
}

function installPlainSpaceKeyHandler(
  editor: monaco.editor.IStandaloneCodeEditor,
): monaco.IDisposable {
  return editor.onKeyDown((event) => {
    if (event.keyCode !== monaco.KeyCode.Space) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.altGraphKey) {
      return;
    }
    if (event.browserEvent.isComposing) {
      return;
    }
    if (editor.getOption(monaco.editor.EditorOption.readOnly)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    editor.trigger("keyboard", "type", { text: " " });
  });
}

export function FileEditorTabPanel({ onClose, tab }: FileEditorTabPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const currentModelPathRef = useRef<string | null>(null);
  const dirty = tab.content !== tab.originalContent;

  const handleSave = useCallback(async () => {
    const currentTab = useLabTabsStore
      .getState()
      .tabs.find((entry) => entry.id === tab.id);
    if (!isFileLabTab(currentTab) || currentTab.saving) {
      return;
    }

    useLabTabsStore.getState().setFileTabSaving(currentTab.id, true);
    useLabTabsStore.getState().setFileTabError(currentTab.id, undefined);
    try {
      await writeFileExplorerFile({
        endpointId: currentTab.endpointId,
        path: currentTab.path,
        content: currentTab.content,
      });
      useLabTabsStore
        .getState()
        .markFileTabSaved(currentTab.id, currentTab.content);
      runtimeUiActions.notify(`Saved ${currentTab.path}`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      useLabTabsStore.getState().setFileTabSaving(currentTab.id, false);
      useLabTabsStore.getState().setFileTabError(currentTab.id, message);
      runtimeUiActions.notify(
        `Failed to save ${currentTab.path}: ${message}`,
        "error",
      );
    }
  }, [tab.id]);

  const handleClose = useCallback(() => {
    onClose(tab.id);
  }, [onClose, tab.id]);

  useEffect(() => {
    if (!containerRef.current) {
      return undefined;
    }

    currentModelPathRef.current = tab.path;
    const theme = applyFileEditorMonacoTheme();
    const language = languageForDocument(tab.path, tab.content);
    configureLanguage(language);
    const schemaModel = isContainerlabTopologyFile(tab.path)
      ? createContainerlabYamlModel(
          monaco,
          tab.endpointId,
          tab.path,
          tab.content,
        )
      : null;
    const schemaSupport = schemaModel
      ? attachContainerlabYamlSupport(monaco, schemaModel)
      : null;
    const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = {
      theme,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      tabSize: 2,
      wordWrap: "on",
      hover: { enabled: true, delay: 300 },
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      suggest: {
        showProperties: true,
        showWords: false,
        snippetsPreventQuickSuggestions: false,
      },
      wordBasedSuggestions: "off",
    };
    if (schemaModel) {
      editorOptions.model = schemaModel;
    } else {
      editorOptions.value = tab.content;
      editorOptions.language = language;
    }

    const editor = monaco.editor.create(containerRef.current, editorOptions);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      void handleSave();
    });
    editorRef.current = editor;
    const spaceDisposable = installPlainSpaceKeyHandler(editor);
    const subscription = editor.onDidChangeModelContent(() => {
      useLabTabsStore.getState().setFileTabContent(tab.id, editor.getValue());
    });

    return () => {
      schemaSupport?.dispose();
      spaceDisposable.dispose();
      subscription.dispose();
      editor.dispose();
      schemaModel?.dispose();
      editorRef.current = null;
      currentModelPathRef.current = null;
    };
  }, [handleSave, tab.endpointId, tab.id, tab.path]);

  useEffect(() => {
    applyFileEditorMonacoTheme();
    const observer = new MutationObserver(() => {
      applyFileEditorMonacoTheme();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!editorRef.current || currentModelPathRef.current !== tab.path) {
      return;
    }
    if (editorRef.current.getValue() !== tab.content) {
      editorRef.current.setValue(tab.content);
    }
  }, [tab.content, tab.path]);

  return (
    <div
      data-testid="file-editor-tab-panel"
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        minHeight: 0,
        flexDirection: "column",
        backgroundColor: PANEL_BG,
        color: PANEL_FG,
        pointerEvents: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          minHeight: 44,
          padding: "0 12px",
          borderBottom: `1px solid ${BORDER}`,
          boxSizing: "border-box",
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {tab.title}
            {dirty ? " *" : ""}
          </div>
          <div
            style={{
              marginTop: 2,
              fontSize: 11,
              opacity: 0.75,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            Lab workspace/{tab.path}
          </div>
        </div>
        <button
          type="button"
          onClick={handleClose}
          style={{
            height: 28,
            padding: "0 10px",
            borderRadius: 4,
            border: `1px solid ${BORDER}`,
            backgroundColor: "transparent",
            color: PANEL_FG,
            cursor: "pointer",
          }}
        >
          Close
        </button>
        <button
          type="button"
          data-testid="file-editor-tab-save"
          disabled={!dirty || tab.saving}
          onClick={() => {
            void handleSave();
          }}
          style={{
            height: 28,
            minWidth: 70,
            padding: "0 12px",
            borderRadius: 4,
            border: "none",
            backgroundColor: dirty && !tab.saving ? BUTTON_BG : DISABLED_BG,
            color: BUTTON_FG,
            cursor: dirty && !tab.saving ? "pointer" : "default",
            opacity: dirty && !tab.saving ? 1 : 0.65,
          }}
        >
          {tab.saving ? "Saving..." : "Save"}
        </button>
      </div>
      {tab.error ? (
        <div
          style={{
            padding: "8px 12px",
            borderBottom: `1px solid ${ERROR_BORDER}`,
            backgroundColor: ERROR_BG,
            fontSize: 12,
          }}
        >
          {tab.error}
        </div>
      ) : null}
      <div
        ref={containerRef}
        data-testid="file-editor-tab-monaco"
        style={{ flex: 1, minHeight: 0 }}
      />
    </div>
  );
}
