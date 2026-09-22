/**
 * Stage one against the real cancer template PDF (88 pages, ~3 s). Each test pins one
 * class of loss the old pipeline had and this reader must not: text coverage, section
 * structure recovered from imperfect tagging, footnotes and endnotes, list nesting, and
 * the marks that carry the template's meaning (bold, italic, underline, highlight,
 * colour, links).
 */

import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Block, ExtractedDocument, ListItem, Paragraph, Section, TextRun } from './model.ts'
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

	it('aligns a paragraph within the drawn cell, the list body or the page column, never its own extent (pp.6–7)', () => {
		// p.6: the two tiles' single-line titles are centred in their shaded cells, as their
		// multi-line bodies are; p.7: the icon grid's labels are centred between the drawn
		// rules ("Health professionals" is the only line in its cell).
		const types = sectionByHeading(/^Types of Optimal Care Pathways/)
		const using = sectionByHeading(/^Using Optimal Care Pathways/)
		const byText = (section: Section | undefined, text: string) =>
			paragraphs(section?.blocks ?? []).find((p) => plainText(p.runs).trim() === text)
		expect(byText(types, 'Cancer-specific OCPs')?.align).toBe('center')
		expect(byText(types, 'Population-based OCPs')?.align).toBe('center')
		expect(byText(using, 'Health professionals')?.align).toBe('center')
		expect(byText(using, 'Clinical practice guidelines')?.align).toBe('center')
		expect(byText(using, 'eviQ protocols')?.align).toBe('center')
		// The frame is the container's, so left-aligned prose stays left: no list item's
		// paragraph anywhere in the document is centred or right-aligned.
		const listParagraphs = (blocks: Block[]): Paragraph[] =>
			blocks.flatMap((b) => {
				if (b.kind === 'list') return b.items.flatMap((i) => paragraphs(i.blocks))
				if (b.kind === 'table')
					return b.rows.flatMap((r) => r.cells.flatMap((c) => listParagraphs(c.blocks)))
				return []
			})
		const inLists = allSections(model.sections).flatMap((s) => listParagraphs(s.blocks))
		expect(inLists.length).toBeGreaterThan(500)
		expect(inLists.every((p) => p.align === 'left')).toBe(true)
	})

	it('splits a title line Word set with a soft return from the body under it (p.7)', () => {
		// "Optimal Care Pathways" (bold, navy) and its description share one P in the
		// tagging; on the page the title is its own centred line, like its two siblings.
		const using = sectionByHeading(/^Using Optimal Care Pathways/)
		const texts = paragraphs(using?.blocks ?? []).map((p) => plainText(p.runs).trim())
		expect(texts).toContain('Optimal Care Pathways')
		expect(texts.some((t) => t.startsWith('Nationally endorsed cancer care pathways'))).toBe(true)
		expect(texts.some((t) => t.startsWith('Optimal Care Pathways Nationally'))).toBe(false)
	})

	it('keeps the gap between two cells out of a line’s extent (p.7)', () => {
		// pdf.js writes the horizontal gap between adjacent cells' text as a whitespace item
		// at the start of the next cell's content; it must not stretch that cell's line back
		// to the previous cell, or the labels would sit off-centre in their cells.
		const resources = sectionByHeading(/^Pathway resources/)
		const labels = paragraphs(resources?.blocks ?? []).filter((p) =>
			/^(Full OCP|OCP Quick Reference Guide|OCP Consumer Guide:)$/.test(plainText(p.runs).trim()),
		)
		expect(labels).toHaveLength(3)
		expect(labels.map((p) => p.align)).toEqual(['center', 'center', 'center'])
	})

	it('keeps every reference link, including on the pages whose Links Word left empty (pp.84, 88)', () => {
		// The first and last reference pages carry all their text in one marked content and
		// their Link elements hold nothing; the link annotations still say where the links
		// are. Refs 1–10 and 85–89 are titles linked in print.
		for (const n of [1, 2, 5, 10, 21, 22, 85, 89]) {
			const note = model.endnotes.find((e) => e.number === n)
			expect(
				note?.runs.some((r) => r.link !== null && 'url' in r.link),
				`reference ${n}`,
			).toBe(true)
		}
		// A linked title is one run, not one run per word: the spaces inside it carry the link.
		const first = model.endnotes.find((e) => e.number === 1)
		const linked = first?.runs.filter((r) => r.link !== null) ?? []
		expect(
			linked.some((r) => r.text.includes('Health Equity in National Cancer Control Plans')),
		).toBe(true)
	})

	it('reads a table rule under a line as a rule, not an underline (pp.70, 76)', () => {
		// The last line of a cell sits on the table's rule; the rule runs past the text at
		// both ends. "for use by Australian haematology teams." has no underline in print.
		const runs = allRuns().filter((r) => /for use by Australian haematology teams/.test(r.text))
		expect(runs.length).toBeGreaterThan(0)
		expect(runs.every((r) => !r.underline)).toBe(true)
		const acnnp = allRuns().filter((r) => /Specialist Support Service NGO/.test(r.text))
		expect(acnnp.length).toBeGreaterThan(0)
	})

	it('keeps a hard return inside a cell as a line break, and carries a row over a page break (pp.23, 70–71)', () => {
		const instructions = allParagraphs().find(
			(p) =>
				/expected timeframe/.test(plainText(p.runs)) &&
				/Document this instruction/.test(plainText(p.runs)),
		)
		expect(instructions).toBeDefined()
		// The break is a '\n' in the runs (it may share a run with the text that follows).
		expect(instructions?.runs.some((r) => r.text.includes('\n'))).toBe(true)
		// The ACNNP funded-NGO row of Step 7's checklist runs over pp.70–71: its second
		// sentence stays in the item, never a bullet of its own.
		const step7 = allSections(model.sections).find((s) => s.number === 'Step 7')
		const lists = (blocks: Block[]): Block[] =>
			blocks.flatMap((b) => {
				if (b.kind === 'list') return [b, ...b.items.flatMap((i) => lists(i.blocks))]
				if (b.kind === 'table')
					return b.rows.flatMap((r) => r.cells.flatMap((c) => lists(c.blocks)))
				return []
			})
		const step7Items = (step7 ? [step7, ...allSections(step7.children)] : [])
			.flatMap((s) => lists(s.blocks))
			.flatMap((l) => (l.kind === 'list' ? l.items : []))
		const ngo = step7Items.find((i) =>
			/funded to provide support for/.test(plainText(paragraphs(i.blocks).flatMap((p) => p.runs))),
		)
		expect(ngo).toBeDefined()
		expect(plainText(paragraphs(ngo?.blocks ?? []).flatMap((p) => p.runs))).toMatch(
			/Referrals can be made to/,
		)
	})

	it('is deterministic', async () => {
		const again = await readDocument(doc, SOURCE)
		expect(JSON.stringify(again)).toBe(JSON.stringify(model))
	}, 60_000)
})

