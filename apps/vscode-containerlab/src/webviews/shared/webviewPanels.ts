import type { Uri, Webview } from "vscode";
import type { ImageManagerInitialData } from "@containerlab/clab-ui/image-manager";
import type { InspectWebviewInitialData } from "@containerlab/clab-ui/inspect";
import type { NodeImpairmentsInitialData } from "@containerlab/clab-ui/node-impairments";
import type { SettingsSnapshot } from "@containerlab/clab-ui/settings";
import type { WiresharkVncInitialData } from "@containerlab/clab-ui/wireshark-vnc";

import { createReactWebviewHtml } from "./reactWebviewHtml";

export interface WelcomeWebviewInitialData {
  extensionVersion: string;
}

export interface WebviewPanelDefinition<TInitialData = undefined> {
  scriptFile: string;
  webviewKind: string;
  title: string | ((initialData: TInitialData) => string);
  connectSrc?: string[];
  frameSrc?: string[];
}

export const EXPLORER_PANEL: WebviewPanelDefinition = {
  scriptFile: "containerlabExplorerView.js",
  webviewKind: "containerlab-explorer",
  title: "Containerlab Explorer"
};

export const SETTINGS_PANEL: WebviewPanelDefinition<SettingsSnapshot> = {
  scriptFile: "settingsWebview.js",
  webviewKind: "containerlab-settings",
  title: "Containerlab Settings"
};

export const WELCOME_PANEL: WebviewPanelDefinition<WelcomeWebviewInitialData> = {
  scriptFile: "welcomePageWebview.js",
  webviewKind: "containerlab-welcome",
  title: "Welcome to Containerlab"
};

export const INSPECT_PANEL: WebviewPanelDefinition<InspectWebviewInitialData> = {
  scriptFile: "inspectWebview.js",
  webviewKind: "containerlab-inspect",
  title: "Containerlab Inspect"
};

export const IMAGE_MANAGER_PANEL: WebviewPanelDefinition<ImageManagerInitialData> = {
  scriptFile: "imageManagerWebview.js",
  webviewKind: "containerlab-image-manager",
  title: "Containerlab Images"
};

export const NODE_IMPAIRMENTS_PANEL: WebviewPanelDefinition<NodeImpairmentsInitialData> = {
  scriptFile: "nodeImpairmentsWebview.js",
  webviewKind: "containerlab-node-impairments",
  title: (initialData) => `Manage Link Impairments for ${initialData.nodeName}`
};

export const WIRESHARK_VNC_PANEL: WebviewPanelDefinition<WiresharkVncInitialData> = {
  scriptFile: "wiresharkVncWebview.js",
  webviewKind: "containerlab-wireshark-vnc",
  title: "Wireshark Capture",
  connectSrc: ["http:", "https:"],
  frameSrc: ["http:", "https:"]
};

export function createPanelWebviewHtml<TInitialData>(
  panel: WebviewPanelDefinition<TInitialData>,
  webview: Webview,
  extensionUri: Uri,
  initialData: TInitialData
): string {
  return createReactWebviewHtml({
    webview,
    extensionUri,
    scriptFile: panel.scriptFile,
    title: typeof panel.title === "function" ? panel.title(initialData) : panel.title,
    initialData,
    webviewKind: panel.webviewKind,
    connectSrc: panel.connectSrc,
    frameSrc: panel.frameSrc
  });
}
