import type React from "react";

import type { MonacoCodeEditorProps } from "./MonacoCodeEditor";

type MonacoCodeEditorModule = { default: React.ComponentType<MonacoCodeEditorProps> };

let monacoCodeEditorModulePromise: Promise<MonacoCodeEditorModule> | null = null;

export function preloadMonacoCodeEditor(): Promise<MonacoCodeEditorModule> {
  monacoCodeEditorModulePromise ??= import("./MonacoCodeEditor").then((module) => ({
    default: module.MonacoCodeEditor
  }));
  return monacoCodeEditorModulePromise;
}
