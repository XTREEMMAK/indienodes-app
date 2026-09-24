/**
 * Whether a craft node slowly pans across its detail photo.
 *
 * One switch for the whole effect: set to false to fall back to the still
 * image without removing any code. The ship-or-defer decision for this
 * animation is still open. `prefers-reduced-motion` and the host's
 * `motionReduced` flag turn the pan off regardless of this value.
 */
export const CRAFT_PAN_ENABLED = true;
