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
import "monaco-editor/esm/vs/language/json/monaco.contribution.js";
import "monaco-editor/esm/vs/basic-languages/bat/bat.contribution.js";
import "monaco-editor/esm/vs/basic-languages/cpp/cpp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js";
import "monaco-editor/esm/vs/basic-languages/css/css.contribution.js";
import "monaco-editor/esm/vs/basic-languages/dockerfile/dockerfile.contribution.js";
import "monaco-editor/esm/vs/basic-languages/go/go.contribution.js";
import "monaco-editor/esm/vs/basic-languages/hcl/hcl.contribution.js";
import "monaco-editor/esm/vs/basic-languages/html/html.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ini/ini.contribution.js";
import "monaco-editor/esm/vs/basic-languages/java/java.contribution.js";
import "monaco-editor/esm/vs/basic-languages/javascript/javascript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/less/less.contribution.js";
import "monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution.js";
import "monaco-editor/esm/vs/basic-languages/mdx/mdx.contribution.js";
import "monaco-editor/esm/vs/basic-languages/mysql/mysql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/php/php.contribution.js";
import "monaco-editor/esm/vs/basic-languages/pgsql/pgsql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/powershell/powershell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/protobuf/protobuf.contribution.js";
import "monaco-editor/esm/vs/basic-languages/python/python.contribution.js";
import "monaco-editor/esm/vs/basic-languages/ruby/ruby.contribution.js";
import "monaco-editor/esm/vs/basic-languages/rust/rust.contribution.js";
import "monaco-editor/esm/vs/basic-languages/scss/scss.contribution.js";
import "monaco-editor/esm/vs/basic-languages/shell/shell.contribution.js";
import "monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js";
import "monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution.js";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution.js";
import "monaco-editor/esm/vs/basic-languages/yaml/yaml.contribution.js";

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
