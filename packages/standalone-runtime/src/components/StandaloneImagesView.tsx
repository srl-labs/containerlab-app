import { lazy, Suspense } from "react";

import {
  createImagesJobsWatcher,
  type ImagesClient,
  type ImagesJobsWatcher,
  type ImagesUnavailableInfo
} from "@containerlab/clab-ui/workspace/overview";
import {
  addImagesTemplate,
  cancelImagesJob,
  fetchImagesIndex,
  fetchImagesJobs,
  fetchImagesStatus,
  fetchImagesTemplates,
  refreshImagesIndex,
  removeImagesTemplate,
  scanImageFiles,
  searchImages,
  showImage,
  startImagesJob,
  syncImagesTemplates,
  uploadImageFile
} from "../runtimeImagesApi";
import { useEndpointStore } from "../stores/endpointStore";

const ImagesView = lazy(async () => ({
  default: (await import("@containerlab/clab-ui/workspace/overview")).ImagesView
}));

/** The Images routes of one endpoint, as the shared view calls them. */
function imagesClientFor(endpointId: string): ImagesClient {
  return {
    status: () => fetchImagesStatus(endpointId),
    index: () => fetchImagesIndex(endpointId),
    refreshIndex: () => refreshImagesIndex(endpointId),
    search: (query, signal) => searchImages(query, endpointId, signal),
    show: (ref) => showImage(ref, endpointId),
    scan: () => scanImageFiles(endpointId),
    templates: () => fetchImagesTemplates(endpointId),
    addTemplate: (ref) => addImagesTemplate(ref, endpointId),
    removeTemplate: (name) => removeImagesTemplate(name, endpointId),
    syncTemplates: (dryRun) => syncImagesTemplates(dryRun, endpointId),
    startJob: (job) => startImagesJob(job, endpointId),
    jobs: () => fetchImagesJobs(endpointId),
    cancelJob: (id) => cancelImagesJob(id, endpointId),
    upload: (file, { onProgress, signal }) => uploadImageFile(file, { endpointId, onProgress, signal })
  };
}

/** Kept per endpoint so job polling outlives the view. */
const sessions = new Map<string, { client: ImagesClient; jobs: ImagesJobsWatcher }>();
let templatesChanged: (() => void) | undefined;

function sessionFor(endpointId: string) {
  let session = sessions.get(endpointId);
  if (!session) {
    const client = imagesClientFor(endpointId);
    session = { client, jobs: createImagesJobsWatcher(client, { onJobEnded: () => templatesChanged?.() }) };
    sessions.set(endpointId, session);
  }
  return session;
}

/** Image management needs a local lab host: the first local endpoint is the one managed. */
export function StandaloneImagesView({ onTemplatesChanged, onClose }: {
  onTemplatesChanged?: () => void;
  onClose?: () => void;
}) {
  templatesChanged = onTemplatesChanged;
  const endpoints = useEndpointStore((state) => state.endpoints);
  const local = [...endpoints.values()].find((endpoint) => endpoint.kind === "local");
  const connected = local?.status === "connected" ? local : undefined;
  const session = connected ? sessionFor(connected.id) : undefined;
  let unavailable: ImagesUnavailableInfo | undefined;
  if (!connected) {
    unavailable = {
      reason: "unavailable",
      detail: local
        ? `Sign in to ${local.label} to manage its images.`
        : "The Images view is not available for this lab host: it needs this computer (a local lab host)."
    };
  }
  return (
    <Suspense fallback={null}>
      <ImagesView
        client={session?.client}
        jobs={session?.jobs}
        endpointLabel={connected?.label ?? local?.label}
        unavailable={unavailable}
        onTemplatesChanged={onTemplatesChanged}
        onClose={onClose}
      />
    </Suspense>
  );
}
