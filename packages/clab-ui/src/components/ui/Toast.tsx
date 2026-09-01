// Notification toast.
import React, { useState, useCallback, useEffect } from "react";
import { Alert } from "@mantine/core";

export interface ToastMessage {
  id: string;
  message: string;
  type?: "info" | "success" | "warning" | "error";
  duration?: number;
}

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

const TOAST_COLOR: Record<NonNullable<ToastMessage["type"]>, string> = {
  error: "red",
  warning: "yellow",
  info: "blue",
  success: "green"
};

const ToastItem: React.FC<{ toast: ToastMessage; index: number; onDismiss: (id: string) => void }> = ({
  toast,
  index,
  onDismiss
}) => {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration ?? 3000);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  return (
    <Alert
      variant="filled"
      color={TOAST_COLOR[toast.type ?? "info"]}
      withCloseButton
      onClose={() => onDismiss(toast.id)}
      style={{
        position: "fixed",
        bottom: 24 + index * 60,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 2000,
        maxWidth: "min(90vw, 480px)"
      }}
    >
      {toast.message}
    </Alert>
  );
};

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => (
  <>
    {toasts.map((toast, index) => (
      <ToastItem key={toast.id} toast={toast} index={index} onDismiss={onDismiss} />
    ))}
  </>
);

// Counter for generating unique toast IDs
let toastIdCounter = 0;

/**
 * Hook for managing toast notifications
 */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback(
    (message: string, type: ToastMessage["type"] = "info", duration?: number) => {
      const id = `toast-${Date.now()}-${++toastIdCounter}`;
      setToasts((prev) => [...prev, { id, message, type, duration }]);
      return id;
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return {
    toasts,
    addToast,
    dismissToast
  };
}
