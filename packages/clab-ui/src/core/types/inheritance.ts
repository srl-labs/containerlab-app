/**
 * Sections nodes inherit settings from: `topology.defaults`,
 * `topology.kinds` and `topology.groups`.
 */
import type { InheritanceLevel } from "../parsing/NodeConfigResolver";

/** One edit of a defaults, kind or group section. */
export interface InheritanceSectionUpdate {
  level: InheritanceLevel;
  /** Kind or group name; unused for defaults */
  name?: string;
  /** New group name; nodes, kinds and defaults that use the group follow it */
  rename?: string;
  /** YAML keys to write; null removes a key. Other keys stay as they are. */
  changes?: Record<string, unknown>;
  /** Removes the kind or group section. Nodes keep their `group` key. */
  remove?: boolean;
}
