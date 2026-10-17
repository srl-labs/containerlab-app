import clabSchema from "../../../schema/clab.schema.json";

import { parseKindSpecificConfig } from "./KindSpecificConfig";
import { parseSchemaData } from "./SchemaParser";

export const containerlabSchema = clabSchema as Record<string, unknown>;
export const defaultSchemaData = parseSchemaData(containerlabSchema);
export const kindSpecificConfig = parseKindSpecificConfig(containerlabSchema);
