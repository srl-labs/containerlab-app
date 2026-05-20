import { gzipSync } from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import {
  getHttpErrorStatus,
  type ClabApiClient,
  type WorkspaceFileEntry,
} from "./clabApiClient.ts";
import type { EndpointEntry } from "./endpointSessionStore.ts";
import { getEndpointIdFromRequest } from "./middleware.ts";

type EndpointResolver = (
  request: FastifyRequest,
  reply: FastifyReply,
  endpointId?: string,
) => { client: ClabApiClient; endpoint: EndpointEntry } | null;

type ArchiveFormat = "zip" | "tar.gz";

interface MultipartFile {
  fieldName: string;
  fileName: string;
  contentType: string;
  data: Buffer;
}

interface MultipartForm {
  fields: Map<string, string>;
  files: MultipartFile[];
}

interface MultipartPart {
  contentType: string;
  data: Buffer;
  fieldName: string;
  fileName: string;
  nextCursor: number;
}

interface ArchiveFileEntry {
  data: Buffer;
  path: string;
}

class RequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

const MAX_MULTIPART_BYTES = 256 * 1024 * 1024;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP_UTF8_FLAG = 0x0800;
const ZIP_METHOD_STORE = 0;
const TAR_BLOCK_SIZE = 512;
const DOS_DATE_1980_01_01 = 33;

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function queryString(request: FastifyRequest, key: string): string {
  const query = request.query as Record<string, unknown> | undefined;
  const value = query?.[key];
  return typeof value === "string" ? value : "";
}

function bodyBuffer(request: FastifyRequest): Buffer {
  const body = request.body;
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  return Buffer.alloc(0);
}

function sendRouteError(reply: FastifyReply, error: unknown): FastifyReply {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof RequestError) {
    return reply.status(error.statusCode).send({ error: message });
  }
  return reply.status(getHttpErrorStatus(error) ?? 500).send({ error: message });
}

function parseBoundary(contentType: unknown): string {
  const header = Array.isArray(contentType) ? contentType[0] : contentType;
  if (typeof header !== "string") {
    throw new RequestError("Missing multipart content type.", 400);
  }
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(header);
  const boundary = (match?.[1] ?? match?.[2] ?? "").trim();
  if (!boundary) {
    throw new RequestError("Missing multipart boundary.", 400);
  }
  return boundary;
}

function parseHeaderParams(value: string): Map<string, string> {
  const params = new Map<string, string>();
  for (const part of value.split(";").slice(1)) {
    const equalsIndex = part.indexOf("=");
    if (equalsIndex < 0) {
      continue;
    }
    const key = part.slice(0, equalsIndex).trim().toLowerCase();
    let paramValue = part.slice(equalsIndex + 1).trim();
    if (paramValue.startsWith('"') && paramValue.endsWith('"')) {
      paramValue = paramValue.slice(1, -1).replace(/\\"/g, '"');
    }
    params.set(key, paramValue);
  }
  return params;
}

function parsePartHeaders(rawHeaders: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of rawHeaders.split("\r\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex < 0) {
      continue;
    }
    headers.set(
      line.slice(0, colonIndex).trim().toLowerCase(),
      line.slice(colonIndex + 1).trim(),
    );
  }
  return headers;
}

function readMultipartPart(
  buffer: Buffer,
  delimiter: Buffer,
  cursor: number,
): MultipartPart | null {
  let partCursor = cursor + delimiter.byteLength;
  const marker = buffer.subarray(partCursor, partCursor + 2).toString("latin1");
  if (marker === "--") {
    return null;
  }
  if (marker === "\r\n") {
    partCursor += 2;
  }

  const headersEnd = buffer.indexOf("\r\n\r\n", partCursor, "latin1");
  if (headersEnd < 0) {
    throw new RequestError("Malformed multipart part.", 400);
  }
  const headers = parsePartHeaders(buffer.subarray(partCursor, headersEnd).toString("utf8"));
  const bodyStart = headersEnd + 4;
  const nextDelimiter = buffer.indexOf(delimiter, bodyStart);
  if (nextDelimiter < 0) {
    throw new RequestError("Malformed multipart body.", 400);
  }

  let bodyEnd = nextDelimiter;
  if (bodyEnd >= 2 && buffer.subarray(bodyEnd - 2, bodyEnd).toString("latin1") === "\r\n") {
    bodyEnd -= 2;
  }
  const disposition = headers.get("content-disposition") ?? "";
  const params = parseHeaderParams(disposition);
  return {
    contentType: headers.get("content-type") ?? "application/octet-stream",
    data: Buffer.from(buffer.subarray(bodyStart, bodyEnd)),
    fieldName: params.get("name") ?? "",
    fileName: params.get("filename") ?? "",
    nextCursor: nextDelimiter,
  };
}

