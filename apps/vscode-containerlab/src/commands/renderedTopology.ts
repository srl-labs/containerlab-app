import * as path from "path";

import * as vscode from "vscode";
import { isTopologyTemplateFileName } from "@containerlab/clab-ui/host";

import { labPathOf, resolveLab } from "../backend/labBackends";

const RENDERED_TOPOLOGY_SCHEME = "containerlab-rendered";

function topologyOf(uri: vscode.Uri): { labPath: string; connectionId?: string } {
  const query = new URLSearchParams(uri.query);
  return {
    labPath: query.get("topology") ?? "",
    connectionId: query.get("connection") ?? undefined
  };
}

/** Read-only documents with a topology template as containerlab renders it. */
class RenderedTopologyProvider implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { labPath, connectionId } = topologyOf(uri);
    const file = path.basename(labPath);
    try {
      const { backend, target } = await resolveLab(labPath, undefined, connectionId);
      const rendered = await backend.renderTopology(target);
      const varsFiles = rendered.varsFiles ?? [];
      const header = [
        `# Rendered from ${file} by containerlab. Read only: edit the template instead.`,
        `# Variables: ${varsFiles.length > 0 ? varsFiles.join(", ") : "none"}`,
        ...(rendered.error ? [`# containerlab rejects this topology: ${rendered.error}`] : [])
      ];
      return `${header.join("\n")}\n${rendered.content}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `# Could not render ${file}\n# ${message.split("\n").join("\n# ")}\n`;
    }
  }

  /** Renders the open previews of a template again, e.g. after it was saved. */
  refresh(labPath: string): void {
    for (const document of vscode.workspace.textDocuments) {
      if (
        document.uri.scheme === RENDERED_TOPOLOGY_SCHEME &&
        topologyOf(document.uri).labPath === labPath
      ) {
        this.changed.fire(document.uri);
      }
    }
  }
}

let provider: RenderedTopologyProvider | undefined;

export function registerRenderedTopologyProvider(context: vscode.ExtensionContext): void {
  provider = new RenderedTopologyProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(RENDERED_TOPOLOGY_SCHEME, provider),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (isTopologyTemplateFileName(document.uri.path)) {
        provider?.refresh(labPathOf(document.uri));
      }
    })
  );
}

/** Opens the rendered topology of a `.clab.gotmpl` template beside it. */
export async function showRenderedTopology(labPath: string, connectionId?: string): Promise<void> {
  const query = new URLSearchParams({ topology: labPath });
  if (connectionId) query.set("connection", connectionId);
  const uri = vscode.Uri.from({
    scheme: RENDERED_TOPOLOGY_SCHEME,
    path: `/${path.basename(labPath).replace(/\.clab\.gotmpl$/i, "")}.rendered.clab.yml`,
    query: query.toString()
  });
  provider?.refresh(labPath);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.languages.setTextDocumentLanguage(document, "yaml");
  await vscode.window.showTextDocument(document, {
    viewColumn: vscode.ViewColumn.Beside,
    preview: true,
    preserveFocus: true
  });
}
