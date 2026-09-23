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

import type { ColorFamily, JsonMark, JsonNode } from '#/content/schema.ts'
import type { Ownership } from '#/db/schema.ts'
import type { DocumentRow, ReferenceRow, SectionRow, SeedResult, TemplateRow } from '../rows.ts'
import { figureUrl, type TemplateInfo } from '../templates.ts'
import {
	type HyperlinkOccurrence,
	type HyperlinkTargets,
	hasHyperlinkNote,
	resolveHyperlinks,
} from './hyperlinks.ts'
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
	/** Where the authors' "<hyperlink to be added>" notes point (hyperlinks.ts). Without
	 *  it the notes stay as printed. */
	hyperlinks?: HyperlinkTargets
}

/** The rows, and what became of each "<hyperlink to be added>" note, in section order. */
export interface MappedTemplate extends SeedResult {
	hyperlinks: (HyperlinkOccurrence & {
		address: string
		printedNumber: string | null
		title: string | null
	})[]
}

// ---------------------------------------------------------------------------
// Learned styles
// ---------------------------------------------------------------------------

interface Grammar {
	/** Colours of developer instruction text (green in one template, purple in another). */
	instruction: Set<string>
	/** Colours body prose is set in. */
	body: Set<string>
	/** Colours of editorial asides — whole paragraphs set in a colour of their own that is
	 *  neither body, instruction nor a link (the Principles' purple notes). */
	note: Set<string>
	/** Where each section's heading sits, for resolving internal links to the nearest one. */
	headings: { page: number; y: number; address: string }[]
	referenceId: (number: number) => string
	footnotes: ExtractedDocument['footnotes']
	/** Where a rendered figure is served from, by page and per-page index. */
	figureUrl: (page: number, index: number) => string
	stats: SeedResult['stats']
	/** Each content figure's per-page index (see `contentFigures`). */
	figureIndex: Map<Figure, number>
	/** Resource entries whose only address was a "<hyperlink to be added>" note. */
	notedResources: Set<JsonNode>
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

/** Two figures drawn on one line: on the same page, their boxes overlapping vertically
 *  by more than half the shorter one. */
const sameLine = (a: Figure, b: Figure): boolean => {
	if (a.page !== b.page || !a.bbox || !b.bbox) return false
	const overlap = Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1])
	return overlap > 0.5 * Math.min(a.bbox[3] - a.bbox[1], b.bbox[3] - b.bbox[1])
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
				// Every figure is rendered, band icons included: a real table keeps its icons
				// as pictures, and a box's band icon costs nothing to have on disk.
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
			if (s.icon) visit([s.icon])
			visit(s.blocks)
			sections(s.children)
		}
	}
	sections(model.sections)
	return out
}

/** A printed colour's theme family, by hue and lightness (decision 60): the templates
 *  shade in navy, blues, greens, yellow, red and purple; grey is neutral. */
function familyOf(hex: string): ColorFamily | null {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
	if (!m) return null
	const [r, g, b] = [m[1], m[2], m[3]].map((h) => Number.parseInt(h ?? '0', 16) / 255)
	const max = Math.max(r ?? 0, g ?? 0, b ?? 0)
	const min = Math.min(r ?? 0, g ?? 0, b ?? 0)
	const l = (max + min) / 2
	const chroma = max - min
	if (l > 0.97) return null
	if (chroma < 0.06) return 'neutral'
	let hue = 0
	if (max === r) hue = (((g ?? 0) - (b ?? 0)) / chroma) % 6
	else if (max === g) hue = ((b ?? 0) - (r ?? 0)) / chroma + 2
	else hue = ((r ?? 0) - (g ?? 0)) / chroma + 4
	hue = (((hue * 60) % 360) + 360) % 360
	if (hue >= 40 && hue < 70) return 'warning'
	if (hue >= 70 && hue < 170) return 'success'
	if (hue >= 170 && hue < 250) return l < 0.35 ? 'secondary' : 'info'
	if (hue >= 250 && hue < 330) return 'accent'
	return 'error'
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
function learnGrammar(model: ExtractedDocument): Pick<Grammar, 'instruction' | 'body' | 'note'> {
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
	// A note colour sets whole paragraphs (two or more) and nothing else: not body, not an
	// instruction, not a link's blue, not a heading's navy.
	const wholeParagraphs = new Map<string, { all: number; prose: number }>()
	const linked = new Set<string>()
	for (const p of allParagraphs(blocks)) {
		const inked = p.runs.filter((r) => r.text.trim() !== '')
		for (const r of inked) if (r.link) linked.add(r.colour)
		const colour = inked[0]?.colour
		if (!colour || !inked.every((r) => r.colour === colour)) continue
		const entry = wholeParagraphs.get(colour) ?? { all: 0, prose: 0 }
		entry.all++
		// A box title ("Find out more") is a whole paragraph in its colour too, but bold
		// throughout; a note is prose.
		if (!inked.every((r) => r.bold)) entry.prose++
		wholeParagraphs.set(colour, entry)
	}
	const note = new Set<string>()
	for (const [colour, { all, prose }] of wholeParagraphs) {
		if (prose < 2 || prose * 2 < all) continue
		if (body.has(colour) || instruction.has(colour) || linked.has(colour)) continue
		// A note is set in a COLOUR; grey text (a diagram's muted labels) is a shade of the
		// body's black.
		if (luminance(colour) > 0.6 || luminance(colour) < 0.08 || isGrey(colour)) continue
		note.add(colour)
	}
	return { instruction, body, note }
}

/** A colour with no hue to speak of: its channels within a few steps of each other. */
const isGrey = (hex: string): boolean => {
	const r = Number.parseInt(hex.slice(1, 3), 16)
	const g = Number.parseInt(hex.slice(3, 5), 16)
	const b = Number.parseInt(hex.slice(5, 7), 16)
	return Math.max(r, g, b) - Math.min(r, g, b) < 30
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
		// A note marker inside the highlight ("…(ECOG) scale²⁵]") does not end the token:
		// the span runs on past it to the closing bracket.
		let end = i
		while (out[end + 1] && (out[end + 1]?.background === first.background || isNote(out[end + 1])))
			end++
		while (end > i && isNote(out[end])) end--
		const last = out[end]
		const before = out[i - 1]
		let k = end + 1
		while (out[k] && isNote(out[k])) k++
		const after = out[k]
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
	// run boundary, where an underline or bold begins inside the token — "liquid biopsy/
	// circulating tumour DNA (ctDNA)") are the same placeholder: its label is its text,
	// and marks inside it mean nothing.
	const merged: TextRun[] = []
	for (const r of out) {
		if (r.text === '' && r.footnote === null && r.endnote === null) continue
		const last = merged.at(-1)
		if (last && r.background !== null && samePlaceholder(last, r)) last.text += r.text
		else merged.push(r)
	}
	// The token is the highlighted WORDS: Word's highlight often runs on over the space
	// after them (or begins on the space before), which would put a gap between the slot
	// and its punctuation. Edge whitespace moves out to the plain run beside it.
	const trimmed: TextRun[] = []
	for (const r of merged) {
		if (r.background === null || r.text.trim() === '') {
			trimmed.push(r)
			continue
		}
		const lead = /^\s+/.exec(r.text)?.[0] ?? ''
		const trail = /\s+$/.exec(r.text)?.[0] ?? ''
		if (lead) {
			const previous = trimmed.at(-1)
			if (previous && previous.background === null) previous.text += lead
			else trimmed.push({ ...r, background: null, text: lead })
		}
		trimmed.push({ ...r, text: r.text.trim() })
		if (trail) trimmed.push({ ...r, background: null, text: trail })
	}
	return trimmed
}

const isNote = (r: TextRun | undefined): boolean =>
	r !== undefined && (r.footnote !== null || r.endnote !== null)

/** Two highlighted runs of one token: the same highlight and link, neither a note. */
const samePlaceholder = (a: TextRun, b: TextRun): boolean =>
	a.background === b.background &&
	a.superscript === b.superscript &&
	JSON.stringify(a.link) === JSON.stringify(b.link) &&
	!isNote(a) &&
	!isNote(b)

/** Runs as the reader means them, before marks are decided:
 *   - a run that is only punctuation takes the colour of the run before it (Word gives a
 *     full stop after a placeholder the placeholder's colour, or a prompt's green);
 *   - a typed token in a colour of its own whose brackets Word drew in the neighbouring
 *     runs ("<" + "hyperlink to be added" + ">") gets its brackets back, so it reads as
 *     the one token it is. */
function readableRuns(runs: TextRun[], g: Grammar): TextRun[] {
	const out = runs.map((r) => ({ ...r }))
	for (const [i, r] of out.entries()) {
		const previous = out[i - 1]
		if (previous && /^\s*[.,;:!?)\]]+\s*$/.test(r.text) && r.colour !== previous.colour)
			r.colour = previous.colour
	}
	for (const [i, r] of out.entries()) {
		const previous = out[i - 1]
		const next = out[i + 1]
		if (!previous || !next || r.text.trim() === '') continue
		if (g.body.has(r.colour) || g.instruction.has(r.colour) || r.background !== null) continue
		if (previous.text.endsWith('<') && next.text.startsWith('>')) {
			previous.text = previous.text.slice(0, -1)
			next.text = next.text.slice(1)
			r.text = `<${r.text.trim()}>`
		}
	}
	return out
}

