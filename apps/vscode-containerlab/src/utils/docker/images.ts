import * as vscode from "vscode";

import { dockerClient, outputChannel } from "../../globals";
import { backendFor, getConnections } from "../../backend/labBackends";
import { LOCAL_CONNECTION, type LabConnection } from "../../backend/connections";

/** Image references by connection: the images on this machine and on each lab host. */
const dockerImagesCache = new Map<string, string[]>();

const dockerImagesEmitter = new vscode.EventEmitter<{ connectionId: string; images: string[] }>();

export const onDockerImagesUpdated = dockerImagesEmitter.event;

/** The images a connection's runtime has, for completions; this machine's by default. */
export function getDockerImages(connectionId: string = LOCAL_CONNECTION.id): string[] {
  return [...(dockerImagesCache.get(connectionId) ?? [])];
}

export interface DockerImageSummary {
  id: string;
  shortId?: string;
  repoTags: string[];
  repoDigests: string[];
  created?: number;
  size?: number;
  virtualSize?: number;
}

function validDockerReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.endsWith(":<none>") &&
    !value.startsWith("<none>") &&
    !value.includes("<none>@")
  );
}

function toNumber(value: number | string | undefined): number | undefined {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}

/** Images on a lab host. */
async function listRemoteImageSummaries(connection: LabConnection): Promise<DockerImageSummary[]> {
  const { images } = await backendFor(connection).listImages();
  return images
    .map((image) => ({
      id: image.id,
      shortId: image.shortId ?? image.id.replace(/^sha256:/, "").slice(0, 12),
      repoTags: image.repoTags.filter(validDockerReference),
      repoDigests: image.repoDigests.filter(validDockerReference),
      created: image.created,
      size: toNumber(image.size),
      virtualSize: toNumber(image.virtualSize)
    }))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

export async function listDockerImageSummaries(
  connection: LabConnection = LOCAL_CONNECTION
): Promise<DockerImageSummary[]> {
  if (connection.kind === "api") {
    return listRemoteImageSummaries(connection);
  }
  const images = await dockerClient.listImages({ all: true });
  return images
    .map((img) => {
      const id = typeof img.Id === "string" ? img.Id : "";
      const shortId = id.replace(/^sha256:/, "").slice(0, 12);
      return {
        id,
        shortId,
        repoTags: (Array.isArray(img.RepoTags) ? img.RepoTags : []).filter(validDockerReference),
        repoDigests: (Array.isArray(img.RepoDigests) ? img.RepoDigests : []).filter(
          validDockerReference
        ),
        created: typeof img.Created === "number" ? img.Created : undefined,
        size: typeof img.Size === "number" ? img.Size : undefined,
        virtualSize: typeof img.VirtualSize === "number" ? img.VirtualSize : undefined
      };
    })
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
}

// Internal func to fetch all docker images
async function fetchDockerImages(connection: LabConnection): Promise<string[]> {
  const images = await listDockerImageSummaries(connection);
  type TagEntry = { tag: string; created: number };
  const entries: TagEntry[] = [];
  const seen = new Set<string>();

  for (const img of images) {
    for (const tag of img.repoTags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        entries.push({ tag, created: img.created ?? 0 });
      }
    }
  }

  entries.sort((a, b) => b.created - a.created || a.tag.localeCompare(b.tag));
  return entries.map((entry) => entry.tag);
}

function updateDockerImagesCache(connectionId: string, images: string[]) {
  const current = dockerImagesCache.get(connectionId) ?? [];
  const changed =
    images.length !== current.length || images.some((img, idx) => current[idx] !== img);
  if (!changed) {
    return;
  }
  dockerImagesCache.set(connectionId, images);
  // fire an event to whom is listenting that the cache updated.
  dockerImagesEmitter.fire({ connectionId, images: [...images] });
}

/**
 * Refreshes the image list of a connection, or of every connection that is
 * shown and signed in.
 */
export async function refreshDockerImages(connection?: LabConnection) {
  outputChannel.debug("Refreshing docker image cache.");
  const manager = getConnections();
  const connections = connection
    ? [connection]
    : (manager?.list() ?? [LOCAL_CONNECTION]).filter(
        (entry) => entry.kind === "local" || manager?.status(entry) === "connected"
      );
  await Promise.all(
    connections.map(async (entry) => {
      try {
        updateDockerImagesCache(entry.id, await fetchDockerImages(entry));
      } catch {
        // Leave existing cache untouched.
      }
    })
  );
}

export async function removeDockerImage(
  reference: string,
  force = false,
  connection: LabConnection = LOCAL_CONNECTION
): Promise<void> {
  if (connection.kind === "api") {
    const result = await backendFor(connection).removeImage(reference, force);
    if (!result.success) throw new Error(result.message ?? `Removing ${reference} failed`);
  } else {
    await dockerClient.getImage(reference).remove({ force });
  }
  await refreshDockerImages(connection);
}

// Create disposable handle to let the image monitor get cleaned up by VSC.
let monitorHandle: vscode.Disposable | undefined;

export function startDockerImageEventMonitor(context: vscode.ExtensionContext) {
  if (monitorHandle !== undefined) {
    return;
  }

  // Start a 'docker events' but only for image events.
  dockerClient
    .getEvents({ filters: { type: ["image"] } })
    .then((stream) => {
      const onData = () => {
        // upon any event, the cache should be updated.
        void refreshDockerImages();
      };

      const onError = (err: Error) => {
        outputChannel.error(`Docker images event stream error: ${err.message}`);
      };

      stream.on("data", onData);
      stream.on("error", onError);

      // Ensure we check if the monitor handle needs to dispose us.
      monitorHandle = {
        dispose: () => {
          stream.off("data", onData);
          stream.off("error", onError);
          stream.removeAllListeners();
          monitorHandle = undefined;
        }
      };
      context.subscriptions.push(monitorHandle);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      outputChannel.warn(`Unable to subscribe to Docker image events: ${message}`);
    });
}
