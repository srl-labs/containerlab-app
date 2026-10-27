import { effectiveSupport } from "@containerlab/clab-ui/host";

import type { LabBackend, LabHostInfo } from "./backend.ts";

export { containerRuntimeFeatures, effectiveSupport } from "@containerlab/clab-ui/host";

/** A lab host's runtime and what it offers, as hosts hand it to the UI. */
export async function describeLabHost(
  backend: Pick<LabBackend, "capabilities" | "features" | "hostProfile">
): Promise<LabHostInfo> {
  const [profile, features] = await Promise.all([backend.hostProfile(), backend.features()]);
  return { profile, support: effectiveSupport(backend.capabilities, features) };
}
