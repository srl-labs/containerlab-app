/** The Fabric view's way to a lab's fcling engine, through whichever backend hosts the lab. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  isFclingApiCallAllowed,
  isValidGnmiPort,
  type FclingApiRequest,
  type FclingEngineStartOptions
} from "@containerlab/clab-ui/fabric/engine";
import type { LabBackend } from "@srl-labs/containerlab-lab-backend";

import type { EndpointResolver } from "./endpointResolver.ts";
import { EventStreamRefusal, sendSseEventStream, type EventStreamSource } from "./eventStreams.ts";
import { getEndpointIdFromRequest } from "./middleware.ts";
import { handleRouteError, RequestError } from "./runtimeProxy.ts";

interface FclingTargetBody {
  endpointId?: string;
  labName?: string;
}

interface FclingStartBody extends FclingTargetBody {
  gnmiPort?: unknown;
}

interface FclingApiBody extends FclingTargetBody {
  request?: FclingApiRequest;
}

interface FclingEventsQuery {
  labName?: string;
  after?: string;
}

function requireLabName(labName: string | undefined): string {
  const name = labName?.trim();
  if (!name) throw new RequestError("Missing lab name.", 400);
  return name;
}

function startOptions(body: FclingStartBody | undefined): FclingEngineStartOptions | undefined {
  const gnmiPort = body?.gnmiPort;
  if (gnmiPort === undefined) return undefined;
  if (!isValidGnmiPort(gnmiPort)) throw new RequestError("The gNMI port must be between 1 and 65535.", 400);
  return { gnmiPort };
}

function parseAfter(value: string | undefined): number | undefined {
  const after = Number(value);
  return value !== undefined && Number.isInteger(after) && after >= 0 ? after : undefined;
}

function fclingEventStreams(resolveEndpoint: EndpointResolver): EventStreamSource {
  return (request, reply) => {
    const { labName, after } = request.query as FclingEventsQuery;
    const name = labName?.trim();
    if (!name) throw new EventStreamRefusal(400, "Missing lab name.");
    const resolved = resolveEndpoint(request, reply, getEndpointIdFromRequest(request));
    if (!resolved) throw new EventStreamRefusal(401, "Not authenticated");
    const position = parseAfter(after);
    return {
      failureMessage: "The fabric engine's event stream failed",
      async open(signal) {
        const events = await resolved.backend.streamFclingEvents(
          { labName: name },
          { signal, ...(position === undefined ? {} : { after: position }) }
        );
        return (async function* () {
          for await (const event of events) yield JSON.stringify(event);
        })();
      }
    };
  };
}

export function registerFclingProxy(app: FastifyInstance, resolveEndpoint: EndpointResolver): void {
  /** Registers a POST route that answers with what `action` returns. */
  const engineRoute = (
    url: string,
    action: (backend: LabBackend, labName: string, body: FclingStartBody | undefined) => Promise<unknown>
  ): void => {
    app.post<{ Body: FclingTargetBody }>(
      url,
      async (request: FastifyRequest<{ Body: FclingTargetBody }>, reply: FastifyReply) => {
        const resolved = resolveEndpoint(request, reply, request.body?.endpointId);
        if (!resolved) return reply.status(401).send({ error: "Not authenticated" });
        try {
          const answer = await action(resolved.backend, requireLabName(request.body?.labName), request.body);
          return await reply.send(answer ?? { ok: true });
        } catch (error) {
          return handleRouteError(reply, error);
        }
      }
    );
  };

  engineRoute("/api/runtime/fcling/engine/status", (backend, labName) =>
    backend.fclingEngine({ labName })
  );
  engineRoute("/api/runtime/fcling/engine/start", (backend, labName, body) =>
    backend.startFclingEngine({ labName }, startOptions(body))
  );
  engineRoute("/api/runtime/fcling/engine/stop", (backend, labName) =>
    backend.stopFclingEngine({ labName })
  );

  app.post<{ Body: FclingApiBody }>(
    "/api/runtime/fcling/api",
    async (request: FastifyRequest<{ Body: FclingApiBody }>, reply: FastifyReply) => {
      const resolved = resolveEndpoint(request, reply, request.body?.endpointId);
      if (!resolved) return reply.status(401).send({ error: "Not authenticated" });
      try {
        const labName = requireLabName(request.body?.labName);
        const call = request.body?.request;
        if (!call || !isFclingApiCallAllowed(call.method, call.path)) {
          throw new RequestError("The fabric engine does not offer this call.", 403);
        }
        const answer = await resolved.backend.fclingApi({ labName }, call);
        return await reply.status(answer.status).send(answer.body);
      } catch (error) {
        return handleRouteError(reply, error);
      }
    }
  );

  const streams = fclingEventStreams(resolveEndpoint);
  app.get("/api/runtime/fcling/events", (request, reply) =>
    sendSseEventStream(request, reply, streams, {})
  );
}
