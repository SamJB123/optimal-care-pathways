/**
 * Stage one: a tagged PDF → the extracted document model, by walking the structure tree
 * of every page in order and reading each leaf's text with its drawn style and geometry.
 *
 * What comes from where:
 *   - reading order, list nesting, table cells and note attachment: the STRUCTURE TREE
 *     (roles P, H1–H6, L/LI/Lbl/LBody, Table/TR/TH/TD, Link, Span, Note, Figure, Sect);
 *   - the words, spacing and line ends: pdf.js's TEXT CONTENT, per marked-content id;
 *   - bold, italic, size, colour: the OPERATOR LIST's glyph runs, aligned to the text
 *     character by character within the same marked-content id;
 *   - superscript, underline, highlight, shading, borders: GEOMETRY — each run keeps the
 *     line it was drawn on, and the page's painted paths are matched against that line;
 *   - links: the tree's Link elements joined to their annotations by id; internal
 *     destinations resolved to page numbers.
 *
 * Where the tagging is imperfect — and Word's is, in ways that recur across documents —
 * general rules recover the structure from what the page shows:
 *   - HEADINGS BY STYLE: the document's tagged headings teach the reader what each level
 *     looks like (size, colour, weight); any line anywhere in that style is a heading of
 *     that level. This recovers headings tagged as plain paragraphs, empty heading
 *     elements whose text sits in the next element, and heading elements that also hold
 *     the paragraph after them.
 *   - PARAGRAPHS BY GAP: a tagged paragraph whose lines are separated by more than the
 *     line pitch is several paragraphs; it is split at each opening.
 *   - FRAMES: a single-cell table that contains headings is a page frame, not a box, and
 *     its content flows into the document.
 *   - NOTES: a Note with a marker (its Link's Span) is a footnote; a Note without one is
 *     an endnote body, numbered from its own leading integer.
 *
 * Nothing is inferred from text patterns except printed numbers (section numbers in
 * headings, note numbers). Anything the reader cannot place is recorded as a warning.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type {
	Block,
	Endnote,
	ExtractedDocument,
	Figure,
	Footnote,
	List,
	ListItem,
	ListMarker,
	Paragraph,
	Section,
	Table,
	TableCell,
	TableRow,
	TextRun,
	Warning,
} from './model.ts'
import { plainText } from './model.ts'
import {
	annotationIdOf,
	type Box,
	type LinkAnnotation,
	type PaintedPath,
	type PdfPage,
	readPage,
	type StructTreeContent,
	type StyleSpan,
	type TreeNode,
} from './pdf-page.ts'

const HEADING_ROLE = /^H([1-6])$/
const NUMBERED = /^(\d+(?:\.\d+)*)\s+\S/
const STEP = /^Step\s+(\d+)\s*:/i
const NOTE_PART = /^(references|endnotes|notes|bibliography)$/i

// ---------------------------------------------------------------------------
// Segments: runs that remember the line they were drawn on
// ---------------------------------------------------------------------------

/** A run plus its geometry; the geometry is dropped when blocks are emitted. */
interface Seg extends TextRun {
	/** Baseline of the line this run sits on, and its horizontal extent. */
	y: number
	x0: number
	x1: number
	/** The dominant font size on that line. */
	lineSize: number
}

interface Line {
	y: number
	x0: number
	x1: number
	size: number
	segs: Seg[]
}

/** The style a heading level is printed in, learned from the tagged headings. */
interface HeadingStyle {
	level: number
	size: number
	colour: string
	bold: boolean
}

/** What the reader knows about the block-level element whose leaves it is reading: the
 *  size its body text is set in (the reference for "small" raised markers) and the
 *  horizontal extent of each of its lines (the reference for "a fill that hugs the text"
 *  versus "a fill that shades the whole cell"). */
interface ElementGeometry {
	bodySize: number
	lines: { y: number; x0: number; x1: number }[]
}

interface Context {
	page: PdfPage
	pageNumber: number
	pageOfRef: Map<number, number>
	footnotes: Footnote[]
	endnotes: Endnote[]
	warnings: Warning[]
	headingStyles: HeadingStyle[]
	/** The link applying to the leaves below (set while inside a Link element). */
	link: LinkAnnotation | null
	/** Inside the References part: numbered paragraphs are endnote bodies. */
	inNotesPart: boolean
	/** The element being read, while one is. */
	element: ElementGeometry | null
}

const isSpace = (ch: string) => /\s/.test(ch)
const isLeaf = (node: TreeNode | StructTreeContent): node is StructTreeContent => 'type' in node

function leafIds(node: TreeNode | StructTreeContent, into: string[] = []): string[] {
	if (isLeaf(node)) {
		if (node.type === 'content') into.push(node.id)
		return into
	}
	for (const child of node.children ?? []) leafIds(child, into)
	return into
}

/** Measure an element from its text items and glyph runs, before reading it. */
function measureElement(ctx: Context, node: TreeNode | StructTreeContent): ElementGeometry {
	const weights = new Map<number, number>()
	const lines: ElementGeometry['lines'] = []
	for (const id of leafIds(node)) {
		for (const span of ctx.page.spansByMcid.get(id) ?? []) {
			weights.set(span.size, (weights.get(span.size) ?? 0) + span.text.replace(/\s/g, '').length)
		}
		for (const item of ctx.page.textByMcid.get(id) ?? []) {
			if (item.text.trim() === '') continue
			const line = lines.find((l) => Math.abs(l.y - item.box.y) < 2)
			if (line) {
				line.x0 = Math.min(line.x0, item.box.x)
				line.x1 = Math.max(line.x1, item.box.x + item.box.width)
			} else lines.push({ y: item.box.y, x0: item.box.x, x1: item.box.x + item.box.width })
		}
	}
	let bodySize = 0
	let best = -1
	for (const [size, count] of weights) if (count > best) [best, bodySize] = [count, size]
	return { bodySize, lines }
}

/** Run `read` with `node` as the current element (unless one is already current, in which
 *  case the node is part of it). */
function withElement<T>(ctx: Context, node: TreeNode | StructTreeContent, read: () => T): T {
	if (ctx.element) return read()
	ctx.element = measureElement(ctx, node)
	try {
		return read()
	} finally {
		ctx.element = null
	}
}

/** Every segment under a node for MEASUREMENT only (shading, borders, frame detection):
 *  no link scoping, no note filing — those side effects belong to the single structural
 *  pass, `inlineSegs`. */
function geometrySegs(ctx: Context, node: TreeNode | StructTreeContent): Seg[] {
	return withElement(ctx, node, () => {
		const into: Seg[] = []
		for (const id of leafIds(node)) into.push(...segsOf(ctx, id))
		markRaised(ctx, into)
		return into
	})
}

/** Within each line of an element, small text drawn above the line's baseline is
 *  superscript and below it subscript; decided against the element's body size, not the
 *  marker's own run. */
