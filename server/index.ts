import { createStandaloneApp } from "./app.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const DEFAULT_CLAB_API_URL = process.env.CLAB_API_URL ?? "http://localhost:8080";
const VITE_DEV_URL = process.env.VITE_DEV_URL ?? "http://localhost:5173";
const IS_DEV = process.env.NODE_ENV !== "production";

async function start(): Promise<void> {
  const app = await createStandaloneApp({
    defaultClabApiUrl: DEFAULT_CLAB_API_URL,
    isDev: IS_DEV,
    logger: true,
    viteDevUrl: VITE_DEV_URL
  });

  await app.listen({ port: PORT, host: "0.0.0.0" });
  app.log.info(`Standalone app server running at http://localhost:${PORT}`);
  app.log.info(`default clab-api-server URL: ${DEFAULT_CLAB_API_URL}`);
  if (IS_DEV) {
    app.log.info(`Proxying frontend to: ${VITE_DEV_URL}`);
  }
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
