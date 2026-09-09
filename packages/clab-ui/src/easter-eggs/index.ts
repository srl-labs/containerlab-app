/**
 * Easter Eggs - Hidden visual modes
 *
 * Click the Containerlab logo 10 times to trigger one of five easter eggs:
 * - Nightcall: 80s synthwave vibe (Kavinsky inspired)
 * - Stickerbrush Symphony: Dreamy forest ambient (DKC2 inspired)
 * - Aquatic Ambience: Underwater serenity (DKC inspired)
 * - Vaporwave: Slowed down smooth jazz aesthetic
 * - Deus Ex: 3D rotating logo with metallic theme (silent mode)
 */

// Main easter egg hook
export { useEasterEgg } from "./useEasterEgg";

// Renderer component (lazy-loads the mode components on demand; importing the
// modes statically from here would pull them into the eager bundle)
export { EasterEggRenderer } from "./EasterEggRenderer";
