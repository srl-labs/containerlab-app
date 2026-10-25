import type { FastifyInstance } from "fastify";

import type { EndpointListResolver, EndpointResolver } from "./endpointResolver.ts";
import { registerCaptureVncStreamProxy } from "./captureVncStreamProxy.ts";
import { registerEventsProxy } from "./eventsProxy.ts";
import { registerFileProxy } from "./fileProxy.ts";
import { registerFileTransferProxy } from "./fileTransferProxy.ts";
import { registerLabOperationsProxy } from "./labOperationsProxy.ts";
import { registerLabProxy } from "./labProxy.ts";
import { registerRuntimeProxy } from "./runtimeProxy.ts";
import { registerTerminalStreamProxy } from "./terminalStreamProxy.ts";
import { registerTopologyEventsProxy } from "./topologyEventsProxy.ts";
import { registerTopologyProxy } from "./topologyProxy.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

export function registerStandaloneProxies(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  listEndpoints: EndpointListResolver,
  topologySessions: StandaloneTopologySessionManager
): void {
  registerEventsProxy(app, resolveEndpoint);
  registerTopologyEventsProxy(app, resolveEndpoint, topologySessions);
  registerTopologyProxy(app, resolveEndpoint, topologySessions);
  registerFileProxy(app, resolveEndpoint);
  registerFileTransferProxy(app, resolveEndpoint);
  registerLabProxy(app, resolveEndpoint, topologySessions);
  registerRuntimeProxy(app, resolveEndpoint, listEndpoints, topologySessions);
  registerLabOperationsProxy(app, resolveEndpoint, topologySessions);
  registerCaptureVncStreamProxy(app, resolveEndpoint);
  registerTerminalStreamProxy(app, resolveEndpoint);
}