function parseMultipartForm(buffer: Buffer, boundary: string): MultipartForm {
  if (buffer.byteLength > MAX_MULTIPART_BYTES) {
    throw new RequestError("Upload is too large.", 413);
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const fields = new Map<string, string>();
  const files: MultipartFile[] = [];
  let cursor = buffer.indexOf(delimiter);
  if (cursor < 0) {
    throw new RequestError("Multipart boundary not found.", 400);
  }

  while (cursor >= 0) {
    const part = readMultipartPart(buffer, delimiter, cursor);
    if (!part) {
      break;
    }
    if (part.fieldName) {
      if (part.fileName) {
        files.push({
          fieldName: part.fieldName,
          fileName: part.fileName,
          contentType: part.contentType,
          data: part.data,
        });
      } else {
        fields.set(part.fieldName, part.data.toString("utf8"));
      }
    }

    cursor = part.nextCursor;
  }

  return { fields, files };
}

function parseMultipartRequest(request: FastifyRequest): MultipartForm {
  return parseMultipartForm(bodyBuffer(request), parseBoundary(request.headers["content-type"]));
}

function findUploadFiles(form: MultipartForm, preferredFieldName: string): MultipartFile[] {
  const preferredFiles = form.files.filter((entry) => entry.fieldName === preferredFieldName);
  const files = preferredFiles.length > 0 ? preferredFiles : form.files;
  if (files.length === 0) {
    throw new RequestError(`Missing '${preferredFieldName}' file in multipart form data.`, 400);
  }
  return files;
}

function normalizePathSegments(pathValue: string): string[] {
  const normalized = pathValue.trim().replace(/\\/g, "/");
  if (!normalized || normalized.includes("\u0000")) {
    throw new RequestError("Missing path.", 400);
  }
  if (normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    throw new RequestError("Absolute paths are not allowed.", 400);
  }
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === "..")
  ) {
    throw new RequestError("Invalid path.", 400);
  }
  return segments;
}

function normalizeWorkspacePath(pathValue: string): string {
  return normalizePathSegments(pathValue).join("/");
}

function normalizeWorkspaceDirectoryPath(pathValue: string): string {
  const trimmed = pathValue.trim();
  return trimmed ? normalizeWorkspacePath(trimmed) : "";
}

function normalizeUploadFileName(fileName: string): string {
  const normalized = fileName.trim().replace(/\\/g, "/");
  const name = normalized.split("/").filter(Boolean).at(-1) ?? "";
  if (!name || name.includes("\u0000") || name === "." || name === "..") {
    throw new RequestError("Invalid upload filename.", 400);
  }
  return name;
}

function joinWorkspacePath(directory: string, name: string): string {
  return directory ? `${directory}/${name}` : name;
}

function normalizeLabFolderPath(pathValue: string): string {
  const raw = pathValue.trim().replace(/\\/g, "/");
  if (raw.startsWith("/") || raw.startsWith("~/.clab/")) {
    const segments = raw.split("/").filter(Boolean);
    const clabIndex = segments.lastIndexOf(".clab");
    if (clabIndex >= 0 && clabIndex === segments.length - 2) {
      return normalizeDirectLabFolder(segments[clabIndex + 1]);
    }
    throw new RequestError("Archive download is only allowed for direct lab folders.", 400);
  }
  return normalizeDirectLabFolder(pathValue);
}

function normalizeDirectLabFolder(pathValue: string): string {
  const segments = normalizePathSegments(pathValue);
  if (segments.length !== 1) {
    throw new RequestError("Archive download is only allowed for direct lab folders.", 400);
  }
  return segments[0];
}

