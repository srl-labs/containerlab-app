import type {
  ImageRecord,
  ImagesIndexInfo,
  ImagesJob,
  ImagesJobRequest,
  ImagesJobsResponse,
  ImagesScanFile,
  ImagesSearchQuery,
  ImagesStatusResponse,
  ImagesTemplateResult,
  ImagesTemplatesResponse,
  ImagesUnavailable,
  ImagesUploadResponse
} from "@srl-labs/containerlab-lab-backend";

import { runtimeFetch } from "./backend";
import { resolveRuntimeRequestUrl } from "./runtimeApi";

export type {
  ImageRecord,
  ImagesIndexInfo,
  ImagesJob,
  ImagesJobRequest,
  ImagesJobsResponse,
  ImagesScanFile,
  ImagesSearchQuery,
  ImagesStatusResponse,
  ImagesTemplateResult,
  ImagesTemplatesResponse,
  ImagesUploadResponse
};

const BASE = "/api/runtime/images";

/** A failed Images request; `unavailable` is set for the 404 that says the feature is off for this endpoint. */
class ImagesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly unavailable?: ImagesUnavailable,
    readonly code?: string
  ) {
    super(message);
    this.name = "ImagesApiError";
  }
}

function headers(endpointId: string | undefined, extra: Record<string, string> = {}): Record<string, string> {
  return endpointId ? { ...extra, "x-endpoint-id": endpointId } : extra;
}

async function failure(response: Response): Promise<ImagesApiError> {
  const text = await response.text().catch(() => "");
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Not JSON: use the raw text below.
  }
  if (response.status === 404 && body.reason === "unavailable") {
    return new ImagesApiError(String(body.detail ?? "Images are not available"), 404, body as unknown as ImagesUnavailable);
  }
  const message =
    typeof body.error === "string" ? body.error : text || `${response.status} ${response.statusText}`.trim();
  return new ImagesApiError(message, response.status, undefined, typeof body.code === "string" ? body.code : undefined);
}

async function request<T>(path: string, init: RequestInit, endpointId?: string): Promise<T> {
  const response = await runtimeFetch(resolveRuntimeRequestUrl(`${BASE}/${path}`), {
    credentials: "include",
    ...init,
    headers: { ...(init.headers as Record<string, string> | undefined), ...headers(endpointId) }
  });
  if (!response.ok) throw await failure(response);
  return (await response.json()) as T;
}

const getJson = <T>(path: string, endpointId?: string, signal?: AbortSignal): Promise<T> =>
  request<T>(path, signal ? { signal } : {}, endpointId);

const sendJson = <T>(method: string, path: string, body: unknown, endpointId?: string): Promise<T> =>
  request<T>(
    path,
    { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) },
    endpointId
  );

export const fetchImagesStatus = (endpointId?: string): Promise<ImagesStatusResponse> =>
  getJson("status", endpointId);

export const fetchImagesIndex = (endpointId?: string): Promise<ImagesIndexInfo> => getJson("index", endpointId);

export const refreshImagesIndex = (endpointId?: string): Promise<ImagesIndexInfo> =>
  sendJson("POST", "index/refresh", {}, endpointId);

export function searchImages(query: ImagesSearchQuery, endpointId?: string, signal?: AbortSignal): Promise<ImageRecord[]> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.kind) params.set("kind", query.kind);
  if (query.vendor) params.set("vendor", query.vendor);
  if (query.source) params.set("source", query.source);
  if (query.status) params.set("status", query.status);
  if (query.all) params.set("all", "true");
  const search = params.toString();
  return getJson(`search${search ? `?${search}` : ""}`, endpointId, signal);
}

export const showImage = (ref: string, endpointId?: string): Promise<ImageRecord> =>
  getJson(`show?ref=${encodeURIComponent(ref)}`, endpointId);

export const scanImageFiles = (endpointId?: string): Promise<ImagesScanFile[]> => getJson("scan", endpointId);

export const fetchImagesTemplates = (endpointId?: string): Promise<ImagesTemplatesResponse> =>
  getJson("templates", endpointId);

export const addImagesTemplate = (ref: string, endpointId?: string): Promise<ImagesTemplateResult> =>
  sendJson("POST", "templates", { ref }, endpointId);

export const removeImagesTemplate = (name: string, endpointId?: string): Promise<ImagesTemplateResult> =>
  request(`templates/${encodeURIComponent(name)}`, { method: "DELETE" }, endpointId);

export const syncImagesTemplates = (dryRun: boolean, endpointId?: string): Promise<ImagesTemplateResult> =>
  sendJson("POST", "templates/sync", { dryRun }, endpointId);

export const startImagesJob = (job: ImagesJobRequest, endpointId?: string): Promise<ImagesJob> =>
  sendJson("POST", "jobs", job, endpointId);

export const fetchImagesJobs = (endpointId?: string): Promise<ImagesJobsResponse> => getJson("jobs", endpointId);

export const cancelImagesJob = (id: string, endpointId?: string): Promise<ImagesJob> =>
  sendJson("POST", `jobs/${encodeURIComponent(id)}/cancel`, {}, endpointId);

/**
 * Uploads an image file as the raw request body (never multipart), so the
 * server writes it to disk as it arrives. `fetch` cannot report upload progress,
 * so this uses XMLHttpRequest; abort with the signal.
 */
export function uploadImageFile(
  file: File,
  options: { endpointId?: string; onProgress?: (sent: number, total: number) => void; signal?: AbortSignal } = {}
): Promise<ImagesUploadResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", resolveRuntimeRequestUrl(`${BASE}/upload`));
    xhr.withCredentials = true;
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.setRequestHeader("x-file-name", encodeURIComponent(file.name));
    if (options.endpointId) xhr.setRequestHeader("x-endpoint-id", options.endpointId);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded, event.total);
    };
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText) as Record<string, unknown>;
      } catch {
        // Not JSON.
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as unknown as ImagesUploadResponse);
        return;
      }
      const unavailable = xhr.status === 404 && body.reason === "unavailable" ? (body as unknown as ImagesUnavailable) : undefined;
      reject(
        new ImagesApiError(
          typeof body.error === "string" ? body.error : unavailable?.detail ?? `${xhr.status} ${xhr.statusText}`,
          xhr.status,
          unavailable,
          typeof body.code === "string" ? body.code : undefined
        )
      );
    };
    xhr.onerror = () => reject(new ImagesApiError("Upload failed: network error", 0));
    xhr.onabort = () => reject(new ImagesApiError("Upload cancelled", 0));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(file);
  });
}