function markRaised(ctx: Context, segs: Seg[]): void {
	const bodySize = ctx.element?.bodySize ?? 0
	if (bodySize <= 0) return
	const tolerance = Math.max(2, bodySize * 0.45)
	const lines: { baseline: number; weight: number; segs: Seg[] }[] = []
	for (const seg of segs) {
		const line = lines.find((l) => Math.abs(l.baseline - seg.y) < tolerance)
		if (line) line.segs.push(seg)
		else lines.push({ baseline: seg.y, weight: 0, segs: [seg] })
	}
	for (const line of lines) {
		// The baseline is where the body-sized text sits.
		const body = line.segs.filter((s) => s.size >= bodySize * 0.9)
		const baseline =
			body.length > 0 ? body.reduce((sum, s) => sum + s.y, 0) / body.length : line.baseline
		for (const seg of line.segs) {
			const small = seg.size <= bodySize * 0.78
			seg.superscript = small && seg.y > baseline + 0.5
			seg.subscript = small && seg.y < baseline - 0.5
		}
	}
}

/** The segments of one marked-content id: pdf.js's text item by item, each character
 *  styled by the glyph run that drew it and placed by that glyph's advance, so every
 *  character has its own x position for the underline and highlight tests. */
function segsOf(ctx: Context, mcid: string): Seg[] {
	const items = ctx.page.textByMcid.get(mcid) ?? []
	const spans = ctx.page.spansByMcid.get(mcid) ?? []
	const glyphs: { ch: string; span: StyleSpan; advance: number }[] = []
	for (const span of spans) {
		const chars = [...span.text]
		for (const [i, ch] of chars.entries()) glyphs.push({ ch, span, advance: span.advances[i] ?? 0 })
	}
	const bodySize = ctx.element?.bodySize || spans[0]?.size || 0

	const out: Seg[] = []
	let g = 0
	let current: StyleSpan | null = spans[0] ?? null
	for (const item of items) {
		const text = item.text + (item.hasEOL ? ' ' : '')
		if (text === '') continue
		if (text.trim() === '') {
			// A whitespace-only item is inter-word spacing pdf.js inferred from the layout;
			// it belongs to the run before it. At the start of a marked-content item there
			// is no run before it yet (the space after a note marker or a link opens the
			// next item), so it becomes a plain segment of its own.
			const last = out.at(-1)
			if (last && !last.text.endsWith(' ')) {
				last.text += ' '
				last.x1 = Math.max(last.x1, item.box.x + item.box.width)
			} else if (!last) {
				const box: Box = { x: item.box.x, y: item.box.y, width: item.box.width, height: bodySize }
				out.push(segFor(ctx, ' ', current, box, bodySize))
			}
			continue
		}
		// First pass: the style and drawn advance of every character of this item.
		const chars: { ch: string; span: StyleSpan | null; advance: number }[] = []
		let skipped = 0
		for (const ch of text) {
			let advance = 0
			if (!isSpace(ch)) {
				// Skip drawn spaces the text layer did not keep, then take the glyph.
				while (glyphs[g] && isSpace(glyphs[g]?.ch ?? '')) {
					skipped += glyphs[g]?.advance ?? 0
					g += 1
				}
				const next = glyphs[g]
				if (next) {
					// The drawing and the text layer disagree on a character only for
					// ligatures and normalised forms; the text layer's character is kept.
					current = next.span
					advance = next.advance + skipped
					skipped = 0
					g += 1
				}
			} else if (glyphs[g] && isSpace(glyphs[g]?.ch ?? '')) {
				advance = glyphs[g]?.advance ?? 0
				g += 1
			}
			chars.push({ ch, span: current, advance })
		}
		// The drawn advances should span the item's measured width; scale out any drift
		// (unknown glyph widths, unread spacing operators) so positions stay honest. The
		// measured width covers the item's own characters, not the line-end space appended
		// above, so that space stays out of the sum (counting it shrank every position by
		// a fraction of a percent — enough to slide a narrow "i" out from under its
		// highlight). With no usable advances at all, spread the width evenly.
		for (const c of chars) if (!Number.isFinite(c.advance)) c.advance = 0
		const own = chars.slice(0, [...item.text].length)
		const drawn = own.reduce((sum, c) => sum + c.advance, 0)
		const measured = item.box.width
		if (drawn <= 0 && measured > 0) for (const c of own) c.advance = measured / own.length
		const scale = drawn > 0 && measured > 0 ? measured / drawn : 1
		// Place every character, then decide each space's marks from BOTH neighbours: a
		// space inside an underlined or highlighted phrase carries the mark; one after the
		// phrase's last word does not.
		let x = item.box.x
		const segs: Seg[] = []
		for (const c of chars) {
			const advance = c.advance * scale
			const size = c.span?.size ?? bodySize
			const box: Box = { x, y: item.box.y, width: advance, height: size }
			segs.push(segFor(ctx, c.ch, c.span, box, bodySize))
			x += advance
		}
		for (const [i, seg] of segs.entries()) {
			if (!isSpace(seg.text)) continue
			const before = segs.slice(0, i).findLast((s) => !isSpace(s.text))
			const after = segs.slice(i + 1).find((s) => !isSpace(s.text))
			seg.underline = !!before && !!after && before.underline && after.underline
			seg.background =
				before && after && before.background === after.background ? before.background : null
		}
		for (const seg of segs) {
			const last = out.at(-1)
			if (last && sameStyle(last, seg) && Math.abs(last.y - seg.y) < 0.5) {
				last.text += seg.text
				last.x1 = Math.max(last.x1, seg.x1)
			} else out.push(seg)
		}
	}
	for (const seg of out) seg.text = seg.text.replace(/\s+/g, ' ')
	return out.filter((s) => s.text !== '')
}

function segFor(ctx: Context, ch: string, span: StyleSpan | null, box: Box, bodySize: number): Seg {
	const size = span?.size ?? bodySize
	return {
		text: ch,
		bold: span?.bold ?? false,
		italic: span?.italic ?? false,
		underline: isSpace(ch) ? false : hasUnderline(ctx.page.paths, box),
		superscript: false,
		subscript: false,
		size,
		colour: span?.fill ?? '#000000',
		background:
			isSpace(ch) && box.width === 0
				? null
				: highlightBehind(ctx.page.paths, box, size, ctx.element),
		link: ctx.link ? linkTarget(ctx, ctx.link) : null,
		footnote: null,
		endnote: null,
		y: box.y,
		x0: box.x,
		x1: box.x + box.width,
		lineSize: bodySize || size,
	}
}

const sameStyle = (a: TextRun, b: TextRun): boolean =>
	a.bold === b.bold &&
	a.italic === b.italic &&
	a.underline === b.underline &&
	a.superscript === b.superscript &&
	a.subscript === b.subscript &&
	a.size === b.size &&
	a.colour === b.colour &&
	a.background === b.background &&
	JSON.stringify(a.link) === JSON.stringify(b.link) &&
	a.footnote === b.footnote &&
	a.endnote === b.endnote

/** A thin filled line just under the baseline at this character: an underline (a dotted
 *  one is many tiny rects spaced a point or two apart, so a small horizontal margin lets a
 *  character between two dots count). */
function hasUnderline(paths: PaintedPath[], box: Box): boolean {
	const mid = box.x + box.width / 2
	const x0 = mid - 0.75
	const x1 = mid + 0.75
	for (const p of paths) {
		if (p.kind !== 'fill' || p.box.height > 1.5) continue
		if (p.box.y > box.y + 0.5 || p.box.y < box.y - 3.5) continue
		if (p.box.x < x1 && p.box.x + p.box.width > x0) return true
	}
	return false
}

