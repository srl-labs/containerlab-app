// Group editor for the ContextPanel.
import React, { useCallback } from "react";
import Box from "@mui/material/Box";

import type { GroupStyleAnnotation } from "../../../../core/types/topology";
import type { GroupEditorData } from "../../../../hooks/canvas";
import { useGenericFormState } from "../../../../hooks/editor";
import { FIELDSET_RESET_STYLE } from "../ContextPanelScrollArea";
import { GroupFormContent } from "../../group-editor/GroupFormContent";

import { useAnnotationLiveApply } from "./useAnnotationLiveApply";

export interface GroupEditorViewProps {
  groupData: GroupEditorData | null;
  /** Live apply: update the canvas immediately, persistence is debounced downstream. */
  onApply: (data: GroupEditorData) => void;
  /** Disable editing, but keep scrolling available */
  readOnly?: boolean;
}

function cloneGroupData(data: GroupEditorData): GroupEditorData {
  return { ...data, style: { ...data.style } };
}

export const GroupEditorView: React.FC<GroupEditorViewProps> = ({
  groupData,
  onApply,
  readOnly = false
}) => {
  const { formData, updateField, setFormData, formSource } = useGenericFormState(groupData, {
    transformData: cloneGroupData
  });

  useAnnotationLiveApply({
    annotation: groupData,
    formData,
    formSource,
    readOnly,
    onApply,
    snapshot: cloneGroupData
  });

  const updateStyle = useCallback(
    <K extends keyof GroupStyleAnnotation>(field: K, value: GroupStyleAnnotation[K]) => {
      if (readOnly) return;
      setFormData((prev) =>
        prev ? { ...prev, style: { ...prev.style, [field]: value } } : null
      );
    },
    [setFormData, readOnly]
  );

  const effectiveUpdateField: typeof updateField = readOnly ? () => {} : updateField;

  if (!formData) return null;

  return (
    <Box sx={{ flex: 1, overflow: "auto" }}>
      <fieldset disabled={readOnly} style={FIELDSET_RESET_STYLE}>
        <GroupFormContent
          formData={formData}
          updateField={effectiveUpdateField}
          updateStyle={updateStyle}
        />
      </fieldset>
    </Box>
  );
};
