/**
 * Stage one against the real cancer template PDF (88 pages, ~3 s). Each test pins one
 * class of loss the old pipeline had and this reader must not: text coverage, section
 * structure recovered from imperfect tagging, footnotes and endnotes, list nesting, and
 * the marks that carry the template's meaning (bold, italic, underline, highlight,
 * colour, links).
 */

import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Block, ExtractedDocument, Paragraph, Section, TextRun } from './model.ts'
import { plainText } from './model.ts'
import { openPdf, readPage } from './pdf-page.ts'
import { readDocument } from './read-document.ts'

const SOURCE = 'Attachment-B-Optimal-Care-Pathway-for-people-with-x-cancer-template_1784776024.pdf'
const path = join(import.meta.dirname, '..', '..', '..', 'template', '2026', 'source', SOURCE)

let model: ExtractedDocument
let doc: Awaited<ReturnType<typeof openPdf>>

beforeAll(async () => {
	doc = await openPdf(path)
	model = await readDocument(doc, SOURCE)
}, 60_000)

const allSections = (sections: Section[]): Section[] =>
	sections.flatMap((s) => [s, ...allSections(s.children)])
const paragraphs = (blocks: Block[]): Paragraph[] =>
	blocks.flatMap((b) => {
		if (b.kind === 'paragraph') return [b]
		if (b.kind === 'list') return b.items.flatMap((i) => paragraphs(i.blocks))
		if (b.kind === 'table')
			return b.rows.flatMap((r) => r.cells.flatMap((c) => paragraphs(c.blocks)))
		return []
	})
const allParagraphs = (): Paragraph[] => [
	...paragraphs(model.front),
	...allSections(model.sections).flatMap((s) => paragraphs(s.blocks)),
	...model.footnotes.flatMap((f) => paragraphs(f.blocks)),
]
const allRuns = (): TextRun[] => [
	...allParagraphs().flatMap((p) => p.runs),
	...allSections(model.sections).flatMap((s) => s.heading),
	...model.endnotes.flatMap((e) => e.runs),
]
const sectionByNumber = (number: string) =>
	allSections(model.sections).find((s) => s.number === number)
const sectionByHeading = (re: RegExp) =>
	allSections(model.sections).find((s) => re.test(s.headingText))

