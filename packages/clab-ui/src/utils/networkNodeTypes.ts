/**
 * Shared helpers for network node classification.
 */
import { BRIDGE_TYPES, SINGLE_ENDPOINT_NETWORK_TYPES } from "../core/types/editors";
import { getRecordUnknown } from "../core/utilities/typeHelpers";

export const SPECIAL_NETWORK_TYPES = new Set<string>(SINGLE_ENDPOINT_NETWORK_TYPES);

export const BRIDGE_NETWORK_TYPES = new Set<string>(BRIDGE_TYPES);

export function getNetworkType(data: Record<string, unknown>): string | undefined {
  const kind = data.kind;
  if (typeof kind === "string") return kind;
  const nodeType = data.nodeType;
  if (typeof nodeType === "string") return nodeType;
  const extraData = getRecordUnknown(data.extraData);
  const extraKind = extraData?.kind;
  if (typeof extraKind === "string") return extraKind;
  return undefined;
}