/** The highlight behind a character, if any: the topmost fill covering at least half the
 *  glyph's width at its baseline height, when that fill is a highlight rather than
 *  shading. Word draws both inside marked-content items of their own, so the tagging does
 *  not tell them apart; what does is that a highlight belongs to the TEXT and shading to
 *  the BOX:
 *   - shading over shading: a paragraph's per-line shading drawn on a cell already filled
 *     in the same colour continues the fill beneath it (a highlight is a different colour
 *     from whatever it sits on, or it would be invisible);
 *   - a highlight is about one line tall;
 *   - per-line shading is a stack of same-colour fills of identical horizontal extent, one
 *     per line, and somewhere in the stack a line's text stops short of the fill (a ragged
 *     or centred line, or an empty one) — a highlight ends where its text ends;
 *   - a lone fill that overruns the line's text at both ends is a shaded single line. */
function highlightBehind(
	paths: PaintedPath[],
	box: Box,
	size: number,
	element: ElementGeometry | null,
): string | null {
	const midY = box.y + size * 0.35
	const covers = (p: PaintedPath): boolean => {
		if (midY < p.box.y || midY > p.box.y + p.box.height) return false
		if (box.width <= 0) return box.x >= p.box.x - 1 && box.x <= p.box.x + p.box.width + 1
		const overlap = Math.min(p.box.x + p.box.width, box.x + box.width) - Math.max(p.box.x, box.x)
		return overlap >= box.width * 0.5
	}
	const stack = paths.filter((p) => p.kind === 'fill' && p.box.height >= size * 0.5 && covers(p))
	const top = stack.at(-1)
	if (!top || top.colour === '#ffffff') return null
	const beneath = stack.at(-2)
	if (beneath && beneath.colour === top.colour) return null
	if (top.box.height > size * 1.3) return null
	const lines = element?.lines ?? []
	const lineOf = (p: PaintedPath) =>
		lines.find((l) => l.y >= p.box.y - 1 && l.y <= p.box.y + p.box.height + 1) ?? null
	const overruns = (p: PaintedPath, side: 'left' | 'right' | 'both'): boolean => {
		const line = lineOf(p)
		if (!line) return true
		const left = p.box.x < line.x0 - 3
		const right = p.box.x + p.box.width > line.x1 + 3
		return side === 'both' ? left && right : left || right
	}
	const chain = fillStack(paths, top)
	if (chain.length > 1)
		return chain.some((p) => overruns(p, 'left') || overruns(p, 'right')) ? null : top.colour
	return overruns(top, 'both') && lines.length > 0 ? null : top.colour
}

/** The fills of one colour and horizontal extent stacked edge to edge with `seed`, in
 *  vertical order — per-line paragraph shading, when there is more than one. */
function fillStack(paths: PaintedPath[], seed: PaintedPath): PaintedPath[] {
	const alike = paths.filter(
		(p) =>
			p.kind === 'fill' &&
			p.colour === seed.colour &&
			Math.abs(p.box.x - seed.box.x) < 1 &&
			Math.abs(p.box.width - seed.box.width) < 1 &&
			p.box.height >= 4,
	)
	const chain = [seed]
	const touching = (a: PaintedPath, b: PaintedPath) =>
		Math.abs(a.box.y - (b.box.y + b.box.height)) < 1.5 ||
		Math.abs(b.box.y - (a.box.y + a.box.height)) < 1.5
	let grew = true
	while (grew) {
		grew = false
		for (const p of alike) {
			if (chain.includes(p) || !chain.some((c) => touching(c, p))) continue
			chain.push(p)
			grew = true
		}
	}
	return chain.sort((a, b) => a.box.y - b.box.y)
}

/** The shading behind a block: the topmost fill covering its lines that extends beyond the
 *  text on the left or right (a cell background, a callout), never a tight highlight. The
 *  topmost, because a page tint or a table's shading may lie beneath the cell's own fill;
 *  a white cell fill on top means the block is unshaded. */
function shadingBehind(paths: PaintedPath[], lines: Line[]): string | null {
	if (lines.length === 0) return null
	const x0 = Math.min(...lines.map((l) => l.x0))
	const x1 = Math.max(...lines.map((l) => l.x1))
	let top: PaintedPath | null = null
	for (const p of paths) {
		if (p.kind !== 'fill' || p.box.height < 6) continue
		const extendsBeyond = p.box.x < x0 - 4 || p.box.x + p.box.width > x1 + 4
		if (!extendsBeyond) continue
		if (
			!lines.every(
				(l) =>
					p.box.y <= l.y + 1 &&
					p.box.y + p.box.height >= l.y - 1 &&
					p.box.x < l.x1 &&
					p.box.x + p.box.width > l.x0,
			)
		)
			continue
		top = p
	}
	return top === null || top.colour === '#ffffff' ? null : top.colour
}

function linkTarget(ctx: Context, link: LinkAnnotation): TextRun['link'] {
	if (link.url) return { url: link.url }
	if (link.dest) {
		try {
			// An explicit destination: [pageRef, {name: 'XYZ'|'FitH'|…}, x?, y?, zoom?].
			const parsed: unknown = JSON.parse(link.dest)
			if (
				Array.isArray(parsed) &&
				parsed[0] &&
				typeof parsed[0] === 'object' &&
				'num' in parsed[0]
			) {
				const page = ctx.pageOfRef.get(Number(parsed[0].num))
				const y =
					typeof parsed[3] === 'number'
						? parsed[3]
						: typeof parsed[2] === 'number' && parsed[1]?.name === 'FitH'
							? parsed[2]
							: null
				if (page) return { page, y }
			}
		} catch {
			/* recorded below */
		}
		ctx.warnings.push({ page: ctx.pageNumber, message: `unresolved link destination ${link.dest}` })
	}
	return null
}

// ---------------------------------------------------------------------------
// Inline structure: Link, Span, Note
// ---------------------------------------------------------------------------

/** Every segment under a node, in order. A Link scopes its annotation over the runs below
 *  it; a Note under a Link is a footnote whose marker is the Link's other content, or an
 *  endnote body when the Link shows no marker; a small numeric Link into another page is
 *  an endnote marker. */
function inlineSegs(ctx: Context, node: TreeNode | StructTreeContent, into: Seg[]): void {
	if (!ctx.element) {
		// The outermost call defines the element: measure it, read it, then decide the
		// raised marks within its lines.
		withElement(ctx, node, () => {
			const start = into.length
			inlineSegs(ctx, node, into)
			markRaised(ctx, into.slice(start))
		})
		return
	}
	if (isLeaf(node)) {
		if (node.type === 'content') into.push(...segsOf(ctx, node.id))
		return
	}
	if (node.role === 'Note') {
		noteOf(ctx, node, [], into)
		return
	}
	if (node.role === 'Link') {
		const annotationLeaf = (node.children ?? []).find((c) => isLeaf(c) && c.type === 'annotation')
		const link =
			annotationLeaf && isLeaf(annotationLeaf)
				? (ctx.page.linksById.get(annotationIdOf(annotationLeaf)) ?? null)
				: null
		const previous = ctx.link
		ctx.link = link
		const notes: TreeNode[] = []
		const markerSegs: Seg[] = []
		for (const child of node.children ?? []) {
			if (isLeaf(child) && child.type === 'annotation') continue
			if (!isLeaf(child) && child.role === 'Note') notes.push(child)
			else inlineSegs(ctx, child, markerSegs)
		}
		ctx.link = previous
		if (notes.length > 0) {
			for (const note of notes) noteOf(ctx, note, markerSegs, into)
			return
		}
		const label = plainText(markerSegs).trim()
		const target = link ? linkTarget(ctx, link) : null
		if (
			/^\d{1,3}$/.test(label) &&
			target &&
			'page' in target &&
			target.page !== ctx.pageNumber &&
			markerSegs.every((s) => s.superscript || s.size < s.lineSize * 0.8)
		) {
			const trailing = detachTrailingSpace(markerSegs)
			for (const seg of markerSegs) {
				seg.endnote = Number(label)
				seg.superscript = true
				seg.link = null
			}
			markerSegs.push(...trailing)
		}
		into.push(...markerSegs)
		return
	}
	for (const child of node.children ?? []) inlineSegs(ctx, child, into)
}

