import fs from "node:fs";
import { getCACertificates } from "node:tls";

import { Agent, type Dispatcher } from "undici";
import type { ClientOptions } from "ws";

import { parseBooleanEnv } from "./env.ts";

export interface ResolvedApiTlsConfig {
  ca?: string[];
  caFile?: string;
  serverName?: string;
  verify: boolean;
}

export interface ApiTlsTransport {
  dispatcher?: Dispatcher;
  dispose(): Promise<void>;
  websocketOptions: ApiWebSocketTlsOptions;
}

// `ws` forwards `servername` to Node's HTTPS request although its public
// ClientOptions type currently omits that standard TLS option.
export interface ApiWebSocketTlsOptions {
  ca?: ClientOptions["ca"];
  rejectUnauthorized?: boolean;
  servername?: string;
}

type CaCertificateSource = (type: "default" | "system") => readonly string[];

export function resolveTrustedCaCertificates(
  additionalCertificate?: string,
  certificateSource: CaCertificateSource = getCACertificates,
): string[] {
  const certificates = [
    ...new Set([
      ...certificateSource("default"),
      ...certificateSource("system"),
    ]),
  ];
  if (additionalCertificate !== undefined) {
    certificates.push(additionalCertificate);
  }
  return certificates;
}

export function resolveApiTlsConfig(
  env: NodeJS.ProcessEnv = process.env,
  production = env.NODE_ENV === "production",
): ResolvedApiTlsConfig {
  const verify = parseBooleanEnv(env.CLAB_API_TLS_VERIFY, production);
  const caFile = env.CLAB_API_CA_FILE?.trim();
  const serverName = env.CLAB_API_TLS_SERVER_NAME?.trim() || undefined;
  const customCertificate = caFile ? fs.readFileSync(caFile, "utf8") : undefined;
  return {
    ca: resolveTrustedCaCertificates(customCertificate),
    ...(caFile ? { caFile } : {}),
    serverName,
    verify,
  };
}

export function createApiTlsTransport(
  config: ResolvedApiTlsConfig,
): ApiTlsTransport {
  const websocketOptions = {
    rejectUnauthorized: config.verify,
    ...(config.ca ? { ca: config.ca } : {}),
    ...(config.serverName ? { servername: config.serverName } : {}),
  };

  const dispatcher = new Agent({
    connect: {
      rejectUnauthorized: config.verify,
      ...(config.ca ? { ca: config.ca } : {}),
      ...(config.serverName ? { servername: config.serverName } : {}),
    },
  });

  return {
    dispatcher,
    async dispose(): Promise<void> {
      await dispatcher.close();
    },
    websocketOptions,
  };
}
