/**
 * The draft as a Word file, built from bodies that hold every block and mark of the
 * content schema and read back out of the zip: headings by outline depth, Word tables,
 * numbered lists with the tick and cross glyphs, citation superscripts numbered as the
 * page numbers them, boxes and the template's guidance box, footnotes, embedded images,
 * the references and the draft header.
 */

import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { citationNumbers, citedBody, type DerivedView, timeframeRows } from '#/content/derived.ts'
import { publishBody } from '#/content/publish.ts'
import { type JsonMark, type JsonNode, parseBody } from '#/content/schema.ts'
import { type DocxSection, draftDocx, pictureOf } from './docx.ts'

/** A 1×1 PNG. */
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
)
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')

/** The zip's entries by name (stored or deflated, as docx writes them). */
function unzip(data: Uint8Array): Map<string, Buffer> {
	const zip = Buffer.from(data)
	const files = new Map<string, Buffer>()
	const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
	let at = zip.readUInt32LE(end + 16)
	for (let i = 0; i < zip.readUInt16LE(end + 10); i++) {
		const method = zip.readUInt16LE(at + 10)
		const size = zip.readUInt32LE(at + 20)
		const nameLength = zip.readUInt16LE(at + 28)
		const skip = nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
		const offset = zip.readUInt32LE(at + 42)
		const name = zip.toString('utf8', at + 46, at + 46 + nameLength)
		const start = offset + 30 + zip.readUInt16LE(offset + 26) + zip.readUInt16LE(offset + 28)
		const raw = zip.subarray(start, start + size)
		files.set(name, method === 8 ? inflateRawSync(raw) : raw)
		at += 46 + skip
	}
	return files
}

const text = (value: string, marks: JsonMark[] = []): JsonNode => (marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value })
const p = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const item = (kind: string, content: JsonNode[], attrs: Record<string, string | number | boolean | null> = {}): JsonNode => ({
	type: 'list',
	attrs: { kind, ...attrs },
	content,
})
const cell = (type: 'tableCell' | 'tableHeaderCell', value: string, attrs: Record<string, string | number | boolean | null> = {}): JsonNode => ({
	type,
	attrs,
	content: [p(text(value))],
})

/** One body with every block and mark the schema has. */
const everything: JsonNode = {
	type: 'doc',
	content: [
		{ type: 'heading', attrs: { level: 3 }, content: [text('A body heading')] },
		p(
			text('Bold', [{ type: 'bold' }]),
			text(' italic', [{ type: 'italic' }]),
			text(' underline', [{ type: 'underline' }]),
			text(' strike', [{ type: 'strike' }]),
			text(' up', [{ type: 'superscript' }]),
			text(' down', [{ type: 'subscript' }]),
			text(' a link', [{ type: 'link', attrs: { href: 'https://example.org/guide' } }]),
			text(' see section 1.1', [{ type: 'sectionLink', attrs: { address: '1.1' } }]),
			text(' [insert timeframe]', [{ type: 'placeholder', attrs: { label: '[insert timeframe]' } }]),
			text(' a note', [{ type: 'note' }]),
			text(' <an instruction>', [{ type: 'instruction' }]),
			text(' added', [{ type: 'insertion' }]),
			text(' removed', [{ type: 'deletion' }]),
			text(' cited'),
			{ type: 'citation', attrs: { referenceId: 'r1' } },
			{ type: 'citation', attrs: { referenceId: 'r2' } },
			{ type: 'footnote', attrs: { text: 'A note at the foot of the page.' } },
			{ type: 'hardBreak' },
			{ type: 'mention', attrs: { id: 'x', value: '@Section 2', kind: 'section' } },
		),
		{
			type: 'box',
			attrs: { kind: 'actions', icon: 'clipboard', family: '', variant: 'soft' },
			content: [{ type: 'banner', attrs: { tone: 'band' }, content: [text('Box title')] }, p(text('Inside the box.'))],
		},
		{ type: 'box', attrs: { kind: 'callout', icon: '', family: 'info', variant: 'soft' }, content: [p(text('A callout.'))] },
		{ type: 'guidance', attrs: { done: false }, content: [p(text('Write the subject here.'))] },
		{
			type: 'timeframe',
			content: [
				{ type: 'carePoint', content: [text('Timeframe for referral')] },
				{
					type: 'variants',
					content: [
						{ type: 'variant', content: [p(text('Within two weeks.'))] },
						{ type: 'variant', content: [p(text('Within four weeks.'))] },
					],
				},
			],
		},
		{
			type: 'table',
			content: [
				{ type: 'tableRow', content: [cell('tableHeaderCell', 'Header A'), cell('tableHeaderCell', 'Header B')] },
				{ type: 'tableRow', content: [cell('tableCell', 'Shaded', { background: 'warning' }), cell('tableCell', 'Plain')] },
				{ type: 'tableRow', content: [cell('tableCell', 'Spanning both', { colspan: 2 })] },
			],
		},
		item('bullet', [p(text('First bullet')), item('ordered', [p(text('Nested number'))], { order: 3 })]),
		item('bullet', [p(text('Second bullet'))]),
		item('check', [p(text('Do this'))]),
		item('check', [p(text('Do not do that'))], { negated: true }),
		item('task', [p(text('A done task'))], { checked: true }),
		item('bullet', [p(text('An icon row'))], { icon: '/template-figures/icon.png' }),
		{
			type: 'columns',
			content: [
				{ type: 'column', content: [p(text('Left column'))] },
				{ type: 'column', content: [p(text('Right column'))] },
			],
		},
		{
			type: 'figureRow',
			content: [
				{ type: 'image', attrs: { src: '/files/images/doc/a.png', alt: 'Figure A' } },
				{ type: 'image', attrs: { src: '/files/images/doc/b.png', alt: 'Figure B' } },
			],
		},
		{ type: 'image', attrs: { src: '/files/images/doc/drawing.svg', alt: 'A drawing' } },
		{
			type: 'resourceList',
			content: [
				{ type: 'resource', attrs: { title: 'Cancer Council', url: 'https://www.cancer.org.au' }, content: [p(text('Information and support.'))] },
				{ type: 'resource', attrs: { title: 'Principle 4', url: '#4' }, content: [] },
			],
		},
		{ type: 'blockquote', content: [p(text('A quotation.'))] },
		{ type: 'horizontalRule' },
		{ type: 'pageBreak' },
		{ type: 'timeframeSnapshot' },
		{ type: 'pathwayMap' },
	],
}

