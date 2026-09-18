import { useCallback, useMemo, useState, type ReactNode } from "react";
import { WorkspaceLayoutContext, type WorkspaceView } from "../host/workspaceLayoutContext";

export function WorkspaceLayoutProvider({ children }: { children: ReactNode }) {
  const [side, setSide] = useState<"left" | "right">("left");
  const [view, setView] = useState<WorkspaceView | null>("labs");
  const toggleSide = useCallback(() => setSide((current) => current === "left" ? "right" : "left"), []);
  const value = useMemo(() => ({ side, view, setView, toggleSide }), [side, view, toggleSide]);
  return <WorkspaceLayoutContext.Provider value={value}>{children}</WorkspaceLayoutContext.Provider>;
}
