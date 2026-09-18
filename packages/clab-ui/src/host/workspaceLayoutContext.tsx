import { createContext, useContext } from "react";

export type WorkspaceView = "labs" | "files" | "help" | "palette";

/** Optional standalone chrome state. Native hosts keep their own sidebar and tabs. */
export const WorkspaceLayoutContext = createContext<{
  side: "left" | "right";
  view: WorkspaceView | null;
  setView: (view: WorkspaceView | null) => void;
  toggleSide: () => void;
} | null>(null);

export function useWorkspaceLayout() {
  return useContext(WorkspaceLayoutContext);
}
