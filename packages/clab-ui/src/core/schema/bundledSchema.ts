import clabSchema from "../../../schema/clab.schema.json";

import { parseSchemaData } from "./SchemaParser";

export const containerlabSchema = clabSchema as Record<string, unknown>;
export const defaultSchemaData = parseSchemaData(containerlabSchema);
