// Generic form state hook for editor panels.
import type React from "react";
import { useState, useEffect, useCallback } from "react";

interface UseGenericFormStateOptions<T> {
  /** Calculate isNew based on data */
  getIsNew?: (data: T | null) => boolean;
  /** Transform data before setting formData (e.g., deep clone nested objects) */
  transformData?: (data: T) => T;
}

interface UseGenericFormStateReturn<T> {
  formData: T | null;
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
  hasChanges: boolean;
  resetInitialData: () => void;
  discardChanges: () => void;
  isNew: boolean;
  setFormData: React.Dispatch<React.SetStateAction<T | null>>;
  /** The exact `data` reference the current formData was initialized from.
   * Lets callers detect a formData that predates an externally refreshed
   * snapshot (form re-initialization happens one render later). */
  formSource: T | null;
}

/**
 * Generic form state hook with change tracking
 * @param data The initial data to populate the form
 * @param options Optional configuration
 */
export function useGenericFormState<T extends { id: string }>(
  data: T | null,
  options: UseGenericFormStateOptions<T> = {}
): UseGenericFormStateReturn<T> {
  const { getIsNew, transformData } = options;

  const [formData, setFormData] = useState<T | null>(null);
  const [initialData, setInitialData] = useState<T | null>(null);
  const [formSource, setFormSource] = useState<T | null>(null);

  useEffect(() => {
    if (data) {
      const transformed = transformData ? transformData(data) : { ...data };
      setFormData(transformed);
      setInitialData(transformed);
      setFormSource(data);
    }
  }, [data, transformData]);

  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setFormData((prev) => (prev ? { ...prev, [field]: value } : null));
  }, []);

  const resetInitialData = useCallback(() => {
    if (formData) {
      const transformed = transformData ? transformData(formData) : { ...formData };
      setInitialData(transformed);
    }
  }, [formData, transformData]);

  const discardChanges = useCallback(() => {
    if (initialData !== null) {
      const transformed = transformData ? transformData(initialData) : { ...initialData };
      setFormData(transformed);
    }
  }, [initialData, transformData]);

  const hasChanges =
    formData !== null && initialData !== null
      ? JSON.stringify(formData) !== JSON.stringify(initialData)
      : false;
  const isNew = getIsNew ? getIsNew(data) : false;

  return {
    formData,
    updateField,
    hasChanges,
    resetInitialData,
    discardChanges,
    isNew,
    setFormData,
    formSource
  };
}