/** A Note element: a footnote (when it has a marker) or one or more endnote bodies (when
 *  it has none). The marker segments are emitted into the flow; bodies are filed. */
function noteOf(ctx: Context, note: TreeNode, markerSegs: Seg[], into: Seg[]): void {
	const label = plainText(markerSegs).trim()
	if (label !== '') {
		const blocks: Block[] = []
		blockChildren(ctx, note, blocks)
		stripLeadingLabel(blocks, label)
		const index = ctx.footnotes.push({ label, page: ctx.pageNumber, blocks }) - 1
		const trailing = detachTrailingSpace(markerSegs)
		for (const seg of markerSegs) {
			seg.footnote = index
			seg.superscript = true
			seg.link = null
		}
		into.push(...markerSegs, ...trailing)
		return
	}
	const segs: Seg[] = []
	for (const child of note.children ?? []) inlineSegs(ctx, child, segs)
	// Filed here rather than emitted, so the element's raised-mark pass never sees them.
	markRaised(ctx, segs)
	fileEndnoteLines(ctx, linesOf(segs))
}

/** The inter-word space after a marker belongs to the flow, not to the marker: split it
 *  off as a plain segment before the marker becomes a note reference. */
function detachTrailingSpace(markerSegs: Seg[]): Seg[] {
	const last = markerSegs.at(-1)
	if (!last || last.text.trim() === '' || !/\s$/.test(last.text)) return []
	last.text = last.text.replace(/\s+$/, '')
	return [
		{
			...last,
			text: ' ',
			superscript: false,
			subscript: false,
			link: null,
			footnote: null,
			endnote: null,
		},
	]
}

/** A line that begins a note: its first token is a small integer in its own run (the
 *  number is set smaller than the body) or a bare integer followed by the entry text.
 *  `consumed` counts from the line's first non-blank character, as the runs are trimmed. */
function noteNumberAt(line: Line): { number: number; consumed: number } | null {
	const first = line.segs.find((s) => s.text.trim() !== '')
	if (!first) return null
	const text = plainText(line.segs).trimStart()
	const own = first.text.trim().match(/^(\d{1,3})$/)
	if (own && (first.size < line.size * 0.9 || first.superscript))
		return { number: Number(own[1]), consumed: first.text.trimStart().length }
	const inline = text.match(/^\s*(\d{1,3})(?![\d.,;:])[.)]?\s+(?=\S)/)
	if (
		inline?.[1] &&
		(first.size < line.size * 0.9 || first.superscript || /^\d{1,3}$/.test(first.text.trim()))
	) {
		return { number: Number(inline[1]), consumed: inline[0].length }
	}
	return null
}

/** Endnote bodies from lines: a new entry opens at each numbered line start; other lines
 *  continue the entry before them. */
function fileEndnoteLines(ctx: Context, lines: Line[]): void {
	let current: { number: number; page: number; lines: Line[]; consumed: number } | null = null
	const flush = () => {
		if (!current) return
		const runs = stripPrefix(runsFromLines(current.lines), current.consumed)
		ctx.endnotes.push({ number: current.number, page: current.page, runs })
		current = null
	}
	for (const line of lines) {
		const start = noteNumberAt(line)
		if (start) {
			flush()
			current = {
				number: start.number,
				page: ctx.pageNumber,
				lines: [line],
				consumed: start.consumed,
			}
		} else if (current) current.lines.push(line)
		else {
			const text = plainText(line.segs).trim()
			if (text)
				ctx.warnings.push({
					page: ctx.pageNumber,
					message: `unnumbered note text: "${text.slice(0, 60)}"`,
				})
		}
	}
	flush()
}

/** Blocks already built (a References part tagged as ordinary paragraphs): each becomes
 *  endnote lines again by its runs' order; numbering by the same rule. */
function fileEndnotes(ctx: Context, blocks: Block[]): void {
	for (const block of blocks) {
		if (block.kind === 'list') {
			for (const item of block.items) fileEndnotes(ctx, item.blocks)
			continue
		}
		if (block.kind !== 'paragraph') continue
		const text = plainText(block.runs)
		const m = text.match(/^\s*(\d{1,3})(?![\d.])[.)]?\s*/)
		if (m?.[1])
			ctx.endnotes.push({
				number: Number(m[1]),
				page: block.page,
				runs: stripPrefix(block.runs, m[0].length),
			})
		else {
			const last = ctx.endnotes.at(-1)
			const spacer = block.runs[0]
			if (last && spacer) last.runs.push({ ...spacer, text: ' ' }, ...block.runs)
			else
				ctx.warnings.push({
					page: block.page,
					message: `unnumbered note text: "${text.slice(0, 60)}"`,
				})
		}
	}
}

function stripLeadingLabel(blocks: Block[], label: string): void {
	const first = blocks[0]
	if (first?.kind !== 'paragraph') return
	const text = plainText(first.runs)
	if (text.startsWith(label)) first.runs = stripPrefix(first.runs, label.length)
}

/** Remove the first `count` characters (and following spaces) from a run sequence. */
function stripPrefix(runs: TextRun[], count: number): TextRun[] {
	const out: TextRun[] = []
	let remaining = count
	for (const run of runs) {
		if (remaining <= 0) {
			out.push(run)
			continue
		}
		if (run.text.length <= remaining) {
			remaining -= run.text.length
			continue
		}
		out.push({ ...run, text: run.text.slice(remaining) })
		remaining = 0
	}
	const first = out[0]
	if (first) first.text = first.text.replace(/^\s+/, '')
	return out.filter((r) => r.text !== '')
}

// ---------------------------------------------------------------------------
// Lines and paragraphs
// ---------------------------------------------------------------------------

/** Group segments into lines by baseline, in reading order. A raised or lowered marker
 *  (a superscript citation, a subscript) belongs to the line it decorates. */
function linesOf(segs: Seg[]): Line[] {
	const lines: Line[] = []
	for (const seg of segs) {
		const last = lines.at(-1)
		const small = seg.superscript || seg.subscript || seg.size <= seg.lineSize * 0.78
		const tolerance = small
			? Math.max(3, last?.size ?? seg.lineSize) * 0.8
			: Math.max(2, (last?.size ?? seg.lineSize) * 0.45)
		if (last && Math.abs(last.y - seg.y) < tolerance) {
			last.segs.push(seg)
			last.x0 = Math.min(last.x0, seg.x0)
			last.x1 = Math.max(last.x1, seg.x1)
			last.size = Math.max(last.size, seg.lineSize)
		} else lines.push({ y: seg.y, x0: seg.x0, x1: seg.x1, size: seg.lineSize, segs: [seg] })
	}
	return lines
}

