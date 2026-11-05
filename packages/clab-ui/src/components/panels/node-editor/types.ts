/**
 * Type definitions for node editor
 *
 * NOTE: Core types are now defined in shared/types/editors.ts
 * Types are exported via the index.ts file for backward compatibility.
 */

import type {
  HealthCheckConfig as _HealthCheckConfig,
  SrosComponent as _SrosComponent,
  NodeEditorData as _NodeEditorData
} from "../../../core/types/editors";
import type { NodeInheritance } from "../../../core/utilities/nodeInheritance";

// Re-export types
export type HealthCheckConfig = _HealthCheckConfig;
export type SrosComponent = _SrosComponent;
export type NodeEditorData = _NodeEditorData;

/**
 * Props for tab components
 */
export interface TabProps {
  data: NodeEditorData;
  onChange: (updates: Partial<NodeEditorData>) => void;
  /** Show a change on the canvas without editing the form, e.g. while a slider is dragged */
  onPreview?: (updates: Partial<NodeEditorData>) => void;
  /** Array of property names that are inherited from defaults/kinds/groups */
  inheritedProps?: string[];
  /** What the node inherits from defaults, its kind and its group */
  inheritance?: NodeInheritance;
  /** The lab is locked: the form only shows values */
  readOnly?: boolean;
}
