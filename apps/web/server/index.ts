import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  shouldVerifyApiTls,
  createContainerlabAppServer,
  createLocalEndpoints,
  normalizeBasePath,
  resolveLocalBackendConfig,
  resolveWebTlsConfig
} from "@srl-labs/containerlab-app-server";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const DEFAULT_CLAB_API_URL = process.env.CLAB_API_URL ?? "https://localhost:8090";
const VITE_DEV_URL = process.env.VITE_DEV_URL ?? "https://localhost:5173";
const BASE_PATH = normalizeBasePath(process.env.WEB_BASE_PATH);
const IS_DEV = process.env.NODE_ENV !== "production";
const API_TLS_VERIFY = shouldVerifyApiTls();
const WEB_TLS = resolveWebTlsConfig();

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

/**
 * Labs on the web app's own host, without clab-api-server. Opt-in with
 * WEB_LOCAL_LABS=true: everyone who can open the app then runs labs as the
 * server's OS user, so it suits a personal or trusted setup.
 */
function createWebLocalEndpoints() {
  const config = resolveLocalBackendConfig({
    platform: process.platform,
    env: process.env,
    envPrefix: "WEB_LOCAL_",
    enableVariable: "WEB_LOCAL_LABS",
    enabledByDefault: false
  });
  for (const problem of config.problems) {
    console.warn(`WEB_LOCAL_*: ${problem}`);
  }
  // With WEB_LOCAL_RUNTIME=c9s and no kubeconfig, labs run in the pod's own cluster
  // with its ServiceAccount.
  return createLocalEndpoints(config, {
    label: process.env.WEB_LOCAL_LABEL?.trim() || os.hostname(),
    setupUrl: "https://srl-labs.github.io/containerlab-app/docs/install/web/#run-labs-on-the-web-apps-host",
    autoConnect: true
  });
}

async function start(): Promise<void> {
  const localEndpoints = createWebLocalEndpoints();
  const app = await createContainerlabAppServer({
    basePath: BASE_PATH,
    defaultClabApiUrl: DEFAULT_CLAB_API_URL,
    https: WEB_TLS.https,
    isDev: IS_DEV,
    localEndpoints,
    logger: true,
    staticClientRoot: resolveStaticClientRoot(),
    viteDevUrl: VITE_DEV_URL
  });

  await app.listen({ port: PORT, host: "::", ipv6Only: false });
  const protocol = WEB_TLS.enabled ? "https" : "http";
  app.log.info(
    `Standalone app server running at ${protocol}://localhost:${PORT}${BASE_PATH}`
  );
  if (WEB_TLS.generated && WEB_TLS.certFile) {
    app.log.warn(`Generated self-signed web TLS certificate at ${WEB_TLS.certFile}`);
  }
  if (!API_TLS_VERIFY) {
    app.log.warn(
      "clab-api-server upstream TLS certificate verification is disabled (CLAB_API_TLS_VERIFY=false)"
    );
  }
  app.log.info(`default clab-api-server URL: ${DEFAULT_CLAB_API_URL}`);
  if (localEndpoints.length > 0) {
    for (const localEndpoint of localEndpoints) {
      const status = await localEndpoint.status();
      app.log.warn(
        `Labs on ${status.label} are on (WEB_LOCAL_LABS): everyone who can open the app runs labs as ${status.username} there, without signing in.`
      );
      if (!status.available) {
        app.log.warn(`Labs on ${status.label} cannot run yet: ${status.problems.join(" ")}`);
      }
    }
    // Event streams, terminals and Wireshark containers end with the server.
    const stop = (): void => {
      void Promise.allSettled([
        app.close(),
        ...localEndpoints.map((localEndpoint) => localEndpoint.backend.dispose())
      ]).finally(() => process.exit(0));
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  }
  if (IS_DEV) {
    app.log.info(`Proxying frontend to: ${VITE_DEV_URL}`);
  }
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
