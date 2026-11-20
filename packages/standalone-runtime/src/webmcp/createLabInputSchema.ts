import { containerlabSchema } from "@containerlab/clab-ui/session";

import { annotationsInputSchema } from "./createClosTopologyInputSchema";

/** Nested copy of the Containerlab schema without root identity keywords. */
function topologyDocumentSchema(): Record<string, unknown> {
  const { $id: _id, $schema: _schema, ...rest } = containerlabSchema as Record<
    string,
    unknown
  >;
  return rest;
}

/** Tool input: a topology document plus optional canvas annotations. */
export const createLabInputSchema = {
  type: "object",
  additionalProperties: false,
  required: ["topology"],
  properties: {
    topology: topologyDocumentSchema(),
    annotations: annotationsInputSchema,
  },
} as const;
