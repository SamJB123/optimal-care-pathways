/**
 * Stage two: the extracted document model → the content schema, section by section, plus
 * the template, document, section and reference rows the seed writes.
 *
 * This is where the template's GRAMMAR is read off the model's marks and shapes. Nothing
 * here names a colour or a page: what a developer instruction looks like is learned from
 * the document itself (the colour of the text beside its pen icons), a box is a table whose
 * rows are single cells, a band is a dark cell with light text, a highlight is an editable
 * slot, an "Or" row in the instruction colour separates alternatives, a stopwatch icon
 * opens a timeframe, and every other icon names the kind of box it heads.
 *
 *   paragraph → paragraph (runs → text with marks; a paragraph entirely in the
 *               instruction colour → guidance)
 *   list      → list (bullet | ordered | check, nested lists inside items)
 *   table     → a box when every row is one cell (kind from its icon; rows become
 *               banner / guidance / variants / timeframe / check lists / paragraphs), or
 *               a table when rows have several columns (label cells as header cells);
 *               a mixed table is a box holding a table
 *   figure    → image (icons that head bands are consumed as the box's icon instead)
 *   footnote  → footnote atom; endnote marker → citation atom
 *
 * Sections get the addresses the CMS keys on: the printed number where there is one, the
 * step number for a step, a slug path under the parent otherwise.
 */

import type { JsonMark, JsonNode } from '#/content/schema.ts'
import type { Ownership } from '#/db/schema.ts'
import type { DocumentRow, ReferenceRow, SectionRow, SeedResult, TemplateRow } from '../rows.ts'
import { figureUrl, type TemplateInfo } from '../templates.ts'
import type {
	Block,
	ExtractedDocument,
	Figure,
	List,
	Paragraph,
	Section,
	Table,
	TableCell,
	TableRow,
	TextRun,
} from './model.ts'
import { plainText } from './model.ts'

export interface MapInput {
	model: ExtractedDocument
	template: TemplateInfo
	/** The central organisation that owns core content. */
	orgId: string
	/** Deterministic id for a (kind, key) pair. */
	id: (kind: 'template' | 'document' | 'section' | 'reference', key: string) => string
}

// ---------------------------------------------------------------------------
// Learned styles
// ---------------------------------------------------------------------------

interface Grammar {
	/** Colours of developer instruction text (green in one template, purple in another). */
	instruction: Set<string>
	/** Colours body prose is set in. */
	body: Set<string>
	/** Where each section's heading sits, for resolving internal links to the nearest one. */
	headings: { page: number; y: number; address: string }[]
	referenceId: (number: number) => string
	footnotes: ExtractedDocument['footnotes']
	templateKey: string
	stats: SeedResult['stats']
	/** Each content figure's per-page index (see `contentFigures`). */
	figureIndex: Map<Figure, number>
}

/** The band glyphs by their alt text, first match wins ("Calligraphy Pen", "Information",
 *  "Right pointing backhand index", "Stopwatch", "Clipboard Checked", "Chat", "Open hand"
 *  in the 2026 templates). Word-bounded, so "Open" is not a pen and "backhand" is not an
 *  open hand. */
const ICONS: {
	test: RegExp
	icon: string
	kind: JsonNode['attrs'] extends infer _ ? string : never
}[] = [
	{ test: /\bpen\b|pencil|calligraphy/i, icon: 'pen', kind: 'developer' },
	{ test: /information|\binfo\b/i, icon: 'info', kind: 'resources' },
	{ test: /pointing|\bindex\b|backhand/i, icon: 'hand', kind: 'seeAlso' },
	{ test: /stopwatch|clock|timer/i, icon: 'stopwatch', kind: 'timeframe' },
	{ test: /clipboard|checklist|\btasks?\b/i, icon: 'clipboard', kind: 'actions' },
	{ test: /speech|comment|bubble|\bchat\b/i, icon: 'speech', kind: 'communication' },
	{
		test: /\bopen hand\b|\bhands\b|\bcare\b|\bheart\b|\bsupport\b/i,
		icon: 'care',
		kind: 'considerations',
	},
]

const iconOf = (figure: Figure) => ICONS.find((i) => i.test.test(figure.alt)) ?? null

/** A small figure with an icon-like alt text: a band glyph, not content. */
const isIcon = (figure: Figure): boolean => {
	if (!iconOf(figure)) return false
	const b = figure.bbox
	if (!b) return true
	return b[2] - b[0] <= 40 && b[3] - b[1] <= 40
}

function allParagraphs(blocks: Block[], into: Paragraph[] = []): Paragraph[] {
	for (const b of blocks) {
		if (b.kind === 'paragraph') into.push(b)
		else if (b.kind === 'list') for (const item of b.items) allParagraphs(item.blocks, into)
		else if (b.kind === 'table')
			for (const row of b.rows) for (const cell of row.cells) allParagraphs(cell.blocks, into)
	}
	return into
}

