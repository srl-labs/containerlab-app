import type { FastifyReply } from "fastify";

import { handleRouteError, RequestError } from "../runtimeProxy.ts";

/** A failure of an Images operation, with the HTTP status and the `climg` error code when there is one. */
export class ImagesError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string = "error"
  ) {
    super(message);
  }
}

const CLIMG_CODE_STATUS: Record<string, number> = {
  not_found: 404,
  invalid_ref: 400,
  needs_yes: 400,
  disk_floor: 507,
  locked: 409,
  no_config: 503,
  cancelled: 409
};

export function statusForClimgCode(code: string): number {
  return CLIMG_CODE_STATUS[code] ?? 500;
}

export function sendImagesError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof ImagesError) {
    return reply.status(error.status).send({ error: error.message, code: error.code });
  }
  if (error instanceof RequestError) return handleRouteError(reply, error);
  return handleRouteError(reply, error);
}
