import type { FastifyReply, FastifyRequest } from "fastify";
import { normalizeEndpointProfileUrl } from "@srl-labs/containerlab-app-contract";

const SESSION_COOKIE_NAME = "clab_session";
const LEGACY_TOKEN_COOKIE_NAME = "clab_token";
const LEGACY_API_URL_COOKIE_NAME = "clab_api_url";
const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface LegacySessionCookies {
  token: string;
  url: string;
}

export function getSessionIdFromRequest(request: FastifyRequest): string | null {
  const cookies = request.cookies as Record<string, string | undefined>;
  const sessionId = cookies[SESSION_COOKIE_NAME]?.trim();
  return sessionId && sessionId.length > 0 ? sessionId : null;
}

export function setSessionCookie(reply: FastifyReply, sessionId: string, secure: boolean): void {
  void reply.setCookie(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export function normalizeApiUrl(raw: string): string | null {
  return normalizeEndpointProfileUrl(raw);
}

export function getLegacySessionCookies(
  request: FastifyRequest,
  fallbackApiUrl: string
): LegacySessionCookies | null {
  const cookies = request.cookies as Record<string, string | undefined>;
  const token = cookies[LEGACY_TOKEN_COOKIE_NAME]?.trim();
  if (!token) {
    return null;
  }

  const normalizedUrl = normalizeApiUrl(cookies[LEGACY_API_URL_COOKIE_NAME] ?? fallbackApiUrl);
  if (!normalizedUrl) {
    return null;
  }

  return {
    token,
    url: normalizedUrl
  };
}

export function clearLegacySessionCookies(reply: FastifyReply): void {
  void reply.clearCookie(LEGACY_TOKEN_COOKIE_NAME, { path: "/" });
  void reply.clearCookie(LEGACY_API_URL_COOKIE_NAME, { path: "/" });
}

export function getEndpointIdFromRequest(request: FastifyRequest): string | undefined {
  const rawHeader = request.headers["x-endpoint-id"];
  if (typeof rawHeader === "string" && rawHeader.trim().length > 0) {
    return rawHeader.trim();
  }
  if (Array.isArray(rawHeader)) {
    const first = rawHeader.find((value) => typeof value === "string" && value.trim().length > 0);
    if (first) {
      return first.trim();
    }
  }

  const query = request.query as Record<string, unknown> | undefined;
  const fromQuery = query?.endpointId;
  return typeof fromQuery === "string" && fromQuery.trim().length > 0
    ? fromQuery.trim()
    : undefined;
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!getSessionIdFromRequest(request)) {
    reply.status(401).send({ error: "Not authenticated" });
  }
}
