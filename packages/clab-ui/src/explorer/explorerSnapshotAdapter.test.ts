import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExplorerSnapshot,
  type ExplorerSnapshotProviders
} from "./explorerSnapshotAdapter";

const TREE_ITEM_COLLAPSED = 1;

function provider(roots: unknown[]): { getChildren(element?: unknown): unknown[] } {
  return {
    getChildren(element?: unknown): unknown[] {
      if (
        typeof element === "object" &&
        element !== null &&
        "children" in element &&
        Array.isArray((element as { children?: unknown }).children)
      ) {
        return (element as { children: unknown[] }).children;
      }
      return roots;
    }
  };
}

test("buildExplorerSnapshot hides configured node and toolbar commands", async () => {
  const endpoint = {
    label: "Endpoint",
    contextValue: "containerlabEndpoint",
    state: "connected",
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      {
        label: "demo.clab.yml",
        contextValue: "containerlabLabUndeployed",
        collapsibleState: 0
      }
    ]
  };
  const providers = {
    runningProvider: provider([endpoint]),
    localProvider: provider([]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;

  const { snapshot } = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true,
    hiddenCommandIds: [
      "containerlab.lab.openFolderInNewWindow",
      "containerlab.install.edgeshark",
      "containerlab.inspectAll"
    ]
  });

  const runningSection = snapshot.sections.find((section) => section.id === "runningLabs");
  assert.ok(runningSection);
  assert.equal(
    runningSection.toolbarActions.some((action) => action.commandId === "containerlab.inspectAll"),
    false
  );

  const endpointNode = runningSection.nodes[0];
  assert.equal(
    endpointNode.actions.some((action) => action.commandId === "containerlab.install.edgeshark"),
    false
  );
  assert.equal(
    endpointNode.actions.some((action) => action.commandId === "containerlab.uninstall.edgeshark"),
    true
  );

  const labNode = endpointNode.children[0];
  assert.equal(
    labNode.actions.some(
      (action) => action.commandId === "containerlab.lab.openFolderInNewWindow"
    ),
    false
  );
});

test("buildExplorerSnapshot disables running-only actions for stopped containers", async () => {
  const endpoint = {
    label: "Endpoint",
    contextValue: "containerlabEndpoint",
    state: "connected",
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      {
        label: "demo.clab.yml",
        contextValue: "containerlabLabDeployed",
        collapsibleState: TREE_ITEM_COLLAPSED,
        children: [
          {
            label: "leaf1",
            contextValue: "containerlabContainer",
            state: "exited",
            status: "Exited (0)",
            collapsibleState: 0
          }
        ]
      }
    ]
  };
  const providers = {
    runningProvider: provider([endpoint]),
    localProvider: provider([]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;

  const { snapshot, actionBindings } = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true
  });

  const runningSection = snapshot.sections.find((section) => section.id === "runningLabs");
  assert.ok(runningSection);
  const containerNode = runningSection.nodes[0].children[0].children[0];
  const actionByCommand = (commandId: string) =>
    containerNode.actions.find((action) => action.commandId === commandId);

  assert.equal(actionByCommand("containerlab.node.start")?.disabled, false);
  assert.equal(actionByCommand("containerlab.node.copyName")?.disabled, false);
  assert.equal(actionByCommand("containerlab.node.showLogs")?.disabled, false);
  assert.equal(actionByCommand("containerlab.node.attachShell")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.ssh")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.telnet")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.openBrowser")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.stop")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.restart")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.pause")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.unpause")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.save")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.manageImpairments")?.disabled, true);

  const logsAction = actionByCommand("containerlab.node.showLogs");
  assert.ok(logsAction);
  assert.equal(actionBindings.get(logsAction.actionRef)?.disabled, false);
});

