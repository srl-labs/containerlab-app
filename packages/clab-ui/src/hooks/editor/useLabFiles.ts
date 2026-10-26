// Opening the files a topology refers to (binds, startup configs, licenses) through the host.
import { useCallback, useMemo } from "react";

import { useClabUiHost } from "../../host";
import {
  resolveLabFileReference,
  type LabFileReferenceKind,
  type LabFileRequest,
  type LabFileScope
} from "../../host/labFiles";
import { useTopoViewerStore } from "../../stores/topoViewerStore";
import type { LabFileLinks } from "../../components/monaco/labFileLinks";

/** Opens a lab file through the host; undefined when the host cannot. */
export function useLabFileOpener(): ((request: LabFileRequest) => void) | undefined {
  const { topoViewer } = useClabUiHost();
  const hasOpener = topoViewer.openLabFile !== undefined;
  const open = useCallback(
    (request: LabFileRequest) => {
      topoViewer.openLabFile?.(request);
    },
    [topoViewer]
  );
  return hasOpener ? open : undefined;
}

/** The lab name and variables a topology value expands with. */
export function useLabFileScope(): LabFileScope {
  const labName = useTopoViewerStore((state) => state.labName);
  const variables = useTopoViewerStore((state) => state.topologyVariables);
  return useMemo(() => ({ labName, variables }), [labName, variables]);
}

/**
 * Resolves a value of a node (or of defaults, a kind or a group without
 * `nodeName`) to the lab file it opens; undefined when the host cannot open
 * files.
 */
export function useLabFileResolver():
  | ((value: string, kind: LabFileReferenceKind, nodeName?: string) => LabFileRequest | undefined)
  | undefined {
  const open = useLabFileOpener();
  const scope = useLabFileScope();
  const resolve = useCallback(
    (value: string, kind: LabFileReferenceKind, nodeName?: string) =>
      resolveLabFileReference(value, kind, { ...scope, nodeName }),
    [scope]
  );
  return open ? resolve : undefined;
}

/** Links for the topology YAML editor; undefined when the host cannot open files. */
export function useTopologyFileLinks(): LabFileLinks | undefined {
  const open = useLabFileOpener();
  const resolve = useLabFileResolver();
  return useMemo(
    () =>
      open && resolve
        ? { resolve: (reference) => resolve(reference.value, reference.kind, reference.nodeName), open }
        : undefined,
    [open, resolve]
  );
}
