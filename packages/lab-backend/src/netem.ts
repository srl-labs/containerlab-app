const NETEM_FIELDS = ["delay", "jitter", "loss", "rate", "corruption"] as const;

/**
 * True when link impairments set every value to zero or leave it empty: the
 * user cleared them, and hosts reset netem instead of setting zeros.
 */
export function isNetemCleared(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  const values = data as Record<string, unknown>;
  return NETEM_FIELDS.every((field) => {
    const value = values[field];
    if (value === undefined || value === null) return true;
    if (typeof value !== "string" && typeof value !== "number") return false;
    const text = String(value).trim().replace(/(ms|s|%)$/i, "").trim();
    return text === "" || Number(text) === 0;
  });
}
