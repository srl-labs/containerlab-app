import { parseBooleanEnv } from "./env.ts";

export function shouldVerifyApiTls(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanEnv(env.CLAB_API_TLS_VERIFY, false);
}

export function apiTlsWebSocketOptions(): { rejectUnauthorized: boolean } {
  return { rejectUnauthorized: shouldVerifyApiTls() };
}