/** Lines → paragraphs: a new paragraph opens where the vertical gap exceeds the line
 *  pitch by half a line, where the text jumps back up (a new cell or column), and where
 *  the heading style begins, ends or changes level. Consecutive lines in one heading
 *  style are one heading (a title wrapped over two lines). */
function paragraphsFromLines(ctx: Context, lines: Line[]): Line[][] {
	const groups: Line[][] = []
	let current: Line[] = []
	let previous: Line | null = null
	for (const line of lines) {
		const heading = headingLevelOf(ctx, line)
		const previousHeading = previous ? headingLevelOf(ctx, previous) : null
		let breakHere = false
		if (previous) {
			const gap = previous.y - line.y
			const pitch = Math.max(previous.size, line.size) * 1.15
			if (gap > pitch * 1.55) breakHere = true
			if (gap < -2) breakHere = true
			if (heading !== previousHeading) breakHere = true
		}
		if (breakHere && current.length > 0) {
			groups.push(current)
			current = []
		}
		current.push(line)
		previous = line
	}
	if (current.length > 0) groups.push(current)
	return groups
}

/** Lines → runs. Lines join with a space, a margin-broken word rejoins without one, and a
 *  line the author ended early ends in a hard break (`'\n'` run). `context` is every line
 *  of the element these lines came from, for its margins. */
function runsFromLines(lines: Line[], context: Line[] = lines): TextRun[] {
	const runs: TextRun[] = []
	for (const [i, line] of lines.entries()) {
		for (const seg of line.segs) {
			const { y: _y, x0: _x0, x1: _x1, lineSize: _s, ...run } = seg
			const last = runs.at(-1)
			// One space between words, whichever side of a run boundary each half was drawn on.
			const text = last?.text.endsWith(' ') ? run.text.replace(/^\s+/, '') : run.text
			if (text === '') continue
			if (last && sameStyle(last, run)) last.text += text
			else runs.push({ ...run, text })
		}
		const next = lines[i + 1]
		if (next) {
			const last = runs.at(-1)
			const nextText = plainText(next.segs)
			// A line ending in a hyphen followed by a lower-case continuation is one word
			// broken at the margin ("sub-" / "headings"): rejoin it without a space.
			const hyphenated = last?.text.trimEnd().endsWith('-') && /^[a-z]/.test(nextText.trimStart())
			if (last && hyphenated) last.text = last.text.trimEnd()
			else if (last && endsEarly(line, next, context)) {
				last.text = last.text.trimEnd()
				runs.push({ ...last, text: '\n' })
			} else if (last && !last.text.endsWith(' ')) last.text += ' '
		}
	}
	trimRuns(runs)
	return runs
}

/** A line the author broke by hand: left-aligned like its neighbours, yet it stops short
 *  of the element's right margin by more than the next line's first word would have
 *  needed — wrapping would have carried that word up. The margin is where wrapped lines
 *  end, so at least two lines must reach it (one long URL overflowing a cell is not the
 *  margin). */
function endsEarly(line: Line, next: Line, context: Line[]): boolean {
	if (context.length < 3) return false
	const left = Math.min(...context.map((l) => l.x0))
	const ends = context.map((l) => l.x1).sort((a, b) => b - a)
	const right = ends.find((x1) => context.filter((l) => Math.abs(l.x1 - x1) <= 3).length >= 2)
	if (right === undefined) return false
	if (Math.abs(line.x0 - left) > 2 || Math.abs(next.x0 - left) > 2) return false
	const firstWord = firstWordWidth(next)
	if (firstWord <= 0) return false
	const space = next.size * 0.28
	return right - line.x1 > firstWord + 2 * space
}

/** The drawn width of a line's first word, from its segments' extents. */
function firstWordWidth(line: Line): number {
	let width = 0
	for (const seg of line.segs) {
		const text = seg.text
		const end = text.search(/\s/)
		const perChar = text.length > 0 ? (seg.x1 - seg.x0) / text.length : 0
		if (end < 0) {
			width += seg.x1 - seg.x0
			continue
		}
		if (end === 0 && width === 0) continue
		width += perChar * end
		return width
	}
	return width
}

function trimRuns(runs: TextRun[]): void {
	while (runs.length > 0 && runs[0]?.text.trim() === '') runs.shift()
	while (runs.length > 0 && runs.at(-1)?.text.trim() === '') runs.pop()
	const first = runs[0]
	if (first) first.text = first.text.replace(/^\s+/, '')
	const last = runs.at(-1)
	if (last) last.text = last.text.replace(/\s+$/, '')
}

function paragraphFromLines(
	ctx: Context,
	lines: Line[],
	context: Line[] = lines,
): Paragraph | null {
	const runs = runsFromLines(lines, context)
	if (runs.length === 0) return null
	return {
		kind: 'paragraph',
		runs,
		page: ctx.pageNumber,
		background: shadingBehind(ctx.page.paths, lines),
	}
}

// ---------------------------------------------------------------------------
// Headings by style
// ---------------------------------------------------------------------------

const roundSize = (size: number) => Math.round(size * 2) / 2

/** The style of a line: its dominant size, colour and weight by character count. */
function lineStyle(line: Line): { size: number; colour: string; bold: boolean } {
	const weight = new Map<string, number>()
	for (const seg of line.segs) {
		if (seg.text.trim() === '') continue
		const key = `${roundSize(seg.size)}|${seg.colour}|${seg.bold}`
		weight.set(key, (weight.get(key) ?? 0) + seg.text.length)
	}
	let best = ''
	let count = -1
	for (const [k, v] of weight) if (v > count) [best, count] = [k, v]
	const [size, colour, bold] = best.split('|')
	return { size: Number(size), colour: colour ?? '#000000', bold: bold === 'true' }
}

/** Learn what each heading level looks like from the tagged heading elements. */
function learnHeadingStyles(pages: PdfPage[], pageOfRef: Map<number, number>): HeadingStyle[] {
	const votes = new Map<string, { style: HeadingStyle; count: number }>()
	for (const page of pages) {
		if (!page.tree) continue
		const ctx: Context = {
			page,
			pageNumber: page.pageNumber,
			pageOfRef,
			footnotes: [],
			endnotes: [],
			warnings: [],
			headingStyles: [],
			link: null,
			inNotesPart: false,
			element: null,
		}
		const visit = (node: TreeNode | StructTreeContent): void => {
			if (isLeaf(node)) return
			const m = node.role.match(HEADING_ROLE)
			if (m) {
				const segs: Seg[] = []
				inlineSegs(ctx, node, segs)
				const first = linesOf(segs)[0]
				if (first && plainText(first.segs).trim() !== '') {
					const s = lineStyle(first)
					const key = `${m[1]}|${s.size}|${s.colour}|${s.bold}`
					const entry = votes.get(key) ?? { style: { level: Number(m[1]), ...s }, count: 0 }
					entry.count += 1
					votes.set(key, entry)
				}
			}
			for (const child of node.children ?? []) visit(child)
		}
		visit(page.tree)
	}
	// Keep every style seen at least twice, or once when it is the level's only style.
	const byLevel = new Map<number, { style: HeadingStyle; count: number }[]>()
	for (const v of votes.values()) {
		const list = byLevel.get(v.style.level) ?? []
		list.push(v)
		byLevel.set(v.style.level, list)
	}
	const styles: HeadingStyle[] = []
	for (const list of byLevel.values()) {
		const total = list.reduce((n, v) => n + v.count, 0)
		for (const v of list) if (v.count >= 2 || v.count === total) styles.push(v.style)
	}
	return styles
}

