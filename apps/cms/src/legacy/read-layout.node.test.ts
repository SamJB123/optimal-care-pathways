/**
 * The legacy reader's links, fitted to the addresses the print shows: a click area that
 * covers a whole line links only the printed address; a wrapped address is linked whole;
 * a named link with no printed address is left alone.
 */

import { describe, expect, it } from 'vitest'
import type { TextRun } from '../template/extract/model.ts'
import { fitLinksToPrintedAddresses } from './read-layout.ts'

const run = (text: string, link: string | null = null, bold = false): TextRun => ({
	text,
	bold,
	italic: false,
	underline: false,
	superscript: false,
	subscript: false,
	size: 10,
	colour: '#000000',
	background: null,
	link: link ? { url: link } : null,
	footnote: null,
	endnote: null,
})

const shape = (runs: TextRun[]) =>
	runs.map((r) => [r.text, r.link && 'url' in r.link ? r.link.url : null])

describe('fitLinksToPrintedAddresses', () => {
	it('links only the printed address inside a line-wide click area', () => {
		const runs = [
			run(
				'Visit the Cancer Council website <www.cancer.org.au/OCP> to view the pathways.',
				'http://www.cancer.org.au/OCP',
			),
		]
		expect(shape(fitLinksToPrintedAddresses(runs, ['http://www.cancer.org.au/OCP']))).toEqual([
			['Visit the Cancer Council website <', null],
			['www.cancer.org.au/OCP', 'http://www.cancer.org.au/OCP'],
			['> to view the pathways.', null],
		])
	})

	it('gives each printed address on one line its own target', () => {
		const runs = [
			run(
				'Visit our guides webpage <www.cancercareguides.org.au> for consumer guides. Visit our OCP webpage <www.cancer.org.au/OCP> for the pathways.',
				'http://www.cancer.org.au/OCP',
			),
		]
		const targets = ['http://www.cancercareguides.org.au/', 'http://www.cancer.org.au/OCP']
		expect(shape(fitLinksToPrintedAddresses(runs, targets))).toEqual([
			['Visit our guides webpage <', null],
			['www.cancercareguides.org.au', 'http://www.cancercareguides.org.au/'],
			['> for consumer guides. Visit our OCP webpage <', null],
			['www.cancer.org.au/OCP', 'http://www.cancer.org.au/OCP'],
			['> for the pathways.', null],
		])
	})

	it('links the whole of a wrapped address when the click area covered one line of it', () => {
		const runs = [
			run('See the course <https://education.eviq.'),
			run(
				'org.au/courses/malnutrition-in-cancer>.',
				'https://education.eviq.org.au/courses/malnutrition-in-cancer',
			),
		]
		expect(
			shape(
				fitLinksToPrintedAddresses(runs, [
					'https://education.eviq.org.au/courses/malnutrition-in-cancer',
				]),
			),
		).toEqual([
			['See the course <', null],
			[
				'https://education.eviq.org.au/courses/malnutrition-in-cancer',
				'https://education.eviq.org.au/courses/malnutrition-in-cancer',
			],
			['>.', null],
		])
	})

	it('keeps the run styles across the split', () => {
		const runs = [
			run('Guides: ', null, true),
			run('see <www.cancercareguides.org.au>.', 'http://www.cancercareguides.org.au/'),
		]
		const out = fitLinksToPrintedAddresses(runs, ['http://www.cancercareguides.org.au/'])
		expect(out.map((r) => r.bold)).toEqual([true, false, false, false])
		expect(shape(out)).toEqual([
			['Guides: ', null],
			['see <', null],
			['www.cancercareguides.org.au', 'http://www.cancercareguides.org.au/'],
			['>.', null],
		])
	})

	it('leaves a named link with no printed address as the click area drew it', () => {
		const runs = [
			run('refer to the '),
			run('Look Good, Feel Better program', 'https://lgfb.org.au/'),
			run(' – see the resource list.'),
		]
		expect(fitLinksToPrintedAddresses(runs, ['https://lgfb.org.au/'])).toEqual(runs)
	})

	it('leaves a link that is exactly the printed address alone', () => {
		const runs = [run('www.palliativecare.org.au', 'http://www.palliativecare.org.au/')]
		expect(fitLinksToPrintedAddresses(runs, ['http://www.palliativecare.org.au/'])).toEqual(runs)
	})

	it('does not touch internal page links', () => {
		const runs: TextRun[] = [
			{ ...run('see Step 3 <www.example.org>'), link: { page: 12, y: null } },
		]
		expect(fitLinksToPrintedAddresses(runs, [])).toEqual(runs)
	})
})
