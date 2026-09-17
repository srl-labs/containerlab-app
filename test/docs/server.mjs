import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "../../site");
const prefix = "/containerlab-app/docs/";
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".gif": "image/gif" };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
    let filename = path.resolve(root, pathname.slice(prefix.length));
    if (filename !== root && !filename.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, "index.html");
    response.setHeader("Content-Type", types[path.extname(filename)] ?? "application/octet-stream");
    const body = await readFile(filename);
    // Match static production hosting for cold-network performance checks.
    response.setHeader("Vary", "Accept-Encoding");
    response.setHeader("Cache-Control", "public, max-age=600");
    if (/\bgzip\b/.test(request.headers["accept-encoding"] ?? "") && /\.(?:html|js|mjs|css|json|svg)$/.test(filename)) {
      response.setHeader("Content-Encoding", "gzip");
      response.end(gzipSync(body));
    } else response.end(body);
  } catch { response.writeHead(404).end(); }
}).listen(8011, "127.0.0.1");
