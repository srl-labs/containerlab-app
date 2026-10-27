import type Docker from "dockerode";

import type { InspectContainerInfo, NodeLogLine } from "../contract/dto.ts";
import { inspectField, inspectLabs } from "./inspect.ts";
import type { NodeAccess } from "./nodeAccess.ts";
import type { ResolvedLocalOptions } from "./options.ts";
import { spawnLines } from "./process.ts";
import { labStats } from "./stats.ts";
import { dockerTerminalAccess } from "./terminals.ts";
import { browserPorts, containerLogs } from "./tools.ts";

/** Nodes in Docker or Podman containers, through the Docker Engine API and the runtime CLI. */
export function createDockerNodeAccess(options: ResolvedLocalOptions, docker: () => Docker): NodeAccess {
  return {
    ...dockerTerminalAccess(docker),
    inspectLabs: (labName) => inspectLabs(docker(), labName),
    async topologyNodeName(container: InspectContainerInfo) {
      // Slot containers of a distributed node start and stop through their root node.
      const labels = await docker()
        .getContainer(container.name)
        .inspect()
        .then((details) => details.Config.Labels ?? {})
        .catch((): Record<string, string> => ({}));
      return labels["clab-root-node-name"] || inspectField(container, "nodeName") || container.name;
    },
    nodeLogs: (container, tail) => containerLogs(options, container.name, tail),
    async streamNodeLogs(container, { tail, signal }) {
      const command = await spawnLines(
        options.runtime,
        ["logs", "--follow", "--tail", tail, "--timestamps", container.name],
        { env: options.env, signal }
      );
      // The runtime CLI writes the container's stderr to its own stderr.
      async function* lines(): AsyncGenerator<NodeLogLine> {
        try {
          for await (const output of command.lines) yield output;
        } finally {
          command.kill();
        }
      }
      return lines();
    },
    browserPorts: (container) => browserPorts(docker(), container.name),
    statsAvailable: async () => true,
    labStats: (labName, intervalSeconds, signal) => labStats(docker(), labName, intervalSeconds, signal),
    dispose: async () => {}
  };
}
