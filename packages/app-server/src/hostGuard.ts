import type { FastifyInstance } from "fastify";

/** `WEB_ALLOWED_HOSTS`: names with or without a port, separated by commas; undefined when unset. */
export function parseAllowedHosts(value: string | undefined): string[] | undefined {
  const hosts = (value ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : undefined;
}

/** A listed name without a port allows the name on any port. */
export function isAllowedHost(host: string | undefined, allowed: readonly string[]): boolean {
  const requested = host?.trim().toLowerCase() ?? "";
  if (requested === "") return false;
  const name = requested.replace(/:\d+$/, "");
  return allowed.some((entry) => entry === requested || entry === name);
}

/**
 * Refuses requests for any other name than this app's. A web page can point a name
 * of its own at this server (DNS rebinding), and then counts as the same site.
 */
export function registerHostGuard(app: FastifyInstance, allowedHosts: () => readonly string[]): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!isAllowedHost(request.headers.host, allowedHosts())) {
      return reply.status(403).send({ error: "This app does not answer for that host name." });
    }
    return undefined;
  });
}
