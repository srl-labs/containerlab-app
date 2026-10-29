/**
 * Captures of lab hosts with `captureStream` (c9s): `.pcapng` downloads and, in the desktop app, Wireshark on
 * this machine reading the stream.
 *
 * A download is two requests: a POST that checks the request and returns a
 * single-use URL, then a GET of that URL that the browser saves as a file.
 * The GET streams the capture while it runs, so the file grows in the
 * browser's downloads until the duration or packet limit ends it.
 */
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CaptureTarget, LabBackend } from "@srl-labs/containerlab-lab-backend";
import { describeCaptureGap } from "@srl-labs/containerlab-lab-backend";
import { launchLocalWireshark, type LocalWiresharkSession } from "@srl-labs/containerlab-lab-backend/local";

import type { EndpointResolver } from "./endpointResolver.ts";
import { getSessionIdFromRequest } from "./middleware.ts";
import {
  handleRouteError,
  RequestError,
  resolveCaptureTargets,
  resolveLabTarget,
  resolveRequestedEndpointId,
  type RuntimeTargetBody
} from "./runtimeProxy.ts";
import type { StandaloneTopologySessionManager } from "./topologySessionManager.ts";

/** Wireshark on the app's own machine: only for a single-user app such as the desktop app. */
export interface LocalWiresharkOptions {
  /** The Wireshark executable; found on this machine when unset. */
  binaryPath?: string;
}

interface CaptureBody extends RuntimeTargetBody {
  targets?: unknown;
  duration?: unknown;
  packetLimit?: unknown;
  /** Window title of a local Wireshark. */
  title?: unknown;
}

interface PendingDownload {
  /** The browser session that asked for the download. */
  sessionId: string;
  endpointId: string;
  backend: LabBackend;
  labName: string;
  targets: CaptureTarget[];
  duration?: string;
  packetLimit?: number;
  expiresAt: number;
}

/** A download URL must be fetched within this time, once. */
const DOWNLOAD_TTL_MS = 60_000;

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number)) throw new RequestError("packetLimit must be a whole number", 400);
  return number;
}

/** `<lab>-<YYYYMMDDTHHMMSSZ>.pcapng`, like clab-api-server names its downloads. */
export function captureFileName(labName: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const safeLab = labName.replace(/[^A-Za-z0-9._-]/g, "_") || "capture";
  return `${safeLab}-${stamp}.pcapng`;
}

