import type {
  ExplorerAction,
  ExplorerNode,
  ExplorerSectionSnapshot,
  ExplorerSnapshotMessage
} from "../../src/explorer/shared/explorer/types";

export type ExplorerFixtureMode = "vscode" | "standalone" | "sandbox" | "files";

let sequence = 0;

function action(commandId: string, label: string, destructive = false): ExplorerAction {
  sequence += 1;
  return { id: `action-${sequence}`, actionRef: `ref-${sequence}`, label, commandId, destructive };
}

const LAB_ACTIONS = [
  action("containerlab.lab.graph.topoViewer", "Open TopoViewer"),
  action("containerlab.lab.redeploy", "Redeploy"),
  action("containerlab.lab.destroy", "Destroy", true)
];
const CONTAINER_ACTIONS = [
  action("containerlab.node.attachShell", "Attach Shell"),
  action("containerlab.node.ssh", "SSH")
];
const FILE_ACTIONS = [action("containerlab.file.openTopology", "Open Topology")];

function node(partial: Partial<ExplorerNode> & Pick<ExplorerNode, "id" | "label">): ExplorerNode {
  return { actions: [], children: [], ...partial };
}

function interfaces(containerId: string, names: string[]): ExplorerNode[] {
  return names.map((name, index) =>
    node({
      id: `${containerId}:${name}`,
      label: name,
      contextValue: index === names.length - 1 ? "containerlabInterfaceDown" : "containerlabInterfaceUp",
      actions: [action("containerlab.interface.capture", "Capture")]
    })
  );
}

function container(id: string, label: string, status: string, ports: string[]): ExplorerNode {
  return node({
    id,
    label,
    description: status,
    contextValue: "containerlabContainer",
    statusIndicator: "green",
    state: "running",
    hasChildren: ports.length > 0,
    actions: CONTAINER_ACTIONS,
    children: interfaces(id, ports)
  });
}

function runningLab(): ExplorerNode {
  return node({
    id: "lab:st",
    label: "st",
    description: "fschwar",
    contextValue: "containerlabLabDeployedFavorite",
    statusIndicator: "green",
    hasChildren: true,
    actions: LAB_ACTIONS,
    children: [
      container("st:client1", "client1", "Up 3 minutes", []),
      container("st:gnmic", "gnmic", "Up 3 minutes", []),
      container("st:leaf1", "leaf1", "Up 3 minutes", ["e1-1", "e1-49", "ethernet-1/49.0", "mgmt0"]),
      container("st:spine1", "spine1", "Up 3 minutes", ["e1-1", "e1-2"])
    ]
  });
}

function stoppedLab(): ExplorerNode {
  return node({
    id: "lab:wan",
    label: "wan-ring",
    description: "fschwar",
    contextValue: "containerlabLabDeployed",
    statusIndicator: "yellow",
    hasChildren: true,
    actions: LAB_ACTIONS,
    children: [container("wan:pe1", "pe1", "Exited 2 hours ago", [])]
  })
}

function undeployedLabs(): ExplorerNode[] {
  return ["datacenter.clab.yml", "spine-leaf.clab.yml", "srsim-simple.clab.yml"].map((name, index) =>
    node({
      id: `local:${name}`,
      label: name,
      description: "topologies",
      contextValue: index === 0 ? "containerlabLabUndeployedFavorite" : "containerlabLabUndeployed",
      workspaceScope: index === 2 ? "shared" : undefined,
      actions: LAB_ACTIONS,
      primaryAction: LAB_ACTIONS[0]
    })
  );
}

function endpointRoot(
  id: string,
  label: string,
  url: string,
  state: string,
  indicator: ExplorerNode["statusIndicator"],
  children: ExplorerNode[]
): ExplorerNode {
  return node({
    id: `endpoint:${id}`,
    label,
    description: url,
    contextValue: "containerlabEndpoint",
    state,
    statusIndicator: indicator,
    hasChildren: children.length > 0,
    actions: [action("containerlab.editor.topoViewerEditor", "New Topology File")],
    children
  });
}

