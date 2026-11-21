import { annotationsInputSchema } from "./annotationsInputSchema";

const nodeSettings = {
  type: "object",
  additionalProperties: true,
  properties: {
    kind: { type: "string", description: "Node kind, e.g. nokia_srlinux or linux." },
    image: { type: "string" },
    type: { type: "string", description: "Node type, e.g. ixrd2." },
    group: { type: "string" },
    labels: { type: "object", additionalProperties: { type: "string" } },
  },
} as const;

/**
 * The main fields of a Containerlab document. The tool checks the full
 * Containerlab schema when it runs; this summary keeps the tool list small.
 */
const topologyDocumentSchema = {
  type: "object",
  description:
    "A Containerlab topology document, checked against the full Containerlab schema (the one the YAML editor uses) when the tool runs.",
  required: ["name", "topology"],
  additionalProperties: true,
  properties: {
    name: {
      type: "string",
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9-._]*$",
      description: "Lab name; the file is written as {name}.clab.yml.",
    },
    prefix: { type: "string" },
    mgmt: { type: "object", additionalProperties: true },
    topology: {
      type: "object",
      required: ["nodes"],
      additionalProperties: true,
      properties: {
        defaults: nodeSettings,
        kinds: {
          type: "object",
          description: "Settings per kind, such as the image.",
          additionalProperties: nodeSettings,
        },
        groups: { type: "object", additionalProperties: nodeSettings },
        nodes: {
          type: "object",
          description: "Nodes by name. Names match ^[a-zA-Z0-9][a-zA-Z0-9-._|]*$.",
          additionalProperties: nodeSettings,
        },
        links: {
          type: "array",
          description:
            'Short form: { "endpoints": ["nodeA:eth1", "nodeB:eth1"] }. Extended links (type veth, host, mgmt-net, …) follow the Containerlab schema.',
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              type: { type: "string" },
              endpoints: { type: "array", minItems: 2, maxItems: 2 },
              mtu: { type: "integer", minimum: 1, maximum: 65535 },
            },
          },
        },
      },
    },
  },
} as const;

/** Tool input: a topology document plus optional canvas annotations. */
export const createLabInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["topology"],
  properties: {
    topology: topologyDocumentSchema,
    annotations: annotationsInputSchema,
  },
} as const;
