import { parseBooleanEnv } from "./env.ts";

export function shouldVerifyApiTls(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseBooleanEnv(env.CLAB_API_TLS_VERIFY, false);
}

export function configureApiTlsVerification(env: NodeJS.ProcessEnv = process.env): boolean {
  const verify = shouldVerifyApiTls(env);
  if (!verify) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  return verify;
}

export function apiTlsWebSocketOptions(): { rejectUnauthorized: boolean } {
  return { rejectUnauthorized: shouldVerifyApiTls() };
}
