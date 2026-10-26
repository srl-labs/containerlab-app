/**
 * Whether the canvas shows hover cards: the `containerlab.appearance.hoverCards`
 * setting in VS Code, the app settings everywhere else.
 */
import { useSyncExternalStore } from "react";

import { readPersistedHoverCards, watchHoverCards } from "../../workspace/state/themePreferences";

interface HostAppearance {
  hoverCards?: boolean;
}

type AppearanceWindow = Window & { __CLAB_APPEARANCE__?: HostAppearance };

function readEnabled(): boolean {
  const appearance = (window as AppearanceWindow).__CLAB_APPEARANCE__;
  return appearance ? appearance.hoverCards !== false : readPersistedHoverCards();
}

function subscribe(onChange: () => void): () => void {
  // VS Code posts its appearance settings again when they change.
  const onMessage = (event: MessageEvent<{ type?: string; appearance?: HostAppearance }>) => {
    if (event.data.type !== "containerlab:appearance" || !event.data.appearance) return;
    (window as AppearanceWindow).__CLAB_APPEARANCE__ = event.data.appearance;
    onChange();
  };
  window.addEventListener("message", onMessage);
  const stopWatching = watchHoverCards(onChange);
  return () => {
    window.removeEventListener("message", onMessage);
    stopWatching();
  };
}

export function useHoverCardsEnabled(): boolean {
  return useSyncExternalStore(subscribe, readEnabled, () => true);
}