/** The heading level a line is printed at, or null. A heading line is short and in a
 *  learned heading style. When two levels share a style, the element's own tag decides,
 *  then the level that continues the current outline (the next level down, or the
 *  shallowest match). */
function headingLevelOf(
	ctx: Context,
	line: Line,
	tagged: number | null = null,
	currentLevel = 0,
): number | null {
	const text = plainText(line.segs).trim()
	if (text === '' || text.length > 160) return null
	const s = lineStyle(line)
	const candidates = ctx.headingStyles
		.filter((h) => Math.abs(h.size - s.size) <= 0.5 && h.colour === s.colour && h.bold === s.bold)
		.map((h) => h.level)
	if (candidates.length === 0) return null
	if (tagged !== null && candidates.includes(tagged)) return tagged
	const deeper = candidates.filter((l) => l > currentLevel).sort((a, b) => a - b)
	return deeper[0] ?? Math.min(...candidates)
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

function markerKind(label: string, font: string | undefined): ListMarker {
	const l = label.trim()
	if (/^\d+[.)]?$/.test(l) || /^[a-z][.)]$/i.test(l)) return 'number'
	if (l === '•' || l === '' || l === '' || l === '○' || l === '▪' || l === '■' || l === '·')
		return 'bullet'
	if (l === '–' || l === '-' || l === '—') return 'dash'
	if (l === '✓' || l === '✔' || l === '' || l === 'ü') return 'check'
	if (l === '☒' || l === '✗' || l === '✘' || l === 'û' || l === 'ý') return 'cross'
	if ((font ?? '').toLowerCase().includes('wingdings') && l !== '') return 'check'
	return 'other'
}

function listOf(ctx: Context, node: TreeNode): List | null {
	const items: ListItem[] = []
	for (const child of node.children ?? []) {
		if (isLeaf(child)) continue
		if (child.role !== 'LI') {
			const blocks: Block[] = []
			blockChildren(ctx, child, blocks)
			if (blocks.length > 0) items.push({ label: '', marker: 'other', blocks })
			continue
		}
		let label = ''
		let labelFont: string | undefined
		const blocks: Block[] = []
		for (const part of child.children ?? []) {
			if (isLeaf(part)) {
				// Text directly under the item (no LBody): read it as an element of its own.
				if (part.type === 'content') {
					const segs: Seg[] = []
					inlineSegs(ctx, part, segs)
					const lines = linesOf(segs)
					for (const g of paragraphsFromLines(ctx, lines)) {
						const p = paragraphFromLines(ctx, g, lines)
						if (p) blocks.push(p)
					}
				}
				continue
			}
			if (part.role === 'Lbl') {
				const segs: Seg[] = []
				inlineSegs(ctx, part, segs)
				label = plainText(segs).trim()
				const leaf = (part.children ?? []).find(isLeaf)
				labelFont =
					leaf && leaf.type === 'content' ? ctx.page.spansByMcid.get(leaf.id)?.[0]?.font : undefined
			} else blockChildren(ctx, part, blocks)
		}
		// Word often writes the marker as the first glyph of the body's text ("• Surgery"),
		// usually in its own font, so it is its own run.
		const first = blocks[0]
		if (label === '' && first?.kind === 'paragraph') {
			const m = plainText(first.runs).match(/^\s*([•–\-✓✔·]|\d+[.)])\s*/)
			if (m?.[1]) {
				label = m[1]
				labelFont = undefined
				first.runs = stripPrefix(first.runs, m[0].length)
			}
		}
		items.push({ label, marker: markerKind(label, labelFont), blocks })
	}
	return items.length > 0 ? { kind: 'list', items, page: ctx.pageNumber } : null
}

function tableOf(ctx: Context, node: TreeNode): Table | null {
	const rows: TableRow[] = []
	const walkRows = (n: TreeNode) => {
		for (const child of n.children ?? []) {
			if (isLeaf(child)) continue
			if (child.role === 'TR') {
				const cells: TableCell[] = []
				for (const cellNode of child.children ?? []) {
					if (isLeaf(cellNode) || (cellNode.role !== 'TD' && cellNode.role !== 'TH')) continue
					const blocks: Block[] = []
					blockChildren(ctx, cellNode, blocks)
					cells.push({
						header: cellNode.role === 'TH',
						rowSpan: cellNode.rowSpan ?? 1,
						colSpan: cellNode.colSpan ?? 1,
						background: shadingBehind(ctx.page.paths, linesOf(geometrySegs(ctx, cellNode))),
						blocks,
					})
				}
				if (cells.length > 0) rows.push({ cells })
			} else walkRows(child)
		}
	}
	walkRows(node)
	if (rows.length === 0) return null
	const segs = geometrySegs(ctx, node)
	if (segs.length === 0) return { kind: 'table', rows, page: ctx.pageNumber, border: null }
	const x0 = Math.min(...segs.map((s) => s.x0))
	const x1 = Math.max(...segs.map((s) => s.x1))
	let border: string | null = null
	for (const p of ctx.page.paths) {
		if (p.kind !== 'fill' || p.box.height > 1.2 || p.box.width < (x1 - x0) * 0.6) continue
		if (p.colour === '#ffffff') continue
		if (p.box.x <= x0 + 8 && p.box.x + p.box.width >= x1 - 8) {
			border = p.colour
			break
		}
	}
	return { kind: 'table', rows, page: ctx.pageNumber, border }
}

function figureOf(ctx: Context, node: TreeNode): Figure {
	const b = node.bbox
	return {
		kind: 'figure',
		alt: node.alt ?? '',
		page: ctx.pageNumber,
		bbox: b && b.length === 4 ? [b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0] : null,
	}
}

/** A paragraph-like element (P or H*) → one or more paragraphs by line gaps. Inline
 *  content directly under a container is gathered the same way. */
function paragraphsOf(ctx: Context, node: TreeNode | StructTreeContent): Paragraph[] {
	const segs: Seg[] = []
	inlineSegs(ctx, node, segs)
	const out: Paragraph[] = []
	const lines = linesOf(segs)
	for (const group of paragraphsFromLines(ctx, lines)) {
		const p = paragraphFromLines(ctx, group, lines)
		if (p) out.push(p)
	}
	return out
}

/** Blocks under a container node (a cell, an LBody, a Note, a Sect). Inline content
 *  directly under the container is read as one element — the container itself. */
