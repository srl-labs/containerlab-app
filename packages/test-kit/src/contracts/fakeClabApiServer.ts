import http from "node:http";
import type { AddressInfo } from "node:net";

import { errorStatus } from "@srl-labs/containerlab-lab-backend";
import { LocalLabBackend } from "@srl-labs/containerlab-lab-backend/local";

export interface FakeClabApiServer {
  url: string;
  token: string;
  close(): Promise<void>;
}

async function readBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function sendJson(response: http.ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

/**
 * The workspace and topology file routes of clab-api-server, served from a
 * local folder. Enough to run the file part of the lab backend contract
 * through `ApiLabBackend` and its HTTP client.
 */
/** What the fake server says about itself on `/health`. */
export interface FakeClabApiServerHealth {
  /** Left out, like a server older than c9s support; `docker` by default. */
  runtime?: "docker" | "podman" | "c9s" | null;
  namespaceMode?: "per-lab" | "fixed";
  features?: string[];
}

export async function startFakeClabApiServer(
  workspaceRoot: string,
  health: FakeClabApiServerHealth = {}
): Promise<FakeClabApiServer> {
  const local = new LocalLabBackend({ workspaceRoot });
  const token = "contract-token";
  const watchers = new Set<AbortController>();

  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://fake");
      const query = (key: string) => url.searchParams.get(key) ?? "";
      if (request.method === "GET" && url.pathname === "/health") {
        // Public, like clab-api-server's: the runtime and the optional features.
        const runtime = health.runtime === undefined ? "docker" : health.runtime;
        sendJson(response, 200, {
          status: "healthy",
          features: health.features ?? [],
          ...(runtime !== null ? { runtime } : {}),
          ...(health.namespaceMode ? { namespaceMode: health.namespaceMode } : {})
        });
        return;
      }
      if (request.headers.authorization !== `Bearer ${token}`) {
        sendJson(response, 401, { error: "Unauthorized" });
        return;
      }
      const route = `${request.method} ${url.pathname}`;
      const topologyFile = /^\/api\/v1\/labs\/([^/]+)\/topology\/file(\/rename)?$/.exec(url.pathname);
      switch (route) {
        case "GET /api/v1/labs/workspace/tree":
          sendJson(response, 200, await local.fs.list(query("path")));
          return;
        case "GET /api/v1/labs/workspace/file": {
          const file = await local.fs.read(query("path"));
          response.writeHead(200, { "Content-Type": file.contentType, "Content-Length": file.data.byteLength });
          response.end(Buffer.from(file.data));
          return;
        }
        case "PUT /api/v1/labs/workspace/file":
          await local.fs.write(query("path"), await readBody(request));
          sendJson(response, 200, { success: true });
          return;
        case "DELETE /api/v1/labs/workspace/file":
          await local.fs.delete(query("path"), { recursive: ["1", "true", "yes"].includes(query("recursive")) });
          sendJson(response, 200, { success: true });
          return;
        case "POST /api/v1/labs/workspace/file/rename": {
          const body = JSON.parse((await readBody(request)).toString("utf8")) as { oldPath: string; newPath: string };
          await local.fs.rename(body.oldPath, body.newPath);
          sendJson(response, 200, { success: true });
          return;
        }
        case "POST /api/v1/labs/workspace/directory": {
          const body = JSON.parse((await readBody(request)).toString("utf8")) as { path: string };
          await local.fs.mkdir(body.path);
          sendJson(response, 200, { success: true });
          return;
        }
        case "GET /api/v1/labs/workspace/events": {
          const controller = new AbortController();
          watchers.add(controller);
          request.on("close", () => controller.abort());
          const events = await local.fs.watch(controller.signal);
          response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
          response.write("\n");
          for await (const event of events) response.write(`${JSON.stringify(event)}\n`);
          response.end();
          watchers.delete(controller);
          return;
        }
        case "GET /api/v1/labs/topology/files":
          sendJson(response, 200, await local.listTopologies());
          return;
      }
      if (topologyFile) {
        const labName = decodeURIComponent(topologyFile[1]);
        const files = local.topologyFiles({ labName });
        if (topologyFile[2]) {
          const body = JSON.parse((await readBody(request)).toString("utf8")) as { oldPath: string; newPath: string };
          await files.rename(body.oldPath, body.newPath);
          sendJson(response, 200, { success: true });
          return;
        }
        const filePath = query("path");
        const revision = await files.revision(filePath);
        switch (request.method) {
          case "GET": {
            const content = await files.readFile(filePath);
            response.writeHead(200, {
              "Content-Type": "text/plain; charset=utf-8",
              ...(revision ? { "X-Topology-Document-Revision": revision } : {})
            });
            response.end(content);
            return;
          }
          case "HEAD":
            response.writeHead(
              (await files.exists(filePath)) ? 200 : 404,
              revision ? { "X-Topology-Document-Revision": revision } : {}
            );
            response.end();
            return;
          case "PUT":
            await files.writeFile(filePath, (await readBody(request)).toString("utf8"));
            sendJson(response, 200, { success: true });
            return;
          case "DELETE":
            await files.unlink(filePath);
            sendJson(response, 200, { success: true });
            return;
        }
      }
      sendJson(response, 404, { error: `No route ${route}` });
    })().catch((error: unknown) => {
      const missing = (error as { code?: unknown } | null)?.code === "ENOENT";
      const status = errorStatus(error) ?? (missing ? 404 : 500);
      if (!response.headersSent) {
        sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
      } else {
        response.end();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    async close() {
      for (const watcher of watchers) watcher.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await local.dispose();
    }
  };
}
