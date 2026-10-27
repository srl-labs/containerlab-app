import type { FastifyInstance } from "fastify";

import type { EndpointListResolver, EndpointResolver } from "./endpointResolver.ts";
import { registerCaptureStreamProxy, type LocalWiresharkOptions } from "./captureStreamProxy.ts";
import { registerCaptureVncStreamProxy } from "./captureVncStreamProxy.ts";
import { registerEventChannel } from "./eventChannel.ts";
import { labEventStreams, registerEventsProxy } from "./eventsProxy.ts";
import { registerFileProxy, workspaceFileEventStreams } from "./fileProxy.ts";
import { registerFileTransferProxy } from "./fileTransferProxy.ts";
import { registerLabOperationsProxy } from "./labOperationsProxy.ts";
import { registerLabProxy } from "./labProxy.ts";
import { registerRuntimeProxy } from "./runtimeProxy.ts";
import { registerRuntimeStreamProxy } from "./runtimeStreamProxy.ts";
import { registerTerminalStreamProxy } from "./terminalStreamProxy.ts";
import { registerTopologyEventsProxy, topologyEventStreams } from "./topologyEventsProxy.ts";
import { registerTopologyProxy } from "./topologyProxy.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

export function registerStandaloneProxies(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  listEndpoints: EndpointListResolver,
  topologySessions: StandaloneTopologySessionManager,
  options: { localWireshark?: LocalWiresharkOptions } = {}
): void {
  registerEventsProxy(app, resolveEndpoint);
  registerEventChannel(app, {
    events: labEventStreams(resolveEndpoint),
    files: workspaceFileEventStreams(resolveEndpoint),
    topology: topologyEventStreams(resolveEndpoint, topologySessions)
  });
  registerTopologyEventsProxy(app, resolveEndpoint, topologySessions);
  registerTopologyProxy(app, resolveEndpoint, topologySessions);
  registerFileProxy(app, resolveEndpoint);
  registerFileTransferProxy(app, resolveEndpoint);
  registerLabProxy(app, resolveEndpoint, topologySessions);
  registerRuntimeProxy(app, resolveEndpoint, listEndpoints, topologySessions);
  registerRuntimeStreamProxy(app, resolveEndpoint, topologySessions);
  registerLabOperationsProxy(app, resolveEndpoint, topologySessions);
  registerCaptureVncStreamProxy(app, resolveEndpoint);
  registerCaptureStreamProxy(app, resolveEndpoint, topologySessions, options);
  registerTerminalStreamProxy(app, resolveEndpoint);
}
