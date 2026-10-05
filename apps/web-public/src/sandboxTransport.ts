import type { StandaloneBackend } from "@srl-labs/containerlab-standalone-runtime/backend";
import type { TopologyHostCommand, TopologyRef } from "@containerlab/clab-ui/session";
import { getSandboxBackend, SANDBOX_ENDPOINT, SANDBOX_FILES_CHANGED_EVENT, type SandboxBackend } from "./sandboxBackend";

const json = (value: unknown = { success: true }, status = 200): Response =>
  Response.json(value, { status });

/** Implements the standalone transport locally without replacing fetch/EventSource. */
export function createSandboxTransport(backend: SandboxBackend = getSandboxBackend()): StandaloneBackend {
  return {
    capabilities: { lifecycle: false, endpoints: false, events: false, repositories: false, archives: false },
    subscribeFiles(listener) {
      const changed = () => listener(SANDBOX_ENDPOINT.id);
      window.addEventListener(SANDBOX_FILES_CHANGED_EVENT, changed);
      window.addEventListener("storage", changed);
      return () => {
        window.removeEventListener(SANDBOX_FILES_CHANGED_EVENT, changed);
        window.removeEventListener("storage", changed);
      };
    },
    async fetch(input, init) {
      const url = new URL(input instanceof Request ? input.url : String(input), globalThis.location?.origin ?? "http://localhost");
      const request = new Request(url, init ?? (input instanceof Request ? input : undefined));
      // Host URLs can have a deployment prefix, including /sandbox/.
      const path = url.pathname.replace(/^.*?(?=\/(?:api|auth)\/|\/files$)/, "");
      const method = request.method;
      const query = url.searchParams;
      const body = method === "GET" || method === "DELETE" || request.headers.get("content-type")?.includes("multipart/form-data")
        ? {} : await request.json().catch(() => ({})) as Record<string, unknown>;
      const text = (key: string) => typeof body[key] === "string" ? body[key] as string : "";
      try {
        if (path === "/api/config") return json({ defaultClabApiUrl: "", endpoints: [SANDBOX_ENDPOINT] });
        if (path === "/auth/me") return json({ authenticated: true, endpoints: [SANDBOX_ENDPOINT] });
        if (path === "/auth/endpoints") return json({ endpoints: [SANDBOX_ENDPOINT] });
        if (path.startsWith("/auth/")) return json({ error: "Endpoint management is unavailable in the local workspace." }, 501);
        if (path === "/files") return json(backend.listTopologyFiles());
        if (path === "/api/topology/sessions" && method === "POST") return json(backend.createSession(body.topologyRef as TopologyRef));
        if (path.startsWith("/api/topology/sessions/") && method === "DELETE") {
          backend.disposeSession(decodeURIComponent(path.split("/").at(-1)!));
          return json();
        }
        if (path === "/api/topology/snapshot") return json({ snapshot: await backend.getSnapshot(query.get("sessionId") ?? text("sessionId"), { externalChange: body.externalChange === true }) });
        if (path === "/api/topology/command") return json(await backend.dispatchCommand(query.get("sessionId") ?? text("sessionId"), Number(body.baseRevision), body.command as TopologyHostCommand));
        if (path === "/api/runtime/inspect/all") return json({});
        if (path === "/api/runtime/inspect/lab") return json([]);
        if (path === "/api/runtime/file-explorer/tree") return json(backend.listDirectory(query.get("path") ?? ""));
        if (path === "/api/runtime/file-explorer/file") {
          const filePath = query.get("path") ?? text("path");
          if (method === "GET") return json(await backend.readFile(filePath));
          if (method === "PUT") await backend.writeFile(filePath, text("content"));
          else if (method === "DELETE") await backend.deletePath(filePath, query.get("recursive") === "true");
          else return json({ error: "Unsupported file operation" }, 405);
          return json();
        }
        if (path === "/api/runtime/file-explorer/file/rename") {
          await backend.renamePath(text("oldPath"), text("newPath"));
          return json();
        }
        if (path === "/api/runtime/file-explorer/directory") {
          backend.createDirectory(text("path"));
          return json();
        }
        if (path === "/api/runtime/file-explorer/download") {
          const file = await backend.readFile(query.get("path") ?? "");
          return new Response(file.content, { headers: { "Content-Type": "text/plain;charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.path.split("/").at(-1) ?? "download")}` } });
        }
        if (path === "/api/runtime/file-explorer/upload") {
          const form = await request.formData();
          const files = await Promise.all(form.getAll("files").filter((file): file is File => typeof file !== "string").map(async (file) => ({ name: file.name, content: await file.text() })));
          await backend.uploadFiles(String(form.get("path") ?? ""), files, form.get("targetKind") === "file" ? "file" : "directory");
          return json();
        }
        if (path === "/api/runtime/topology-file/create") return json({ success: true, topologyRef: await backend.createTopologyFile(text("fileName"), typeof body.content === "string" ? body.content : undefined) });
        if (path === "/api/runtime/topology-file/delete") return json({ success: true, path: await backend.deleteTopologyFile(body.topologyRef as TopologyRef) });
        if (path === "/api/runtime/ui/custom-nodes") {
          if (method === "GET") return json(backend.getCustomNodes());
          if (method === "PUT") return json(backend.replaceCustomNodes(Array.isArray(body.customNodes) ? body.customNodes : []));
          return json(backend.saveCustomNode(body));
        }
        if (path === "/api/runtime/ui/custom-nodes/default") return json(backend.setDefaultCustomNode(text("name")));
        if (path.startsWith("/api/runtime/ui/custom-nodes/") && method === "DELETE") return json(backend.deleteCustomNode(decodeURIComponent(path.split("/").at(-1)!)));
        if (path === "/api/runtime/ui/icons/list") return json({ icons: backend.listIcons() });
        if (path === "/api/runtime/ui/icons" && method === "POST") return json({ success: true, ...backend.uploadIcon(body) });
        if (path === "/api/runtime/ui/icons/reconcile") return json();
        if (path.startsWith("/api/runtime/ui/icons/")) {
          const name = decodeURIComponent(path.split("/").at(-1)!);
          if (method === "DELETE") { backend.deleteIcon(name); return json(); }
          const icon = backend.listIcons().find((entry) => entry.name === name);
          return icon ? globalThis.fetch(icon.dataUri) : json({ error: "Icon not found" }, 404);
        }
        if (path === "/api/runtime/images") return json({ runtime: "browser", images: [] });
        if (path === "/api/runtime/version") return json({ versionInfo: "Containerlab browser sandbox" });
        if (path === "/api/runtime/version/check") return json({ checkResult: "Updates are not checked in the browser sandbox." });
        if (path === "/api/runtime/popular-repos") return json({ items: [] });
        return json({ error: "This action requires a connected lab host." }, 501);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    }
  };
}
