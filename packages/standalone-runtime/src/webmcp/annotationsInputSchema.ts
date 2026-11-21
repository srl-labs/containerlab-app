import Ajv from "ajv";

const position = {
  type: "object",
  required: ["x", "y"],
  additionalProperties: false,
  properties: {
    x: { type: "number" },
    y: { type: "number" },
  },
} as const;

function objectList(
  description: string,
  required: string[],
  properties: Record<string, unknown>,
) {
  return {
    type: "array",
    description,
    items: { type: "object", required, additionalProperties: true, properties },
  } as const;
}

/** A list of placed canvas items; each entry needs an `id`. */
function placedList(description: string, extra: Record<string, unknown> = {}) {
  return objectList(description, ["id"], {
    id: { type: "string", minLength: 1 },
    position,
    ...extra,
  });
}

/** Shared annotations property for WebMCP create tools. */
export const annotationsInputSchema = {
  type: "object",
  description:
    "Canvas annotations for the topology. Omit to auto-layout nodes when the lab opens.",
  additionalProperties: true,
  properties: {
    nodeAnnotations: placedList("Node layout. `id` is the node name in the topology.", {
      icon: { type: "string" },
    }),
    freeTextAnnotations: placedList("Text on the canvas.", { text: { type: "string" } }),
    freeShapeAnnotations: placedList("Shapes on the canvas."),
    groupStyleAnnotations: placedList("Group boxes on the canvas."),
    networkNodeAnnotations: placedList("Network endpoints such as host or mgmt-net."),
    trafficRateAnnotations: placedList("Traffic rate labels."),
    scriptButtonAnnotations: placedList("Script buttons."),
    edgeAnnotations: objectList("Per-link display settings.", [], {}),
    aliasEndpointAnnotations: objectList(
      "Alias endpoints.",
      ["yamlNodeId", "interface", "aliasNodeId"],
      {
        yamlNodeId: { type: "string" },
        interface: { type: "string" },
        aliasNodeId: { type: "string" },
      },
    ),
    viewerSettings: { type: "object", additionalProperties: true },
  },
} as const;

let validate: ReturnType<Ajv["compile"]> | undefined;

/** Check annotations before they are written; returns error messages. */
export function validateAnnotations(value: unknown): string[] {
  validate ??= new Ajv({ allErrors: true, strict: false }).compile(annotationsInputSchema);
  if (validate(value) === true) {
    return [];
  }
  return (validate.errors ?? []).map(
    (error) => `annotations${error.instancePath}: ${error.message ?? "is invalid"}`,
  );
}