function safeFileName(pathValue: string): string {
  const segments = pathValue.split("/").filter(Boolean);
  const name = segments.at(-1) ?? "download";
  return name.replace(/[^\w.-]+/g, "_") || "download";
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/["\\\r\n]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function isTopologyFileName(name: string): boolean {
  return /\.clab\.ya?ml$/i.test(name);
}

function assertLabFolderEntries(labFolder: string, entries: WorkspaceFileEntry[]): void {
  if (!entries.some((entry) => entry.kind === "file" && isTopologyFileName(safeFileName(entry.path)))) {
    throw new RequestError(`Folder '${labFolder}' does not look like a lab folder.`, 400);
  }
}

async function responseToBuffer(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

async function collectWorkspaceFiles(
  client: ClabApiClient,
  token: string,
  labFolder: string,
): Promise<ArchiveFileEntry[]> {
  const rootEntries = await client.listWorkspaceTree(token, labFolder);
  assertLabFolderEntries(labFolder, rootEntries);

  const files: ArchiveFileEntry[] = [];
  const visit = async (entries: WorkspaceFileEntry[]): Promise<void> => {
    for (const entry of entries) {
      const entryPath = normalizeWorkspacePath(entry.path);
      if (entry.kind === "directory") {
        await visit(await client.listWorkspaceTree(token, entryPath));
        continue;
      }
      const response = await client.openWorkspaceFile(token, entryPath);
      files.push({ path: entryPath, data: await responseToBuffer(response) });
    }
  };
  await visit(rootEntries);
  files.sort((left, right) => left.path.localeCompare(right.path));
  return files;
}

function assertZipSize(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new RequestError(`${what} is too large for ZIP format.`, 413);
  }
}

function buildZipArchive(files: ArchiveFileEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path, "utf8");
    const data = file.data;
    const crc = crc32(data);
    assertZipSize(name.byteLength, "ZIP filename");
    assertZipSize(data.byteLength, file.path);
    assertZipSize(offset, "ZIP offset");

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    localHeader.writeUInt16LE(ZIP_METHOD_STORE, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(DOS_DATE_1980_01_01, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(data.byteLength, 18);
    localHeader.writeUInt32LE(data.byteLength, 22);
    localHeader.writeUInt16LE(name.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, name, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    centralHeader.writeUInt16LE(ZIP_METHOD_STORE, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(DOS_DATE_1980_01_01, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(data.byteLength, 20);
    centralHeader.writeUInt32LE(data.byteLength, 24);
    centralHeader.writeUInt16LE(name.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.byteLength + name.byteLength + data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  assertZipSize(centralDirectory.byteLength, "ZIP central directory");
  assertZipSize(offset, "ZIP central directory offset");

  const end = Buffer.alloc(22);
  end.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function writeTarString(header: Buffer, offset: number, length: number, value: string): void {
  header.fill(0, offset, offset + length);
  header.write(value, offset, Math.min(Buffer.byteLength(value), length), "utf8");
}

function writeTarOctal(header: Buffer, offset: number, length: number, value: number): void {
  const octal = value.toString(8).padStart(length - 1, "0").slice(-(length - 1));
  header.write(`${octal}\0`, offset, length, "ascii");
}

function splitTarPath(pathValue: string): { name: string; prefix: string } {
  const pathBytes = Buffer.byteLength(pathValue);
  if (pathBytes <= 100) {
    return { name: pathValue, prefix: "" };
  }
  const slashIndexes = [...pathValue.matchAll(/\//g)].map((match) => match.index ?? -1);
  for (let index = slashIndexes.length - 1; index >= 0; index -= 1) {
    const slashIndex = slashIndexes[index];
    const prefix = pathValue.slice(0, slashIndex);
    const name = pathValue.slice(slashIndex + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) {
      return { name, prefix };
    }
  }
  throw new RequestError(`Path '${pathValue}' is too long for tar format.`, 400);
}

function buildTarHeader(pathValue: string, dataLength: number): Buffer {
  const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
  const { name, prefix } = splitTarPath(pathValue);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, dataLength);
  writeTarOctal(header, 136, 12, Math.floor(Date.now() / 1000));
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");
  writeTarString(header, 345, 155, prefix);

  let checksum = 0;
  for (const byte of header) {
    checksum += byte;
  }
  const checksumValue = checksum.toString(8).padStart(6, "0").slice(-6);
  header.write(`${checksumValue}\0 `, 148, 8, "ascii");
  return header;
}

function buildTarGzArchive(files: ArchiveFileEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const file of files) {
    parts.push(buildTarHeader(file.path, file.data.byteLength), file.data);
    const padding = (TAR_BLOCK_SIZE - (file.data.byteLength % TAR_BLOCK_SIZE)) % TAR_BLOCK_SIZE;
    if (padding > 0) {
      parts.push(Buffer.alloc(padding));
    }
  }
  parts.push(Buffer.alloc(TAR_BLOCK_SIZE * 2));
  return gzipSync(Buffer.concat(parts));
}

function buildArchive(format: ArchiveFormat, files: ArchiveFileEntry[]): Buffer {
  return format === "tar.gz" ? buildTarGzArchive(files) : buildZipArchive(files);
}

function archiveFormatFromRequest(request: FastifyRequest, fallbackFileName = ""): ArchiveFormat {
  const format = queryString(request, "format").trim().toLowerCase();
  if (format === "zip") {
    return "zip";
  }
  if (format === "tar.gz" || format === "tgz") {
    return "tar.gz";
  }
  const lowerFileName = fallbackFileName.toLowerCase();
  if (lowerFileName.endsWith(".tar.gz") || lowerFileName.endsWith(".tgz")) {
    return "tar.gz";
  }
  if (lowerFileName.endsWith(".zip")) {
    return "zip";
  }
  return "zip";
}

export function registerFileTransferProxy(
  app: FastifyInstance,
  resolveEndpoint: EndpointResolver,
): void {
  app.addContentTypeParser(
    /^multipart\/form-data/i,
    { parseAs: "buffer", bodyLimit: MAX_MULTIPART_BYTES },
    (_request, body, done) => {
      done(null, Buffer.isBuffer(body) ? body : Buffer.from(body));
    },
  );

  const resolveFileEndpoint = (
    request: FastifyRequest,
    reply: FastifyReply,
  ): { client: ClabApiClient; endpoint: EndpointEntry } | null =>
    resolveEndpoint(request, reply, getEndpointIdFromRequest(request));

  app.get("/api/runtime/file-explorer/download", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    try {
      const pathValue = normalizeWorkspacePath(queryString(request, "path"));
      const response = await resolved.client.openWorkspaceFile(resolved.endpoint.token, pathValue);
      const data = await responseToBuffer(response);
      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      reply.header("Content-Type", contentType);
      reply.header("Content-Disposition", contentDisposition(safeFileName(pathValue)));
      return reply.send(data);
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  app.post("/api/runtime/file-explorer/upload", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    try {
      const form = parseMultipartRequest(request);
      const files = findUploadFiles(form, "file");
      const rawPath = form.fields.get("path") ?? queryString(request, "path");
      const targetKind = (form.fields.get("targetKind") ?? queryString(request, "targetKind")).trim();
      const useDirectoryTarget = targetKind === "directory" || files.length > 1;
      const basePath = useDirectoryTarget
        ? normalizeWorkspaceDirectoryPath(rawPath)
        : normalizeWorkspacePath(rawPath);
      const paths: string[] = [];

      for (const file of files) {
        const pathValue = useDirectoryTarget
          ? normalizeWorkspacePath(joinWorkspacePath(basePath, normalizeUploadFileName(file.fileName)))
          : basePath;
        await resolved.client.putWorkspaceFileBytes(
          resolved.endpoint.token,
          pathValue,
          file.data,
          file.contentType,
        );
        paths.push(pathValue);
      }
      return reply.send({
        endpointId: resolved.endpoint.id,
        filesWritten: paths.length,
        path: paths[0],
        paths,
        success: true,
      });
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });

  app.get("/api/runtime/labs/archive", async (request, reply) => {
    const resolved = resolveFileEndpoint(request, reply);
    if (!resolved) {
      return reply.status(401).send({ error: "Not authenticated" });
    }
    try {
      const labFolder = normalizeLabFolderPath(queryString(request, "path"));
      const format = archiveFormatFromRequest(request);
      const files = await collectWorkspaceFiles(resolved.client, resolved.endpoint.token, labFolder);
      const archive = buildArchive(format, files);
      const extension = format === "zip" ? "zip" : "tar.gz";
      reply.header("Content-Type", format === "zip" ? "application/zip" : "application/gzip");
      reply.header("Content-Disposition", contentDisposition(`${labFolder}.${extension}`));
      return reply.send(archive);
    } catch (error) {
      return sendRouteError(reply, error);
    }
  });
}
