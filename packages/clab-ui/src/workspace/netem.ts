import type { NetemFields } from "./types";
export function normalizeNetemFields(value: unknown): NetemFields {
  if (typeof value !== "object" || value === null) {
    return { delay: "", jitter: "", loss: "", rate: "", corruption: "" };
  }
  const fields = value as Record<string, unknown>;
  return {
    delay: typeof fields.delay === "string" ? fields.delay : "",
    jitter: typeof fields.jitter === "string" ? fields.jitter : "",
    loss: typeof fields.loss === "string" ? fields.loss : "",
    rate: typeof fields.rate === "string" ? fields.rate : "",
    corruption: typeof fields.corruption === "string" ? fields.corruption : ""
  };
}
