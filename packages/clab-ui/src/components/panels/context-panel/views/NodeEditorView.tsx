// Node editor content for the ContextPanel.
import React, { useCallback, useEffect, useMemo, useRef } from "react";

import { EditorPanel } from "../../../ui/editor/EditorPanel";
import type { TabConfig } from "../../../ui/editor/EditorPanel";
import { useApplySaveHandlers, useFooterControlsRef } from "../../../../hooks/ui";
import { useNodeEditorForm, hasFieldChanged } from "../../../../hooks/editor/useNodeEditorForm";
import { useClabUiRuntime } from "../../../../host";
import type {
  NodeEditorData,
  TabProps as NodeEditorTabProps
} from "../../node-editor/types";
import { BasicTab } from "../../node-editor/BasicTab";
import { ComponentsTab } from "../../node-editor/ComponentsTab";
import { ConfigTab } from "../../node-editor/ConfigTab";
import { RuntimeTab } from "../../node-editor/RuntimeTab";
import { NetworkTab } from "../../node-editor/NetworkTab";
import { AdvancedTab } from "../../node-editor/AdvancedTab";
import type { ClabTopology } from "../../../../core/types/topology";
import {
  computeNodeInheritance,
  rebaseInheritedValues
} from "../../../../core/utilities/nodeInheritance";

export interface NodeEditorViewProps {
  nodeData: NodeEditorData | null;
  onSave: (data: NodeEditorData) => void;
  onApply: (data: NodeEditorData) => void;
  onPreview?: (data: NodeEditorData) => void;
  inheritedProps?: string[];
  /** Topology the node belongs to, for showing what it inherits from defaults, kinds and groups */
  inheritanceTopology?: ClabTopology | null;
  /** Disable editing, but keep scrolling and tab navigation available */
  readOnly?: boolean;
  /** Exposed for ContextPanel footer */
  onFooterRef?: (ref: NodeEditorFooterRef | null) => void;
}

export interface NodeEditorFooterRef {
  handleApply: () => void;
  handleSave: () => void;
  handleDiscard: () => void;
  hasChanges: boolean;
}

const BASE_TABS: Array<TabConfig<NodeEditorTabProps>> = [
  { id: "basic", label: "Basic", component: BasicTab },
  { id: "config", label: "Configuration", component: ConfigTab },
  { id: "runtime", label: "Runtime", component: RuntimeTab },
  { id: "network", label: "Network", component: NetworkTab },
  { id: "advanced", label: "Advanced", component: AdvancedTab }
];

const COMPONENTS_TAB: TabConfig<NodeEditorTabProps> = {
  id: "components",
  label: "Components",
  component: ComponentsTab
};

function getTabsForNode(kind: string | undefined): Array<TabConfig<NodeEditorTabProps>> {
  if (kind === "nokia_srsim") {
    return [BASE_TABS[0], COMPONENTS_TAB, ...BASE_TABS.slice(1)];
  }
  return BASE_TABS;
}

function mergeNodeEditorTabs(
  baseTabs: Array<TabConfig<NodeEditorTabProps>>,
  extensionTabs: Array<TabConfig<NodeEditorTabProps>>
): Array<TabConfig<NodeEditorTabProps>> {
  const tabs = [...baseTabs];
  const tabIndexById = new Map(tabs.map((tab, index) => [tab.id, index]));

  for (const tab of extensionTabs) {
    const existingIndex = tabIndexById.get(tab.id);
    if (existingIndex === undefined) {
      tabIndexById.set(tab.id, tabs.length);
      tabs.push(tab);
    } else {
      tabs[existingIndex] = tab;
    }
  }
  return tabs;
}

export const NodeEditorView: React.FC<NodeEditorViewProps> = ({
  nodeData,
  onSave,
  onApply,
  onPreview,
  inheritedProps = [],
  inheritanceTopology,
  readOnly = false,
  onFooterRef
}) => {
  const { nodeEditorTabs = [] } = useClabUiRuntime();
  const {
    activeTab,
    setActiveTab,
    formData,
    handleChange,
    hasChanges,
    resetAfterApply,
    discardChanges,
    originalData
  } = useNodeEditorForm(nodeData, readOnly);

  const tabs = useMemo(
    () => mergeNodeEditorTabs(getTabsForNode(formData?.kind), nodeEditorTabs),
    [formData?.kind, nodeEditorTabs]
  );

  const formKind = formData?.kind;
  const formGroup = formData?.group;
  const inheritance = useMemo(
    () =>
      inheritanceTopology
        ? computeNodeInheritance(inheritanceTopology, formKind, formGroup)
        : undefined,
    [inheritanceTopology, formKind, formGroup]
  );

  // Read through refs so the change handler stays stable while the form changes.
  const formDataRef = useRef(formData);
  formDataRef.current = formData;
  const inheritanceRef = useRef(inheritance);
  inheritanceRef.current = inheritance;

  // A new kind or group brings other inherited values; swap the ones the node took from the old.
  const handleChangeWithInheritance = useCallback(
    (updates: Partial<NodeEditorData>) => {
      const formData = formDataRef.current;
      const inheritance = inheritanceRef.current;
      if (!inheritanceTopology || !formData || !inheritance) {
        handleChange(updates);
        return;
      }
      const kindChanged = "kind" in updates && updates.kind !== formData.kind;
      const groupChanged = "group" in updates && updates.group !== formData.group;
      if (!kindChanged && !groupChanged) {
        handleChange(updates);
        return;
      }
      const next = { ...formData, ...updates };
      const after = computeNodeInheritance(inheritanceTopology, next.kind, next.group);
      handleChange({ ...updates, ...rebaseInheritedValues(next, inheritance.values, after.values) });
    },
    [handleChange, inheritanceTopology]
  );

  const effectiveInheritedProps = useMemo(() => {
    if (!formData || !originalData) return inheritedProps;
    return inheritedProps.filter((prop) => !hasFieldChanged(prop, formData, originalData));
  }, [inheritedProps, formData, originalData]);

  const { handleApply, handleSave } = useApplySaveHandlers(
    formData,
    onApply,
    onSave,
    resetAfterApply
  );

  useEffect(() => {
    if (!formData || readOnly || !onPreview) return;
    onPreview(formData);
  }, [formData, readOnly, onPreview]);

  const previewChange = useCallback(
    (updates: Partial<NodeEditorData>) => {
      if (!formData || readOnly || !onPreview) return;
      onPreview({ ...formData, ...updates });
    },
    [formData, readOnly, onPreview]
  );

  useEffect(() => {
    if (tabs.some((tab) => tab.hidden !== true && tab.id === activeTab)) {
      return;
    }
    setActiveTab(tabs.find((tab) => tab.hidden !== true)?.id ?? "basic");
  }, [activeTab, setActiveTab, tabs]);

  useFooterControlsRef(
    onFooterRef,
    Boolean(formData),
    handleApply,
    handleSave,
    hasChanges,
    discardChanges
  );

  if (!formData) return null;

  const tabProps = {
    data: formData,
    onChange: handleChangeWithInheritance,
    onPreview: previewChange,
    inheritedProps: effectiveInheritedProps,
    inheritance
  };

  return (
    <EditorPanel
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      tabProps={tabProps}
      readOnly={readOnly}
    />
  );
};
