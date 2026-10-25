import assert from "node:assert/strict";
import test from "node:test";

import type { ExplorerIncomingMessage, ExplorerSnapshotProviders } from "../explorer/snapshot";

import { createExplorerController } from "./controllers";

/** A running lab whose uptime text changes on every refresh, like a real one. */
function changingProviders(tick: number): ExplorerSnapshotProviders {
  const lab = {
    label: "demo",
    description: `Up ${tick} seconds`,
    contextValue: "containerlabLabDeployed",
    collapsibleState: 0
  };
  const provider = (roots: unknown[]) => ({ getChildren: (element?: unknown) => (element ? [] : roots) });
  return {
    runningProvider: provider([lab]),
    localProvider: provider([]),
    helpProvider: provider([])
  } as unknown as ExplorerSnapshotProviders;
}

function firstActionRef(message: ExplorerIncomingMessage): string {
  assert.equal(message.command, "snapshot");
  const running = message.sections.find((section) => section.id === "runningLabs");
  const actionRef = running?.nodes[0]?.actions[0]?.actionRef;
  assert.ok(actionRef);
  return actionRef;
}

test("explorer actions of earlier snapshots keep working after many refreshes", async () => {
  let tick = 0;
  const messages: ExplorerIncomingMessage[] = [];
  let published: () => void = () => {};
  const executed: string[] = [];
  const controller = createExplorerController({
    debounceMs: 0,
    buildProviders: async () => changingProviders((tick += 1)),
    executeAction: async (binding) => {
      executed.push(binding.commandId);
    },
    publish: (message) => {
      messages.push(message);
      if (message.command === "snapshot") published();
    }
  });
  const nextSnapshot = () =>
    new Promise<void>((resolve) => {
      published = resolve;
    });

  let snapshot = nextSnapshot();
  controller.connect();
  await snapshot;
  const firstSnapshot = messages.findLast((message) => message.command === "snapshot");
  assert.ok(firstSnapshot);
  const staleRef = firstActionRef(firstSnapshot);

  // Enough refreshes that a fixed number of kept actions would have dropped the first ones.
  for (let index = 0; index < 300; index += 1) {
    snapshot = nextSnapshot();
    controller.scheduleSnapshot(0);
    await snapshot;
  }
  const latest = messages.findLast((message) => message.command === "snapshot");
  assert.ok(latest);
  assert.notEqual(firstActionRef(latest), staleRef);

  await controller.invokeAction(staleRef);
  assert.equal(executed.length, 1);

  snapshot = nextSnapshot();
  await controller.invokeAction("action:unknown");
  await snapshot;
  const error = messages.find((message) => message.command === "error");
  assert.ok(error);
  controller.dispose();
});
