/**
 * The two grounds the application is read on — PAPER (the default, warm) and NIGHT — as
 * the theme's two anchors per scheme. Defined here, once, because two things need the
 * numbers: the root element carries them as the theme's anchors (`paletteStyle`, the
 * rest of the ladder derives in ui-solid), and the family colours derive the text colour
 * that stays legible on each ground (lib/family.ts). Anything else about the theme is
 * CSS (src/theme.css).
 */

export interface Ground {
	/** The page ground. */
	ground: string
	/** The body text on it. */
	ink: string
}

export const PAPER: Ground = { ground: '#faf7f1', ink: '#1b1f27' }
export const NIGHT: Ground = { ground: '#14181f', ink: '#e9e4d8' }

/** The theme anchors as inline custom properties, for the root element. */
export const paletteStyle = (): Record<string, string> => ({
	'--color-base-100': `light-dark(${PAPER.ground}, ${NIGHT.ground})`,
	'--color-base-content': `light-dark(${PAPER.ink}, ${NIGHT.ink})`,
})