function endpointSection(id: string, kind: "Running" | "Local", children: ExplorerNode[]): ExplorerNode {
  return node({
    id: `section:${id}:${kind}`,
    label: kind === "Running" ? "Running labs" : "Undeployed labs",
    contextValue: `containerlabEndpointSection${kind}`,
    hasChildren: children.length > 0,
    children
  });
}

function folder(id: string, label: string, children: ExplorerNode[]): ExplorerNode {
  return node({
    id,
    label,
    contextValue: "containerlabFileFolder",
    hasChildren: children.length > 0,
    actions: FILE_ACTIONS,
    children
  });
}

function file(id: string, label: string, topology = false): ExplorerNode {
  return node({
    id,
    label,
    description: topology ? "demo" : undefined,
    contextValue: topology ? "containerlabFileTopology" : "containerlabFile",
    actions: FILE_ACTIONS,
    primaryAction: FILE_ACTIONS[0]
  });
}

function files(): ExplorerNode[] {
  return [
    node({
      id: "file-root:local",
      label: "Local workspace",
      contextValue: "containerlabFileExplorerRoot",
      hasChildren: true,
      children: [
        folder("file:topologies", "topologies", [
          file("file:dc", "datacenter.clab.yml", true),
          file("file:sl", "spine-leaf.clab.yml", true),
          file("file:notes", "notes.md"),
          file("file:cfg", "leaf1.cfg")
        ]),
        folder("file:configs", "configs", [file("file:srl", "srl.json"), file("file:docker", "Dockerfile")]),
        file("file:readme", "README.md")
      ]
    })
  ];
}

function help(): ExplorerNode[] {
  return ["Containerlab Documentation", "VS Code Extension Documentation", "Browse Labs on GitHub", "Join our Discord server"].map(
    (label) =>
      node({
        id: `help:${label}`,
        label,
        primaryAction: action("containerlab.openLink", label)
      })
  );
}

function section(
  id: ExplorerSectionSnapshot["id"],
  label: string,
  nodes: ExplorerNode[],
  extra: Partial<ExplorerSectionSnapshot> = {}
): ExplorerSectionSnapshot {
  return {
    id,
    label,
    count: nodes.length,
    nodes,
    toolbarActions: [],
    ...extra
  };
}

export function buildExplorerFixture(mode: ExplorerFixtureMode): ExplorerSnapshotMessage {
  sequence = 0;
  const toolbar = [action("containerlab.editor.topoViewerEditor", "New Topology File")];
  if (mode === "vscode") {
    return {
      command: "snapshot",
      filterText: "",
      sections: [
        section("runningLabs", "Running Labs", [runningLab(), stoppedLab()], { toolbarActions: toolbar }),
        section("localLabs", "Undeployed Local Labs", undeployedLabs(), { toolbarActions: toolbar }),
        section("helpFeedback", "Help & Feedback", help())
      ]
    };
  }
  if (mode === "sandbox") {
    return {
      command: "snapshot",
      filterText: "",
      sections: [
        section("runningLabs", "Labs", undeployedLabs(), { appearance: "bareTree", toolbarActions: toolbar })
      ]
    };
  }
  if (mode === "files") {
    return {
      command: "snapshot",
      filterText: "",
      sections: [section("fileExplorer", "File Explorer", files())]
    };
  }
  return {
    command: "snapshot",
    filterText: "",
    sections: [
      section(
        "runningLabs",
        "Endpoints",
        [
          endpointRoot("lab-a", "lab-host-a", "https://10.0.0.5:8080", "connected", "green", [
            endpointSection("a", "Running", [runningLab(), stoppedLab()]),
            endpointSection("a", "Local", undeployedLabs())
          ]),
          endpointRoot("lab-b", "lab-host-b", "https://10.0.0.9:8080", "session_expired", "yellow", []),
          endpointRoot("lab-c", "edge-lab", "https://edge.example.net", "offline", "red", [])
        ],
        { appearance: "bareTree", toolbarActions: toolbar }
      )
    ]
  };
}

export const FIXTURE_EXPANDED = [
  "endpoint:lab-a",
  "section:a:Running",
  "section:a:Local",
  "lab:st",
  "st:leaf1",
  "file-root:local",
  "file:topologies"
];
