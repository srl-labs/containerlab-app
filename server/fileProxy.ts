/**
 * File listing proxy - returns topology files in the format the Explorer expects.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ClabApiClient } from "./clabApiClient.js";
import { getTokenFromRequest } from "./middleware.js";
import { buildStandaloneTopologyRef } from "./topologyIdentity.js";

type ClientResolver = (request: FastifyRequest) => ClabApiClient;

export function registerFileProxy(app: FastifyInstance, getClient: ClientResolver): void {
  app.get("/files", async (request, reply) => {
    const token = getTokenFromRequest(request);
    if (!token) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    try {
      const client = getClient(request);
      const topologies = await client.listTopologies(token);
      // Transform to the format expected by the Explorer bridge.
      return reply.send(topologies.map((topo) => {
        const topologyRef = buildStandaloneTopologyRef(topo);
        return {
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
