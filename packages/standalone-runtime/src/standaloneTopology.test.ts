import assert from "node:assert/strict";
import { register } from "node:module";
import { test } from "node:test";

import {
  createTopologySessionClient,
  type TopologyRef,
  type TopologySnapshot
} from "@containerlab/clab-ui/session";

import { configureStandaloneBackend } from "./backend";
import type { EndpointConfig } from "./stores/endpointStore";
import type { ContainerState, LabState } from "./stores/labStore";

// The page's window, as far as the topology manager uses it.
Object.assign(globalThis, {
  window: Object.assign(new EventTarget(), { location: { origin: "http://app.test" }, setTimeout, clearTimeout })
});
// The clab-ui entry imports its stylesheets, which Node cannot load; they do not matter here.
register(
  "data:text/javascript," +
    encodeURIComponent(
      'export async function load(url, context, next) { return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : next(url, context); }'
    )
);
const { useTopoViewerStore } = await import("@containerlab/clab-ui");
const { createStandaloneTopologyManager } = await import("./standaloneTopology");

const ENDPOINT_ID = "endpoint-api";
const TOPOLOGY_REF: TopologyRef = {
  topologyId: `standalone:${ENDPOINT_ID}::lab1/lab1.clab.yml`,
  labName: "lab1",
  yamlPath: "lab1/lab1.clab.yml",
  absoluteYamlPath: "/home/alice/.clab/lab1/lab1.clab.yml",
  annotationsPath: "lab1/lab1.clab.yml.annotations.json",
  source: "standalone"
};

function runningLab(): Map<string, LabState> {
  const container: ContainerState = {
    endpointId: ENDPOINT_ID,
    name: "lab1-n1",
    containerId: "c9s-alice-lab1/lab1/n1",
    labName: "lab1",
    labPath: TOPOLOGY_REF.absoluteYamlPath ?? "",
    owner: "alice",
    nodeName: "n1",
    kind: "linux",
    image: "alpine:3",
    state: "running",
    status: "healthy",
    ipv4Address: "",
    ipv6Address: "",
    interfaces: new Map()
  };
  const containers = new Map([[container.name, container]]);
  return new Map([
    [
      `${ENDPOINT_ID}:lab1`,
      { endpointId: ENDPOINT_ID, name: "lab1", owner: "alice", topologyPath: TOPOLOGY_REF.absoluteYamlPath ?? "", containers }
    ]
  ]);
}

function snapshotFor(deploymentState: TopologySnapshot["deploymentState"]): TopologySnapshot {
  return {
    revision: 1,
    nodes: [],
    edges: [],
    annotations: {},
    yamlFileName: "lab1.clab.yml",
    annotationsFileName: "lab1.clab.yml.annotations.json",
    yamlContent: "name: lab1\n",
    annotationsContent: "{}",
    labName: "lab1",
    mode: "edit",
    deploymentState,
    canUndo: false,
    canRedo: false
  };
}

test("a lab whose events arrive while its topology loads shows deployed, whatever state the opener asked for", async () => {
  // A lab host's file listing says "undeployed" until the lab's events are in; a link opened
  // right after a page load asks for that state. The events then arrive during the load.
  let labs = new Map<string, LabState>();
  let labsArrive: (() => void) | undefined;
  const iconsRequested = new Promise<void>((resolve) => {
    labsArrive = resolve;
  });
  let releaseIcons: (() => void) | undefined;
  const iconsReleased = new Promise<void>((resolve) => {
    releaseIcons = resolve;
  });

  configureStandaloneBackend({
    capabilities: { lifecycle: true, endpoints: true, events: false, repositories: false, archives: false },
    async fetch(input) {
      const url = new URL(String(input), "http://app.test");
      if (url.pathname.endsWith("/files")) {
        return Response.json([
          {
            endpointId: ENDPOINT_ID,
            filename: TOPOLOGY_REF.yamlPath,
            path: TOPOLOGY_REF.yamlPath,
            labName: "lab1",
            deploymentState: "undeployed",
            topologyRef: TOPOLOGY_REF
          }
        ]);
      }
      if (url.pathname.endsWith("/api/topology/sessions")) {
        return Response.json({ sessionId: "session-1", topologyRef: TOPOLOGY_REF });
      }
      if (url.pathname.endsWith("/api/runtime/ui/icons/list")) {
        labsArrive?.();
        await iconsReleased;
        return Response.json({ icons: [] });
      }
      if (url.pathname.endsWith("/api/lab/apply")) {
        return Response.json({ changesPending: false, result: {} });
      }
      return Response.json({});
    }
  });

  const sessionClient = createTopologySessionClient({
    host: {
      topology: {
        // The lab host echoes the deployment state of the context it was asked with.
        requestSnapshot: async (context: { deploymentState?: TopologySnapshot["deploymentState"] }) =>
          snapshotFor(context.deploymentState ?? "unknown"),
        dispatchCommand: async () => ({ type: "topology-host:ack", revision: 1 }) as never
      }
    } as never
  });
  const endpoints = [{ id: ENDPOINT_ID, kind: "api", status: "connected" } as unknown as EndpointConfig];
  const manager = createStandaloneTopologyManager({
    debounceMs: 0,
    getEndpoints: () => endpoints,
    getLabs: () => labs,
    getSessionClient: () => sessionClient,
    onTopologyFilesChanged: () => {}
  });
  manager.setAuthenticated(true);

  const requestedState = await manager.resolveDeploymentState(TOPOLOGY_REF);
  assert.equal(requestedState, "undeployed", "the file listing before the lab's events");
  const load = manager.loadTopologyFile(TOPOLOGY_REF, { deploymentState: requestedState, endpointId: ENDPOINT_ID });

  await iconsRequested;
  const previous = labs;
  labs = runningLab();
  manager.handleLabStateChange(previous, labs);
  releaseIcons?.();
  await load;
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(useTopoViewerStore.getState().deploymentState, "deployed");
  assert.equal(sessionClient.getContext().deploymentState, "deployed");
});
