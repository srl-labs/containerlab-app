const CONTROL_OR_BACKSLASH = /[\\\u0000-\u001f\u007f]/u;
const MAX_DECODE_PASSES = 8;

function canonicalProxySegment(raw: string): string | null {
  if (!raw) return null;
  let decoded = raw;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      CONTROL_OR_BACKSLASH.test(decoded)
    ) {
      return null;
    }
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      return null;
    }
    if (next === decoded) {
      return encodeURIComponent(decoded);
    }
    decoded = next;
  }
  return null;
}

/** Canonicalize a decoded Fastify wildcard without permitting URL dot segments. */
export function encodeVncProxyWildcard(raw: string | undefined): string | null {
  if (!raw) return "";
  const encoded: string[] = [];
  for (const segment of raw.split("/")) {
    const canonical = canonicalProxySegment(segment);
    if (canonical === null) return null;
    encoded.push(canonical);
  }
  return encoded.join("/");
}

/** Preserve VNC client options while removing BFF-only endpoint selection. */
export function vncUpstreamQuery(rawUrl: string | undefined): string {
  const parsed = new URL(rawUrl ?? "/", "http://containerlab-app.invalid");
  parsed.searchParams.delete("endpointId");
  const query = parsed.searchParams.toString();
  return query ? `?${query}` : "";
}