function inlineOf(
	runs: TextRun[],
	g: Grammar,
	options: { instructionAsMark: boolean },
): JsonNode[] {
	const out: JsonNode[] = []
	const readable = normalisePlaceholders(readableRuns(runs, g))
	for (const [index, r] of readable.entries()) {
		// The separator Word printed between two markers of one raised run ("34,35,36")
		// is the renderer's to draw: one comma, not the printed one and the drawn one.
		if (
			r.superscript &&
			/^[,–-]$/.test(r.text.trim()) &&
			out.at(-1)?.type === 'citation' &&
			isNote(readable[index + 1])
		)
			continue
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
		} else if (g.note.has(r.colour)) {
			marks.push({ type: 'note' })
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
	// A space belongs to neither mark: Word's bold and link runs carry their trailing or
	// leading space ("**routine surveillance: **detected", "The[ Australian…]"); it moves
	// to the plain run beside it.
	for (const [i, node] of out.entries()) {
		if (node.type !== 'text' || !node.text) continue
		const next = out[i + 1]
		if ((node.marks?.length ?? 0) > 0 && next?.type === 'text' && (next.marks?.length ?? 0) === 0) {
			const trail = /\s+$/.exec(node.text)?.[0]
			if (trail && node.text.trim() !== '') {
				node.text = node.text.slice(0, -trail.length)
				next.text = `${trail}${next.text ?? ''}`
			}
		}
		const previous = out[i - 1]
		if (
			(node.marks?.length ?? 0) > 0 &&
			previous?.type === 'text' &&
			(previous.marks?.length ?? 0) === 0
		) {
			const lead = /^\s+/.exec(node.text)?.[0]
			if (lead && node.text.trim() !== '') {
				node.text = node.text.slice(lead.length)
				previous.text = `${previous.text ?? ''}${lead}`
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

const paragraphNode = (
	p: Paragraph,
	g: Grammar,
	options: { markInstruction?: boolean } = {},
): JsonNode | null => {
	const content = inlineOf(p.runs, g, {
		instructionAsMark: options.markInstruction || !isInstructionParagraph(p, g),
	})
	if (content.length === 0) return null
	return p.align === 'left'
		? { type: 'paragraph', content }
		: { type: 'paragraph', attrs: { textAlign: p.align }, content }
}

function listNode(list: List, g: Grammar): JsonNode[] {
	// ProseKit's flat list: each item is a `list` node; a nested list is a child node.
	const nodes: JsonNode[] = []
	// A list wholly in the instruction colour folds into guidance outside; inside a mixed
	// list an item wholly in it keeps the colour as a mark, so a purple tick row stays a
	// tick row (the page prints the prompt as one of the rows).
	const whollyInstruction = list.items.every((i) =>
		allParagraphs(i.blocks).every((p) => isInstructionParagraph(p, g)),
	)
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
				const p = paragraphNode(b, g, { markInstruction: !whollyInstruction })
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
		// A cross-marked row ("Do not …") is a check item that says what not to do.
		const attrs: NonNullable<JsonNode['attrs']> =
			kind === 'check'
				? item.marker === 'cross'
					? { kind, pointOfCare: false, negated: true }
					: { kind, pointOfCare: false }
				: { kind }
		nodes.push({ type: 'list', attrs, content })
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

function blockNodes(
	blocks: Block[],
	g: Grammar,
	options: { keepIcons?: boolean } = {},
): JsonNode[] {
	const staged: { node: JsonNode; instruction: boolean }[] = []
	const joined = joinButtedTables(blocks, g)
	for (let i = 0; i < joined.length; i++) {
		const b = joined[i]
		if (!b) continue
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
				// Figures the source drew on one line are one row. Band icons are the box's
				// own (consumed as its `icon`); in a real table an icon is a picture in a
				// cell and stays.
				const row: Figure[] = [b]
				while (i + 1 < joined.length) {
					const next = joined[i + 1]
					if (next?.kind !== 'figure' || !sameLine(b, next)) break
					row.push(next)
					i++
				}
				const images = row
					.filter((figure) => options.keepIcons || !isIcon(figure))
					.map((figure): JsonNode => {
						g.stats.figures++
						const index = g.figureIndex.get(figure) ?? 0
						return {
							type: 'image',
							attrs: { src: g.figureUrl(figure.page, index), alt: figure.alt },
						}
					})
				const [first] = images
				if (!first) break
				staged.push({
					node: images.length === 1 ? first : { type: 'figureRow', content: images },
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
/** `cells` picks the cells a row contributes: a box's column rows leave the band icons
 *  out (`r.cells`), a real table keeps every cell and its figures (`r.row.cells`). */
function tableNode(rows: ClassifiedRow[], g: Grammar, mode: 'box' | 'real' = 'box'): JsonNode {
	g.stats.tables++
	return {
		type: 'table',
		content: rows.map((r) => ({
			type: 'tableRow',
			content: (mode === 'real' ? r.row.cells : r.cells).map((cell) => {
				const blocks = blockNodes(
					mode === 'real'
						? cell.blocks
						: cell.blocks.filter((b) => !(b.kind === 'figure' && isIcon(b))),
					g,
					{ keepIcons: mode === 'real' },
				)
				const header = cell.header && cell.background !== null && luminance(cell.background) < 0.97
				const background = cell.background ? familyOf(cell.background) : null
				return {
					type: header ? 'tableHeaderCell' : 'tableCell',
					attrs: {
						colspan: cell.colSpan,
						rowspan: cell.rowSpan,
						...(background ? { background } : {}),
					},
					content: blocks.length > 0 ? blocks : [{ type: 'paragraph' }],
				}
			}),
		})),
	}
}

/** Consecutive check-list rows of a box become one check list; group-header rows stay
 *  paragraphs between them. */
/** A shaded single row inside a banded box holding one short paragraph and no list is a
 *  group header ("For people who may be at risk due to inherited factors"): a sub-band. */
const isGroupHeader = (r: ClassifiedRow, rows: ClassifiedRow[]): boolean => {
	const cell = r.cells[0]
	if (!cell || r.kind !== 'content' || cell.background === null) return false
	// Under any heading row — a band, or an icon row (a Find out more box's grey
	// "Guidelines and frameworks" rows are its group headers).
	if (!rows.some(isHeadingRow)) return false
	// Its shade is its own: a box whose every content row is shaded (a Find out more box
	// filled pale blue) has no header among them.
	const contentRows = rows.filter((x) => x.kind === 'content' && x.cells.length === 1)
	if (contentRows.every((x) => x.cells[0]?.background === cell.background)) return false
	const paragraphs = cell.blocks.filter((b): b is Paragraph => b.kind === 'paragraph')
	if (paragraphs.length !== 1 || cell.blocks.length !== 1) return false
	const text = plainText(paragraphs[0]?.runs ?? []).trim()
	// A header names a group; a statement ends in a full stop.
	return text.split(/\s+/).length <= 14 && !/[.!?]$/.test(text)
}

/** Find out more / See also entries (decision 64): a paragraph's leading bold or linked
 *  text is the title, its first link the url (a section reference as `#address`, a
 *  printed "<hyperlink to be added>" as none), the rest the description. */
const linkUrl = (g: Grammar, run: TextRun): string | null => {
	if (!run.link) return null
	if ('url' in run.link) return run.link.url
	const address = sectionAt(g, run.link.page, run.link.y)
	return address ? `#${address}` : ''
}

/** A printed "<hyperlink …>" — or a bare "<https://…>" — is the author's note of a link
 *  to add (or the link's own address again); the resource's url carries what it says. */
const HYPERLINK_NOTE = /<\s*(?:hyperlink\b|https?:\/\/)/i
const isHyperlinkNote = (run: TextRun): boolean => HYPERLINK_NOTE.test(run.text)

/** The address inside a hyperlink note, for an entry whose note is the only place its
 *  address appears (Word set it as plain text, not a link). */
const urlInNotes = (paragraphs: Paragraph[]): string | null => {
	const text = plainText(paragraphs.flatMap((p) => p.runs))
	const match = text.match(/<\s*(?:hyperlink\b[^>]*?)?(https?:\/\/[^\s>]+)/i)
	return match?.[1] ?? null
}

const nodeText = (node: JsonNode): string =>
	node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(nodeText).join('')

/** The runs without their hyperlink notes, which Word splits over several runs when the
 *  address inside is itself a link: "<hyperlink:", " ", "https://…", ">". */
function withoutHyperlinkNotes(source: TextRun[]): TextRun[] {
	// The note's opening bracket may end the run before it ("…referral <" | "hyperlink
	// <https://…>"): it belongs with the word it opens.
	const runs = source.map((r) => ({ ...r }))
	for (const [i, run] of runs.entries()) {
		const next = runs[i + 1]
		if (next && /<\s*$/.test(run.text) && /^\s*(?:hyperlink\b|https?:\/\/)/i.test(next.text)) {
			run.text = run.text.replace(/<\s*$/, '')
			next.text = `<${next.text.trimStart()}`
		}
	}
	const out: TextRun[] = []
	for (let i = 0; i < runs.length; i++) {
		const run = runs[i]
		if (!run) continue
		const open = run.text.search(HYPERLINK_NOTE)
		if (open < 0) {
			out.push(run)
			continue
		}
		const before = run.text.slice(0, open).trimEnd()
		if (before !== '') out.push({ ...run, text: before })
		let closer = run
		let from = open
		while (!closer.text.includes('>', from)) {
			const next = runs[++i]
			if (!next) return out
			closer = next
			from = 0
		}
		const after = closer.text.slice(closer.text.indexOf('>', from) + 1)
		if (after.trim() !== '') out.push({ ...closer, text: after })
	}
	return out
}

/** Whether a paragraph opens a resource entry: it leads with bold or linked text (a
 *  title). Anything else continues the entry before it. */
const opensResource = (p: Paragraph): boolean => {
	const first = p.runs.find((r) => r.text.trim() !== '')
	return first !== undefined && (first.bold || first.link !== null) && !isHyperlinkNote(first)
}

/** A row that is one short plain line and not a lead-in ("Resources for practical and
 *  social support", set without its link) is an entry with no address. */
const isBareTitleRow = (blocks: Block[]): boolean => {
	const [only, ...rest] = blocks.filter(
		(b) => b.kind !== 'paragraph' || plainText(b.runs).trim() !== '',
	)
	if (!only || rest.length > 0 || only.kind !== 'paragraph') return false
	const text = plainText(withoutHyperlinkNotes(only.runs)).trim()
	return text !== '' && text.split(/\s+/).length <= 12 && !/[:.]$/.test(text)
}

/** An entry left without an address whose note was "<hyperlink to be added>" is
 *  remembered: the seed's resolver gives it the address its title names (hyperlinks.ts). */
function noteResource(node: JsonNode, paragraphs: Paragraph[], g: Grammar): JsonNode {
	if (node.attrs?.url === '' && hasHyperlinkNote(plainText(paragraphs.flatMap((p) => p.runs))))
		g.notedResources.add(node)
	return node
}

function resourceNode(paragraphs: Paragraph[], g: Grammar): JsonNode {
	const [lead, ...more] = paragraphs
	const runs = (lead?.runs ?? []).filter(
		(r) => r.text !== '' || r.footnote !== null || r.endnote !== null,
	)
	// Title = the leading run(s) that are bold or linked, stopping at a placeholder or
	// instruction token or a hyperlink note. A highlighted run that keeps the title's
	// bold or link ("Guide to Best Cancer Care for people with [cancer type]") is part of
	// the title.
	const isToken = (r: TextRun) =>
		(r.background !== null && !(r.bold || r.link !== null)) ||
		g.instruction.has(r.colour) ||
		ANGLE_TOKEN.test(r.text.trim()) ||
		isHyperlinkNote(r)
	let titleEnd = 0
	while (titleEnd < runs.length && runs[titleEnd]?.text.trim() === '') titleEnd++
	const titleStart = titleEnd
	while (titleEnd < runs.length) {
		const run = runs[titleEnd]
		if (!run || !(run.bold || run.link !== null) || isToken(run)) break
		titleEnd++
	}
	// A row set without bold or link ("Resources for practical and social support") is
	// titled by its whole line, less any note.
	if (titleEnd === titleStart) {
		const plain = withoutHyperlinkNotes(runs).filter((r) => !isToken(r))
		titleEnd = runs.length
		const title = plainText(plain).replace(/\s+/g, ' ').trim()
		const description: JsonNode[] = []
		for (const p of more) {
			const content = inlineOf(withoutHyperlinkNotes(p.runs), g, { instructionAsMark: true })
			if (content.length > 0) description.push({ type: 'paragraph', content })
		}
		const url =
			paragraphs
				.flatMap((p) => p.runs)
				.map((r) => linkUrl(g, r))
				.find((u): u is string => u !== null) ??
			urlInNotes(paragraphs) ??
			''
		return noteResource(
			{ type: 'resource', attrs: { title, url }, content: description },
			paragraphs,
			g,
		)
	}
	const title = plainText(runs.slice(0, titleEnd)).replace(/\s+/g, ' ').trim()
	const rest = runs.slice(titleEnd)
	const description: JsonNode[] = []
	const tail = inlineOf(withoutHyperlinkNotes(rest), g, { instructionAsMark: true })
	if (tail.length > 0) description.push({ type: 'paragraph', content: tail })
	for (const p of more) {
		const content = inlineOf(withoutHyperlinkNotes(p.runs), g, { instructionAsMark: true })
		if (content.length > 0) description.push({ type: 'paragraph', content })
	}
	// The title's own full stop, which Word set outside the bold run, is not a
	// description ("Surgery." → description "."); nor does a description open with it.
	const kept = description.filter((p) => !/^[\s.,;:]*$/.test(nodeText(p)))
	const opening = kept[0]?.content?.[0]
	if (opening?.type === 'text' && opening.text)
		opening.text = opening.text.replace(/^[.,;:]\s*/, '')
	// The url is the first link anywhere in the entry, else the address its note names.
	const url =
		paragraphs
			.flatMap((p) => p.runs)
			.map((r) => linkUrl(g, r))
			.find((u): u is string => u !== null) ??
		urlInNotes(paragraphs) ??
		''
	return noteResource({ type: 'resource', attrs: { title, url }, content: kept }, paragraphs, g)
}

function boxContent(rows: ClassifiedRow[], g: Grammar, kind: string = 'plain'): JsonNode[] {
	const out: JsonNode[] = []
	let columns: ClassifiedRow[] = []
	const flushColumns = () => {
		if (columns.length > 0) {
			const rows = columns.map((r) => r.row)
			out.push(...(iconRowsList(rows, g) ?? tileColumns(rows, g) ?? [tableNode(columns, g)]))
		}
		columns = []
	}
	// Resource entries: a title paragraph and the plain paragraphs that follow it, which
	// may sit in the next row when the box broke over a page.
	let entry: Paragraph[] | null = null
	const flushEntry = () => {
		if (entry) {
			g.stats.resources++
			out.push(resourceNode(entry, g))
		}
		entry = null
	}
	for (const r of rows) {
		if (r.kind === 'columns') {
			flushEntry()
			columns.push(r)
			continue
		}
		flushColumns()
		const cell = r.cells[0]
		if (!cell) continue
		if (r.kind === 'band' || r.kind === 'icon-band') {
			flushEntry()
			out.push(bannerNode(cell, g))
			continue
		}
		if (isGroupHeader(r, rows)) {
			flushEntry()
			out.push({ ...bannerNode(cell, g), attrs: { tone: 'sub' } })
			continue
		}
		// The box's heading row ("Find out more" beside its icon) is a title, not an entry.
		if ((kind === 'resources' || kind === 'seeAlso') && r.kind === 'content' && r.icon === null) {
			// Every row starts afresh (a link-less title row is an entry, a lead-in line is
			// a paragraph); within a row, plain paragraphs after a title continue it.
			flushEntry()
			for (const b of cell.blocks) {
				if (b.kind === 'list') {
					// Entries set as a bulleted list (the regional trial networks): an item
					// that leads with a title is an entry like any other row.
					for (const item of b.items) {
						const paragraphs = item.blocks.filter((x): x is Paragraph => x.kind === 'paragraph')
						const lead = paragraphs[0]
						flushEntry()
						if (lead && opensResource(lead) && !isInstructionParagraph(lead, g)) entry = paragraphs
						else out.push(...blockNodes([{ ...b, items: [item] }], g))
					}
					flushEntry()
					continue
				}
				const prose =
					b.kind === 'paragraph' && !isInstructionParagraph(b, g) && plainText(b.runs).trim() !== ''
				if (prose && (opensResource(b) || isBareTitleRow(cell.blocks))) {
					flushEntry()
					entry = [b]
				} else if (prose && entry) entry.push(b)
				else {
					flushEntry()
					out.push(...blockNodes([b], g))
				}
			}
			continue
		}
		flushEntry()
		const nodes = blockNodes(cell.blocks, g)
		for (const node of nodes) {
			const last = out.at(-1)
			// A row without a check marker after a check row ending in a colon is that
			// row's nested content ("…including:" then "[insert cancer-specific symptoms]",
			// which Word set as a row of its own after the page break).
			const opensNested =
				last?.type === 'list' &&
				last.attrs?.kind === 'check' &&
				/:$/.test(nodeText(last).trim()) &&
				(node.type === 'paragraph' || (node.type === 'list' && node.attrs?.kind !== 'check'))
			if (opensNested && last) last.content = [...(last.content ?? []), node]
			else out.push(node)
		}
	}
	flushEntry()
	flushColumns()
	return groupResources(out)
}

/** Consecutive resource entries become one `resourceList`. */
function groupResources(nodes: JsonNode[]): JsonNode[] {
	const out: JsonNode[] = []
	for (const node of nodes) {
		const last = out.at(-1)
		if (node.type === 'resource') {
			if (last?.type === 'resourceList') last.content = [...(last.content ?? []), node]
			else out.push({ type: 'resourceList', content: [node] })
		} else out.push(node)
	}
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
/** A real table: rows of columns, none of them a band, an icon row, an "Or" or guidance;
 *  a row spanning the full width (a title or a note row) does not make it a box. */
const isRealTable = (table: Table, g: Grammar): boolean => {
	const kinds = table.rows.map((r) => classifyRow(r, g, { collapseEmpty: false }).kind)
	const columns = kinds.filter((k) => k === 'columns').length
	return (
		kinds.every((k) => k === 'columns' || k === 'content') &&
		columns * 2 >= kinds.length &&
		columns > 0
	)
}

function tableNodes(table: Table, g: Grammar): JsonNode[] {
	// A table with nothing left to show (the endnote lists moved to the references) is
	// Word's layout, not content.
	if (
		!table.rows.some((row) =>
			row.cells.some((cell) => cellHasText(cell) || cellFigures(cell).length > 0),
		)
	)
		return []
	if (isRealTable(table, g)) {
		const iconRows = iconRowsList(table.rows, g)
		if (iconRows) return iconRows
		const diagram = diagramColumns(table.rows, g)
		if (diagram) return diagram
		const tiles = tileColumns(table.rows, g)
		if (tiles) return tiles
		return [
			tableNode(
				table.rows.map((r) => classifyRow(r, g, { collapseEmpty: false })),
				g,
				'real',
			),
		]
	}

	const rows = table.rows.map((r) => classifyRow(r, g, { collapseEmpty: true }))
	// An icon row heads a box (the stopwatch heads a care point inside one), so a table
	// whose icon rows come mid-way holds that many boxes stacked in one Word table: the
	// pen row above a checklist, the See also under a Find out more, a supportive care
	// page's considerations / checklist / communication boxes.
	// A heading row is the icon and its title, and nothing else: an icon among several
	// content cells (a diagram's row) is content.
	const segments: ClassifiedRow[][] = []
	for (const r of rows) {
		const heads = r.icon !== null && r.icon.icon !== 'stopwatch' && r.row.cells.length <= 2
		if (heads || segments.length === 0) segments.push([r])
		else segments.at(-1)?.push(r)
	}
	// A pen row with nothing but instructions under it heads the box that follows
	// ("Complete the box" over a Find out more or a Key actions box, one bordered table
	// on the page): it is that box's guidance, not an empty developer box of its own.
	const merged: ClassifiedRow[][] = []
	for (const segment of segments) {
		const previous = merged.at(-1)
		const penOnly =
			previous?.every(
				(r) => r.kind === 'instruction' && (r.icon === null || r.icon.icon === 'pen'),
			) ?? false
		if (previous && penOnly) merged[merged.length - 1] = [...previous, ...segment]
		else merged.push(segment)
	}
	return merged.flatMap((segment) => boxSegmentNodes(segment, g))
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
		const guidance = boxContent(before, g)
		const timeframes = timeframeNodes(rest, g)
		// The pen row and the stopwatch rows are ONE bordered developer box on the page
		// ("Complete the timeframe" over the timeframe rows): the box wraps both.
		if (before.some((r) => r.icon?.icon === 'pen')) {
			g.stats.boxes++
			return [
				{
					type: 'box',
					attrs: { kind: 'developer', icon: 'pen', family: '' },
					content: [...guidance, ...timeframes],
				},
			]
		}
		return [...guidance, ...timeframes]
	}

	// Under an icon heading, the box's rows are unshaded or share the heading's colour. A
	// single content row shaded in a light colour of its own, carrying no icon, is a callout
	// that Word stacked into the same table: it becomes a box of its own beside this one.
	const heading = rows[0]
	const headingBackground = heading?.cells[0]?.background ?? null
	const shadedRows = (colour: string) =>
		rows.filter((r) => r.cells[0]?.background === colour).length
	const isCallout = (r: ClassifiedRow) => {
		const cell = r.cells[0]
		const background = cell?.background ?? null
		if (
			!heading ||
			heading.icon === null ||
			r === heading ||
			r.kind !== 'content' ||
			r.icon !== null ||
			background === null ||
			!cell
		)
			return false
		// A row that carries a prompt is the developer box's own (a fill change inside one
		// bordered table is not a second box); a short header row is a sub-band, not a
		// statement.
		if (allParagraphs(cell.blocks).some((p) => isInstructionParagraph(p, g))) return false
		if (isGroupHeader(r, rows)) return false
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
	// The box's kind is its own icon's; a pen row heading it only adds guidance.
	const first = icons.find((i) => i.icon !== 'pen') ?? icons[0]
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
			...boxContent(intro, g, kind),
			{
				type: 'variants',
				content: groups.map((gr) => {
					const nodes = boxContent(gr, g, kind)
					return { type: 'variant', content: nodes.length > 0 ? nodes : [{ type: 'paragraph' }] }
				}),
			},
		]
	} else content = boxContent(rows, g, kind)
	if (content.length === 0) return []
	// A callout keeps the shade it was printed in, as a theme family: the shade of its own
	// full-width row, never of a tile in a columns row (p.6 holds two tiles inside a
	// pale-blue box).
	const shadedCell =
		kind === 'callout' ? rows.find((r) => r.cells.length === 1)?.cells[0] : undefined
	const shade = shadedCell?.background ?? null
	const family = shade ? (familyOf(shade) ?? '') : ''
	return [
		{
			type: 'box',
			attrs:
				kind === 'callout'
					? calloutAttrs(family, shadedCell)
					: { kind, icon, family, variant: 'soft' },
			content,
		},
	]
}

/** Rows of [icon | text] (decision 59): a list whose items carry the icon. Only when
 *  EVERY row is exactly that shape; anything else is a table. */
function iconRowsList(rows: TableRow[], g: Grammar): JsonNode[] | null {
	const isSpacer = (row: TableRow) =>
		row.cells.every((cell) => !cellHasText(cell) && cellFigures(cell).length === 0)
	const live = rows.filter((row) => !isSpacer(row))
	if (live.length === 0) return null
	const items: { icon: Figure | null; label: Paragraph | null; blocks: Block[] }[] = []
	let withIcon = 0
	// Rows still covered by the last lead cell's row span continue its item (Word lays a
	// long item's list out as cells of the rows beneath).
	let covered = 0
	for (const row of live) {
		const last = items.at(-1)
		if (covered > 0 && last) {
			covered--
			last.blocks = [...last.blocks, ...row.cells.flatMap((cell) => cell.blocks)]
			continue
		}
		if (row.cells.length < 2 || row.cells.length > 3) return null
		const [lead, ...restCells] = row.cells
		if (!lead) return null
		const figures = cellFigures(lead)
		const paragraphs = lead.blocks.filter((b): b is Paragraph => b.kind === 'paragraph')
		// The lead cell is the icon, or the icon with a short label under or over it, or
		// (one row of a set) nothing at all. A three-cell row keeps the label in its own
		// cell between the icon and the text.
		const labelCell = restCells.length === 2 ? restCells[0] : undefined
		const text = restCells.at(-1)
		if (!text || !cellHasText(text)) return null
		if (figures.length > 1 || lead.blocks.length - figures.length - paragraphs.length !== 0)
			return null
		if (paragraphs.length > 1 || (paragraphs[0] && wordsOf(lead) > 12)) return null
		if (figures.length === 0 && paragraphs.length > 0) return null
		let label: Paragraph | null = paragraphs[0] ?? null
		if (labelCell) {
			const labelParagraphs = labelCell.blocks.filter((b): b is Paragraph => b.kind === 'paragraph')
			if (
				label ||
				labelParagraphs.length > 1 ||
				labelParagraphs.length !== labelCell.blocks.length ||
				wordsOf(labelCell) > 12
			)
				return null
			label = labelParagraphs[0] ?? null
		}
		if (figures[0]) withIcon++
		covered = Math.max(0, lead.rowSpan - 1)
		items.push({ icon: figures[0] ?? null, label, blocks: text.blocks })
	}
	if (withIcon * 2 < items.length) return null
	return items.map(({ icon, label, blocks }) => {
		const content = blockNodes(blocks, g)
		if (label) {
			const lead = paragraphNode(
				{ ...label, runs: label.runs.map((r) => ({ ...r, bold: true })), align: 'left' },
				g,
			)
			if (lead) content.unshift(lead)
		}
		if (content[0]?.type !== 'paragraph') content.unshift({ type: 'paragraph' })
		return {
			type: 'list',
			attrs: {
				kind: 'bullet',
				icon: icon ? g.figureUrl(icon.page, g.figureIndex.get(icon) ?? 0) : '',
			},
			content,
		}
	})
}

const cellHasText = (cell: TableCell): boolean => cellText(cell) !== ''

/**
 * A layout diagram (decision 58): a table whose shaded cells span three or more rows is
 * a figure drawn with a table — labels down one side, a column of icon-and-name rows,
 * blocks of text down the other. It becomes `columns`: one per logical column, each a
 * stack of the cells that sit in it (a spanning shaded cell as a callout in its family);
 * a column that holds only icons folds into its neighbour as icon rows.
 */
function diagramColumns(rows: TableRow[], g: Grammar): JsonNode[] | null {
	if (!rows.some((row) => row.cells.some((cell) => cell.rowSpan >= 3 && cellHasText(cell))))
		return null
	// Place every cell on the grid its spans describe.
	const width = Math.max(...rows.map((row) => row.cells.reduce((n, c) => n + c.colSpan, 0)))
	const occupied: boolean[][] = rows.map(() => Array.from({ length: width }, () => false))
	const placed: GridCell[] = []
	for (const [r, row] of rows.entries()) {
		let c = 0
		for (const cell of row.cells) {
			while (occupied[r]?.[c]) c++
			placed.push({ cell, c, r })
			for (let dr = 0; dr < cell.rowSpan; dr++)
				for (let dc = 0; dc < cell.colSpan; dc++) {
					const slots = occupied[r + dr]
					if (slots) slots[c + dc] = true
				}
			c += cell.colSpan
		}
	}
	// Bands: a run of rows no cell spans out of. Each band reads on its own — one cell
	// wide is a block, wider is a `columns` of the logical columns it holds.
	const bands: GridCell[][] = []
	let band: GridCell[] = []
	let reach = 0
	for (const [r] of rows.entries()) {
		if (r >= reach && band.length > 0) {
			bands.push(band)
			band = []
		}
		for (const p of placed.filter((p) => p.r === r)) {
			band.push(p)
			reach = Math.max(reach, r + p.cell.rowSpan)
		}
	}
	if (band.length > 0) bands.push(band)
	const out: JsonNode[] = []
	for (const cells of bands) {
		const live = cells.filter((p) => cellHasText(p.cell) || cellFigures(p.cell).length > 0)
		if (live.length === 0) continue
		const starts = [...new Set(live.map((p) => p.c))].sort((a, b) => a - b)
		if (starts.length === 1) {
			for (const p of live) out.push(...diagramCell(p.cell, g))
			continue
		}
		const columns: JsonNode[] = []
		for (let i = 0; i < starts.length; i++) {
			const c = starts[i] ?? 0
			const inColumn = live.filter((p) => p.c === c).sort((a, b) => a.r - b.r)
			const next = starts[i + 1]
			const iconOnly = inColumn.every(
				(p) => !cellHasText(p.cell) && cellFigures(p.cell).length === 1,
			)
			if (iconOnly && next !== undefined) {
				// A column of icons beside a column of names: one icon list.
				const names = live.filter((p) => p.c === next).sort((a, b) => a.r - b.r)
				const pairs: TableRow[] = names.map((name) => ({
					cells: [
						inColumn.find((icon) => icon.r === name.r)?.cell ?? {
							header: false,
							rowSpan: 1,
							colSpan: 1,
							background: null,
							blocks: [],
						},
						name.cell,
					],
				}))
				const list = iconRowsList(pairs, g)
				if (list) {
					columns.push({ type: 'column', content: list })
					i++
					continue
				}
			}
			const content = inColumn.flatMap((p) => diagramCell(p.cell, g))
			if (content.length > 0) columns.push({ type: 'column', content })
		}
		if (columns.length === 1) out.push(...(columns[0]?.content ?? []))
		else if (columns.length > 1) out.push({ type: 'columns', content: columns })
	}
	return out.length > 0 ? out : null
}

interface GridCell {
	cell: TableCell
	c: number
	r: number
}

/** A diagram cell's blocks: a shaded cell is a callout in its colour's family. */
function diagramCell(cell: TableCell, g: Grammar): JsonNode[] {
	const blocks = blockNodes(cell.blocks, g, { keepIcons: true })
	if (blocks.length === 0) return []
	const family = cell.background ? familyOf(cell.background) : null
	if (!family) return blocks
	g.stats.boxes++
	return [{ type: 'box', attrs: calloutAttrs(family, cell), content: blocks }]
}

/** A shaded tile's attributes: its family, and ui-solid's `solid` treatment when the
 *  source printed it dark with light text (the p.4 "Considerations for delivery" tile). */
const calloutAttrs = (
	family: string,
	cell: TableCell | undefined,
): NonNullable<JsonNode['attrs']> => ({
	kind: 'callout',
	icon: '',
	family,
	variant: cell && cellIsBand(cell) ? 'solid' : 'soft',
})

const wordsOf = (cell: TableCell): number =>
	allParagraphs(cell.blocks).reduce(
		(n, p) => n + plainText(p.runs).trim().split(/\s+/).filter(Boolean).length,
		0,
	)

/** A grid of tiles (decision 58): every row has the same two or more cells, and the cells
 *  are tiles — short, and mostly centred or picture-led. Each row becomes `columns`; a
 *  shaded tile is a callout box in its family. Real data tables (left-aligned prose,
 *  header rows over values) are not tiles. */
function tileColumns(rows: TableRow[], g: Grammar): JsonNode[] | null {
	const width = rows[0]?.cells.length ?? 0
	if (width < 2 || rows.length === 0) return null
	if (!rows.every((row) => row.cells.length === width)) return null
	const cells = rows.flatMap((row) => row.cells)
	if (
		cells.some(
			(cell) =>
				wordsOf(cell) > 60 || cell.blocks.some((b) => b.kind === 'list' || b.kind === 'table'),
		)
	)
		return null
	const tileLike = cells.filter(
		(cell) =>
			cellFigures(cell).length > 0 || allParagraphs(cell.blocks).some((p) => p.align === 'center'),
	).length
	if (tileLike * 2 < cells.length) return null
	return rows.map(
		(row): JsonNode => ({
			type: 'columns',
			content: row.cells.map((cell): JsonNode => {
				const blocks = blockNodes(cell.blocks, g, { keepIcons: true })
				const content: JsonNode[] = blocks.length > 0 ? blocks : [{ type: 'paragraph' }]
				const family = cell.background ? familyOf(cell.background) : null
				if (family) {
					g.stats.boxes++
					const tile: JsonNode = { type: 'box', attrs: calloutAttrs(family, cell), content }
					return { type: 'column', content: [tile] }
				}
				return { type: 'column', content }
			}),
		}),
	)
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

/** The template's family colour: the commonest non-white colour its top two heading levels
 *  are printed in (every 2026 template sets them in Cancer Australia's navy). */
function headingColourOf(model: ExtractedDocument): string | null {
	const counts = new Map<string, number>()
	const walk = (sections: ExtractedDocument['sections']) => {
		for (const s of sections) {
			if (s.level <= 2)
				for (const run of s.heading) {
					const colour = run.colour.toLowerCase()
					if (run.text.trim() && colour !== '#ffffff') counts.set(colour, (counts.get(colour) ?? 0) + 1)
				}
			walk(s.children)
		}
	}
	walk(model.sections)
	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

const APPARATUS = /^(contents|cancer-specific-template|population-based-template|core-content)$/
/** The template's instructions to its developers, wherever the title page puts them
 *  ("optimal-care-pathway-for-people-with/instructions-for-developers/…"): part of the
 *  template as printed, never a section of a pathway (whose drafters read it in their
 *  margin by reference). */
const INSTRUCTIONS_SUBTREE = /(^|\/)instructions-for-developers(\/|$)/

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

/** The PDF pages a section's own blocks span (children are sections of their own):
 *  "13" or "13-14". */
function sourcePagesOf(section: Section): string {
	let last = section.page
	const visit = (blocks: Block[]) => {
		for (const b of blocks) {
			if ('page' in b) last = Math.max(last, b.page)
			if (b.kind === 'list') for (const item of b.items) visit(item.blocks)
			else if (b.kind === 'table')
				for (const row of b.rows) for (const cell of row.cells) visit(cell.blocks)
		}
	}
	visit(section.blocks)
	return last > section.page ? `${section.page}-${last}` : `${section.page}`
}

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
// Entry points
// ---------------------------------------------------------------------------

export const emptyStats = (): SeedResult['stats'] => ({
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
	resources: 0,
})

/** The block mapper alone, for a document with no template grammar of its own. */
export interface BlockMapper {
	/** Blocks of the model → content nodes. */
	blocks: (blocks: Block[]) => JsonNode[]
	/** Runs → inline nodes (a heading's text, a table cell's label). */
	inline: (runs: TextRun[]) => JsonNode[]
	stats: SeedResult['stats']
}

/**
 * A mapper for a PLAIN document — a legacy pathway read off its drawing — where no colour
 * is an instruction, a note or a placeholder: every colour is body, so runs map to text
 * with their marks and nothing folds into guidance. Footnotes and figures are the
 * model's; internal links resolve against the headings given.
 */
export function createBlockMapper(
	model: ExtractedDocument,
	options: {
		figureUrl: (page: number, index: number) => string
		headings?: { page: number; y: number; address: string }[]
		referenceId?: (number: number) => string
	},
): BlockMapper {
	const colours = new Set<string>()
	for (const p of allParagraphs([...model.front, ...allBlocks(model.sections)]))
		for (const r of p.runs) colours.add(r.colour)
	const stats = emptyStats()
	const g: Grammar = {
		instruction: new Set(),
		body: colours,
		note: new Set(),
		headings: options.headings ?? [],
		referenceId: options.referenceId ?? ((n) => String(n)),
		footnotes: model.footnotes,
		figureUrl: options.figureUrl,
		stats,
		figureIndex: new Map(contentFigures(model).map(({ figure, index }) => [figure, index])),
		notedResources: new Set(),
	}
	return {
		blocks: (blocks) => blockNodes(blocks, g),
		inline: (runs) => inlineOf(runs, g, { instructionAsMark: false }),
		stats,
	}
}

export function mapTemplate(input: MapInput): MappedTemplate {
	const { model, template, orgId, id } = input
	const documentId = id('document', `${template.templateId}:core`)
	const learned = learnGrammar(model)
	const stats = emptyStats()
	const placed = placeSections(model)
	const g: Grammar = {
		...learned,
		headings: placed.map((p) => ({ page: p.section.page, y: p.section.y, address: p.address })),
		referenceId: (n) => id('reference', `${template.templateId}:${n}`),
		footnotes: model.footnotes,
		figureUrl: (page, index) => figureUrl(template.key, page, index),
		stats,
		figureIndex: new Map(contentFigures(model).map(({ figure, index }) => [figure, index])),
		notedResources: new Set(),
	}
	// A step's cross-reference is checked against this document's own sections.
	const showing = {
		kind: template.kind,
		sections: placed.map((p) => ({
			address: p.address,
			title: titleOf(p.section.headingText, p.section.number),
		})),
	}
	const hyperlinks: MappedTemplate['hyperlinks'] = []

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
		accent: headingColourOf(model),
	}

	const sectionId = (p: Placed) => id('section', `${template.templateId}:${p.address}`)
	const sections: SectionRow[] = placed.map((p) => {
		const apparatus = APPARATUS.test(p.address) || p.parent?.address === 'contents'
		// The contents page is a derived view of the section tree, never content; a
		// template-declared derived section keeps its prose and boxes but its printed table
		// (the snapshot schematic) or figure (the steps schematic) is replaced by the node
		// the CMS renders from the document.
		const derived = template.derived.find((d) => d.address === p.address)
		const body =
			p.address === 'contents'
				? []
				: derived
					? [
							...blockNodes(
								p.section.blocks.filter(
									(b) => !(b.kind === 'table' && isRealTable(b, g)) && b.kind !== 'figure',
								),
								g,
							),
							{ type: derived.node },
						]
					: blockNodes(p.section.blocks, g)
		const number = p.section.number
		const mapped: JsonNode = {
			type: 'doc',
			content: body.length > 0 ? body : [{ type: 'paragraph' }],
		}
		let bodyJson = mapped
		if (input.hyperlinks) {
			const resolved = resolveHyperlinks(mapped, showing, input.hyperlinks, (n) =>
				g.notedResources.has(n),
			)
			bodyJson = resolved.body
			for (const found of resolved.found)
				hyperlinks.push({
					...found,
					address: p.address,
					printedNumber: number,
					title: titleOf(p.section.headingText, number),
				})
		}
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
			instructions: INSTRUCTIONS_SUBTREE.test(p.address),
			bodyJson,
			sourcePages: sourcePagesOf(p.section),
			icon: p.section.icon
				? figureUrl(template.key, p.section.icon.page, g.figureIndex.get(p.section.icon) ?? 0)
				: null,
			titleCitations: p.section.heading.flatMap((r) => {
				if (r.endnote === null) return []
				g.stats.citations++
				return [g.referenceId(r.endnote)]
			}),
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

	return { template: templateRow, document, sections, references, stats, hyperlinks }
}
