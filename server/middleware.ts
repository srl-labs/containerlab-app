/**
 * Fastify middleware for cookie-based JWT session management.
 */

import type { FastifyRequest, FastifyReply } from "fastify";

const COOKIE_NAME = "clab_token";
const API_URL_COOKIE_NAME = "clab_api_url";

/**
 * Extracts JWT token from httpOnly cookie.
 * Attaches it to request headers for downstream use.
 */
export function getTokenFromRequest(request: FastifyRequest): string | null {
  const cookies = request.cookies as Record<string, string | undefined>;
  return cookies[COOKIE_NAME] ?? null;
}

/**
 * Sets JWT token as httpOnly cookie on the response.
 */
export function setTokenCookie(reply: FastifyReply, token: string): void {
  void reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 3600 // 1 hour, matches default JWT expiration
  });
}

/**
 * Clears the JWT cookie.
 */
export function clearTokenCookie(reply: FastifyReply): void {
  void reply.clearCookie(COOKIE_NAME, {
    path: "/"
  });
}

/**
 * Normalizes and validates API endpoint URL.
 * Accepts host:port shorthand and normalizes to absolute HTTP(S) URL.
 */
export function normalizeApiUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const withProtocol = /^[a-z][a-z0-9+\-.]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

/**
 * Resolves API endpoint from cookie, with configured default fallback.
 */
export function getApiUrlFromRequest(request: FastifyRequest, fallback: string): string {
  const cookies = request.cookies as Record<string, string | undefined>;
  const raw = cookies[API_URL_COOKIE_NAME];
  const normalized = raw ? normalizeApiUrl(raw) : null;
  return normalized ?? fallback;
}

/**
 * Stores the selected API endpoint in a session cookie.
 */
export function setApiUrlCookie(reply: FastifyReply, apiUrl: string): void {
  void reply.setCookie(API_URL_COOKIE_NAME, apiUrl, {
    httpOnly: true,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30 // 30 days
  });
}

/**
 * Auth guard - returns 401 if no valid token present.
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const token = getTokenFromRequest(request);
  if (!token) {
    reply.status(401).send({ error: "Not authenticated" });
  }
}
