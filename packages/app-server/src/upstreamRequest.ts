import { Agent } from "undici";

import { shouldVerifyApiTls } from "./upstreamTls.ts";

const verifiedAgent = new Agent({ connect: { rejectUnauthorized: true } });
const selfSignedAgent = new Agent({ connect: { rejectUnauthorized: false } });
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

interface ApiRequestOptions {
  timeoutMs?: number;
  /** Bound connection setup without cutting off a running event stream. */
  stream?: boolean;
}

export async function apiFetch(
  url: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const connectionAbort = options.stream ? new AbortController() : undefined;
  const deadline = connectionAbort?.signal ?? AbortSignal.timeout(timeoutMs);
  const timer = connectionAbort
    ? setTimeout(
        () => connectionAbort.abort(new DOMException("API connection timed out", "TimeoutError")),
        timeoutMs
      )
    : undefined;
  timer?.unref();
  const request = {
    ...init,
    // Never forward credentials through a redirect to another origin.
    redirect: "error",
    dispatcher: shouldVerifyApiTls() ? verifiedAgent : selfSignedAgent,
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  };
  try {
    // Node and the explicit undici package can ship different declaration versions.
    // Their dispatch protocol is compatible; keep that boundary in one place.
    return await fetch(url, request as unknown as RequestInit);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
