import { resolveNodeCredentialsFromYaml } from "@containerlab/clab-ui/host";

import type { ClabApiClient } from "./clabApiClient.ts";

/**
 * SSH username from the `credentials` the lab's topology gives a node, tried
 * for each candidate node name in order. Undefined when the topology sets no
 * username for the node or cannot be read; the caller then keeps its own.
 */
export async function resolveTopologySshUsername(
  client: Pick<ClabApiClient, "getLabTopologyYaml">,
  token: string,
  labName: string,
  nodeNames: string[]
): Promise<string | undefined> {
  let yaml: string;
  try {
    yaml = await client.getLabTopologyYaml(token, labName);
  } catch {
    return undefined;
  }
  for (const nodeName of nodeNames) {
    const username = resolveNodeCredentialsFromYaml(yaml, nodeName).username?.trim();
    if (username !== undefined && username !== "") return username;
  }
  return undefined;
}
