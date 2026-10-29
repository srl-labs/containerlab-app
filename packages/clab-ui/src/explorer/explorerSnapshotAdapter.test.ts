import assert from "node:assert/strict";
import test from "node:test";

import { greyedExplorerCommandsForHost } from "./hostSupportCommands";

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
  assert.equal(actionByCommand("containerlab.node.captureInterfaces")?.disabled, true);
  assert.equal(actionByCommand("containerlab.node.captureInterfaces")?.label, "Capture Interfaces…");

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

test("buildExplorerSnapshot keeps a section's last content when it fails to build", async () => {
  const lab = {
    label: "demo",
    contextValue: "containerlabLabDeployed",
    collapsibleState: 0
  };
  const options = { hideNonOwnedLabs: false, isLocalCaptureAllowed: true };
  const first = await buildExplorerSnapshot(
    {
      runningProvider: provider([lab]),
      localProvider: provider([]),
      helpProvider: provider([])
    } as ExplorerSnapshotProviders,
    "",
    options
  );
  const failing = {
    getTreeItem: (element: unknown) => element,
    getChildren: () => Promise.reject(new Error("lab host did not answer"))
  };
  const providers = {
    runningProvider: failing,
    localProvider: provider([]),
    helpProvider: provider([])
  } as unknown as ExplorerSnapshotProviders;

  const running = (result: typeof first) =>
    result.snapshot.sections.find((section) => section.id === "runningLabs");
  const second = await buildExplorerSnapshot(providers, "", options, first);
  assert.deepEqual(running(second), running(first));
  for (const actionRef of first.actionBindings.keys()) {
    assert.ok(second.actionBindings.has(actionRef));
  }

  const filtered = await buildExplorerSnapshot(providers, "other", options, first);
  assert.equal(running(filtered)?.nodes.length, 0);
});

test("buildExplorerSnapshot offers validate, text graph exports and the Clos generator", async () => {
  const endpoint = {
    label: "Endpoint",
    contextValue: "containerlabEndpoint",
    state: "connected",
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      { label: "demo.clab.yml", contextValue: "containerlabLabUndeployed", collapsibleState: 0 }
    ]
  };
  const providers = {
    runningProvider: provider([endpoint]),
    localProvider: provider([]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;

  const { snapshot } = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true
  });

  const endpointNode = snapshot.sections.find((section) => section.id === "runningLabs")?.nodes[0];
  assert.ok(endpointNode);
  assert.ok(endpointNode.actions.some((action) => action.commandId === "containerlab.lab.generate"));
  const labCommands = endpointNode.children[0].actions.map((action) => action.commandId);
  for (const commandId of [
    "containerlab.lab.validate",
    "containerlab.lab.graph.mermaid",
    "containerlab.lab.graph.dot"
  ]) {
    assert.ok(labCommands.includes(commandId), commandId);
  }
});

test("section actions hide what no lab host can do, and stay while one can", async () => {
  const providers = {
    runningProvider: provider([]),
    localProvider: provider([]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;
  const toolbar = async (byHost: Array<[string, string[]]>) => {
    const { snapshot } = await buildExplorerSnapshot(providers, "", {
      hideNonOwnedLabs: false,
      isLocalCaptureAllowed: true,
      hiddenCommandIdsByEndpoint: new Map(byHost)
    });
    const running = snapshot.sections.find((section) => section.id === "runningLabs");
    return running?.toolbarActions.map((action) => action.commandId) ?? [];
  };
  const cluster: [string, string[]] = ["cluster", ["containerlab.images.manage"]];

  assert.ok(!(await toolbar([cluster])).includes("containerlab.images.manage"));
  assert.ok((await toolbar([cluster, ["docker", []]])).includes("containerlab.images.manage"));
  // A host whose support is not known yet hides nothing.
  assert.ok((await toolbar([cluster, ["pending", []]])).includes("containerlab.images.manage"));
  assert.ok((await toolbar([])).includes("containerlab.images.manage"));
});

test("a Kubernetes lab host's items show what it lacks greyed out, with why", async () => {
  const container = {
    label: "leaf1",
    contextValue: "containerlabContainer",
    state: "running",
    status: "Up",
    endpointId: "cluster",
    collapsibleState: 0
  };
  const endpoint = {
    label: "Cluster",
    contextValue: "containerlabEndpoint",
    state: "connected",
    endpointId: "cluster",
    collapsibleState: TREE_ITEM_COLLAPSED,
    children: [
      {
        label: "demo.clab.yml",
        contextValue: "containerlabLabDeployed",
        endpointId: "cluster",
        collapsibleState: TREE_ITEM_COLLAPSED,
        children: [container]
      }
    ]
  };
  const providers = {
    runningProvider: provider([endpoint]),
    localProvider: provider([]),
    helpProvider: provider([])
  } as ExplorerSnapshotProviders;
  const cluster = { profile: { runtime: "c9s" as const } };
  const { snapshot } = await buildExplorerSnapshot(providers, "", {
    hideNonOwnedLabs: false,
    isLocalCaptureAllowed: true,
    hiddenCommandIdsByEndpoint: new Map([["cluster", ["containerlab.node.pause", "containerlab.node.unpause"]]]),
    greyedCommandsByEndpoint: new Map([["cluster", greyedExplorerCommandsForHost(cluster)]])
  });
  const node = snapshot.sections.find((section) => section.id === "runningLabs")?.nodes[0].children[0].children[0];
  assert.ok(node);
  const pause = node.actions.find((action) => action.commandId === "containerlab.node.pause");
  assert.equal(pause?.disabled, true);
  assert.match(pause?.disabledReason ?? "", /^Not supported on Kubernetes \(c9s\)/);
  assert.equal(node.actions.find((action) => action.commandId === "containerlab.node.stop")?.disabledReason, undefined);

  // Docker and Podman grey nothing out.
  assert.equal(greyedExplorerCommandsForHost({ profile: { runtime: "docker" } }).size, 0);
});
