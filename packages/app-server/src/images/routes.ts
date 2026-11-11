import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Readable } from "node:stream";

import type {
  ImagesJobRequest,
  ImagesSearchQuery,
  ImagesUnavailable
} from "@srl-labs/containerlab-lab-backend";

import type { EndpointResolver } from "../endpointResolver.ts";
import { RequestError } from "../runtimeProxy.ts";
import { IMAGES_CONFIG_KEYS } from "./config.ts";
import { sendImagesError } from "./errors.ts";
import type { ImagesHandle } from "./setup.ts";
import type { ImagesService } from "./service.ts";

const BASE = "/api/runtime/images";

type Locals = ReadonlyArray<{ url: string; images?: ImagesHandle }>;

function unavailable(reply: FastifyReply, detail: string, configKeys?: string[]): FastifyReply {
  const body: ImagesUnavailable = { reason: "unavailable", detail, ...(configKeys ? { configKeys } : {}) };
  return reply.status(404).send(body);
}

function queryText(request: FastifyRequest, name: string): string | undefined {
  const value = (request.query as Record<string, unknown> | undefined)?.[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new RequestError(`Invalid ${name}`, 400);
  return value;
}

function bodyObject(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("Expected a JSON object body", 400);
  }
  return body as Record<string, unknown>;
}

function decodeFileName(value: unknown): unknown {
  if (typeof value !== "string") return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The Images routes. They exist for every server, and answer 404
 * `{reason: "unavailable"}` unless the request's endpoint is a local one whose
 * server has `climg` configured and started.
 */
export function registerImagesRoutes(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  locals: Locals
): void {
  // The upload body is the raw stream, read as it arrives. The parser belongs to this
  // plugin scope only, so no other route accepts octet-stream bodies.
  void app.register(async (scoped) => {
    scoped.addContentTypeParser("application/octet-stream", (_request, payload, done) => {
      done(null, payload);
    });

    /** The service for the request, or a reply already sent. */
    const serviceFor = (request: FastifyRequest, reply: FastifyReply): ImagesService | undefined => {
      const resolved = resolveEndpoint(request, reply);
      if (!resolved) {
        void reply.status(401).send({ error: "Not authenticated" });
        return undefined;
      }
      if (resolved.endpoint.kind !== "local") {
        void unavailable(reply, "The Images view is not available for this endpoint: it needs a local lab host.");
        return undefined;
      }
      const handle = locals.find((local) => local.url === resolved.endpoint.url)?.images;
      if (!handle) {
        void unavailable(
          reply,
          "The image manager is not configured on this server. Set WEB_LOCAL_CLIMG_PATH (and the other WEB_LOCAL_CLIMG_* settings).",
          IMAGES_CONFIG_KEYS
        );
        return undefined;
      }
      if ("problem" in handle) {
        void unavailable(reply, `The image manager did not start: ${handle.problem}`);
        return undefined;
      }
      return handle.service;
    };

    const get = <T>(path: string, run: (service: ImagesService, request: FastifyRequest) => Promise<T>) => {
      scoped.get(`${BASE}/${path}`, async (request, reply) => {
        const service = serviceFor(request, reply);
        if (!service) return reply;
        try {
          return reply.send(await run(service, request));
        } catch (error) {
          return sendImagesError(reply, error);
        }
      });
    };
    const send = <T>(
      method: "post" | "delete",
      path: string,
      run: (service: ImagesService, request: FastifyRequest) => Promise<T>,
      status = 200
    ) => {
      scoped[method](`${BASE}/${path}`, async (request, reply) => {
        const service = serviceFor(request, reply);
        if (!service) return reply;
        try {
          return reply.status(status).send(await run(service, request));
        } catch (error) {
          return sendImagesError(reply, error);
        }
      });
    };

    get("status", (service) => service.status());
    get("index", (service) => service.index(false));
    send("post", "index/refresh", (service) => service.index(true));
    get("search", (service, request): Promise<unknown> => {
      const source = queryText(request, "source");
      const status = queryText(request, "status");
      const query: ImagesSearchQuery = {
        ...(queryText(request, "q") !== undefined ? { q: queryText(request, "q") } : {}),
        ...(queryText(request, "kind") !== undefined ? { kind: queryText(request, "kind") } : {}),
        ...(queryText(request, "vendor") !== undefined ? { vendor: queryText(request, "vendor") } : {}),
        ...(source !== undefined ? { source: source as ImagesSearchQuery["source"] } : {}),
        ...(status !== undefined ? { status: status as ImagesSearchQuery["status"] } : {}),
        ...(queryText(request, "all") === "true" ? { all: true } : {})
      };
      return service.search(query);
    });
    get("show", (service, request) => service.show(queryText(request, "ref")));
    get("images", (service) => service.images());
    get("scan", (service) => service.scan());
    get("templates", (service) => service.templates());

    send("post", "templates", (service, request) => service.addTemplate(bodyObject(request).ref));
    send("delete", "templates/:name", (service, request) =>
      service.removeTemplate((request.params as { name?: string }).name)
    );
    send("post", "templates/sync", (service, request) => {
      const dryRun = bodyObject(request).dryRun;
      if (dryRun !== undefined && typeof dryRun !== "boolean") throw new RequestError("dryRun must be a boolean", 400);
      return service.syncTemplates(dryRun === true);
    });

    send("post", "jobs", (service, request) => service.jobs.start(bodyObject(request) as unknown as ImagesJobRequest), 202);
    get("jobs", (service) => service.jobs.list());
    get("jobs/:id", (service, request) => service.jobs.get((request.params as { id?: string }).id));
    send("post", "jobs/:id/cancel", (service, request) =>
      service.jobs.cancel((request.params as { id?: string }).id)
    );

    // No route bodyLimit: it would also lift the limit of the JSON and text parsers, which buffer the whole body
    // before the session check. The octet-stream parser hands over the raw stream, which that limit does not
    // apply to; the per-server size cap is checked by the upload manager.
    scoped.put(`${BASE}/upload`, async (request, reply) => {
      const service = serviceFor(request, reply);
      if (!service) return reply;
      try {
        const length = request.headers["content-length"];
        const declared = typeof length === "string" && /^\d+$/.test(length) ? Number(length) : undefined;
        const body = request.body as Readable | undefined;
        if (!body || typeof body.pipe !== "function") {
          throw new RequestError("Send the file as the raw body with Content-Type: application/octet-stream", 415);
        }
        const result = await service.uploads.receive({
          fileName: decodeFileName(request.headers["x-file-name"]),
          declared,
          source: body
        });
        return reply.status(201).send(result);
      } catch (error) {
        // The unread rest of the body must not hold the connection open.
        if (!request.raw.readableEnded) request.raw.resume();
        return sendImagesError(reply, error);
      }
    });
  });
}