describe('stage one: the cancer template read from its PDF', () => {
	it('places every word of every page, once (no text lost, none duplicated)', async () => {
		// Every non-artifact text item of every page must appear in the model's text; the
		// model's total length must not exceed the pages' (nothing counted twice).
		const modelText = allRuns()
			.map((r) => r.text)
			.join(' ')
			.replace(/\s+/g, '')
		let pageChars = 0
		const missing: string[] = []
		for (let n = 1; n <= doc.numPages; n++) {
			const page = await readPage(doc, n)
			for (const [mcid, items] of page.textByMcid) {
				if (mcid === '<none>' || page.untaggedMcids.includes(mcid)) continue
				const text = items
					.map((i) => i.text)
					.join('')
					.replace(/\s+/g, '')
				pageChars += text.length
				// Sample the item's longest word: a whole-item check would fail on legitimate
				// joins across marked content; a word is the unit that must survive.
				const word = items
					.flatMap((i) => i.text.split(/\s+/))
					.filter((w) => /\w{5,}/.test(w))
					.sort((a, b) => b.length - a.length)[0]
				if (word && !modelText.includes(word.replace(/\s+/g, ''))) missing.push(`p.${n}: ${word}`)
			}
		}
		expect(missing).toEqual([])
		expect(modelText.length).toBeGreaterThan(pageChars * 0.97)
		expect(modelText.length).toBeLessThan(pageChars * 1.03)
		expect(model.warnings).toEqual([])
	}, 60_000)

	it('recovers the full outline, including headings Word tagged badly', () => {
		const numbers = allSections(model.sections)
			.map((s) => s.number)
			.filter((n): n is string => n !== null)
		for (const expected of [
			'Step 1',
			'1.1',
			'1.1.1',
			'2.3',
			'3.2.3',
			'4.3.1',
			'6.2',
			'6.7',
			'7.2.4',
		]) {
			expect(numbers).toContain(expected)
		}
		// 6.2 is an EMPTY H2 whose text sits in the next paragraph; 3.2.3 is an H3 holding
		// its body paragraph too; the Preface's sub-headings are untagged bold lines.
		expect(sectionByNumber('6.2')?.headingText).toBe(
			'6.2 Investigating residual, recurrent or metastatic disease',
		)
		expect(sectionByNumber('3.2.3')?.headingText).toBe('3.2.3 Pharmacogenetics')
		expect(
			plainText(
				sectionByNumber('3.2.3')?.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.runs : [])) ??
					[],
			),
		).toMatch(/^Pharmacogenetics can influence/)
		for (const heading of [
			/^Preface$/,
			/^Statement of acknowledgement$/,
			/^Endorsement$/,
			/^Publication details$/,
			/^Instructions for developers$/,
			/^Tips for success$/,
		]) {
			expect(sectionByHeading(heading), String(heading)).toBeDefined()
		}
		// Numbers never leak into a wrong level: 1.1.1 is a child of 1.1, which is a child of Step 1.
		const step1 = sectionByNumber('Step 1')
		expect(step1?.children.map((c) => c.number)).toEqual(['1.1', '1.2', null])
		expect(step1?.children[0]?.children.map((c) => c.number)).toEqual(['1.1.1', '1.1.2', '1.1.3'])
	})

	it('keeps footnotes out of the prose and attached to their markers', () => {
		expect(model.footnotes.map((f) => f.label)).toEqual(['1', 'b'])
		const riskFactors = sectionByNumber('1.1.1')
		const first = riskFactors?.blocks[0]
		expect(first?.kind).toBe('paragraph')
		const runs = first?.kind === 'paragraph' ? first.runs : []
		// The page reads "Common<sup>b</sup> risk factors for cancer include:<sup>11,12</sup>":
		// the word, the marker as its own superscript run bound to the footnote, then the
		// prose with its space intact, then the two citations.
		const shape = runs.map((r) => ({
			text: r.text,
			sup: r.superscript,
			fn: r.footnote,
			en: r.endnote,
		}))
		expect(shape.slice(0, 3)).toEqual([
			{ text: 'Common', sup: false, fn: null, en: null },
			{ text: 'b', sup: true, fn: 1, en: null },
			{ text: ' risk factors for cancer include:', sup: false, fn: null, en: null },
		])
		expect(shape.slice(3).map((s) => s.en)).toEqual([11, null, 12])
		expect(shape.slice(3).every((s) => s.sup)).toBe(true)
		expect(shape[4]?.text).toBe(',')
		expect(
			plainText(
				model.footnotes[1]?.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.runs : [])) ?? [],
			),
		).toBe('Not all risk factors are relevant for all cancer types')
	})

	it('numbers the endnotes 1–89 from the References and marks every citation', () => {
		expect(model.endnotes.map((e) => e.number)).toEqual(Array.from({ length: 89 }, (_, i) => i + 1))
		expect(plainText(model.endnotes[0]?.runs ?? [])).toMatch(/^Sayani A\./)
		const cited = new Set(allRuns().flatMap((r) => (r.endnote !== null ? [r.endnote] : [])))
		expect(cited.has(9)).toBe(true)
		expect(cited.has(89)).toBe(true)
		for (const n of cited)
			expect(
				model.endnotes.some((e) => e.number === n),
				`endnote ${n} cited but absent`,
			).toBe(true)
		// A marker is a small raised number and never keeps its link.
		const nine = allRuns().find((r) => r.endnote === 9)
		expect(nine?.superscript).toBe(true)
		expect(nine?.link).toBeNull()
	})

	it('keeps list nesting (the treatment modalities list)', () => {
		const summary = sectionByNumber('4.3.1')
		const table = summary?.blocks.find((b) => b.kind === 'table')
		expect(table?.kind).toBe('table')
		const cellBlocks =
			table?.kind === 'table' ? table.rows.flatMap((r) => r.cells.flatMap((c) => c.blocks)) : []
		const list = cellBlocks.find((b) => b.kind === 'list')
		expect(list?.kind).toBe('list')
		const items = list?.kind === 'list' ? list.items : []
		const labels = items.map((i) =>
			plainText(i.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.runs : []))),
		)
		expect(labels).toEqual([
			'Surgery',
			'Radiation therapy',
			'Systemic therapy:',
			'Transplant',
			'Other',
		])
		const systemic = items[2]
		const nested = systemic?.blocks.find((b) => b.kind === 'list')
		expect(nested?.kind).toBe('list')
		const subItems = nested?.kind === 'list' ? nested.items : []
		expect(subItems.map((i) => i.marker)).toEqual(['dash', 'dash', 'dash', 'dash', 'dash'])
		expect(
			plainText(subItems[0]?.blocks.flatMap((b) => (b.kind === 'paragraph' ? b.runs : [])) ?? []),
		).toBe('Chemotherapy')
		expect(items.every((i) => i.marker === 'bullet')).toBe(true)
	})

	it('carries the marks the template means something by', () => {
		const runs = allRuns()
		// Bold lead-ins on the instructions page.
		const core = runs.find((r) => r.text.trim() === 'core content' && r.bold)
		expect(core).toBeDefined()
		// Green italic developer instructions, white text on the navy bands.
		expect(
			runs.some(
				(r) => r.colour === '#00b050' && r.italic && /Complete the appropriate box/.test(r.text),
			),
		).toBe(true)
		expect(
			runs.some(
				(r) => r.colour === '#ffffff' && r.bold && r.text.includes('Cancer-specific risk factors'),
			),
		).toBe(true)
		// Yellow highlights mark the editable words, and stop at the brackets Word left plain.
		const highlighted = runs.filter((r) => r.background === '#ffff00')
		expect(highlighted.length).toBeGreaterThan(150)
		expect(highlighted.some((r) => r.text.trim() === 'cancer type')).toBe(true)
		expect(highlighted.some((r) => r.text.trim() === 'Surgery')).toBe(true)
		// Dotted underlines on glossary terms, one term at a time.
		const advice = allParagraphs().find((p) =>
			plainText(p.runs).startsWith('Advice about modifiable risk factors'),
		)
		const underlined = advice?.runs.filter((r) => r.underline).map((r) => r.text.trim()) ?? []
		expect(underlined).toEqual([
			'social',
			'environmental',
			'structural',
			'economic',
			'cultural',
			'biomedical',
			'commercial',
			'digital determinants of health',
		])
		// Links keep their targets: an external URL and an internal page.
		expect(runs.some((r) => r.link && 'url' in r.link && r.link.url.startsWith('mailto:'))).toBe(
			true,
		)
		expect(
			runs.some(
				(r) => r.link && 'page' in r.link && r.text.includes('Resources on risk reduction'),
			),
		).toBe(true)
		// The light-blue hyperlink token is its own coloured run.
		expect(
			runs.some((r) => r.colour === '#4f81bd' && r.text.includes('<hyperlink to be added>')),
		).toBe(true)
	})

	it('reads the boxes as tables with their shading and borders', () => {
		const riskFactors = sectionByNumber('1.1.1')
		const box = riskFactors?.blocks.find((b) => b.kind === 'table')
		expect(box?.kind).toBe('table')
		if (box?.kind !== 'table') return
		expect(box.border).toBe('#00b050')
		expect(box.rows).toHaveLength(5)
		expect(box.rows[0]?.cells[0]?.background).toBe('#eaf1dd')
		expect(box.rows[1]?.cells[0]?.background).toBe('#0f1e64')
		expect(box.rows[3]?.cells[0]?.background).toBe('#eaf1dd')
		expect(plainText(paragraphs(box.rows[3]?.cells[0]?.blocks ?? []).flatMap((p) => p.runs))).toBe(
			'Or',
		)
		// The pencil icon is a figure with its alt text, inside the first cell.
		expect(
			box.rows[0]?.cells[0]?.blocks.some((b) => b.kind === 'figure' && /pen/i.test(b.alt)),
		).toBe(true)
	})

	it('is deterministic', async () => {
		const again = await readDocument(doc, SOURCE)
		expect(JSON.stringify(again)).toBe(JSON.stringify(model))
	}, 60_000)
})
