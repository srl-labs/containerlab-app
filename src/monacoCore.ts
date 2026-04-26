import "monaco-editor/esm/vs/editor/contrib/bracketMatching/browser/bracketMatching.js";
import "monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js";
import "monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js";
import "monaco-editor/esm/vs/editor/contrib/find/browser/findController.js";
import "monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js";
import "monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js";
import "monaco-editor/esm/vs/editor/contrib/gotoError/browser/gotoError.js";
import "monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/esm/vs/editor/contrib/links/browser/links.js";
import "monaco-editor/esm/vs/editor/contrib/snippet/browser/snippetController2.js";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js";
import "monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestInlineCompletions.js";
import "monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js";

export * from "monaco-editor/esm/vs/editor/editor.api.js";

interface JsonLanguageDefaults {
  languageId: string;
  setDiagnosticsOptions: (options: unknown) => void;
  setModeConfiguration: (configuration: unknown) => void;
}

interface JsonContribution {
  getWorker: () => Promise<unknown>;
  jsonDefaults: JsonLanguageDefaults;
}

let jsonContributionPromise: Promise<JsonContribution> | null = null;
let pendingDiagnosticsOptions: unknown;
let pendingModeConfiguration: unknown;

function loadJsonContribution(): Promise<JsonContribution> {
  jsonContributionPromise ??= import(
    "monaco-editor/esm/vs/language/json/monaco.contribution.js"
  ).then((module) => module as unknown as JsonContribution);

  return jsonContributionPromise.then((contribution) => {
    if (pendingDiagnosticsOptions !== undefined) {
      contribution.jsonDefaults.setDiagnosticsOptions(pendingDiagnosticsOptions);
      pendingDiagnosticsOptions = undefined;
    }
    if (pendingModeConfiguration !== undefined) {
      contribution.jsonDefaults.setModeConfiguration(pendingModeConfiguration);
      pendingModeConfiguration = undefined;
    }
    return contribution;
  });
}

export const json = {
  getWorker: () => loadJsonContribution().then((contribution) => contribution.getWorker()),
  jsonDefaults: {
    languageId: "json",
    setDiagnosticsOptions: (options: unknown) => {
      pendingDiagnosticsOptions = options;
      void loadJsonContribution();
    },
    setModeConfiguration: (configuration: unknown) => {
      pendingModeConfiguration = configuration;
      void loadJsonContribution();
    }
  }
};