const PRINCIPLES = 'Attachment-A-Principles-for-Optimal-Cancer-Care_1784775997.pdf'
const principlesPath = join(
	import.meta.dirname,
	'..',
	'..',
	'..',
	'template',
	'2026',
	'source',
	PRINCIPLES,
)

describe('stage one: the Principles document read from its PDF', () => {
	let principles: ExtractedDocument

	beforeAll(async () => {
		const pdf = await openPdf(principlesPath)
		principles = await readDocument(pdf, PRINCIPLES)
	}, 60_000)

	const everyParagraph = (): Paragraph[] =>
		allSections(principles.sections).flatMap((s) => paragraphs(s.blocks))

	it('attaches a run of markers that wrapped onto its own line, once each (p.11)', () => {
		// "• use of AI⁴⁴˒⁴⁵˒⁴⁶˒⁴⁷˒⁴⁸": five Links whose digits are the only text on their
		// drawn line, so neither the line nor the element (which they outweigh) can say
		// what full size is. "…(PREMs) ³⁹" is one marker, not two.
		const ai = everyParagraph().find((p) => plainText(p.runs).startsWith('use of AI'))
		expect(ai?.runs.filter((r) => r.endnote !== null).map((r) => r.endnote)).toEqual([
			44, 45, 46, 47, 48,
		])
		const prems = everyParagraph().find((p) =>
			plainText(p.runs).startsWith('Patient-reported experience measures (PREMs)'),
		)
		expect(prems?.runs.filter((r) => r.endnote !== null).map((r) => r.endnote)).toEqual([39])
	})

	it('keeps a heading’s own citation on the heading (pp.13, 26)', () => {
		const mdt = allSections(principles.sections).find((s) =>
			/^Principles of multidisciplinary care/.test(s.headingText),
		)
		expect(mdt?.heading.filter((r) => r.endnote !== null).map((r) => r.endnote)).toEqual([52])
		const research = allSections(principles.sections).find((s) =>
			/^Types of research relevant to cancer care/.test(s.headingText),
		)
		expect(research?.heading.filter((r) => r.endnote !== null).map((r) => r.endnote)).toEqual([72])
	})

	it('keeps the links of references 1–43 (pp.37–38, the tagless pages)', () => {
		for (const n of [1, 12, 30, 43, 44, 73]) {
			const note = principles.endnotes.find((e) => e.number === n)
			expect(
				note?.runs.some((r) => r.link !== null && 'url' in r.link),
				`reference ${n}`,
			).toBe(true)
		}
	})

	it('reads the cross-marked "Do not" rows as crosses (pp.25, 27)', () => {
		const items = (blocks: Block[]): ListItem[] =>
			blocks.flatMap((b) => {
				if (b.kind === 'list') return b.items.flatMap((i) => [i, ...items(i.blocks)])
				if (b.kind === 'table')
					return b.rows.flatMap((r) => r.cells.flatMap((c) => items(c.blocks)))
				return []
			})
		const doNot = allSections(principles.sections)
			.flatMap((s) => items(s.blocks))
			.filter((i) => /^Do not /.test(plainText(paragraphs(i.blocks).flatMap((p) => p.runs))))
		expect(doNot.length).toBeGreaterThanOrEqual(5)
		expect(doNot.every((i) => i.marker === 'cross')).toBe(true)
	})

	it('joins a row Word repeated after the page break back into its row (pp.21–22)', () => {
		const sources = allSections(principles.sections).find((s) =>
			/^Sources of navigation and care coordination support/.test(s.headingText),
		)
		const text = plainText(paragraphs(sources?.blocks ?? []).flatMap((p) => p.runs))
		expect(text).toMatch(
			/impacted by any cancer\. Services include navigation and emotional support/,
		)
		// No label-less two-cell row remains: the repeated row was folded into its own.
		const cellIsBlank = (cell: { blocks: Block[] }) =>
			cell.blocks.every((b) => b.kind === 'paragraph' && plainText(b.runs).trim() === '')
		const rows = (sources?.blocks ?? []).flatMap((b) => (b.kind === 'table' ? b.rows : []))
		expect(
			rows.filter((r) => r.cells.length === 2 && cellIsBlank(r.cells[0] ?? { blocks: [] })),
		).toEqual([])
	})
})
