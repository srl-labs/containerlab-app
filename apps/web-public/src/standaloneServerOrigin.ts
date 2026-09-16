// The public sandbox is fully in-browser: all requests are same-origin and
// served by the in-page shim, so the server origin is always the page origin.
export function resolveStandaloneServerOrigin(
  location: Pick<Location, "origin"> = window.location
): string {
  return location.origin;
}

export function standaloneServerUrl(path: string): string {
  return new URL(path, resolveStandaloneServerOrigin()).toString();
}
