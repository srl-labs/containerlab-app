import undici, { Agent, type RequestInit, type Response } from "undici";

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
  const request: RequestInit = {
    ...init,
    // Never forward credentials through a redirect to another origin.
    redirect: "error",
    dispatcher: shouldVerifyApiTls() ? verifiedAgent : selfSignedAgent,
    signal: init.signal ? AbortSignal.any([init.signal, deadline]) : deadline
  };
  try {
    return await undici.fetch(url, request);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
