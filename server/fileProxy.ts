/**
 * File listing proxy - returns topology files in the format the Explorer expects.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ClabApiClient } from "./clabApiClient.js";
import type { EndpointEntry } from "./endpointSessionStore.js";
import { buildStandaloneTopologyRef } from "./topologyIdentity.js";

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

export function registerFileProxy(app: FastifyInstance, resolveEndpoint: EndpointResolver): void {
  app.get("/files", async (request, reply) => {
    const resolved = resolveEndpoint(request, reply);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    try {
      const { client, endpoint } = resolved;
      const topologies = await client.listTopologies(endpoint.token);
      // Transform to the format expected by the Explorer bridge.
      return reply.send(topologies.map((topo) => {
        const topologyRef = buildStandaloneTopologyRef(topo, endpoint.id);
        return {
          endpointId: endpoint.id,
          filename: topo.yamlFileName,
          path: topologyRef.yamlPath,
          hasAnnotations: topo.hasAnnotations,
          labName: topo.labName,
          deploymentState: topo.deploymentState || "unknown",
          topologyRef
        };
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message });
    }
  });
}