export function registerCaptureStreamProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
  sessions: StandaloneTopologySessionManager,
  options: { localWireshark?: LocalWiresharkOptions } = {}
): void {
  const downloads = new Map<string, PendingDownload>();
  const wiresharks = new Set<{ controller: AbortController; session: LocalWiresharkSession }>();

  app.addHook("onClose", async () => {
    downloads.clear();
    // Captures end with the app; Wireshark keeps what it read.
    for (const entry of wiresharks) entry.controller.abort();
    await Promise.all([...wiresharks].map((entry) => entry.session.finished));
  });

  /** The endpoint, lab and targets of a capture request. */
  async function resolveCapture(request: FastifyRequest<{ Body: CaptureBody }>, reply: FastifyReply) {
    const body = request.body ?? {};
    const resolved = resolveEndpoint(request, reply, resolveRequestedEndpointId(body));
    if (!resolved) return null;
    const { backend, endpoint } = resolved;
    const target = await resolveLabTarget(endpoint, backend, sessions, body);
    const targets = await resolveCaptureTargets(backend, target.labName, body.targets);
    if (targets.length === 0) throw new RequestError("At least one capture target is required", 400);
    const duration = optionalString(body.duration);
    const packetLimit = optionalInteger(body.packetLimit);
    return {
      backend,
      endpointId: endpoint.id,
      labName: target.labName,
      targets,
      ...(duration !== undefined ? { duration } : {}),
      ...(packetLimit !== undefined ? { packetLimit } : {})
    };
  }

  app.post<{ Body: CaptureBody }>("/api/runtime/capture/downloads", async (request, reply) => {
    try {
      const capture = await resolveCapture(request, reply);
      if (!capture) return reply.status(401).send({ error: "Not authenticated" });
      if (capture.duration === undefined && capture.packetLimit === undefined) {
        throw new RequestError("A capture download needs a duration or a packet limit.", 400);
      }
      const now = Date.now();
      for (const [id, pending] of downloads) if (pending.expiresAt < now) downloads.delete(id);
      const sessionId = getSessionIdFromRequest(request);
      if (!sessionId) return reply.status(401).send({ error: "Not authenticated" });
      const id = randomBytes(16).toString("hex");
      downloads.set(id, { ...capture, sessionId, expiresAt: now + DOWNLOAD_TTL_MS });
      return reply.status(201).send({
        url: `${app.prefix}/api/runtime/capture/downloads/${id}`,
        fileName: captureFileName(capture.labName)
      });
    } catch (error) {
      return handleRouteError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>("/api/runtime/capture/downloads/:id", async (request, reply) => {
    const pending = downloads.get(request.params.id);
    downloads.delete(request.params.id);
    // Single use, and only for the browser session that asked for it, while it
    // still has the lab host. An API host gets a new backend per request, so
    // the session and endpoint decide, not the backend object.
    const resolved =
      pending && getSessionIdFromRequest(request) === pending.sessionId
        ? resolveEndpoint(request, reply, pending.endpointId)
        : null;
    if (!pending || !resolved || pending.expiresAt < Date.now()) {
      return reply.status(404).send({ error: "This capture download expired. Start the capture again." });
    }
    const controller = new AbortController();
    request.raw.on("close", () => controller.abort());
    try {
      const stream = await pending.backend.openCaptureStream(pending.labName, {
        targets: pending.targets,
        ...(pending.duration !== undefined ? { duration: pending.duration } : {}),
        ...(pending.packetLimit !== undefined ? { packetLimit: pending.packetLimit } : {}),
        signal: controller.signal,
        onGap: (gap) => request.log.warn({ labName: pending.labName }, describeCaptureGap(gap))
      });
      return reply
        .header("Content-Type", "application/x-pcapng")
        .header("Content-Disposition", `attachment; filename="${captureFileName(pending.labName)}"`)
        .header("Cache-Control", "no-store")
        .send(Readable.from(stream, { objectMode: false }));
    } catch (error) {
      controller.abort();
      return handleRouteError(reply, error);
    }
  });

  app.post<{ Body: CaptureBody }>("/api/runtime/capture/local-wireshark", async (request, reply) => {
    if (!options.localWireshark) {
      return reply.status(501).send({ error: "This app cannot start Wireshark on its machine." });
    }
    const controller = new AbortController();
    try {
      const capture = await resolveCapture(request, reply);
      if (!capture) return reply.status(401).send({ error: "Not authenticated" });
      const stream = await capture.backend.openCaptureStream(capture.labName, {
        targets: capture.targets,
        ...(capture.duration !== undefined ? { duration: capture.duration } : {}),
        ...(capture.packetLimit !== undefined ? { packetLimit: capture.packetLimit } : {}),
        signal: controller.signal,
        onGap: (gap) => app.log.warn({ labName: capture.labName }, describeCaptureGap(gap))
      });
      const title =
        optionalString(request.body?.title) ??
        `${capture.labName}: ${capture.targets.map((target) => `${target.containerName}:${target.interfaceName}`).join(", ")}`;
      let session: LocalWiresharkSession;
      try {
        session = await launchLocalWireshark(stream, {
          title,
          ...(options.localWireshark.binaryPath ? { binaryPath: options.localWireshark.binaryPath } : {}),
          stopCapture: () => controller.abort()
        });
      } catch (error) {
        // Nobody reads the capture: end it on the lab host.
        controller.abort();
        await stream[Symbol.asyncIterator]().return?.();
        throw error;
      }
      const entry = { controller, session };
      wiresharks.add(entry);
      void session.finished.then(() => wiresharks.delete(entry));
      return reply.status(201).send({ pid: session.pid ?? null, title });
    } catch (error) {
      controller.abort();
      return handleRouteError(reply, error);
    }
  });
}
