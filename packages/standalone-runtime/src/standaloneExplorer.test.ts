import assert from "node:assert/strict";
import test from "node:test";

import type {
  ExplorerIncomingMessage,
  ExplorerNode,
} from "@srl-labs/clab-ui/explorer";

import { createStandaloneExplorerBridge } from "./standaloneExplorer";

type ExplorerSnapshotMessage = Extract<
  ExplorerIncomingMessage,
  { command: "snapshot" }
>;

const HELP_LINKS = [
  ["Containerlab Documentation", "https://containerlab.dev/"],
  [
    "VS Code Extension Documentation",
    "https://containerlab.dev/manual/vsc-extension/",
  ],
  ["Browse Labs on GitHub (srl-labs)", "https://github.com/srl-labs/"],
  ["Join our Discord server", "https://discord.gg/vAyddtaEV9"],
] as const;

function createEmptyExplorerBridge() {
  return createStandaloneExplorerBridge({
    debounceMs: 0,
    getEndpoints: () => [],
    getLabs: () => new Map(),
    invalidateTopologyFileListCache: () => {},
    openFileEditor: async () => {},
    runLifecycle: async () => {},
    listTopologyFiles: async () => [],
    loadTopologyFile: async () => {},
    removeEndpoint: async () => {},
    resolveApiTopologyPath: async () => undefined,
    resolveDeploymentState: async () => undefined,
    resolveTopologyRef: async () => undefined,
  });
}

function waitForExplorerSnapshot(
  bridge: ReturnType<typeof createStandaloneExplorerBridge>,
): Promise<ExplorerSnapshotMessage> {
  return new Promise((resolve) => {
    const unsubscribe = bridge.explorer.subscribe((message) => {
      if (message.command === "snapshot") {
        unsubscribe();
        resolve(message);
      }
    });
    bridge.explorer.connect();
  });
}

test("standalone Help & Feedback items open their configured external links", async (t) => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const openedLinks: Array<{
    features?: string;
    target?: string;
    url: string;
  }> = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      open(url: string, target?: string, features?: string): null {
        openedLinks.push({ features, target, url });
        return null;
      },
    },
  });

  t.after(() => {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
      return;
    }
    delete (globalThis as { window?: unknown }).window;
  });

  const bridge = createEmptyExplorerBridge();
  const snapshot = await waitForExplorerSnapshot(bridge);
  const helpSection = snapshot.sections.find(
    (section) => section.id === "helpFeedback",
  );

  assert.ok(helpSection);

  for (const [label, url] of HELP_LINKS) {
    const helpNode: ExplorerNode | undefined = helpSection.nodes.find(
      (candidate: ExplorerNode) => candidate.label === label,
    );
    assert.ok(helpNode, `${label} should be present`);
    assert.ok(helpNode.primaryAction, `${label} should have a primary action`);
    assert.equal(helpNode.primaryAction.commandId, "containerlab.openLink");

    await bridge.explorer.invokeAction(helpNode.primaryAction.actionRef);
    assert.deepEqual(openedLinks.at(-1), {
      features: "noopener,noreferrer",
      target: "_blank",
      url,
    });
  }
});
