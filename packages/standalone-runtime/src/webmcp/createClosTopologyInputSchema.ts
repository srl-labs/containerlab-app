import { annotationsInputSchema } from "./annotationsInputSchema";

/** Most nodes in one tier. */
export const MAX_TIER_NODES = 256;
/** Most nodes and links in one generated fabric, to keep the sandbox responsive. */
export const MAX_CLOS_NODES = 1024;
export const MAX_CLOS_LINKS = 4096;

/** Tool input shaped like the Clos generator / `containerlab generate` request. */
export const createClosTopologyInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "tiers", "images"],
  properties: {
    name: {
      type: "string",
      description: "Lab name; also used as the .clab.yml file name.",
      pattern: "^[A-Za-z0-9_-]+$",
    },
    tiers: {
      type: "array",
      minItems: 1,
      description: `Clos stages from bottom to top (e.g. leaves then spines). Every node links to every node of the next tier. At most ${MAX_CLOS_NODES} nodes and ${MAX_CLOS_LINKS} links in total.`,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["count"],
        properties: {
          count: { type: "integer", minimum: 1, maximum: MAX_TIER_NODES },
          kind: {
            type: "string",
            description: "Node kind. Defaults to nokia_srlinux when omitted.",
          },
          type: { type: "string", description: "Optional node type (e.g. ixrd2)." },
        },
      },
    },
    images: {
      type: "object",
      description:
        "Container image per node kind. Every kind used in the tiers needs one, including the default nokia_srlinux.",
      additionalProperties: { type: "string", minLength: 1 },
      minProperties: 1,
    },
    licenses: {
      type: "object",
      description: "Optional license file path per kind, on the lab host.",
      additionalProperties: { type: "string" },
    },
    nodePrefix: { type: "string", description: "Node name prefix. Default: node." },
    groupPrefix: { type: "string", description: "Group name prefix. Default: tier." },
    managementNetwork: { type: "string" },
    ipv4Subnet: { type: "string", description: "e.g. 172.20.20.0/24" },
    ipv6Subnet: { type: "string", description: "e.g. 3fff:172:20:20::/64" },
    annotations: annotationsInputSchema,
  },
} as const;
