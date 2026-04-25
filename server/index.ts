import { createStandaloneApp } from "./app.js";
import { configureApiTlsVerification } from "./upstreamTls.js";
import { resolveWebTlsConfig } from "./tlsConfig.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const DEFAULT_CLAB_API_URL = process.env.CLAB_API_URL ?? "https://localhost:8080";
const VITE_DEV_URL = process.env.VITE_DEV_URL ?? "https://localhost:5173";
const IS_DEV = process.env.NODE_ENV !== "production";
const API_TLS_VERIFY = configureApiTlsVerification();
const WEB_TLS = resolveWebTlsConfig();

async function start(): Promise<void> {
  const app = await createStandaloneApp({
    defaultClabApiUrl: DEFAULT_CLAB_API_URL,
    https: WEB_TLS.https,
    isDev: IS_DEV,
    logger: true,
    viteDevUrl: VITE_DEV_URL
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  const protocol = WEB_TLS.enabled ? "https" : "http";
  app.log.info(`Standalone app server running at ${protocol}://localhost:${PORT}`);
  if (WEB_TLS.generated && WEB_TLS.certFile) {
    app.log.warn(`Generated self-signed web TLS certificate at ${WEB_TLS.certFile}`);
  }
  if (!API_TLS_VERIFY) {
    app.log.warn("clab-api-server upstream TLS certificate verification is disabled (CLAB_API_TLS_VERIFY=false)");
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
