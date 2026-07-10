import fs from "node:fs";
import path from "node:path";

import {
  createContainerlabAppServer,
  resolveApiTlsConfig,
  resolveWebTlsConfig
} from "@srl-labs/containerlab-app-server";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const LISTEN_ADDRESS = process.env.WEB_LISTEN_ADDRESS?.trim() || "0.0.0.0";
const DEFAULT_CLAB_API_URL = process.env.CLAB_API_URL ?? "https://localhost:8090";
const VITE_DEV_URL = process.env.VITE_DEV_URL ?? "https://localhost:5173";
const IS_DEV = process.env.NODE_ENV !== "production";
const API_TLS = resolveApiTlsConfig(process.env, !IS_DEV);
const WEB_TLS = resolveWebTlsConfig();
const SESSION_PERSISTENCE_FILE = process.env.CONTAINERLAB_WEB_SESSION_FILE?.trim() || undefined;

function resolveStaticClientRoot(): string {
  if (process.env.CONTAINERLAB_WEB_CLIENT_ROOT?.trim()) {
    return path.resolve(process.env.CONTAINERLAB_WEB_CLIENT_ROOT.trim());
  }

  const candidates = [
    path.resolve(process.cwd(), "apps/web/dist/client"),
    path.resolve(process.cwd(), "dist/client")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

async function start(): Promise<void> {
  const app = await createContainerlabAppServer({
    apiTls: API_TLS,
    defaultClabApiUrl: DEFAULT_CLAB_API_URL,
    https: WEB_TLS.https,
    isDev: IS_DEV,
    logger: true,
    sessionPersistenceFile: SESSION_PERSISTENCE_FILE,
    staticClientRoot: resolveStaticClientRoot(),
    viteDevUrl: VITE_DEV_URL
  });

  await app.listen({ port: PORT, host: LISTEN_ADDRESS });
  const protocol = WEB_TLS.enabled ? "https" : "http";
  app.log.info(`Standalone app server listening at ${protocol}://${LISTEN_ADDRESS}:${PORT}`);
  if (WEB_TLS.generated && WEB_TLS.certFile) {
    app.log.warn(`Generated self-signed web TLS certificate at ${WEB_TLS.certFile}`);
  }
  if (!API_TLS.verify) {
    app.log.warn("clab-api-server upstream TLS certificate verification is disabled (CLAB_API_TLS_VERIFY=false)");
  } else if (API_TLS.caFile) {
    app.log.info(`Using clab-api-server CA certificate: ${API_TLS.caFile}`);
  }
  app.log.info(`default clab-api-server URL: ${DEFAULT_CLAB_API_URL}`);
  if (IS_DEV) {
    app.log.info(`Proxying frontend to: ${VITE_DEV_URL}`);
  }
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
