export function normalizeBasePath(value: string | undefined): string {
  const segments = (value ?? "").trim().split("/").filter(Boolean);
  return segments.length > 0 ? `/${segments.join("/")}` : "";
}
