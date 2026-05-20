import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ClabApiClient } from "./clabApiClient.ts";
import type { EndpointEntry } from "./endpointSessionStore.ts";
import { registerCaptureVncStreamProxy } from "./captureVncStreamProxy.ts";
import { registerEventsProxy } from "./eventsProxy.ts";
import { registerFileProxy } from "./fileProxy.ts";
import { registerFileTransferProxy } from "./fileTransferProxy.ts";
import { registerLabProxy } from "./labProxy.ts";
import { registerRuntimeProxy } from "./runtimeProxy.ts";
import { registerTerminalStreamProxy } from "./terminalStreamProxy.ts";
import { registerTopologyEventsProxy } from "./topologyEventsProxy.ts";
import { registerTopologyProxy } from "./topologyProxy.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

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
  registerFileTransferProxy(app, resolveEndpoint);
  registerLabProxy(app, resolveEndpoint, topologySessions);
  registerRuntimeProxy(app, resolveEndpoint, listEndpoints, topologySessions);
  registerCaptureVncStreamProxy(app, resolveEndpoint);
  registerTerminalStreamProxy(app, resolveEndpoint);
}
