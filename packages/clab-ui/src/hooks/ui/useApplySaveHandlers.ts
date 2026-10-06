import { useCallback, useRef } from "react";

/**
 * Small helper hook for editors that expose Apply + Save callbacks
 * based on an optional formData object.
 *
 * The callbacks read the latest values when called, so they keep their identity
 * while the form changes and the panel footer does not re-render on every edit.
 */
export function useApplySaveHandlers<T>(
  formData: T | null,
  onApply: (data: T) => void,
  onSave: (data: T) => void,
  afterApply?: () => void
): { handleApply: () => void; handleSave: () => void } {
  const latestRef = useRef({ formData, onApply, onSave, afterApply });
  latestRef.current = { formData, onApply, onSave, afterApply };

  const handleApply = useCallback(() => {
    const latest = latestRef.current;
    if (latest.formData === null) return;
    latest.onApply(latest.formData);
    latest.afterApply?.();
  }, []);

  const handleSave = useCallback(() => {
    const latest = latestRef.current;
    if (latest.formData === null) return;
    latest.onSave(latest.formData);
  }, []);

  return { handleApply, handleSave };
}