function allBlocks(sections: Section[], into: Block[] = []): Block[] {
	for (const s of sections) {
		into.push(...s.blocks)
		allBlocks(s.children, into)
	}
	return into
}

/** The figures that are CONTENT (not band icons), numbered per page in document order —
 *  the numbering both the mapper's image nodes and the renderer's files use. */
export function contentFigures(model: ExtractedDocument): { figure: Figure; index: number }[] {
	const out: { figure: Figure; index: number }[] = []
	const perPage = new Map<number, number>()
	const visit = (blocks: Block[]) => {
		for (const b of blocks) {
			if (b.kind === 'figure') {
				if (isIcon(b)) continue
				const index = (perPage.get(b.page) ?? 0) + 1
				perPage.set(b.page, index)
				out.push({ figure: b, index })
			} else if (b.kind === 'list') for (const item of b.items) visit(item.blocks)
			else if (b.kind === 'table')
				for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks)
		}
	}
	visit(model.front)
	const sections = (list: Section[]) => {
		for (const s of list) {
			visit(s.blocks)
			sections(s.children)
		}
	}
	sections(model.sections)
	return out
}

const luminance = (hex: string): number => {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
	if (!m) return 1
	const [r, g, b] = [m[1], m[2], m[3]].map((h) => Number.parseInt(h ?? '0', 16) / 255)
	return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)
}

/** Learn the instruction colour(s) from the template's own legend: the cells that carry the
 *  pen icon are developer instructions, so a colour ENRICHED there relative to the whole
 *  document (at least three times its overall share, and not the dominant text colour) is
 *  the instruction colour. Body colours are then the frequent colours that are not
 *  instruction. */
function learnGrammar(model: ExtractedDocument): Pick<Grammar, 'instruction' | 'body'> {
	const blocks = [...model.front, ...allBlocks(model.sections)]
	const overall = new Map<string, number>()
	for (const p of allParagraphs(blocks))
		for (const r of p.runs)
			overall.set(r.colour, (overall.get(r.colour) ?? 0) + r.text.trim().length)
	const total = [...overall.values()].reduce((n, w) => n + w, 0)
	const dominant = [...overall.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]

	const inPen = new Map<string, number>()
	for (const b of blocks) {
		if (b.kind !== 'table') continue
		for (const row of b.rows) {
			for (const cell of row.cells) {
				if (!cell.blocks.some((c) => c.kind === 'figure' && iconOf(c)?.icon === 'pen')) continue
				for (const p of allParagraphs(cell.blocks))
					for (const r of p.runs)
						inPen.set(r.colour, (inPen.get(r.colour) ?? 0) + r.text.trim().length)
			}
		}
	}
	const penTotal = [...inPen.values()].reduce((n, w) => n + w, 0)
	const instruction = new Set<string>()
	for (const [colour, w] of inPen) {
		if (colour === dominant || luminance(colour) > 0.9 || penTotal === 0) continue
		const share = w / penTotal
		const overallShare = (overall.get(colour) ?? 0) / Math.max(1, total)
		if (share >= 0.2 && share > overallShare * 3) instruction.add(colour)
	}

	const body = new Set<string>()
	let covered = 0
	for (const [colour, w] of [...overall.entries()].sort((a, b) => b[1] - a[1])) {
		if (instruction.has(colour)) continue
		if (covered / Math.max(1, total) > 0.85) break
		body.add(colour)
		covered += w
	}
	return { instruction, body }
}

// ---------------------------------------------------------------------------
// Inline content
// ---------------------------------------------------------------------------

const text = (value: string, marks: JsonMark[]): JsonNode =>
	marks.length > 0 ? { type: 'text', text: value, marks } : { type: 'text', text: value }

const ANGLE_TOKEN = /^<[^<>]+>$/

const BRACKET_PAIRS: [string, string][] = [
	['[', ']'],
	['<', '>'],
	['(', ')'],
]

/** A placeholder is one highlighted token, however the drawing broke it up:
 *   - a space between two runs highlighted in one colour is highlighted too (a
 *     placeholder wrapped over a line break has no fill under the break);
 *   - a bracket immediately outside the highlighted span, whose pair closes it, joins it
 *     ("[|xx]|" and "|[xx]|" both occur in the source; the token is "[xx]" either way). */
