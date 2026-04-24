import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ClabApiClient } from "./clabApiClient.js";
import type { EndpointEntry } from "./endpointSessionStore.js";
import { registerCaptureVncStreamProxy } from "./captureVncStreamProxy.js";
import { registerEventsProxy } from "./eventsProxy.js";
import { registerFileProxy } from "./fileProxy.js";
import { registerLabProxy } from "./labProxy.js";
import { registerRuntimeProxy } from "./runtimeProxy.js";
import { registerTerminalStreamProxy } from "./terminalStreamProxy.js";
import { registerTopologyEventsProxy } from "./topologyEventsProxy.js";
import { registerTopologyProxy } from "./topologyProxy.js";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.js";

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

export function registerStandaloneProxies(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  listEndpoints: (request: FastifyRequest, reply: FastifyReply) => EndpointEntry[],
  topologySessions: StandaloneTopologySessionManager
): void {
  registerEventsProxy(app, resolveEndpoint);
  registerTopologyEventsProxy(app, resolveEndpoint, topologySessions);
  registerTopologyProxy(app, resolveEndpoint, topologySessions);
  registerFileProxy(app, resolveEndpoint);
  registerLabProxy(app, resolveEndpoint, topologySessions);
  registerRuntimeProxy(app, resolveEndpoint, listEndpoints, topologySessions);
  registerCaptureVncStreamProxy(app, resolveEndpoint);
  registerTerminalStreamProxy(app, resolveEndpoint);
}
