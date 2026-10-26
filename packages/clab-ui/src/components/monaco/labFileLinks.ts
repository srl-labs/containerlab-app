// Ctrl/Cmd+click on the files a topology refers to (binds, startup configs, licenses).
import type * as monaco from "monaco-editor";

import { resolveLabFileReference, type LabFileRequest } from "../../host/labFiles";
import { literalTopologyName, topologyFileStem } from "../../host/topologyVariables";
import { findLabFileReferences, type LabFileReference } from "../../yaml/labFileReferences";

type MonacoApi = Pick<typeof monaco, "Uri" | "editor" | "languages">;

export interface LabFileLinks {
  /** The file a reference opens; undefined when it cannot be opened. */
  resolve: (reference: LabFileReference) => LabFileRequest | undefined;
  open: (request: LabFileRequest) => void;
}

const LINK_SCHEME = "clab-lab-file";
/** Link handlers of the editors that show them, by model URI. */
const modelLinks = new Map<string, () => LabFileLinks | undefined>();
let registered = false;

function linkUri(monacoApi: MonacoApi, model: monaco.editor.ITextModel, request: LabFileRequest): monaco.Uri {
  const query = new URLSearchParams({ model: model.uri.toString(), path: request.path });
  if (request.create === true) query.set("create", "1");
  return monacoApi.Uri.from({ scheme: LINK_SCHEME, path: "/", query: query.toString() });
}

/**
 * Opening a file tab can close the editor right after the click, and Monaco
 * then cancels the click's pending word highlight as a rejected promise that
 * nothing awaits. That is expected; keep it out of the console.
 */
function ignoreMonacoCancellations(): void {
  window.addEventListener("unhandledrejection", (event) => {
    const reason: unknown = event.reason;
    if (reason instanceof Error && reason.name === "Canceled" && reason.message === "Canceled") {
      event.preventDefault();
    }
  });
}

function ensureRegistered(monacoApi: MonacoApi): void {
  if (registered) return;
  registered = true;
  ignoreMonacoCancellations();

  monacoApi.languages.registerLinkProvider("yaml", {
    provideLinks(model) {
      const links = modelLinks.get(model.uri.toString())?.();
      if (!links) return { links: [] };
      const result: monaco.languages.ILink[] = [];
      for (const reference of findLabFileReferences(model.getValue())) {
        const request = links.resolve(reference);
        if (!request) continue;
        const start = model.getPositionAt(reference.start);
        const end = model.getPositionAt(reference.end);
        result.push({
          range: {
            startLineNumber: start.lineNumber,
            startColumn: start.column,
            endLineNumber: end.lineNumber,
            endColumn: end.column
          },
          url: linkUri(monacoApi, model, request),
          tooltip: `Open ${request.path}`
        });
      }
      return { links: result };
    }
  });

  monacoApi.editor.registerLinkOpener({
    open(resource) {
      if (resource.scheme !== LINK_SCHEME) return false;
      const query = new URLSearchParams(resource.query);
      const links = modelLinks.get(query.get("model") ?? "")?.();
      const path = query.get("path");
      if (!links || path === null) return true;
      links.open({ path, ...(query.get("create") === "1" ? { create: true } : {}) });
      return true;
    }
  });
}

/**
 * Links of a topology file edited as plain text, without a topology session:
 * the lab name comes from the text, variables of the lab host stay unknown.
 */
export function plainTopologyFileLinks(
  model: monaco.editor.ITextModel,
  topologyPath: string,
  open: (request: LabFileRequest) => void
): LabFileLinks {
  return {
    resolve: (reference) =>
      resolveLabFileReference(reference.value, reference.kind, {
        labName: literalTopologyName(model.getValue()) ?? topologyFileStem(topologyPath),
        nodeName: reference.nodeName
      }),
    open
  };
}

/**
 * Turns the lab files of a topology model into links. `getLinks` is read
 * whenever links are computed or opened, so it may change with the editor's
 * props; returning undefined shows no links.
 */
export function attachLabFileLinks(
  monacoApi: MonacoApi,
  model: monaco.editor.ITextModel,
  getLinks: () => LabFileLinks | undefined
): monaco.IDisposable {
  ensureRegistered(monacoApi);
  const key = model.uri.toString();
  modelLinks.set(key, getLinks);
  return {
    dispose: () => {
      if (modelLinks.get(key) === getLinks) modelLinks.delete(key);
    }
  };
}