function normalisePlaceholders(runs: TextRun[]): TextRun[] {
	const out = runs.map((r) => ({ ...r }))
	for (const [i, r] of out.entries()) {
		if (r.background !== null || r.text.trim() !== '') continue
		const before = out[i - 1]
		const after = out[i + 1]
		if (before && after && before.background !== null && before.background === after.background)
			r.background = before.background
	}
	let i = 0
	while (i < out.length) {
		const first = out[i]
		if (!first || first.background === null || first.text.trim() === '') {
			i++
			continue
		}
		let end = i
		while (out[end + 1]?.background === first.background) end++
		const last = out[end]
		const before = out[i - 1]
		const after = out[end + 1]
		if (last) {
			for (const [open, close] of BRACKET_PAIRS) {
				const closes = last.text.trimEnd().endsWith(close) || after?.text.startsWith(close) === true
				if (
					before &&
					before.background === null &&
					before.text.endsWith(open) &&
					!first.text.startsWith(open) &&
					closes
				) {
					before.text = before.text.slice(0, -1)
					first.text = `${open}${first.text}`
				}
				if (
					after &&
					after.background === null &&
					after.text.startsWith(close) &&
					!last.text.trimEnd().endsWith(close) &&
					first.text.startsWith(open)
				) {
					after.text = after.text.slice(1)
					last.text = `${last.text.trimEnd()}${close}`
				}
			}
		}
		i = end + 1
	}
	// One token, one run: highlighted runs the drawing split (at a line break, at a glyph
	// run boundary) but that carry the same marks are the same placeholder.
	const merged: TextRun[] = []
	for (const r of out) {
		if (r.text === '' && r.footnote === null && r.endnote === null) continue
		const last = merged.at(-1)
		if (last && r.background !== null && sameMarks(last, r)) last.text += r.text
		else merged.push(r)
	}
	return merged
}

const sameMarks = (a: TextRun, b: TextRun): boolean =>
	a.background === b.background &&
	a.bold === b.bold &&
	a.italic === b.italic &&
	a.underline === b.underline &&
	a.superscript === b.superscript &&
	a.subscript === b.subscript &&
	a.colour === b.colour &&
	JSON.stringify(a.link) === JSON.stringify(b.link) &&
	a.footnote === null &&
	b.footnote === null &&
	a.endnote === null &&
	b.endnote === null

function inlineOf(
	runs: TextRun[],
	g: Grammar,
	options: { instructionAsMark: boolean },
): JsonNode[] {
	const out: JsonNode[] = []
	for (const r of normalisePlaceholders(runs)) {
		if (r.footnote !== null) {
			const note = g.footnotes[r.footnote]
			if (note) {
				g.stats.footnotes++
				out.push({
					type: 'footnote',
					attrs: { text: plainText(allParagraphs(note.blocks).flatMap((p) => p.runs)).trim() },
				})
			}
			continue
		}
		if (r.endnote !== null) {
			g.stats.citations++
			out.push({ type: 'citation', attrs: { referenceId: g.referenceId(r.endnote) } })
			continue
		}
		if (r.text === '') continue
		const marks: JsonMark[] = []
		if (r.bold) marks.push({ type: 'bold' })
		if (r.italic) marks.push({ type: 'italic' })
		if (r.underline && !r.link) marks.push({ type: 'underline' })
		if (r.superscript) marks.push({ type: 'superscript' })
		if (r.subscript) marks.push({ type: 'subscript' })
		let link = false
		let placeholder = false
		if (r.link) {
			if ('url' in r.link) {
				link = true
				marks.push({ type: 'link', attrs: { href: r.link.url } })
			} else {
				const address = sectionAt(g, r.link.page, r.link.y)
				if (address) marks.push({ type: 'sectionLink', attrs: { address } })
			}
		}
		const trimmed = r.text.trim()
		if (
			r.background !== null ||
			(ANGLE_TOKEN.test(trimmed) && !g.body.has(r.colour) && !g.instruction.has(r.colour))
		) {
			placeholder = true
			marks.push({ type: 'placeholder', attrs: { label: trimmed } })
		} else if (options.instructionAsMark && g.instruction.has(r.colour)) {
			marks.push({ type: 'instruction' })
		}
		// A '\n' in a run is a hard line break the author typed.
		const pieces = r.text.split('\n')
		for (const [index, piece] of pieces.entries()) {
			if (index > 0) out.push({ type: 'hardBreak' })
			if (piece === '') continue
			const last = out.at(-1)
			if (last?.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks))
				last.text = `${last.text}${piece}`
			else {
				// Counted per node, not per drawn run: one link or slot however many runs drew it.
				if (link) g.stats.links++
				if (placeholder) g.stats.placeholders++
				out.push(text(piece, marks))
			}
		}
	}
	// Whitespace at the edges belongs to the layout, not the content.
	const first = out[0]
	if (first?.type === 'text' && first.text) first.text = first.text.replace(/^\s+/, '')
	const last = out.at(-1)
	if (last?.type === 'text' && last.text) last.text = last.text.replace(/\s+$/, '')
	return out.filter((n) => n.type !== 'text' || (n.text ?? '') !== '')
}

/** The section an internal destination points at: on its page, the heading nearest to
 *  the destination's y at or just below it (a destination names the top of its target);
 *  without a y, the first heading on the page; failing that, the last section begun
 *  before the page. */
function sectionAt(g: Grammar, page: number, y: number | null): string | null {
	const onPage = g.headings.filter((h) => h.page === page)
	if (onPage.length === 0) {
		const before = g.headings
			.filter((h) => h.page < page)
			.sort((a, b) => b.page - a.page || a.y - b.y)[0]
		return before?.address ?? null
	}
	if (y === null) return [...onPage].sort((a, b) => b.y - a.y)[0]?.address ?? null
	const below = onPage.filter((h) => h.y <= y + 20).sort((a, b) => b.y - a.y)
	return (
		(below[0] ?? [...onPage].sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))[0])?.address ??
		null
	)
}

