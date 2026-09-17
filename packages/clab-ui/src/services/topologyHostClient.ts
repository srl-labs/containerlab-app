/**
 * TopologyHost client - public helpers around the session client's context and
 * revision state. Re-exported via the session package for external consumers;
 * internal code calls the {@link TopologySessionClient} methods directly.
 */

import type { TopologyUiContext } from "../host";
import type { TopologySessionClient } from "../session/client";

export function setHostContext(
  update: Partial<TopologyUiContext>,
  client: TopologySessionClient
): void {
  client.setContext(update);
}

export function getHostContext(client: TopologySessionClient): TopologyUiContext {
  return client.getContext();
}

export function getHostRevision(client: TopologySessionClient): number {
  return client.getRevision();
}

export function setHostRevision(nextRevision: number, client: TopologySessionClient): void {
  client.setRevision(nextRevision);
}
