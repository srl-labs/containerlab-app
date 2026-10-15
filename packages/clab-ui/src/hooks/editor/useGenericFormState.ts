// Generic form state hook for editor panels.
import type React from "react";
import { useState, useEffect, useCallback } from "react";

interface UseGenericFormStateOptions<T> {
  /** Transform data before setting formData (e.g., deep clone nested objects) */
  transformData?: (data: T) => T;
}

interface UseGenericFormStateReturn<T> {
  formData: T | null;
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
  setFormData: React.Dispatch<React.SetStateAction<T | null>>;
  /** The exact `data` reference the current formData was initialized from.
   * Lets callers detect a formData that predates an externally refreshed
   * snapshot (form re-initialization happens one render later). */
  formSource: T | null;
}

/**
 * Generic form state hook
 * @param data The initial data to populate the form
 * @param options Optional configuration
 */
export function useGenericFormState<T extends { id: string }>(
  data: T | null,
  options: UseGenericFormStateOptions<T> = {}
): UseGenericFormStateReturn<T> {
  const { transformData } = options;

  const [formData, setFormData] = useState<T | null>(null);
  const [formSource, setFormSource] = useState<T | null>(null);

  useEffect(() => {
    if (data) {
      setFormData(transformData ? transformData(data) : { ...data });
      setFormSource(data);
    }
  }, [data, transformData]);

  const updateField = useCallback(<K extends keyof T>(field: K, value: T[K]) => {
    setFormData((prev) => (prev ? { ...prev, [field]: value } : null));
  }, []);

  return {
    formData,
    updateField,
    setFormData,
    formSource
  };
}
