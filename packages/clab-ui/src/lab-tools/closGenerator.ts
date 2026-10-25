// The Clos topology wizard: a draft the form edits, checked and turned into
// the request of `containerlab generate` (clab-api-server `POST /generate`).

import { getKindImageGuidance, isPlaceholderImageReference } from "../image-manager/kindGuidance";

/** One Clos stage: `--nodes <count>:<kind>:<type>`. */
export interface ClosTierDraft {
  count: string;
  kind: string;
  type: string;
}

export interface ClosGeneratorDraft {
  name: string;
  /** Workspace path of the new topology file. */
  fileName: string;
  tiers: ClosTierDraft[];
  /** Image per kind, for the kinds the tiers use. */
  images: Record<string, string>;
  /** License file per kind, on the lab host. */
  licenses: Record<string, string>;
  nodePrefix: string;
  groupPrefix: string;
  managementNetwork: string;
  ipv4Subnet: string;
  ipv6Subnet: string;
}

/** The request hosts pass to `containerlab generate`, shaped like clab-api-server's. */
export interface ClosTopologyRequest {
  name: string;
  tiers: Array<{ count: number; kind?: string; type?: string }>;
  images: Record<string, string>;
  licenses?: Record<string, string>;
  nodePrefix?: string;
  groupPrefix?: string;
  managementNetwork?: string;
  ipv4Subnet?: string;
  ipv6Subnet?: string;
}

/** What the wizard hands its host: where to save the topology, and how to generate it. */
export interface ClosGeneratorResult {
  endpointId?: string;
  fileName: string;
  request: ClosTopologyRequest;
}

type ClosDraftErrors = Partial<
  Record<"name" | "fileName" | "ipv4Subnet" | "ipv6Subnet" | `tier${number}` | `image:${string}`, string>
>;

/** Kinds `containerlab generate` can build, most common first. Others can be typed in. */
export const CLOS_KIND_SUGGESTIONS = [
  "nokia_srlinux",
  "nokia_srsim",
  "nokia_sros",
  "arista_ceos",
  "cisco_xrd",
  "juniper_crpd",
  "juniper_vjunosswitch",
  "juniper_vjunosevolved",
  "nvidia_cumulusvx",
  "sonic-vs",
  "frr",
  "linux"
] as const;

const DEFAULT_KIND = "nokia_srlinux";
const MAX_NODES_PER_TIER = 256;
const LAB_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;
const IPV4_CIDR_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;
const IPV6_CIDR_PATTERN = /^[0-9A-Fa-f:]+\/(\d{1,3})$/;

/** A suggested image for a kind, or "" when the image has to be built or imported first. */
function suggestedClosImage(kind: string): string {
  const recommended = getKindImageGuidance(kind).recommendedImages.at(0) ?? "";
  if (!recommended || isPlaceholderImageReference(recommended)) return "";
  return recommended.includes(":") ? recommended : `${recommended}:latest`;
}

export function defaultClosDraft(directory = ""): ClosGeneratorDraft {
  const name = "clos";
  return {
    name,
    fileName: closFileName(directory, name),
    tiers: [
      { count: "4", kind: DEFAULT_KIND, type: "" },
      { count: "2", kind: DEFAULT_KIND, type: "" }
    ],
    images: { [DEFAULT_KIND]: suggestedClosImage(DEFAULT_KIND) },
    licenses: {},
    nodePrefix: "",
    groupPrefix: "",
    managementNetwork: "",
    ipv4Subnet: "",
    ipv6Subnet: ""
  };
}

/** `<directory>/<name>.clab.yml`, the file name that follows the lab name. */
export function closFileName(directory: string, name: string): string {
  const folder = directory.replace(/\/+$/, "");
  const file = `${name.trim() || "clos"}.clab.yml`;
  return folder ? `${folder}/${file}` : file;
}

function tierKind(tier: ClosTierDraft): string {
  return tier.kind.trim() || DEFAULT_KIND;
}

/** The kinds the tiers use, in tier order. */
export function closDraftKinds(draft: ClosGeneratorDraft): string[] {
  return [...new Set(draft.tiers.map(tierKind))];
}

/** Adds suggested images for kinds that have none yet, e.g. after a tier changed kind. */
export function withSuggestedImages(draft: ClosGeneratorDraft): ClosGeneratorDraft {
  const images = { ...draft.images };
  let changed = false;
  for (const kind of closDraftKinds(draft)) {
    if (images[kind] === undefined) {
      images[kind] = suggestedClosImage(kind);
      changed = true;
    }
  }
  return changed ? { ...draft, images } : draft;
}

function tierCount(tier: ClosTierDraft): number | undefined {
  const count = Number(tier.count.trim());
  return Number.isInteger(count) && count >= 1 && count <= MAX_NODES_PER_TIER ? count : undefined;
}

/** Nodes and links of the fabric: every node links to every node of the next tier. */
export function closDraftSummary(draft: ClosGeneratorDraft): { nodes: number; links: number } {
  const counts = draft.tiers.map((tier) => tierCount(tier) ?? 0);
  let links = 0;
  for (let index = 0; index + 1 < counts.length; index += 1) {
    links += counts[index] * counts[index + 1];
  }
  return { nodes: counts.reduce((sum, count) => sum + count, 0), links };
}

