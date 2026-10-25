// Types and pure helpers only, so browser code can import them too. The
// implementations are Node-only: "./local" and "./api".
export type * from "./contract/backend.ts";
export type * from "./contract/dto.ts";
export { LabBackendError, errorStatus, isNotFoundError } from "./contract/errors.ts";
export { parseBooleanEnv } from "./env.ts";
