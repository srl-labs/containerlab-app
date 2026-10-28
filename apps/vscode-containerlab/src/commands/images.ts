import * as vscode from "vscode";

import {
  collectKindImageReferencesFromCustomTemplates,
  collectKindImageReferencesFromYaml,
  type ImageActionResult,
  type ImageManagerTargetOptions,
  type ImagePullRequest,
  type ImageRemoveRequest,
  type KindImageReference
} from "@containerlab/clab-ui/image-manager/catalog";

import { IMAGE_MANAGER_PANEL, createPanelWebviewHtml } from "../webviews/shared/webviewPanels";
import { pullDockerImage } from "../utils/docker/docker";
import { listDockerImageSummaries, removeDockerImage } from "../utils/docker/images";
import { connectionOf, pickConnection } from "../backend/labBackends";
import type { LabConnection } from "../backend/connections";
import { getCustomNodesFromConfig } from "../reactTopoViewer/extension/services/schema";
import { cachedLabHostInfo, ensureHostSupports } from "../backend/labHostSupport";

type ImageManagerRequestMessage = {
  command?: string;
  requestId?: string;
  action?: string;
  payload?: unknown;
};

/** One image manager per connection. */
const panels = new Map<string, vscode.WebviewPanel>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function stringField(record: Record<string, unknown>, key: string): string {
  return optionalString(record, key) ?? "";
}

function isImageManagerRequest(message: unknown): message is Required<ImageManagerRequestMessage> {
  if (!isRecord(message)) {
    return false;
  }
  return (
    message.command === "image-manager:request" &&
    typeof message.requestId === "string" &&
    typeof message.action === "string"
  );
}

function asTargetOptions(payload: unknown): ImageManagerTargetOptions {
  const record = isRecord(payload) ? payload : {};
  const endpointId = optionalString(record, "endpointId");
  return endpointId === undefined ? {} : { endpointId };
}

function asPullRequest(payload: unknown): ImagePullRequest {
  const record = isRecord(payload) ? payload : {};
  const endpointId = optionalString(record, "endpointId");
  const kind = optionalString(record, "kind");
  const request: ImagePullRequest = {
    ...(endpointId === undefined ? {} : { endpointId }),
    image: stringField(record, "image")
  };
  if (kind !== undefined) {
    request.kind = kind;
  }
  return request;
}

function asRemoveRequest(payload: unknown): ImageRemoveRequest {
  const record = isRecord(payload) ? payload : {};
  const endpointId = optionalString(record, "endpointId");
  return {
    ...(endpointId === undefined ? {} : { endpointId }),
    reference: stringField(record, "reference"),
    force: record.force === true
  };
}

function referenceOptions(
  options: ImageManagerTargetOptions,
  extra: { label: string; path?: string }
): { endpointId?: string; label: string; path?: string } {
  return {
    ...extra,
    ...(options.endpointId === undefined ? {} : { endpointId: options.endpointId })
  };
}

async function collectWorkspaceImageReferences(
  options: ImageManagerTargetOptions
): Promise<KindImageReference[]> {
  const yamlFiles = await vscode.workspace.findFiles(
    "**/*.clab.{yml,yaml}",
    "**/{node_modules,.git,out,dist}/**",
    1000
  );
  const references: KindImageReference[] = [];
  for (const uri of yamlFiles) {
    try {
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
      references.push(
        ...collectKindImageReferencesFromYaml(
          content,
          referenceOptions(options, {
            label: vscode.workspace.asRelativePath(uri, false),
            path: uri.fsPath
          })
        )
      );
    } catch {
      // Ignore malformed or unreadable topology candidates.
    }
  }

  references.push(
    ...collectKindImageReferencesFromCustomTemplates(
      getCustomNodesFromConfig(),
      referenceOptions(options, {
        label: "Custom"
      })
    )
  );
  return references;
}

async function handleImageManagerRequest(
  connection: LabConnection,
  message: Required<ImageManagerRequestMessage>
): Promise<unknown> {
  switch (message.action) {
    case "listImages":
      return listDockerImageSummaries(connection);
    case "listImageReferences":
      return collectWorkspaceImageReferences(asTargetOptions(message.payload));
    case "pullImage": {
      const request = asPullRequest(message.payload);
      const image = request.image.trim();
      if (image.length === 0) {
        throw new Error("Image reference is required.");
      }
      const success = await pullDockerImage(image, connection);
      return {
        success,
        image,
        message: success ? `Pulled ${image}.` : `Failed to pull ${image}.`
      } satisfies ImageActionResult;
    }
    case "removeImage": {
      const request = asRemoveRequest(message.payload);
      const reference = request.reference.trim();
      if (reference.length === 0) {
        throw new Error("Image reference is required.");
      }
      await removeDockerImage(reference, request.force === true, connection);
      return {
        success: true,
        image: reference,
        message: `Removed ${reference}.`
      } satisfies ImageActionResult;
    }
    default:
      throw new Error(`Unsupported image manager action: ${message.action}`);
  }
}

async function respondToImageManagerRequest(
  panel: vscode.WebviewPanel,
  connection: LabConnection,
  message: unknown
): Promise<void> {
  if (!isImageManagerRequest(message)) {
    return;
  }
  try {
    const result = await handleImageManagerRequest(connection, message);
    await panel.webview.postMessage({
      type: "image-manager:response",
      requestId: message.requestId,
      success: true,
      result
    });
  } catch (error) {
    await panel.webview.postMessage({
      type: "image-manager:response",
      requestId: message.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/** Opens the images of a connection: this machine, or a lab host. */
export async function manageImages(
  context: vscode.ExtensionContext,
  target?: unknown
): Promise<void> {
  const connection =
    target !== undefined
      ? connectionOf(target)
      : await pickConnection(
          "Manage images on",
          // A cluster's nodes pull their own images: only container runtimes have images here.
          (candidate) => cachedLabHostInfo(candidate)?.support.imageManagement !== false
        );
  if (!connection) {
    return;
  }
  if (!(await ensureHostSupports(connection, "imageManagement", "Image management"))) return;
  const existing = panels.get(connection.id);
  if (existing) {
    existing.reveal(vscode.ViewColumn.One);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "containerlabImageManager",
    connection.kind === "api" ? `Images on ${connection.label}` : "Containerlab Images",
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, "dist"),
        vscode.Uri.joinPath(context.extensionUri, "resources")
      ]
    }
  );
  panels.set(connection.id, panel);
  panel.onDidDispose(() => {
    panels.delete(connection.id);
  });

  panel.webview.html = createPanelWebviewHtml(
    IMAGE_MANAGER_PANEL,
    panel.webview,
    context.extensionUri,
    {}
  );
  panel.webview.onDidReceiveMessage((message: unknown) => {
    void respondToImageManagerRequest(panel, connection, message);
  });
}