function blockChildren(ctx: Context, node: TreeNode, into: Block[]): void {
	let pending: Seg[] = []
	const flush = () => {
		const lines = linesOf(pending)
		for (const group of paragraphsFromLines(ctx, lines)) {
			const p = paragraphFromLines(ctx, group, lines)
			if (p) into.push(p)
		}
		pending = []
	}
	const inlineChildren: (TreeNode | StructTreeContent)[] = (node.children ?? []).filter(
		(c) => isLeaf(c) || c.role === 'Link' || c.role === 'Span' || c.role === 'Note',
	)
	const inlineElement: TreeNode = { role: 'Span', children: inlineChildren }
	const readInline = (child: TreeNode | StructTreeContent) => {
		const outer = ctx.element
		if (!outer) ctx.element = measureElement(ctx, inlineElement)
		try {
			const start = pending.length
			inlineSegs(ctx, child, pending)
			if (!outer) markRaised(ctx, pending.slice(start))
		} finally {
			if (!outer) ctx.element = null
		}
	}
	for (const child of node.children ?? []) {
		if (isLeaf(child)) {
			if (child.type === 'content') readInline(child)
			continue
		}
		switch (child.role) {
			case 'P':
			case 'H1':
			case 'H2':
			case 'H3':
			case 'H4':
			case 'H5':
			case 'H6':
				flush()
				into.push(...paragraphsOf(ctx, child))
				break
			case 'L': {
				flush()
				const l = listOf(ctx, child)
				if (l) into.push(l)
				break
			}
			case 'Table': {
				flush()
				const t = tableOf(ctx, child)
				if (t) into.push(t)
				break
			}
			case 'Figure':
				flush()
				into.push(figureOf(ctx, child))
				break
			case 'Link':
			case 'Span':
			case 'Note':
				readInline(child)
				break
			default:
				flush()
				blockChildren(ctx, child, into)
		}
	}
	flush()
}

// ---------------------------------------------------------------------------
// Sections: the heading structure across pages
// ---------------------------------------------------------------------------

interface Outline {
	front: Block[]
	sections: Section[]
	stack: Section[]
	next: number
}

function openSection(
	outline: Outline,
	level: number,
	heading: TextRun[],
	page: number,
	y: number,
): Section {
	const headingText = plainText(heading).replace(/\s+/g, ' ').trim()
	const numbered = headingText.match(NUMBERED)
	const step = headingText.match(STEP)
	const section: Section = {
		id: `s${outline.next++}`,
		level,
		heading,
		headingText,
		number: numbered?.[1] ?? (step ? `Step ${step[1]}` : null),
		page,
		y,
		blocks: [],
		children: [],
	}
	while (outline.stack.length > 0 && (outline.stack.at(-1)?.level ?? 0) >= level)
		outline.stack.pop()
	const parent = outline.stack.at(-1)
	if (parent) parent.children.push(section)
	else outline.sections.push(section)
	outline.stack.push(section)
	return section
}

const currentBlocks = (outline: Outline): Block[] => outline.stack.at(-1)?.blocks ?? outline.front

/** Emit a paragraph-like element into the document flow: heading-styled line groups open
 *  sections (whatever the element's tag), the rest become paragraphs of the current one. */
function flowParagraphs(
	ctx: Context,
	outline: Outline,
	node: TreeNode | StructTreeContent,
	taggedLevel: number | null,
): void {
	const segs: Seg[] = []
	inlineSegs(ctx, node, segs)
	const lines = linesOf(segs)
	const groups = paragraphsFromLines(ctx, lines)
	for (const [i, group] of groups.entries()) {
		const first = group[0]
		const currentLevel = outline.stack.at(-1)?.level ?? 0
		const styled = first ? headingLevelOf(ctx, first, taggedLevel, currentLevel) : null
		// The first group of a tagged heading is a heading even if its style is unlearned.
		const level = styled ?? (i === 0 ? taggedLevel : null)
		if (level !== null) {
			const runs = runsFromLines(group)
			if (runs.length > 0) {
				const section = openSection(outline, level, runs, ctx.pageNumber, first?.y ?? 0)
				ctx.inNotesPart = NOTE_PART.test(section.headingText)
			}
			continue
		}
		const p = paragraphFromLines(ctx, group, lines)
		if (!p) continue
		if (ctx.inNotesPart) fileEndnotes(ctx, [p])
		else currentBlocks(outline).push(p)
	}
}

/** A single-cell table whose cell holds heading-styled lines is a page frame. */
function isFrame(ctx: Context, node: TreeNode): boolean {
	const cells: TreeNode[] = []
	const collect = (n: TreeNode) => {
		for (const c of n.children ?? []) {
			if (isLeaf(c)) continue
			if (c.role === 'TD' || c.role === 'TH') cells.push(c)
			else collect(c)
		}
	}
	collect(node)
	const only = cells[0]
	if (cells.length !== 1 || !only) return false
	return linesOf(geometrySegs(ctx, only)).some((line) => headingLevelOf(ctx, line) !== null)
}

/** Walk a page's tree at flow level: headings open sections; everything else is a block
 *  of the current section. */
function walkFlow(ctx: Context, outline: Outline, node: TreeNode): void {
	for (const child of node.children ?? []) {
		if (isLeaf(child)) {
			if (child.type === 'content') flowParagraphs(ctx, outline, child, null)
			continue
		}
		const tagged = child.role.match(HEADING_ROLE)
		if (tagged || child.role === 'P') {
			flowParagraphs(ctx, outline, child, tagged ? Number(tagged[1]) : null)
			continue
		}
		if (child.role === 'Table' && isFrame(ctx, child)) {
			walkFlow(ctx, outline, child)
			continue
		}
		if (
			[
				'Document',
				'Sect',
				'Part',
				'Div',
				'Art',
				'THead',
				'TBody',
				'TR',
				'TD',
				'TH',
				'NonStruct',
			].includes(child.role)
		) {
			walkFlow(ctx, outline, child)
			continue
		}
		const blocks: Block[] = []
		blockChildren(ctx, { role: 'Div', children: [child] }, blocks)
		if (ctx.inNotesPart) fileEndnotes(ctx, blocks)
		else currentBlocks(outline).push(...blocks)
	}
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export async function readDocument(
	doc: PDFDocumentProxy,
	source: string,
): Promise<ExtractedDocument> {
	const pages: PdfPage[] = []
	for (let n = 1; n <= doc.numPages; n++) pages.push(await readPage(doc, n))

	const pageOfRef = new Map<number, number>()
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n)
		if (page.ref) pageOfRef.set(page.ref.num, n)
	}

	const headingStyles = learnHeadingStyles(pages, pageOfRef)
	const footnotes: Footnote[] = []
	const endnotes: Endnote[] = []
	const warnings: Warning[] = []
	const outline: Outline = { front: [], sections: [], stack: [], next: 1 }
	let inNotesPart = false

	for (const page of pages) {
		const ctx: Context = {
			page,
			pageNumber: page.pageNumber,
			pageOfRef,
			footnotes,
			endnotes,
			warnings,
			headingStyles,
			link: null,
			inNotesPart,
			element: null,
		}
		if (!page.tree) {
			warnings.push({ page: page.pageNumber, message: 'page has no structure tree' })
			continue
		}
		walkFlow(ctx, outline, page.tree)
		inNotesPart = ctx.inNotesPart
		for (const id of page.untaggedMcids) {
			const text = (page.textByMcid.get(id) ?? [])
				.map((t) => t.text)
				.join('')
				.trim()
			if (text)
				warnings.push({
					page: page.pageNumber,
					message: `untagged text not placed: "${text.slice(0, 80)}"`,
				})
		}
	}

	endnotes.sort((a, b) => a.number - b.number)
	const seen = new Set<number>()
	for (const e of endnotes) {
		if (seen.has(e.number))
			warnings.push({ page: e.page, message: `endnote ${e.number} appears more than once` })
		seen.add(e.number)
	}

	const front = normaliseBlocks(outline.front)
	const normaliseSections = (sections: Section[]) => {
		for (const s of sections) {
			s.blocks = normaliseBlocks(s.blocks)
			normaliseSections(s.children)
		}
	}
	normaliseSections(outline.sections)

	const title = plainText(outline.sections.find((s) => s.level === 1)?.heading ?? []) || source
	return {
		source,
		pages: doc.numPages,
		title,
		front,
		sections: outline.sections,
		footnotes,
		endnotes,
		warnings,
	}
}