const isInstructionRun = (r: TextRun, g: Grammar) =>
	r.text.trim() === '' || g.instruction.has(r.colour)
const isInstructionParagraph = (p: Paragraph, g: Grammar) =>
	p.runs.some((r) => r.text.trim() !== '') &&
	p.runs.every((r) => isInstructionRun(r, g) || r.footnote !== null || r.endnote !== null)

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

const paragraphNode = (p: Paragraph, g: Grammar): JsonNode | null => {
	const content = inlineOf(p.runs, g, { instructionAsMark: !isInstructionParagraph(p, g) })
	return content.length > 0 ? { type: 'paragraph', content } : null
}

function listNode(list: List, g: Grammar): JsonNode[] {
	// ProseKit's flat list: each item is a `list` node; a nested list is a child node.
	const nodes: JsonNode[] = []
	for (const item of list.items) {
		const kind =
			item.marker === 'check' || item.marker === 'cross'
				? 'check'
				: item.marker === 'number'
					? 'ordered'
					: 'bullet'
		const content: JsonNode[] = []
		let first = true
		for (const b of item.blocks) {
			if (first && b.kind === 'paragraph') {
				const p = paragraphNode(b, g)
				if (p) content.push(p)
				first = false
				continue
			}
			first = false
			content.push(...blockNodes([b], g))
		}
		if (content.length === 0) continue
		if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' })
		if (kind === 'check') g.stats.checkItems++
		nodes.push({
			type: 'list',
			attrs: kind === 'check' ? { kind, pointOfCare: false } : { kind },
			content,
		})
	}
	return nodes
}

/** Consecutive instruction paragraphs and instruction-only lists fold into one guidance node. */
function foldGuidance(nodes: { node: JsonNode; instruction: boolean }[], g: Grammar): JsonNode[] {
	const out: JsonNode[] = []
	for (const { node, instruction } of nodes) {
		const last = out.at(-1)
		if (instruction) {
			if (last?.type === 'guidance') last.content?.push(node)
			else {
				g.stats.guidance++
				out.push({ type: 'guidance', content: [node] })
			}
		} else out.push(node)
	}
	return out
}

/** A box's heading row: an icon row or a band. Every box begins with one. */
const isHeadingRow = (row: ClassifiedRow): boolean =>
	row.icon !== null || row.kind === 'band' || row.kind === 'icon-band'

/** Every box begins with a heading row, so a table that begins without one — an "Or", a
 *  statement, guidance, check items — directly after a box continues that box: Word saved
 *  the rows as a table of their own, butted against the first. */
function joinButtedTables(blocks: Block[], g: Grammar): Block[] {
	const out: Block[] = []
	for (const b of blocks) {
		const last = out.at(-1)
		if (b.kind === 'table' && last?.kind === 'table') {
			const first = b.rows[0] ? classifyRow(b.rows[0], g, { collapseEmpty: true }) : null
			const lastRows = last.rows.map((r) => classifyRow(r, g, { collapseEmpty: true }))
			const lastIsBox = lastRows.some(isHeadingRow) && !lastRows.every((r) => r.kind === 'columns')
			// A real table (every row in columns) stands on its own, heading row or not.
			const realTable = b.rows.every(
				(r) => classifyRow(r, g, { collapseEmpty: false }).kind === 'columns',
			)
			if (first && !isHeadingRow(first) && lastIsBox && !realTable) {
				out[out.length - 1] = { ...last, rows: [...last.rows, ...b.rows] }
				continue
			}
		}
		out.push(b)
	}
	return out
}

function blockNodes(blocks: Block[], g: Grammar): JsonNode[] {
	const staged: { node: JsonNode; instruction: boolean }[] = []
	for (const b of joinButtedTables(blocks, g)) {
		switch (b.kind) {
			case 'paragraph': {
				const node = paragraphNode(b, g)
				if (node) staged.push({ node, instruction: isInstructionParagraph(b, g) })
				break
			}
			case 'list': {
				const everyInstruction = b.items.every((i) =>
					allParagraphs(i.blocks).every((p) => isInstructionParagraph(p, g)),
				)
				for (const node of listNode(b, g)) staged.push({ node, instruction: everyInstruction })
				break
			}
			case 'table':
				for (const node of tableNodes(b, g)) staged.push({ node, instruction: false })
				break
			case 'figure': {
				if (isIcon(b)) break
				g.stats.figures++
				const index = g.figureIndex.get(b) ?? 0
				staged.push({
					node: {
						type: 'image',
						attrs: { src: figureUrl(g.templateKey, b.page, index), alt: b.alt },
					},
					instruction: false,
				})
				break
			}
		}
	}
	return foldGuidance(staged, g)
}

