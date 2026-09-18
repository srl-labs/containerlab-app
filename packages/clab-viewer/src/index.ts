import { mountViewer as mountSharedViewer } from "../../clab-ui/src/viewer/mountViewer";
import type { MountViewerOptions, ViewerHandle } from "../../clab-ui/src/viewer/publicTypes";

export type { MountViewerOptions, ViewerHandle, ViewerNodeInfo, ViewerOptions } from "../../clab-ui/src/viewer/publicTypes";

/** Mount one read-only canvas. Use the HTML component for multiple isolated diagrams. */
export function mountViewer(container: Element, options: MountViewerOptions): ViewerHandle {
  const root = mountSharedViewer(container, options);
  return { unmount: () => root.unmount() };
}
