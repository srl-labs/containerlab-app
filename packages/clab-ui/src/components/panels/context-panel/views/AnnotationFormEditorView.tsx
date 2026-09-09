// Generic annotation editor view shared by the text and shape annotation editors.
// Edits live-apply to the canvas and persist debounced — there is no Apply button.
import React from "react";
import Box from "@mui/material/Box";

import { useGenericFormState } from "../../../../hooks/editor";
import { FIELDSET_RESET_STYLE } from "../ContextPanelScrollArea";

import { useAnnotationLiveApply } from "./useAnnotationLiveApply";

/** External props shared by all annotation form editor views. */
export interface AnnotationEditorViewProps<T extends { id: string }> {
  annotation: T | null;
  /** Live apply: update the canvas immediately, persistence is debounced downstream. */
  onApply: (annotation: T) => void;
  /** Disable editing, but keep scrolling available */
  readOnly?: boolean;
}

interface AnnotationFormContentProps<T> {
  formData: T;
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
}

interface AnnotationFormEditorViewProps<T extends { id: string }>
  extends AnnotationEditorViewProps<T> {
  /** Form body rendered inside the read-only-aware fieldset */
  FormContent: React.ComponentType<AnnotationFormContentProps<T>>;
  /** Snapshot used for change detection (clone or normalize). Must be referentially stable. */
  snapshot: (annotation: T) => T;
  /** Validation gate: invalid states are not applied. Must be referentially stable. */
  canApply?: (data: T) => boolean;
  /** Transform data before populating the form. Must be referentially stable. */
  transformData?: (data: T) => T;
}

export function AnnotationFormEditorView<T extends { id: string }>({
  annotation,
  onApply,
  readOnly = false,
  FormContent,
  snapshot,
  canApply,
  transformData
}: AnnotationFormEditorViewProps<T>): React.ReactElement | null {
  const { formData, updateField, formSource } = useGenericFormState(annotation, { transformData });

  useAnnotationLiveApply({
    annotation,
    formData,
    formSource,
    readOnly,
    onApply,
    canApply,
    snapshot
  });

  if (!formData) return null;

  const effectiveUpdateField: typeof updateField = readOnly ? () => {} : updateField;

  return (
    <Box sx={{ flex: 1, overflow: "auto" }}>
      <fieldset disabled={readOnly} style={FIELDSET_RESET_STYLE}>
        <FormContent formData={formData} updateField={effectiveUpdateField} />
      </fieldset>
    </Box>
  );
}