// ---------------------------------------------------------------------------
// Block sequence repairs: tables broken over a page, lists tagged beside their parent
// ---------------------------------------------------------------------------

/** The repairs a block sequence needs once a whole document has been read, applied to
 *  every sequence (sections, list items, cells). */
function normaliseBlocks(blocks: Block[]): Block[] {
	return nestTrailingLists(joinPageSplitTables(blocks.map(descend)))
}

function descend(block: Block): Block {
	if (block.kind === 'list')
		return nestMixedMarkers({
			...block,
			items: block.items.map((i) => ({ ...i, blocks: normaliseBlocks(i.blocks) })),
		})
	if (block.kind === 'table')
		return {
			...block,
			rows: block.rows.map((r) => ({
				cells: r.cells.map((c) => ({ ...c, blocks: normaliseBlocks(c.blocks) })),
			})),
		}
	return block
}

const lastParagraphText = (blocks: Block[]): string => {
	const last = blocks.findLast((b) => b.kind === 'paragraph')
	return last?.kind === 'paragraph' ? plainText(last.runs).trim() : ''
}

/** Items of one list whose marker changes after an item ending in a colon are that item's
 *  sub-list ("provide information about:" ✓, then "•" transport, out-of-pocket costs…, then
 *  "✓" again): Word tags a sub-list's items as further items of the parent list when the
 *  author typed them at the same list level with another bullet style. The sub-list runs
 *  until the parent's marker returns. */
function nestMixedMarkers(list: List): List {
	const items: ListItem[] = []
	let nested: List | null = null
	for (const item of list.items) {
		if (nested && item.marker === nested.items[0]?.marker) {
			nested.items.push(item)
			continue
		}
		nested = null
		const prev = items.at(-1)
		if (prev && item.marker !== prev.marker && /:$/.test(lastParagraphText(prev.blocks))) {
			nested = { kind: 'list', items: [item], page: list.page }
			items[items.length - 1] = { ...prev, blocks: [...prev.blocks, nested] }
			continue
		}
		items.push(item)
	}
	return { ...list, items }
}

/** A list that follows a list whose last item ends in a colon, with a different marker,
 *  is that item's sub-list: Word tags the nested list as the parent's sibling when the
 *  item's paragraph and the sub-list are separate paragraphs ("provide information about:"
 *  then the bullets). */
function nestTrailingLists(blocks: Block[]): Block[] {
	const out: Block[] = []
	for (const b of blocks) {
		const last = out.at(-1)
		const tail = last?.kind === 'list' ? last.items.at(-1) : undefined
		if (
			b.kind === 'list' &&
			last?.kind === 'list' &&
			tail &&
			b.items[0]?.marker !== tail.marker &&
			/:$/.test(lastParagraphText(tail.blocks))
		) {
			const items = [...last.items.slice(0, -1), { ...tail, blocks: [...tail.blocks, b] }]
			out[out.length - 1] = { ...last, items }
			continue
		}
		out.push(b)
	}
	return out
}

const cellHasContent = (cell: TableCell): boolean =>
	cell.blocks.some(
		(b) =>
			b.kind === 'figure' ||
			(b.kind === 'table' && b.rows.length > 0) ||
			(b.kind === 'list' && b.items.length > 0) ||
			(b.kind === 'paragraph' && plainText(b.runs).trim() !== ''),
	)

/** The structure tree is delivered page by page, so a table that runs over a page break
 *  arrives twice: on each page the whole table, with every cell whose content sits on the
 *  other page left empty. Two consecutive tables on consecutive pages of the same shape
 *  are one table when no cell is filled on both sides — or exactly one is, the cell the
 *  break fell inside, whose two halves are then read on after each other. */
function joinPageSplitTables(blocks: Block[]): Block[] {
	const out: Block[] = []
	for (const b of blocks) {
		const last = out.at(-1)
		const joined = last?.kind === 'table' && b.kind === 'table' ? joinTables(last, b) : null
		if (joined && last) out[out.length - 1] = joined
		else out.push(b)
	}
	return out
}

function joinTables(a: Table, b: Table): Table | null {
	if (b.page !== a.page + 1 || a.rows.length !== b.rows.length) return null
	const rows: TableRow[] = []
	let shared = 0
	for (const [i, rowA] of a.rows.entries()) {
		const rowB = b.rows[i]
		if (!rowB || rowA.cells.length !== rowB.cells.length) return null
		const cells: TableCell[] = []
		for (const [j, cellA] of rowA.cells.entries()) {
			const cellB = rowB.cells[j]
			if (!cellB) return null
			const inA = cellHasContent(cellA)
			const inB = cellHasContent(cellB)
			if (inA && inB) {
				shared++
				if (shared > 1) return null
				cells.push({
					...cellA,
					header: cellA.header || cellB.header,
					blocks: continueBlocks(cellA.blocks, cellB.blocks),
				})
				continue
			}
			const filled = inB ? cellB : cellA
			cells.push({
				...filled,
				header: cellA.header || cellB.header,
				background: filled.background ?? cellA.background ?? cellB.background,
			})
		}
		rows.push({ cells })
	}
	return { kind: 'table', rows, page: a.page, border: a.border ?? b.border }
}

/** The two halves of a cell the page break fell inside. A list broken over the break
 *  continues as one list (a continuation item with no text of its own carries the nested
 *  items of the item before it); a sentence broken mid-way continues as one paragraph. */
function continueBlocks(before: Block[], after: Block[]): Block[] {
	const last = before.at(-1)
	const first = after[0]
	if (last?.kind === 'list' && first?.kind === 'list') {
		const items = [...last.items]
		const rest = [...first.items]
		const carried = rest[0]
		const tail = items.at(-1)
		if (
			carried &&
			tail &&
			carried.blocks.every((b) => b.kind !== 'paragraph' || plainText(b.runs).trim() === '')
		) {
			rest.shift()
			items[items.length - 1] = {
				...tail,
				blocks: continueBlocks(
					tail.blocks,
					carried.blocks.filter((b) => b.kind !== 'paragraph'),
				),
			}
		}
		return [...before.slice(0, -1), { ...last, items: [...items, ...rest] }, ...after.slice(1)]
	}
	if (last?.kind === 'paragraph' && first?.kind === 'paragraph') {
		const endText = plainText(last.runs).trimEnd()
		const startText = plainText(first.runs).trimStart()
		const base = last.runs.at(-1) ?? first.runs[0]
		if (base && endText !== '' && !/[.!?:;]$/.test(endText) && /^[a-z(]/.test(startText)) {
			const joiner: TextRun = { ...base, text: ' ' }
			return [
				...before.slice(0, -1),
				{ ...last, runs: [...last.runs, joiner, ...first.runs] },
				...after.slice(1),
			]
		}
	}
	return [...before, ...after]
}
