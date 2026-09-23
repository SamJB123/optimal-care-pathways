/**
 * A pathway's family colour (decisions U21, U25): the accent its printed edition set its
 * step bands in, stored per document. The print colour is the ANCHOR: fills and ticks
 * use it exactly. Text in the family colour must stay legible, so for each ground (paper,
 * night) the colour is walked along its own lightness axis in OKLCH — hue kept, chroma
 * pulled in only as far as sRGB requires — until it reaches the contrast text needs. The
 * two results are the family's LEGIBLE PAIR, applied with `light-dark()`.
 *
 * Pure maths over hex strings, shared by the server (every page's inline style) and the
 * colour editor (which shows the pair and the contrast each reaches).
 */

import { NIGHT, PAPER } from './palette.ts'

/** WCAG 2.2 AA for body text, with a margin for the ladder's slightly darker surfaces. */
export const TEXT_CONTRAST = 4.8

type Rgb = [number, number, number]

const HEX = /^#([0-9a-f]{6})$/i

export const isHexColour = (value: string): boolean => HEX.test(value)

const each = (rgb: Rgb, f: (channel: number) => number): Rgb => [f(rgb[0]), f(rgb[1]), f(rgb[2])]

function parseHex(hex: string): Rgb {
	const match = HEX.exec(hex)
	if (!match?.[1]) throw new Error(`[family] not a #rrggbb colour: ${hex}`)
	const n = Number.parseInt(match[1], 16)
	return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

const channelHex = (c: number): string =>
	Math.round(Math.min(1, Math.max(0, c)) * 255)
		.toString(16)
		.padStart(2, '0')

const toHex = (rgb: Rgb): string => `#${rgb.map(channelHex).join('')}`

const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const gamma = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

/** WCAG relative luminance. */
function luminance(hex: string): number {
	const [r, g, b] = each(parseHex(hex), linear)
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours. */
export function contrast(a: string, b: string): number {
	const la = luminance(a)
	const lb = luminance(b)
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

interface Oklch {
	l: number
	c: number
	h: number
}

function toOklch(hex: string): Oklch {
	const [r, g, b] = each(parseHex(hex), linear)
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	return { l: L, c: Math.hypot(A, B), h: Math.atan2(B, A) }
}

/** OKLCH to linear sRGB; null when the colour falls outside the sRGB gamut. */
function fromOklch({ l: L, c, h }: Oklch): Rgb | null {
	const A = c * Math.cos(h)
	const B = c * Math.sin(h)
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
	const rgb: Rgb = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	]
	const eps = 1e-6
	return rgb.every((v) => v >= -eps && v <= 1 + eps) ? rgb : null
}

/** The colour at lightness `l` with the hue kept and as much of its chroma as sRGB holds. */
function atLightness(base: Oklch, l: number): string {
	let lo = 0
	let hi = base.c
	const grey: Rgb = [l ** 3, l ** 3, l ** 3]
	let best = fromOklch({ l, c: 0, h: base.h }) ?? grey
	for (let i = 0; i < 24; i++) {
		const c = (lo + hi) / 2
		const rgb = fromOklch({ l, c, h: base.h })
		if (rgb) {
			best = rgb
			lo = c
		} else hi = c
	}
	return toHex(each(fromOklch({ l, c: base.c, h: base.h }) ?? best, gamma))
}

/** The nearest colour to `hex`, along its own lightness, that reaches `target` against
 *  `ground`: darker on a light ground, lighter on a dark one. */
export function legibleOn(hex: string, ground: string, target = TEXT_CONTRAST): string {
	if (contrast(hex, ground) >= target) return hex
	const base = toOklch(hex)
	const darken = luminance(ground) > 0.18
	let lo = darken ? 0 : base.l
	let hi = darken ? base.l : 1
	let found = darken ? '#000000' : '#ffffff'
	for (let i = 0; i < 30; i++) {
		const l = (lo + hi) / 2
		const candidate = atLightness(base, l)
		if (contrast(candidate, ground) >= target) {
			found = candidate
			// Walk back toward the print colour while the target still holds.
			if (darken) lo = l
			else hi = l
		} else if (darken) hi = l
		else lo = l
	}
	return found
}

/** Text on a surface filled with the family colour: the grounds' own ink or paper. */
export function onFamily(hex: string): string {
	return contrast(hex, PAPER.ink) >= contrast(hex, PAPER.ground) ? PAPER.ink : PAPER.ground
}

/** The legible pair and what each reaches, for the colour editor. */
export interface FamilyReport {
	print: string
	paper: { ink: string; contrast: number; adjusted: boolean }
	night: { ink: string; contrast: number; adjusted: boolean }
	/** Ink for text set on a family-filled surface, and its contrast. */
	on: { ink: string; contrast: number }
}

export function familyReport(hex: string): FamilyReport {
	const paper = legibleOn(hex, PAPER.ground)
	const night = legibleOn(hex, NIGHT.ground)
	const on = onFamily(hex)
	return {
		print: hex.toLowerCase(),
		paper: { ink: paper, contrast: contrast(paper, PAPER.ground), adjusted: paper !== hex.toLowerCase() },
		night: { ink: night, contrast: contrast(night, NIGHT.ground), adjusted: night !== hex.toLowerCase() },
		on: { ink: on, contrast: contrast(hex, on) },
	}
}

/** The custom properties a family-coloured subtree carries: `--family` (the print
 *  colour, for fills and ticks), `--family-ink` (text, legible per scheme) and
 *  `--family-on` (text on a family fill). None for a document without a colour. */
export function familyStyle(hex: string | null | undefined): Record<string, string> | undefined {
	if (!hex || !isHexColour(hex)) return undefined
	const report = familyReport(hex)
	return {
		'--family': report.print,
		'--family-ink': `light-dark(${report.paper.ink}, ${report.night.ink})`,
		'--family-on': report.on.ink,
	}
}