// ---------------------------------------------------------------------------
// Tables: boxes and real tables
// ---------------------------------------------------------------------------

type RowKind = 'icon-band' | 'band' | 'instruction' | 'or' | 'content' | 'columns'

interface ClassifiedRow {
	row: TableRow
	kind: RowKind
	icon: (typeof ICONS)[number] | null
	/** The cells that carry content (icon-only cells removed). */
	cells: TableCell[]
}

const cellText = (cell: TableCell) =>
	plainText(allParagraphs(cell.blocks).flatMap((p) => p.runs)).trim()
const cellFigures = (cell: TableCell): Figure[] =>
	cell.blocks.flatMap((b) => (b.kind === 'figure' ? [b] : []))
const cellIsIconOnly = (cell: TableCell) =>
	cellText(cell) === '' && cellFigures(cell).length > 0 && cellFigures(cell).every(isIcon)
const cellIsBand = (cell: TableCell): boolean => {
	const paragraphs = allParagraphs(cell.blocks)
	if (paragraphs.length === 0 || cell.background === null) return false
	const runs = paragraphs.flatMap((p) => p.runs).filter((r) => r.text.trim() !== '')
	return (
		luminance(cell.background) < 0.45 &&
		runs.length > 0 &&
		runs.every((r) => luminance(r.colour) > 0.8)
	)
}

const cellIsEmpty = (cell: TableCell) => cellText(cell) === '' && cellFigures(cell).length === 0

/** In a box, an empty cell is the continuation of a cell merged from the row above (the
 *  icon cell beside a stack of statements) and is not a column of its own; in a real table
 *  an empty cell is a cell, so it is kept. */
function classifyRow(
	row: TableRow,
	g: Grammar,
	options: { collapseEmpty: boolean },
): ClassifiedRow {
	const cells = row.cells.filter(
		(c) => !cellIsIconOnly(c) && !(options.collapseEmpty && cellIsEmpty(c)),
	)
	const icons = row.cells
		.flatMap(cellFigures)
		.filter(isIcon)
		.map(iconOf)
		.filter((i): i is (typeof ICONS)[number] => i !== null)
	const icon = icons[0] ?? null
	if (cells.length === 0) return { row, kind: 'icon-band', icon, cells }
	if (cells.length >= 2) return { row, kind: 'columns', icon, cells }
	const only = cells[0]
	if (!only) return { row, kind: 'content', icon, cells }
	const paragraphs = allParagraphs(only.blocks)
	const textOnly = cellText(only)
	if (/^or$/i.test(textOnly)) return { row, kind: 'or', icon, cells }
	if (cellIsBand(only)) return { row, kind: icon ? 'icon-band' : 'band', icon, cells }
	if (
		paragraphs.length > 0 &&
		paragraphs.every((p) => isInstructionParagraph(p, g)) &&
		!only.blocks.some((b) => b.kind === 'list' && b.items.some((i) => i.marker === 'check'))
	) {
		return { row, kind: 'instruction', icon, cells }
	}
	return { row, kind: 'content', icon, cells }
}

const bannerNode = (cell: TableCell, g: Grammar): JsonNode => ({
	type: 'banner',
	content: inlineOf(
		allParagraphs(cell.blocks).flatMap((p) => p.runs),
		g,
		{ instructionAsMark: false },
	),
})

/** A real table: rows of several columns; shaded or TH label cells are header cells. */
function tableNode(rows: ClassifiedRow[], g: Grammar): JsonNode {
	g.stats.tables++
	return {
		type: 'table',
		content: rows.map((r) => ({
			type: 'tableRow',
			content: r.cells.map((cell) => {
				const blocks = blockNodes(
					cell.blocks.filter((b) => !(b.kind === 'figure' && isIcon(b))),
					g,
				)
				const header = cell.header && cell.background !== null && luminance(cell.background) < 0.97
				return {
					type: header ? 'tableHeaderCell' : 'tableCell',
					attrs: { colspan: cell.colSpan, rowspan: cell.rowSpan },
					content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }],
				}
			}),
		})),
	}
}

/** Consecutive check-list rows of a box become one check list; group-header rows stay
 *  paragraphs between them. */
function boxContent(rows: ClassifiedRow[], g: Grammar): JsonNode[] {
	const out: JsonNode[] = []
	let columns: ClassifiedRow[] = []
	const flushColumns = () => {
		if (columns.length > 0) out.push(tableNode(columns, g))
		columns = []
	}
	for (const r of rows) {
		if (r.kind === 'columns') {
			columns.push(r)
			continue
		}
		flushColumns()
		const cell = r.cells[0]
		if (!cell) continue
		if (r.kind === 'band' || r.kind === 'icon-band') {
			out.push(bannerNode(cell, g))
			continue
		}
		const nodes = blockNodes(cell.blocks, g)
		for (const node of nodes) {
			const last = out.at(-1)
			// Adjacent check lists from consecutive rows are one list.
			if (
				node.type === 'list' &&
				last?.type === 'list' &&
				node.attrs?.kind === 'check' &&
				last.attrs?.kind === 'check'
			) {
				out.push(node)
			} else out.push(node)
		}
	}
	flushColumns()
	return out
}

