/**
 * DOM Interaction Hooks
 */
import { useEffect } from "react";

/**
 * Hook that calls onClose when ESC key is pressed while isOpen is true
 */
export function useEscapeKey(isOpen: boolean, onClose: () => void): void {
  useEffect(() => {
    // Only listen while open so closed modals/panels don't keep idle global listeners.
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);
}
