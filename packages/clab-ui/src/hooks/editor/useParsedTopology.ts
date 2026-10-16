// The topology YAML of the open lab, parsed.
import { useMemo } from "react";
import * as YAML from "yaml";

import { useTopoViewerStore } from "../../stores/topoViewerStore";
import type { ClabTopology } from "../../core/types/topology";
import { isRecord } from "../../core/utilities/typeHelpers";

/** Parsed topology of the open lab; null while the YAML is empty or invalid. */
export function useParsedTopology(): ClabTopology | null {
  const yamlContent = useTopoViewerStore((state) => state.yamlContent);
  return useMemo(() => {
    if (yamlContent.trim() === "") return null;
    try {
      const parsed: unknown = YAML.parse(yamlContent);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }, [yamlContent]);
}