/** Rows split by "Or" rows → alternatives. */
function splitAlternatives(rows: ClassifiedRow[]): ClassifiedRow[][] {
	const groups: ClassifiedRow[][] = [[]]
	for (const r of rows) {
		if (r.kind === 'or') groups.push([])
		else groups.at(-1)?.push(r)
	}
	return groups.filter((gr) => gr.length > 0)
}

function timeframeNodes(rows: ClassifiedRow[], g: Grammar): JsonNode[] {
	// Each stopwatch row: a care point (the bold lead paragraph) and its statement(s);
	// "Or" rows between statements make alternatives of one care point.
	const out: JsonNode[] = []
	let current: { carePoint: JsonNode[]; alternatives: JsonNode[][] } | null = null
	const flush = () => {
		if (!current) return
		g.stats.timeframes++
		const statements: JsonNode[] =
			current.alternatives.length > 1
				? [
						{
							type: 'variants',
							content: current.alternatives.map((blocks) => ({ type: 'variant', content: blocks })),
						},
					]
				: (current.alternatives[0] ?? [{ type: 'paragraph' }])
		if (current.alternatives.length > 1) g.stats.variants++
		const carePoint: JsonNode =
			current.carePoint.length > 0
				? { type: 'carePoint', content: current.carePoint }
				: { type: 'carePoint' }
		const empty: JsonNode[] = [{ type: 'paragraph' }]
		out.push({
			type: 'timeframe',
			content: [carePoint, ...(statements.length > 0 ? statements : empty)],
		})
		current = null
	}
	for (const r of rows) {
		if (r.kind === 'or') {
			current?.alternatives.push([])
			continue
		}
		const cell = r.cells[0]
		if (!cell) continue
		const paragraphs = cell.blocks.filter((b): b is Paragraph => b.kind === 'paragraph')
		const lead = paragraphs[0]
		const isLead = lead?.runs.filter((x) => x.text.trim()).every((x) => x.bold)
		if (
			isLead &&
			(r.icon?.icon === 'stopwatch' ||
				current === null ||
				current.alternatives.at(-1)?.length !== 0)
		) {
			// A new care point (a bold lead), unless we are mid-alternative awaiting a statement.
			if (!(current && current.alternatives.at(-1)?.length === 0)) {
				flush()
				// The care point keeps its marks: the template prints placeholders in it.
				current = {
					carePoint: inlineOf(lead.runs, g, { instructionAsMark: true }),
					alternatives: [[]],
				}
				const rest = blockNodes(
					cell.blocks.filter((b) => b !== lead && !(b.kind === 'figure' && isIcon(b))),
					g,
				)
				current.alternatives[0]?.push(...rest)
				continue
			}
		}
		if (!current) current = { carePoint: [], alternatives: [[]] }
		current.alternatives.at(-1)?.push(
			...blockNodes(
				cell.blocks.filter((b) => !(b.kind === 'figure' && isIcon(b))),
				g,
			),
		)
	}
	flush()
	return out
}

/** A real table: every row has columns and none is a band, an icon row or an "Or". */
const isRealTable = (table: Table, g: Grammar): boolean =>
	table.rows.every((r) => classifyRow(r, g, { collapseEmpty: false }).kind === 'columns')

function tableNodes(table: Table, g: Grammar): JsonNode[] {
	if (isRealTable(table, g))
		return [
			tableNode(
				table.rows.map((r) => classifyRow(r, g, { collapseEmpty: false })),
				g,
			),
		]

	const rows = table.rows.map((r) => classifyRow(r, g, { collapseEmpty: true }))
	// An icon row heads a box (the stopwatch heads a care point inside one), so a table
	// whose icon rows come mid-way holds that many boxes stacked in one Word table: the
	// pen row above a checklist, the See also under a Find out more, a supportive care
	// page's considerations / checklist / communication boxes.
	const segments: ClassifiedRow[][] = []
	for (const r of rows) {
		const heads = r.icon !== null && r.icon.icon !== 'stopwatch'
		if (heads || segments.length === 0) segments.push([r])
		else segments.at(-1)?.push(r)
	}
	return segments.flatMap((segment) => boxSegmentNodes(segment, g))
}

/** One box's rows (heading row first): a timeframe box, a box with a callout stacked
 *  under it, or a plain box. */