function isValidIpv4Cidr(value: string): boolean {
  const match = IPV4_CIDR_PATTERN.exec(value);
  if (!match) return false;
  const octets = match.slice(1, 5).map(Number);
  return octets.every((octet) => octet <= 255) && Number(match[5]) <= 32;
}

function fileNameError(fileName: string): string | undefined {
  const trimmed = fileName.trim();
  if (!trimmed) return "Enter a file name.";
  if (trimmed.startsWith("/") || trimmed.split("/").some((part) => !part || part === "." || part === "..")) {
    return "Enter a file name or a relative folder path.";
  }
  if (!/\.ya?ml$/i.test(trimmed)) return "Topology files end in .clab.yml.";
  return undefined;
}

export function validateClosDraft(draft: ClosGeneratorDraft): ClosDraftErrors {
  const errors: ClosDraftErrors = {};
  if (!LAB_NAME_PATTERN.test(draft.name.trim())) {
    errors.name = "Use letters, digits, '-' and '_'.";
  }
  const fileError = fileNameError(draft.fileName);
  if (fileError) errors.fileName = fileError;
  draft.tiers.forEach((tier, index) => {
    if (tierCount(tier) === undefined) {
      errors[`tier${index}`] = `Enter 1 to ${MAX_NODES_PER_TIER} nodes.`;
    } else if (/[\s:,]/.test(tier.kind.trim()) || /[\s:,]/.test(tier.type.trim())) {
      errors[`tier${index}`] = "Kind and type cannot contain spaces, ':' or ','.";
    }
  });
  for (const kind of closDraftKinds(draft)) {
    const image = draft.images[kind]?.trim() ?? "";
    if (!image) errors[`image:${kind}`] = "Enter the image for this kind.";
    else if (/[\s,]/.test(image)) errors[`image:${kind}`] = "Images cannot contain spaces or ','.";
  }
  if (draft.ipv4Subnet.trim() && !isValidIpv4Cidr(draft.ipv4Subnet.trim())) {
    errors.ipv4Subnet = "Enter an IPv4 subnet such as 172.20.20.0/24.";
  }
  if (draft.ipv6Subnet.trim() && !IPV6_CIDR_PATTERN.test(draft.ipv6Subnet.trim())) {
    errors.ipv6Subnet = "Enter an IPv6 subnet such as 3fff:172:20:20::/64.";
  }
  return errors;
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** The `containerlab generate` command line of a request, to show what will run. */
export function closGenerateCommand(request: ClosTopologyRequest): string {
  const parts = ["containerlab generate", `--name ${request.name || "<name>"}`];
  const nodes = request.tiers.map((tier) => [tier.count, tier.kind, tier.type].filter(Boolean).join(":"));
  parts.push(`--nodes ${nodes.join(",")}`);
  const perKind = (values: Record<string, string> | undefined) =>
    Object.entries(values ?? {}).map(([kind, value]) => `${kind}=${value}`);
  const images = perKind(request.images);
  if (images.length > 0) parts.push(`--image ${images.join(",")}`);
  const licenses = perKind(request.licenses);
  if (licenses.length > 0) parts.push(`--license ${licenses.join(",")}`);
  const flags: Array<[string, string | undefined]> = [
    ["--node-prefix", request.nodePrefix],
    ["--group-prefix", request.groupPrefix],
    ["--network", request.managementNetwork],
    ["--ipv4-subnet", request.ipv4Subnet],
    ["--ipv6-subnet", request.ipv6Subnet]
  ];
  for (const [flag, value] of flags) {
    if (value !== undefined) parts.push(`${flag} ${value}`);
  }
  return parts.join(" ");
}

/** The generate request of a valid draft; options left empty keep containerlab's defaults. */
export function closDraftToRequest(draft: ClosGeneratorDraft): ClosTopologyRequest {
  const kinds = closDraftKinds(draft);
  const pick = (values: Record<string, string>) =>
    Object.fromEntries(
      kinds.flatMap((kind) => {
        const value = values[kind]?.trim();
        return value ? [[kind, value]] : [];
      })
    );
  const licenses = pick(draft.licenses);
  const request: ClosTopologyRequest = {
    name: draft.name.trim(),
    tiers: draft.tiers.map((tier) => {
      const type = optional(tier.type);
      return { count: tierCount(tier) ?? 1, kind: tierKind(tier), ...(type ? { type } : {}) };
    }),
    images: pick(draft.images)
  };
  if (Object.keys(licenses).length > 0) request.licenses = licenses;
  const extras: Array<[keyof ClosTopologyRequest, string]> = [
    ["nodePrefix", draft.nodePrefix],
    ["groupPrefix", draft.groupPrefix],
    ["managementNetwork", draft.managementNetwork],
    ["ipv4Subnet", draft.ipv4Subnet],
    ["ipv6Subnet", draft.ipv6Subnet]
  ];
  for (const [key, value] of extras) {
    const trimmed = optional(value);
    if (trimmed !== undefined) Object.assign(request, { [key]: trimmed });
  }
  return request;
}
