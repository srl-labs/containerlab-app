import { create } from "zustand";

interface RotationPick {
  targetId: string;
  onPick: (angle: number) => void;
}

interface RotationState {
  copiedAngle: number | null;
  pick: RotationPick | null;
  copyAngle: (angle: number) => void;
  startPick: (pick: RotationPick) => void;
  cancelPick: () => void;
}

/** Transient tools only. Annotation data continues through the normal save/undo path. */
export const useRotationStore = create<RotationState>((set) => ({
  copiedAngle: null,
  pick: null,
  copyAngle: (copiedAngle) => set({ copiedAngle }),
  startPick: (pick) => set({ pick }),
  cancelPick: () => set({ pick: null })
}));