function boxSegmentNodes(rows: ClassifiedRow[], g: Grammar): JsonNode[] {
	const icons = rows.map((r) => r.icon).filter((i): i is (typeof ICONS)[number] => i !== null)
	const stopwatch = icons.some((i) => i.icon === 'stopwatch')

	// A timeframe box: stopwatch rows (with an optional instruction row above them).
	if (stopwatch) {
		const before = rows.filter(
			(r) =>
				r.kind === 'instruction' &&
				rows.indexOf(r) < rows.findIndex((x) => x.icon?.icon === 'stopwatch'),
		)
		const rest = rows.filter((r) => !before.includes(r))
		return [...boxContent(before, g), ...timeframeNodes(rest, g)]
	}

	// Under an icon heading, the box's rows are unshaded or share the heading's colour. A
	// single content row shaded in a light colour of its own, carrying no icon, is a callout
	// that Word stacked into the same table: it becomes a box of its own beside this one.
	const heading = rows[0]
	const headingBackground = heading?.cells[0]?.background ?? null
	const shadedRows = (colour: string) =>
		rows.filter((r) => r.cells[0]?.background === colour).length
	const isCallout = (r: ClassifiedRow) => {
		const background = r.cells[0]?.background ?? null
		if (
			!heading ||
			heading.icon === null ||
			r === heading ||
			r.kind !== 'content' ||
			r.icon !== null ||
			background === null
		)
			return false
		return (
			background !== headingBackground &&
			luminance(background) >= 0.45 &&
			shadedRows(background) === 1
		)
	}
	if (rows.some(isCallout)) {
		const out: JsonNode[] = []
		let run: ClassifiedRow[] = []
		const flush = () => {
			if (run.length > 0) out.push(...boxNodes(run, icons, g))
			run = []
		}
		for (const r of rows) {
			if (isCallout(r)) {
				flush()
				out.push(...boxNodes([r], [], g))
			} else run.push(r)
		}
		flush()
		return out
	}
	return boxNodes(rows, icons, g)
}

/** A box: its kind from the first icon; without one, a plain box when a banner heads it
 *  and a callout when it is shaded statements alone. */
function boxNodes(rows: ClassifiedRow[], icons: (typeof ICONS)[number][], g: Grammar): JsonNode[] {
	const first = icons[0]
	const banded = rows.some((r) => r.kind === 'band')
	const kind = first ? first.kind : banded ? 'plain' : 'callout'
	const icon = first?.icon ?? ''
	g.stats.boxes++
	const alternatives = splitAlternatives(rows)
	let content: JsonNode[]
	if (alternatives.length > 1) {
		// The box's heading rows introduce it — the icon row(s) and any band directly under
		// them; everything after that up to the first "Or" is the first alternative, even
		// when it is only guidance on what to write.
		const firstGroup = alternatives[0] ?? []
		let introEnd = 0
		while (introEnd < firstGroup.length && firstGroup[introEnd]?.icon !== null) introEnd++
		while (introEnd < firstGroup.length && firstGroup[introEnd]?.kind === 'band') introEnd++
		const intro = firstGroup.slice(0, introEnd)
		const firstAlternative = firstGroup.slice(introEnd)
		const groups = [firstAlternative, ...alternatives.slice(1)].filter((gr) => gr.length > 0)
		g.stats.variants++
		content = [
			...boxContent(intro, g),
			{
				type: 'variants',
				content: groups.map((gr) => {
					const nodes = boxContent(gr, g)
					return { type: 'variant', content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }] }
				}),
			},
		]
	} else content = boxContent(rows, g)
	if (content.length === 0) return []
	return [{ type: 'box', attrs: { kind, icon }, content }]
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/\[[^\]]*\]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'section'

const APPARATUS = /^(contents|cancer-specific-template|population-based-template|core-content)$/
const APPARATUS_SUBTREE = /^cover\/instructions-for-developers(\/|$)/

interface Placed {
	section: Section
	address: string
	parent: Placed | null
	canonical: boolean
	stepNumber: number | null
	orderIndex: number
}

/** Addresses: the printed number for numbered sections under a step, the step number for
 *  a step, otherwise a slug path under the parent. Duplicates get a suffix. */
