import { normalizePathValue } from "./standaloneHostShared";

/** `?lab=<endpointId>::<path>&node=<nodeName>`: a lab on one lab host, optionally one of its nodes. */
export interface LabDeepLink {
  endpointId: string;
  path: string;
  node?: string;
}

const LAB_PARAM = "lab";
const NODE_PARAM = "node";
const SEPARATOR = "::";

export function parseLabDeepLink(search: string): LabDeepLink | null {
  const params = new URLSearchParams(search);
  const value = params.get(LAB_PARAM)?.trim() ?? "";
  const separator = value.indexOf(SEPARATOR);
  if (separator <= 0) return null;
  const endpointId = value.slice(0, separator).trim();
  const path = normalizePathValue(value.slice(separator + SEPARATOR.length));
  if (!endpointId || !path) return null;
  const node = params.get(NODE_PARAM)?.trim();
  return { endpointId, path, ...(node ? { node } : {}) };
}

// Slashes, colons and at signs are valid in a query, and keep the link readable.
function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%2F/gi, "/").replace(/%3A/gi, ":").replace(/%40/g, "@");
}

/**
 * The query string with the lab (and node) replaced, every other parameter kept.
 * The node only survives while the link still points at the same lab.
 */
export function withLabDeepLink(search: string, link: LabDeepLink | null): string {
  const params = new URLSearchParams(search);
  const previous = parseLabDeepLink(search);
  const sameLab = previous !== null && link !== null &&
    previous.endpointId === link.endpointId && previous.path === normalizePathValue(link.path);
  const node = link?.node ?? (sameLab ? previous.node : undefined);
  params.delete(LAB_PARAM);
  params.delete(NODE_PARAM);
  const parts = [...params.entries()].map(([key, value]) => `${encodeQueryValue(key)}=${encodeQueryValue(value)}`);
  if (link) {
    parts.push(`${LAB_PARAM}=${encodeQueryValue(`${link.endpointId}${SEPARATOR}${normalizePathValue(link.path)}`)}`);
    if (node) parts.push(`${NODE_PARAM}=${encodeQueryValue(node)}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

type LocationLike = Pick<Location, "origin" | "pathname" | "search" | "hash">;

/** An absolute link to the lab on this page, under whatever base path the app is served from. */
export function labDeepLinkUrl(location: LocationLike, link: LabDeepLink): string {
  return `${location.origin}${location.pathname}${withLabDeepLink(location.search, link)}${location.hash}`;
}

/** Keeps the address bar on the active lab without adding history entries or navigating. */
export function replaceLabDeepLink(link: LabDeepLink | null): void {
  const { pathname, search, hash } = window.location;
  const nextSearch = withLabDeepLink(search, link);
  if (nextSearch === search) return;
  window.history.replaceState(window.history.state, "", `${pathname}${nextSearch}${hash}`);
}
