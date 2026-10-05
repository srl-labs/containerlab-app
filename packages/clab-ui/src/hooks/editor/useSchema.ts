/**
 * useSchema - Hook to access containerlab schema data for kind/type options
 *
 * Hosts can override bundled schema data through the host editor data.
 */
import { useState, useMemo, useCallback } from "react";

import { defaultSchemaData, type SchemaData as HostSchemaData } from "../../core/schema";
import { useClabUiHost } from "../../host";
import { log } from "../../utils/logger";

/**
 * SROS component types for nokia_srsim nodes
 */
export interface SrosComponentTypes {
  sfm: string[];
  cpm: string[];
  card: string[];
  mda: string[];
  xiom: string[];
  xiomMda: string[];
}

const EMPTY_SROS_TYPES: SrosComponentTypes = {
  sfm: [],
  cpm: [],
  card: [],
  mda: [],
  xiom: [],
  xiomMda: []
};

interface SchemaData {
  kinds: string[];
  typesByKind: Map<string, string[]>;
  kindsWithTypeSupport: Set<string>;
  srosComponentTypes: SrosComponentTypes;
  isLoaded: boolean;
  error: string | null;
}

interface UseSchemaResult extends SchemaData {
  getTypesForKind: (kind: string) => string[];
  kindSupportsType: (kind: string) => boolean;
}

/**
 * Load host-provided schema data or fall back to the bundled containerlab schema.
 * Schema data is synchronously available from the host, so this runs as a
 * lazy state initializer.
 */
function buildSchemaData(hostSchema: HostSchemaData | undefined): SchemaData {
  const data = hostSchema ?? defaultSchemaData;

  const kinds = Array.isArray(data.kinds) ? data.kinds : [];
  const typesByKind = new Map<string, string[]>();
  const kindsWithTypeSupport = new Set<string>();

  // Convert Record to Map and build kindsWithTypeSupport set
  for (const [kind, types] of Object.entries(data.typesByKind ?? {})) {
    if (Array.isArray(types)) {
      typesByKind.set(kind, types);
      kindsWithTypeSupport.add(kind);
    }
  }

  // Get SROS component types
  const srosComponentTypes = data.srosComponentTypes ?? EMPTY_SROS_TYPES;

  log.info(
    `Schema loaded: ${kinds.length} kinds, ${typesByKind.size} kinds with type options, SROS types: sfm=${srosComponentTypes.sfm.length}, cpm=${srosComponentTypes.cpm.length}, card=${srosComponentTypes.card.length}, mda=${srosComponentTypes.mda.length}`
  );

  return {
    kinds,
    typesByKind,
    kindsWithTypeSupport,
    srosComponentTypes,
    isLoaded: true,
    error: null
  };
}

/**
 * Hook to access containerlab schema data
 */
export function useSchema(): UseSchemaResult {
  // Initialize synchronously (lazy initializer) instead of via a mount effect;
  // this avoids a wasted first render where isLoaded is false and consumers
  // flash a loading state.
  const host = useClabUiHost();
  const [schemaData] = useState<SchemaData>(() => buildSchemaData(host.editorData?.getSchema()));

  // Get types for a specific kind
  const getTypesForKind = useCallback(
    (kind: string): string[] => {
      return schemaData.typesByKind.get(kind) ?? [];
    },
    [schemaData.typesByKind]
  );

  // Check if a kind supports type field
  const kindSupportsType = useCallback(
    (kind: string): boolean => {
      return schemaData.kindsWithTypeSupport.has(kind);
    },
    [schemaData.kindsWithTypeSupport]
  );

  return useMemo(
    () => ({
      ...schemaData,
      getTypesForKind,
      kindSupportsType
    }),
    [schemaData, getTypesForKind, kindSupportsType]
  );
}