test("buildExplorerSnapshot supports opt-in lazy file explorer section", async () => {
  const root = {
    id: "file-root:endpoint-1",
    label: "Localhost",
    contextValue: "containerlabFileExplorerRoot",
    endpointId: "endpoint-1",
    hasChildren: true,
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      {
        id: "file:endpoint-1:configs",
        label: "configs",
        contextValue: "containerlabFileFolder",
        endpointId: "endpoint-1",
        hasChildren: true,
        collapsibleState: TREE_ITEM_COLLAPSED,
        children: []
      },
      {
        id: "file:endpoint-1:lab1.clab.yml",
        label: "lab1.clab.yml",
        contextValue: "containerlabFileTopology",
        endpointId: "endpoint-1",
        collapsibleState: 0
      }
    ]
  };
  const providers = {
    runningProvider: provider([]),
    localProvider: provider([]),
    fileProvider: provider([root]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;

  const collapsed = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true,
    sectionOrder: ["fileExplorer"],
    expandedBySection: { fileExplorer: [] }
  });
  const collapsedRoot = collapsed.snapshot.sections[0].nodes[0];
  const collapsedRootCommands = collapsedRoot.actions.map((action) => action.commandId);
  assert.equal(collapsedRoot.hasChildren, true);
  assert.equal(collapsedRoot.children.length, 0);
  assert.equal(collapsedRoot.primaryAction, undefined);
  assert.deepEqual(collapsedRootCommands, [
    "containerlab.file.newFile",
    "containerlab.file.newFolder"
  ]);

  const expanded = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true,
    sectionOrder: ["fileExplorer"],
    expandedBySection: { fileExplorer: ["file-root:endpoint-1"] }
  });
  const expandedRoot = expanded.snapshot.sections[0].nodes[0];
  assert.equal(expandedRoot.children.length, 2);
  assert.equal(expandedRoot.primaryAction, undefined);
  assert.equal(expandedRoot.children[0].primaryAction, undefined);
  assert.equal(
    expandedRoot.children[0].actions.some(
      (action) => action.commandId === "containerlab.file.refresh"
    ),
    false
  );
  assert.deepEqual(
    expandedRoot.children[0].actions.map((action) => action.commandId),
    [
      "containerlab.file.newFile",
      "containerlab.file.newFolder",
      "containerlab.file.rename",
      "containerlab.file.delete",
      "containerlab.file.copyPath"
    ]
  );
  assert.equal(
    expandedRoot.children[1].primaryAction?.commandId,
    "containerlab.file.open"
  );
});

test("buildExplorerSnapshot applies host-contributed endpoint, lab, file, and toolbar actions", async () => {
  const endpoint = {
    label: "Endpoint",
    contextValue: "containerlabEndpoint",
    state: "connected",
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      {
        label: "demo",
        contextValue: "containerlabLabUndeployed",
        collapsibleState: 0
      }
    ]
  };
  const fileRoot = {
    id: "file-root:endpoint-1",
    label: "Endpoint",
    contextValue: "containerlabFileExplorerRoot",
    endpointId: "endpoint-1",
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      {
        id: "file:endpoint-1:demo",
        label: "demo",
        contextValue: "containerlabFileFolder",
        endpointId: "endpoint-1",
        collapsibleState: 0
      }
    ]
  };
  const providers = {
    runningProvider: provider([endpoint]),
    localProvider: provider([]),
    fileProvider: provider([fileRoot]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;

  const { snapshot, actionBindings } = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true,
    sectionOrder: ["runningLabs", "fileExplorer"],
    expandedBySection: { fileExplorer: ["file-root:endpoint-1"] },
    commandMetadata: {
      commandLabels: new Map([
        ["host.endpoint.import", "Import Archive"],
        ["host.lab.export", "Export Archive"],
        ["host.file.downloadArchive", "Download Archive"],
        ["host.file.import", "Import Archive"],
        ["host.section.addEndpoint", "Add Endpoint"]
      ]),
      contributedEndpointActions: [{ commandId: "host.endpoint.import" }],
      contributedLabActions: [{ commandId: "host.lab.export" }],
      contributedFileActions: [
        {
          commandId: "host.file.downloadArchive",
          contextValues: ["containerlabFileFolder"]
        }
      ],
      contributedToolbarActions: {
        fileExplorer: [{ commandId: "host.file.import" }]
      },
      contributedSectionContextActions: {
        runningLabs: [{ commandId: "host.section.addEndpoint" }]
      }
    }
  });

  const runningSection = snapshot.sections.find((section) => section.id === "runningLabs");
  assert.ok(runningSection);
  assert.equal(
    runningSection.nodes[0].actions.some((action) => action.commandId === "host.endpoint.import"),
    true
  );
  assert.equal(
    runningSection.nodes[0].children[0].actions.some((action) => action.commandId === "host.lab.export"),
    true
  );
  const addEndpointAction = runningSection.contextActions?.find(
    (action) => action.commandId === "host.section.addEndpoint"
  );
  assert.ok(addEndpointAction);
  assert.equal(addEndpointAction.label, "Add Endpoint");
  assert.equal(actionBindings.get(addEndpointAction.actionRef)?.commandId, "host.section.addEndpoint");

  const fileSection = snapshot.sections.find((section) => section.id === "fileExplorer");
  assert.ok(fileSection);
  assert.equal(
    fileSection.toolbarActions.some((action) => action.commandId === "host.file.import"),
    true
  );
  assert.equal(
    fileSection.nodes[0].children[0].actions.some(
      (action) => action.commandId === "host.file.downloadArchive"
    ),
    true
  );
});
