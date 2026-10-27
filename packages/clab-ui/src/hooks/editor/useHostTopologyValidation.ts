import React from "react";

import { useClabUiHost } from "../../host";
import { hostSupports, useLabHostStore } from "../../stores/labHostStore";

/** A problem the lab host found in the topology, shown in the source editor. */
export interface HostTopologyDiagnostic {
  message: string;
  /** 1-based line when containerlab names one. */
  line?: number;
}

/** Waits for edits to settle (and the topology file to be written) before asking. */
const VALIDATE_DEBOUNCE_MS = 1500;

/** The line containerlab's error names, e.g. "yaml: line 12: …". */
export function validationErrorLine(message: string): number | undefined {
  const match = /\bline (\d+)\b/i.exec(message);
  const line = match ? Number(match[1]) : Number.NaN;
  return Number.isInteger(line) && line > 0 ? line : undefined;
}

/**
 * On a c9s lab host, `containerlab validate -r c9s` after each edit: what
 * clabernetes cannot run (macvlan endpoints, custom management networks, …)
 * shows in the editor before a deploy. Other hosts validate on request only.
 */
export function useHostTopologyValidation(value: string, enabled: boolean): HostTopologyDiagnostic[] {
  const { topoViewer } = useClabUiHost();
  const operations = topoViewer.labOperations;
  const info = useLabHostStore((state) => state.info);
  const active = enabled && operations !== undefined && info?.profile.runtime === "c9s" && hostSupports(info, "validate");
  const [diagnostics, setDiagnostics] = React.useState<HostTopologyDiagnostic[]>([]);

  React.useEffect(() => {
    if (!active || !operations) {
      setDiagnostics([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      operations.validate().then(
        (result) => {
          if (cancelled) return;
          if (result.valid || !result.error) {
            setDiagnostics([]);
            return;
          }
          const line = validationErrorLine(result.error);
          setDiagnostics([
            { message: `containerlab validate -r c9s: ${result.error}`, ...(line !== undefined ? { line } : {}) }
          ]);
        },
        () => {
          // A host that cannot validate right now leaves the editor as it is.
        }
      );
    }, VALIDATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, operations, value]);

  return diagnostics;
}
