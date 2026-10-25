import type { FastifyReply, FastifyRequest } from "fastify";
import type { LabBackend } from "@srl-labs/containerlab-lab-backend";

import type { EndpointEntry } from "./endpointSessionStore.ts";
import type { EndpointUiStore } from "./uiStore.ts";

/** An endpoint of the browser session, with the backend that serves it. */
export interface ResolvedEndpoint {
  backend: LabBackend;
  endpoint: EndpointEntry;
  /** Custom node templates and icons kept for the endpoint's user. */
  ui: EndpointUiStore;
}

/**
 * The endpoint a request targets: `endpointId` when given, else the
 * `x-endpoint-id` header or `endpointId` query, else the first endpoint.
 * Null when it does not exist or is signed out.
 */
export type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string
) => ResolvedEndpoint | null;

export type EndpointListResolver = (
  request: FastifyRequest,
  reply: FastifyReply
) => EndpointEntry[];