function placeSections(model: ExtractedDocument): Placed[] {
	const placed: Placed[] = []
	const used = new Set<string>()
	const unique = (address: string) => {
		let candidate = address
		let n = 2
		while (used.has(candidate)) candidate = `${address}-${n++}`
		used.add(candidate)
		return candidate
	}
	const visit = (sections: Section[], parent: Placed | null) => {
		sections.forEach((section, index) => {
			const step = section.number?.match(/^Step (\d+)$/)
			const numbered =
				section.number && /^\d+(\.\d+)*$/.test(section.number) ? section.number : null
			const rootIsStep =
				parent === null ? step !== null : parent.stepNumber !== null && parent.canonical
			let address: string
			let canonical = false
			let stepNumber: number | null = parent?.stepNumber ?? null
			if (step && parent === null) {
				address = step[1] ?? slugify(section.headingText)
				canonical = true
				stepNumber = Number(step[1])
			} else if (numbered && rootIsStep) {
				address = numbered
				canonical = true
				stepNumber = Number(numbered.split('.')[0])
			} else {
				const slug = slugify(
					section.headingText.replace(
						/^Step \d+:?\s*/i,
						(m) => `${m.trim().replace(/:$/, '').toLowerCase()} `,
					),
				)
				address = parent ? `${parent.address}/${slug}` : slug
			}
			address = unique(address)
			const entry: Placed = { section, address, parent, canonical, stepNumber, orderIndex: index }
			placed.push(entry)
			visit(section.children, entry)
		})
	}
	visit(model.sections, null)
	return placed
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The heading without its printed number ("1.1 Prevention" → "Prevention", "Step 1:
 *  Treatment" → "Treatment"); the number is kept on the row's own column. */
function titleOf(headingText: string, number: string | null): string | null {
	const title = number
		? headingText.replace(new RegExp(`^${escapeRegExp(number)}:?\\s*`), '')
		: headingText
	return title.trim() || null
}

/** A section each pathway writes for itself: it contains a developer box, a highlight or
 *  an instruction. Otherwise its text is shared across pathways. */
function ownershipOf(section: Section, g: Grammar): Ownership {
	const paragraphs = allParagraphs(section.blocks)
	const hasInstruction = paragraphs.some((p) =>
		p.runs.some(
			(r) => r.text.trim() !== '' && (g.instruction.has(r.colour) || r.background !== null),
		),
	)
	const hasPen = section.blocks.some(
		(b) =>
			b.kind === 'table' &&
			b.rows.some((r) =>
				r.cells.some((c) => cellFigures(c).some((f) => iconOf(f)?.icon === 'pen')),
			),
	)
	return hasInstruction || hasPen ? 'owned' : 'shared'
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function mapTemplate(input: MapInput): SeedResult {
	const { model, template, orgId, id } = input
	const documentId = id('document', `${template.templateId}:core`)
	const learned = learnGrammar(model)
	const stats: SeedResult['stats'] = {
		checkItems: 0,
		citations: 0,
		footnotes: 0,
		timeframes: 0,
		guidance: 0,
		boxes: 0,
		variants: 0,
		tables: 0,
		figures: 0,
		links: 0,
		placeholders: 0,
	}
	const placed = placeSections(model)
	const g: Grammar = {
		...learned,
		headings: placed.map((p) => ({ page: p.section.page, y: p.section.y, address: p.address })),
		referenceId: (n) => id('reference', `${template.templateId}:${n}`),
		footnotes: model.footnotes,
		templateKey: template.key,
		stats,
		figureIndex: new Map(contentFigures(model).map(({ figure, index }) => [figure, index])),
	}

	const templateRow: TemplateRow = {
		id: template.templateId,
		kind: template.kind,
		label: `Public consultation draft, ${template.issuedOn}`,
		sourceFile: template.sourceFile,
		issuedOn: template.issuedOn,
		pageCount: model.pages,
	}
	const document: DocumentRow = {
		id: documentId,
		kind: 'core',
		templateId: template.templateId,
		orgId,
		slug: template.coreSlug,
		title: model.title,
		subject: template.coreSubject,
		audience: template.kind,
	}

	const sectionId = (p: Placed) => id('section', `${template.templateId}:${p.address}`)
	const sections: SectionRow[] = placed.map((p) => {
		const apparatus =
			APPARATUS.test(p.address) ||
			APPARATUS_SUBTREE.test(p.address) ||
			p.parent?.address === 'contents'
		// The contents page is a derived view of the section tree, never content; a
		// template-declared derived section keeps its prose and boxes but its printed table
		// (the snapshot schematic) is replaced by the node the CMS renders from the document.
		const derived = template.derived.find((d) => d.address === p.address)
		const body =
			p.address === 'contents'
				? []
				: derived
					? [
							...blockNodes(
								p.section.blocks.filter((b) => !(b.kind === 'table' && isRealTable(b, g))),
								g,
							),
							{ type: derived.node },
						]
					: blockNodes(p.section.blocks, g)
		const number = p.section.number
		return {
			id: sectionId(p),
			documentId,
			parentId: p.parent ? sectionId(p.parent) : null,
			address: p.address,
			canonical: p.canonical,
			printedNumber: number,
			title: titleOf(p.section.headingText, number),
			headingLevel: p.section.level,
			orderIndex: p.orderIndex,
			stepNumber: p.stepNumber,
			ownership: 'owned',
			pathwayOwnership: ownershipOf(p.section, g),
			apparatus,
			bodyJson: { type: 'doc', content: body.length > 0 ? body : [{ type: 'paragraph' }] },
		}
	})

	const references: ReferenceRow[] = model.endnotes.map((e) => {
		const url = e.runs.find((r) => r.link && 'url' in r.link)?.link
		const urlText = plainText(e.runs).match(/https?:\/\/\S+/)?.[0]
		return {
			id: g.referenceId(e.number),
			documentId,
			citation: plainText(e.runs).replace(/\s+/g, ' ').trim(),
			url: url && 'url' in url ? url.url : (urlText ?? null),
			printedNumber: e.number,
		}
	})

	return { template: templateRow, document, sections, references, stats }
}
