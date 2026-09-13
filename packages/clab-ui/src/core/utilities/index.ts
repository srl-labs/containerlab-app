/**
 * Shared utilities barrel file
 */

// Node editor conversions
export {
  convertToEditorData,
  convertEditorDataToYaml,
  convertEditorDataToNodeSaveData
} from "./nodeEditorConversions";

// Network editor conversions
export {
  convertToNetworkEditorData,
  convertNetworkEditorDataToYaml
} from "./networkEditorConversions";

// Link types and utilities
export {
  STR_HOST,
  STR_MGMT_NET,
  PREFIX_MACVLAN,
  PREFIX_VXLAN,
  PREFIX_VXLAN_STITCH,
  PREFIX_DUMMY
} from "./LinkTypes";

// Annotation migrations
export { applyInterfacePatternMigrations } from "./annotationMigrations";