const images: Record<string, Buffer> = {
	'/files/images/doc/a.png': PNG,
	'/files/images/doc/b.png': PNG,
	'/template-figures/icon.png': PNG,
	'/files/images/doc/drawing.svg': SVG,
}

async function build(sections: DocxSection[]) {
	const derived: DerivedView = {
		referenceNumbers: citationNumbers(sections.map((s) => citedBody(s.titleCitations, s.body))),
		timeframes: timeframeRows(sections.map((s) => ({ stepNumber: 1, address: '1', printedNumber: s.printedNumber, title: s.title, body: s.body }))),
		map: null,
	}
	const file = await draftDocx({
		title: 'Optimal care pathway for people with test cancer',
		editionNo: 3,
		exportedAt: Date.UTC(2026, 8, 24, 2),
		exportedBy: 'Ada Drafter',
		origin: 'https://cms.example',
		sections,
		derived,
		references: [
			{ number: 1, citation: 'First reference, viewed 1 May 2020, <www.example.org/one>.', url: null },
			{ number: 2, citation: 'Second reference.', url: 'https://example.org/two' },
		],
		loadImage: async (src) => images[src] ?? null,
	})
	const files = unzip(file)
	const read = (name: string) => files.get(name)?.toString('utf8') ?? ''
	return { files, read, document: read('word/document.xml') }
}

