// Shakes the navbar lock whenever an edit is blocked by the lock.
import React from "react";

import { useLockNudge } from "../../stores/topoViewerStore";

const SHAKE_DURATION_MS = 480;

const SHAKE_FRAMES: Keyframe[] = [
  { transform: "translateX(0) rotate(0)" },
  { transform: "translateX(-3px) rotate(-10deg)" },
  { transform: "translateX(3px) rotate(10deg)" },
  { transform: "translateX(-3px) rotate(-8deg)" },
  { transform: "translateX(2px) rotate(6deg)" },
  { transform: "translateX(-1px) rotate(-3deg)" },
  { transform: "translateX(0) rotate(0)" }
];

/** Reduced motion swaps the shake for a short in-place pulse. */
const PULSE_FRAMES: Keyframe[] = [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }];

function prefersReducedMotion(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function playLockShake(element: HTMLElement): void {
  if (typeof element.animate !== "function") return;
  const reduced = prefersReducedMotion();
  element.animate(reduced ? PULSE_FRAMES : SHAKE_FRAMES, {
    duration: SHAKE_DURATION_MS,
    easing: "ease-in-out"
  });
}

/** Plays the shake on `ref` each time a locked edit is attempted. */
export function useLockShake(ref: React.RefObject<HTMLElement | null>): void {
  const nudge = useLockNudge();
  const lastNudge = React.useRef(nudge);

  React.useEffect(() => {
    if (nudge === lastNudge.current) return;
    lastNudge.current = nudge;
    const element = ref.current;
    if (element) playLockShake(element);
  }, [nudge, ref]);
}
