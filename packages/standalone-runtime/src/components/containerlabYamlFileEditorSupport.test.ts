import assert from "node:assert/strict";
import test from "node:test";
import type * as monaco from "@containerlab/clab-ui/monaco/core";
import { attachContainerlabYamlSupport } from "./containerlabYamlFileEditorSupport.ts";

test("file editor shares schema completions and scopes providers to attached models", () => {
  let completion: monaco.languages.CompletionItemProvider | undefined;
  let hover: monaco.languages.HoverProvider | undefined;
  let disposed = false;
  const markers: unknown[][] = [];
  const api = {
    languages: {
      CompletionItemKind: {
        Property: 9,
        EnumMember: 15,
        Snippet: 27,
        Value: 12,
      },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      CompletionTriggerKind: { Invoke: 0 },
      registerCompletionItemProvider(
        _language: string,
        provider: monaco.languages.CompletionItemProvider,
      ) {
        completion = provider;
        return { dispose() {} };
      },
      registerHoverProvider(
        _language: string,
        provider: monaco.languages.HoverProvider,
      ) {
        hover = provider;
        return { dispose() {} };
      },
    },
    editor: {
      setModelMarkers(_model: unknown, _owner: string, values: unknown[]) {
        markers.push(values);
      },
    },
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
  } as unknown as typeof monaco;
  let text = "";
  const model = {
    uri: { toString: () => "file:///test.clab.yml" },
    getValue: () => text,
    getLineContent: (line: number) => text.split("\n")[line - 1],
    getLineMaxColumn: (line: number) => text.split("\n")[line - 1].length + 1,
    getWordAtPosition: () => null,
    onDidChangeContent: () => ({
      dispose() {
        disposed = true;
      },
    }),
  } as unknown as monaco.editor.ITextModel;
  const support = attachContainerlabYamlSupport(api, model);
  const token = {} as monaco.CancellationToken;
  const context = { triggerKind: 0 } as monaco.languages.CompletionContext;
  const complete = (source: string) => {
    text = source;
    const lines = text.split("\n");
    return completion!.provideCompletionItems(
      model,
      {
        lineNumber: lines.length,
        column: lines.at(-1)!.length + 1,
      } as monaco.Position,
      context,
      token,
    ) as monaco.languages.CompletionList;
  };
  try {
    assert.ok(
      complete(
        "name: demo\ntopology:\n  nodes:\n    r1:\n      ",
      ).suggestions.some((item) => item.label === "kind"),
    );
    assert.ok(
      complete(
        "name: demo\ntopology:\n  nodes:\n    r1:\n      kind: nokia_srlinux\n      type: ",
      ).suggestions.some((item) => item.label === "ixr-d2"),
    );
    assert.ok(
      complete(
        "name: demo\ntopology:\n  nodes:\n    r1:\n      kind: linux\n  links:\n    - endpoints:\n        - r",
      ).suggestions.some((item) => item.insertText === "r1:"),
    );
    text = "name: demo";
    assert.ok(
      hover!.provideHover(
        model,
        { lineNumber: 1, column: 2 } as monaco.Position,
        token,
        {} as monaco.languages.HoverContext,
      ),
    );
  } finally {
    support.dispose();
  }
  assert.equal(disposed, true);
  assert.deepEqual(markers.at(-1), []);
  assert.equal(complete("name: demo"), undefined);
  assert.equal(
    hover!.provideHover(
      model,
      { lineNumber: 1, column: 2 } as monaco.Position,
      token,
      {} as monaco.languages.HoverContext,
    ),
    null,
  );
});
