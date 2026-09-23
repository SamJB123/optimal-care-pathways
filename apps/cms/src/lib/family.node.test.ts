/**
 * The legible pair (decision U25): every family colour the print gave a pathway, walked to
 * the lightness its text needs on paper and on night, reaches the contrast target — and a
 * colour that already reaches it is left exactly as printed.
 */

import { describe, expect, it } from 'vitest'
import { contrast, familyReport, familyStyle, legibleOn, TEXT_CONTRAST } from './family.ts'
import { NIGHT, PAPER } from './palette.ts'

/** The step-band colours the legacy import read off the 33 printed editions (a sample
 *  across hues and lightness), plus the extremes. */
const PRINT = [
	'#b65673',
	'#00856e',
	'#5b78a8',
	'#015740',
	'#e36f1e',
	'#7d4b99',
	'#f2c230',
	'#8c1d40',
	'#1a1a1a',
	'#fafafa',
]

describe('contrast', () => {
	it('is 21 between black and white and 1 between a colour and itself', () => {
		expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
		expect(contrast('#5b78a8', '#5b78a8')).toBeCloseTo(1, 5)
	})
})

describe('the legible pair', () => {
	for (const hex of PRINT) {
		it(`${hex} reaches the text contrast on paper and on night`, () => {
			const report = familyReport(hex)
			expect(report.paper.contrast).toBeGreaterThanOrEqual(TEXT_CONTRAST)
			expect(report.night.contrast).toBeGreaterThanOrEqual(TEXT_CONTRAST)
			expect(contrast(report.paper.ink, PAPER.ground)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
			expect(contrast(report.night.ink, NIGHT.ground)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
		})
	}

	it('leaves a colour that already reaches the target as printed', () => {
		const dark = '#015740'
		expect(contrast(dark, PAPER.ground)).toBeGreaterThanOrEqual(TEXT_CONTRAST)
		expect(legibleOn(dark, PAPER.ground)).toBe(dark)
	})

	it('moves no further than it has to: a little lighter would fail', () => {
		const ink = legibleOn('#b65673', PAPER.ground)
		expect(contrast(ink, PAPER.ground)).toBeLessThan(TEXT_CONTRAST + 0.35)
	})

	it('styles a subtree with the print colour and the pair, and nothing without a colour', () => {
		const style = familyStyle('#00856e')
		expect(style?.['--family']).toBe('#00856e')
		expect(style?.['--family-ink']).toMatch(/^light-dark\(#[0-9a-f]{6}, #[0-9a-f]{6}\)$/)
		expect(familyStyle(null)).toBeUndefined()
		expect(familyStyle('teal')).toBeUndefined()
	})
})
