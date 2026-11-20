/** Shared annotations property for WebMCP create tools. */
export const annotationsInputSchema = {
  type: "object",
  description:
    "Canvas annotations for the topology. Omit to auto-layout nodes when the lab opens.",
  additionalProperties: true,
  properties: {
    nodeAnnotations: {
      type: "array",
      items: {
        type: "object",
        required: ["id"],
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          position: {
            type: "object",
            required: ["x", "y"],
            additionalProperties: false,
            properties: {
              x: { type: "number" },
              y: { type: "number" },
            },
          },
        },
      },
    },
    viewerSettings: { type: "object", additionalProperties: true },
  },
} as const;

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
      description:
        "Clos stages from bottom to top (e.g. leaves then spines). Every node links to every node of the next tier.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["count"],
        properties: {
          count: { type: "integer", minimum: 1, maximum: 256 },
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
      description: "Container image per node kind used in the tiers.",
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
