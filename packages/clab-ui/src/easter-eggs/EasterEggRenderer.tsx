/**
 * Easter Egg Renderer - Renders the active easter egg mode component.
 * Extracts duplicated conditional rendering logic from App.tsx.
 *
 * Mode components (and the audio-synthesis hooks they pull in) are lazy-loaded
 * so they stay out of the main bundle until the hidden trigger activates them.
 */

import React from "react";

import type { UseEasterEggReturn } from "./useEasterEgg";

const LazyNightcallMode = React.lazy(async () => {
  const module = await import("./modes/NightcallMode");
  return { default: module.NightcallMode };
});

const LazyStickerbushMode = React.lazy(async () => {
  const module = await import("./modes/StickerbushMode");
  return { default: module.StickerbushMode };
});

const LazyAquaticAmbienceMode = React.lazy(async () => {
  const module = await import("./modes/AquaticAmbienceMode");
  return { default: module.AquaticAmbienceMode };
});

const LazyVaporwaveMode = React.lazy(async () => {
  const module = await import("./modes/VaporwaveMode");
  return { default: module.VaporwaveMode };
});

const LazyDeusExMode = React.lazy(async () => {
  const module = await import("./modes/DeusExMode");
  return { default: module.DeusExMode };
});

interface EasterEggRendererProps {
  easterEgg: UseEasterEggReturn;
}

/**
 * Renders the appropriate easter egg mode based on current state.
 */
export const EasterEggRenderer: React.FC<EasterEggRendererProps> = ({ easterEgg }) => {
  const { state, endPartyMode, nextMode, getModeName } = easterEgg;
  const { isPartyMode, easterEggMode } = state;

  if (!isPartyMode) return null;

  const commonProps = {
    isActive: isPartyMode,
    onClose: endPartyMode,
    onSwitchMode: nextMode,
    modeName: getModeName()
  };

  let mode: React.ReactNode;
  switch (easterEggMode) {
    case "nightcall":
      mode = <LazyNightcallMode {...commonProps} />;
      break;
    case "stickerbrush":
      mode = <LazyStickerbushMode {...commonProps} />;
      break;
    case "aquatic":
      mode = <LazyAquaticAmbienceMode {...commonProps} />;
      break;
    case "vaporwave":
      mode = <LazyVaporwaveMode {...commonProps} />;
      break;
    case "deusex":
      mode = <LazyDeusExMode {...commonProps} />;
      break;
    default:
      return null;
  }

  return <React.Suspense fallback={null}>{mode}</React.Suspense>;
};
