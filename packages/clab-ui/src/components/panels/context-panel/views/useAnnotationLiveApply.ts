import { useEffect, useRef } from "react";

interface AnnotationWithId {
  id: string;
}

interface UseAnnotationLiveApplyParams<T extends AnnotationWithId> {
  annotation: T | null;
  formData: T | null;
  /** The annotation reference formData was initialized from. When it lags
   * behind `annotation` (external snapshot refresh, e.g. an inline-edit
   * commit), formData is stale and must not be applied. */
  formSource: T | null;
  readOnly: boolean;
  /** Apply the edit: update the canvas immediately, persistence is debounced downstream. */
  onApply: (annotation: T) => void;
  /** Invalid states (e.g. empty text) are neither applied nor persisted. */
  canApply?: (annotation: T) => boolean;
  /** Snapshot used for change detection (clone or normalize). Must be referentially stable. */
  snapshot: (annotation: T) => T;
}

/**
 * Live-applies form edits: every valid formData change is pushed to the canvas
 * and persisted (debounced) — no Apply button, no revert-on-close.
 */
export function useAnnotationLiveApply<T extends AnnotationWithId>(
  params: UseAnnotationLiveApplyParams<T>
): void {
  const { annotation, formData, formSource, readOnly, snapshot } = params;

  const onApplyRef = useRef(params.onApply);
  onApplyRef.current = params.onApply;
  const canApplyRef = useRef(params.canApply);
  canApplyRef.current = params.canApply;
  const lastAppliedRef = useRef<string | null>(null);

  // Baseline change detection on the annotation being edited.
  useEffect(() => {
    lastAppliedRef.current = annotation ? JSON.stringify(snapshot(annotation)) : null;
  }, [annotation, snapshot]);

  useEffect(() => {
    if (readOnly || !formData || !annotation) return;
    // Skip transition renders where the form still holds the previous annotation.
    if (formData.id !== annotation.id) return;
    // Skip renders where the snapshot was refreshed externally and the form
    // hasn't re-initialized from it yet — applying would write stale data back.
    if (formSource !== annotation) return;

    const snap = snapshot(formData);
    if (canApplyRef.current && !canApplyRef.current(snap)) return;

    const serialized = JSON.stringify(snap);
    if (serialized === lastAppliedRef.current) return;
    lastAppliedRef.current = serialized;
    onApplyRef.current(snap);
  }, [formData, annotation, formSource, readOnly, snapshot]);
}
