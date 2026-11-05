/** Which view the Fabric window shows, kept for a tab that drops its page while hidden. */

export type FabricLensName = "where" | "path" | "service" | "endpoints";

type FabricViewId = "topology" | "nodes" | "incidents" | "history" | "lens" | "report";

export interface FabricRoute {
  view: FabricViewId;
  /** The lens or report. */
  name?: string;
  /** Its arguments; for a report also its filters, as `f.<column>`. */
  query: Record<string, string>;
}

export const DEFAULT_ROUTE: FabricRoute = { view: "topology", query: {} };

const VIEWS: readonly FabricViewId[] = ["topology", "nodes", "incidents", "history", "lens", "report"];

function storageKey(labName: string): string {
  return `clab.fabric.route.${labName}`;
}

function isRoute(value: unknown): value is FabricRoute {
  if (typeof value !== "object" || value === null) return false;
  const { view, name, query } = value as Partial<FabricRoute>;
  if (!VIEWS.some((known) => known === view)) return false;
  if ((view === "lens" || view === "report") && typeof name !== "string") return false;
  return typeof query === "object" && query !== null;
}

/** A route as it was kept, or the default for anything else. */
export function parseRoute(text: string | null): FabricRoute {
  if (!text) return DEFAULT_ROUTE;
  try {
    const value: unknown = JSON.parse(text);
    return isRoute(value) ? value : DEFAULT_ROUTE;
  } catch {
    return DEFAULT_ROUTE;
  }
}

export function loadRoute(labName: string): FabricRoute {
  try {
    return parseRoute(sessionStorage.getItem(storageKey(labName)));
  } catch {
    // Storage can be disabled.
    return DEFAULT_ROUTE;
  }
}

export function saveRoute(labName: string, route: FabricRoute): void {
  try {
    sessionStorage.setItem(storageKey(labName), JSON.stringify(route));
  } catch {
    // Storage can be disabled; the route then lasts as long as the page.
  }
}

export function reportRoute(name: string, query: Record<string, string> = {}): FabricRoute {
  return { view: "report", name, query };
}

export function nodeRoute(node: string): FabricRoute {
  return { view: "topology", query: { node } };
}

/** The report's filters kept in a route: `f.<column>`. */
export function routeFilters(query: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query)
      .filter(([key]) => key.startsWith("f."))
      .map(([key, value]) => [key.slice(2), value])
  );
}
