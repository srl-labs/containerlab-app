import assert from "node:assert/strict";
import test from "node:test";

import type Docker from "dockerode";

import { inspectLabs } from "./inspect.ts";

function container(name: string, labels: Record<string, string>): Docker.ContainerInfo {
  return {
    Id: `${name}-0123456789ab`,
    Names: [`/${name}`],
    Image: "registry.srlinux.dev/pub/nokia_srsim:25.10.R2",
    State: "running",
    Status: "Up 1 minute",
    Labels: { containerlab: "srsimcap", "clab-node-kind": "nokia_srsim", ...labels },
    Ports: [],
    NetworkSettings: { Networks: {} }
  } as unknown as Docker.ContainerInfo;
}

test("inspect records name the topology node of a sub-container", async () => {
  // Labels of a distributed SR-SIM node (dist) and an integrated one (integ).
  const docker = {
    listContainers: async () => [
      container("clab-srsimcap-dist-a", { "clab-node-name": "dist-a", "clab-root-node-name": "dist" }),
      container("clab-srsimcap-integ", { "clab-node-name": "integ" })
    ]
  } as unknown as Docker;

  const labs = (await inspectLabs(docker, "srsimcap")) as unknown as Record<
    string,
    Array<{ name: string; nodeName: string; rootNodeName?: string }>
  >;

  assert.deepEqual(
    labs.srsimcap.map(({ name, nodeName, rootNodeName }) => ({ name, nodeName, rootNodeName })),
    [
      { name: "clab-srsimcap-dist-a", nodeName: "dist-a", rootNodeName: "dist" },
      { name: "clab-srsimcap-integ", nodeName: "integ", rootNodeName: undefined }
    ]
  );
});