describe('the draft as a Word file', () => {
	it('the representative body is a valid body', () => {
		expect(() => parseBody(everything)).not.toThrow()
	})

	it('writes every block of a core template, guidance included', async () => {
		const { files, read, document } = await build([
			{ depth: 0, printedNumber: 'Step 1', title: 'Prevention', titleCitations: [], body: publishBody(everything, 'test cancer', 'template') },
			{ depth: 1, printedNumber: '1.1', title: 'Risk factors', titleCitations: ['r2'], body: { type: 'doc', content: [p(text('Short.'))] } },
		])
		// Headings by outline depth, the number as the page prints it, a heading's own
		// citations after it.
		expect(document).toMatch(/<w:pStyle w:val="Heading1"\/>.*?<w:t[^>]*>Step 1: Prevention<\/w:t>/)
		expect(document).toMatch(/<w:pStyle w:val="Heading2"\/>.*?<w:t[^>]*>1\.1 Risk factors<\/w:t>.*?<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t[^>]*>2<\/w:t>/)
		expect(document).toMatch(/<w:pStyle w:val="Heading3"\/>.*?<w:t[^>]*>A body heading<\/w:t>/)
		// Marks as run formatting.
		expect(document).toMatch(/<w:b\/>.*?<w:t[^>]*>Bold<\/w:t>/)
		expect(document).toMatch(/<w:strike\/>.*?<w:t[^>]*> strike<\/w:t>/)
		expect(document).toMatch(/<w:vertAlign w:val="subscript"\/>.*?<w:t[^>]*> down<\/w:t>/)
		expect(document).toMatch(/<w:highlight w:val="yellow"\/>.*?<w:t[^>]*> \[insert timeframe\]<\/w:t>/)
		expect(document).toContain('> see section 1.1</w:t>')
		expect(document).toContain('>@Section 2</w:t>')
		expect(read('word/_rels/document.xml.rels')).toContain('https://example.org/guide')
		// Citations: superscript numbers, a joined run reading "1,2".
		expect(document).toMatch(/<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t[^>]*>1<\/w:t>/)
		expect(document).toMatch(/<w:vertAlign w:val="superscript"\/><\/w:rPr><w:t[^>]*>,2<\/w:t>/)
		// A footnote.
		expect(document).toContain('<w:footnoteReference w:id="1"/>')
		expect(read('word/footnotes.xml')).toContain('A note at the foot of the page.')
		// A box: a one-cell table, its banner the bold first line.
		expect(document).toMatch(/<w:tbl>(?:(?!<\/w:tbl>).)*<w:b\/>(?:(?!<\/w:tbl>).)*>Box title<\/w:t>(?:(?!<\/w:tbl>).)*>Inside the box\.<\/w:t>/)
		// The template's guidance, shaded and headed.
		expect(document).toMatch(/<w:shd w:fill="E0F0E6"[^>]*\/>(?:(?!<\/w:tbl>).)*>Drafting guidance<\/w:t>(?:(?!<\/w:tbl>).)*>Write the subject here\.<\/w:t>/)
		// The timeframe and its alternatives.
		expect(document).toContain('>Timeframe for referral</w:t>')
		expect(document).toMatch(/>Within two weeks\.<\/w:t>.*?>Or<\/w:t>.*?>Within four weeks\.<\/w:t>/)
		// A table: header cells, a shaded cell, a span.
		expect(document).toContain('>Header A</w:t>')
		expect(document).toContain('<w:gridSpan w:val="2"/>')
		expect(document).toMatch(/<w:shd w:fill="FFF3CC"[^>]*\/>(?:(?!<\/w:tc>).)*>Shaded<\/w:t>/)
		// Lists as Word numbering, with the tick and cross glyphs.
		expect(document).toMatch(/<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="\d+"\/><\/w:numPr>.*?>First bullet<\/w:t>/)
		expect(document).toMatch(/<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="\d+"\/><\/w:numPr>.*?>Nested number<\/w:t>/)
		const numbering = read('word/numbering.xml')
		for (const glyph of ['✓', '✗', '☑']) expect(numbering).toContain(`<w:lvlText w:val="${glyph}"/>`)
		expect(numbering).toContain('<w:start w:val="3"/>')
		// Columns, the resources, a quotation.
		expect(document).toMatch(/>Left column<\/w:t>(?:(?!<\/w:tr>).)*>Right column<\/w:t>/)
		expect(document).toContain('>Cancer Council</w:t>')
		expect(read('word/_rels/document.xml.rels')).toContain('https://www.cancer.org.au')
		expect(document).toContain('>Principle 4</w:t>')
		expect(document).toContain('>A quotation.</w:t>')
		// Images: embedded where Word can take them, the alt text where it cannot.
		expect([...files.keys()].filter((name) => name.startsWith('word/media/')).length).toBeGreaterThan(0)
		expect(document).toContain('descr="Figure A"')
		expect(document).toContain('>[A drawing]</w:t>')
		// The snapshot, off the timeframe boxes.
		expect(document).toMatch(/>Pathway step<\/w:t>.*?>Timeframe for referral<\/w:t>.*?>Within two weeks\.<\/w:t>.*?> or <\/w:t>.*?>Within four weeks\.<\/w:t>/)
		expect(document).toContain('<w:br w:type="page"/>')
		// The references, a printed address its link.
		expect(document).toMatch(/<w:pStyle w:val="Heading1"\/>.*?>References<\/w:t>/)
		expect(document).toMatch(/>1\.<\/w:t><w:tab\/>.*?>First reference, viewed 1 May 2020, &lt;<\/w:t>.*?>www\.example\.org\/one<\/w:t>/)
		expect(read('word/_rels/document.xml.rels')).toContain('https://www.example.org/one')
		expect(read('word/_rels/document.xml.rels')).toContain('https://example.org/two')
		// Marked as a draft.
		expect(document).toContain('>Draft edition 3</w:t>')
		expect(document).toContain('>Not for publication. Exported 24 September 2026 by Ada Drafter.</w:t>')
		const headers = [...files.keys()].filter((name) => /^word\/header\d+\.xml$/.test(name)).map(read).join('')
		expect(headers).toContain('DRAFT — edition 3, not published · exported 24 September 2026')
		expect(read('docProps/core.xml')).toContain('<dc:title>Optimal care pathway for people with test cancer</dc:title>')
	})

	it('writes a pathway without its guidance or instructions, the subject filled', async () => {
		const body: JsonNode = {
			type: 'doc',
			content: [
				p(text('People with '), text('[cancer type]', [{ type: 'placeholder', attrs: { label: '[cancer type]' } }]), text(' should be seen.'), text(' <for this pathway only>', [{ type: 'instruction' }])),
				{ type: 'guidance', attrs: { done: false }, content: [p(text('Write the subject here.'))] },
			],
		}
		const { document } = await build([{ depth: 0, printedNumber: '2.1', title: 'Signs', titleCitations: [], body: publishBody(body, 'test cancer', 'pathway') }])
		expect(document).toContain('>test cancer</w:t>')
		expect(document).not.toContain('Drafting guidance')
		expect(document).not.toContain('for this pathway only')
	})

	it('reads an image size off its bytes, and refuses what Word cannot embed', () => {
		expect(pictureOf(PNG)).toMatchObject({ type: 'png', width: 1, height: 1 })
		expect(pictureOf(SVG)).toBeNull()
	})
})
