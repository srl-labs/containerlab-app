/**
 * Node type containerlab picks for a kind when `type` is omitted.
 * New nodes of these kinds get the type written explicitly so that editors
 * which depend on it (e.g. the SR OS components tab) show the right chassis.
 */
const DEFAULT_NODE_TYPES: Record<string, string> = {
  nokia_srlinux: "ixr-d2l",
  nokia_srsim: "SR-1",
  nokia_sros: "sr-1"
};

export function getDefaultNodeType(kind: string): string | undefined {
  return Object.hasOwn(DEFAULT_NODE_TYPES, kind) ? DEFAULT_NODE_TYPES[kind] : undefined;
}
