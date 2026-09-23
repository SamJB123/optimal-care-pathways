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
	Alignment,
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
	/** The page's text column: the frame the body's paragraphs are aligned in. */
	pageFrame: Frame
	/** The frame of the container being read (a drawn table cell, a list item's body),
	 *  while one is; paragraphs are aligned within it rather than within their own extent. */
	frame: Frame | null
	/** Whether this page's Link elements carry no text (Word's tagging on the first and
	 *  last reference pages wraps every reference in one marked content and leaves the
	 *  Links empty): then the link annotations' rectangles say where the links are. */
	taglessLinks: boolean
}

/** Whether a page's tagged Links hold any text at all. */
function linksAreTagless(page: PdfPage): boolean {
	let links = 0
	let withText = 0
	const visit = (node: TreeNode | StructTreeContent): void => {
		if (isLeaf(node)) return
		if (node.role === 'Link') {
			links++
			if (
				leafIds(node).some((id) =>
					(page.textByMcid.get(id) ?? []).some((item) => item.text.trim() !== ''),
				)
			)
				withText++
		}
		for (const child of node.children ?? []) visit(child)
	}
	if (page.tree) visit(page.tree)
	// Nearly every Link empty (the list's first item keeps its text on such pages).
	return links >= 4 && withText * 4 < links && page.links.some((l) => l.url !== undefined)
}

/** A horizontal extent paragraphs are aligned in. */
interface Frame {
	x0: number
	x1: number
}

/** The page's text column: the left margin most runs start at, to the rightmost text. */
function pageFrameOf(page: PdfPage): Frame {
	const starts = new Map<number, number>()
	let x1 = 0
	let min = Number.POSITIVE_INFINITY
	for (const run of page.textRuns) {
		if (run.text.trim() === '') continue
		const x = Math.round(run.box.x * 2) / 2
		starts.set(x, (starts.get(x) ?? 0) + 1)
		min = Math.min(min, x)
		x1 = Math.max(x1, run.box.x + run.box.width)
	}
	const repeated = [...starts].filter(([, count]) => count >= 3).map(([x]) => x)
	const x0 = repeated.length > 0 ? Math.min(...repeated) : min
	return Number.isFinite(x0) ? { x0, x1 } : { x0: 0, x1: page.width }
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
	// The body size is the size most of the text is set in — unless a smaller size only
	// wins by markers ("use of AI" under five superscript citations): a larger size
	// carrying at least a third as much text is the body, the small one its notes.
	let best = -1
	for (const count of weights.values()) best = Math.max(best, count)
	let bodySize = 0
	for (const [size, count] of weights) if (count * 3 >= best && size > bodySize) bodySize = size
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
			// A whitespace-only item is inter-word spacing pdf.js inferred from the layout:
			// the gap between two cells' text on one line, the space after a note marker.
			// It joins the text but never the geometry — a gap is not ink, and a cell's line
			// must not start where the previous cell's text ended. It belongs to the run
			// before it; at the start of a marked-content item there is no run before it
			// yet, so it becomes a zero-width segment where the next text begins.
			const last = out.at(-1)
			if (last && !last.text.endsWith(' ')) last.text += ' '
			else if (!last) {
				const box: Box = {
					x: item.box.x + item.box.width,
					y: item.box.y,
					width: 0,
					height: bodySize,
				}
				out.push(segFor(ctx, ' ', current, box, item.box, bodySize))
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
			segs.push(segFor(ctx, c.ch, c.span, box, item.box, bodySize))
			x += advance
		}
		for (const [i, seg] of segs.entries()) {
			if (!isSpace(seg.text)) continue
			const before = segs.slice(0, i).findLast((s) => !isSpace(s.text))
			const after = segs.slice(i + 1).find((s) => !isSpace(s.text))
			seg.underline = !!before && !!after && before.underline && after.underline
			seg.background =
				before && after && before.background === after.background ? before.background : null
			// A space between two words of one drawn link is the link's too (the tags scope
			// a Link over its spaces; the annotation rectangles are read glyph by glyph).
			if (
				!ctx.link &&
				before &&
				after &&
				before.link &&
				JSON.stringify(before.link) === JSON.stringify(after.link)
			)
				seg.link = before.link
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

/** The link annotation drawn over a glyph, when the tags scope none: on pages where
 *  Word's tagging left the text outside its Link elements (the first and last reference
 *  pages carry every reference's text in one marked content), the annotation rectangles
 *  still say exactly where the links are. */
function linkAt(ctx: Context, box: Box): TextRun['link'] {
	if (!ctx.taglessLinks || box.width <= 0) return null
	const x = box.x + box.width / 2
	const y = box.y + Math.max(1, box.height) * 0.3
	let best: LinkAnnotation | null = null
	for (const link of ctx.page.links) {
		const b = link.box
		if (!link.url) continue
		if (x < b.x || x > b.x + b.width || y < b.y || y > b.y + b.height) continue
		if (!best || b.width * b.height < best.box.width * best.box.height) best = link
	}
	return best ? linkTarget(ctx, best) : null
}

function segFor(
	ctx: Context,
	ch: string,
	span: StyleSpan | null,
	box: Box,
	line: Box,
	bodySize: number,
): Seg {
	const size = span?.size ?? bodySize
	return {
		text: ch,
		bold: span?.bold ?? false,
		italic: span?.italic ?? false,
		underline: isSpace(ch) ? false : hasUnderline(ctx.page.paths, box, line),
		superscript: false,
		subscript: false,
		size,
		colour: span?.fill ?? '#000000',
		background:
			isSpace(ch) && box.width === 0
				? null
				: highlightBehind(ctx.page.paths, box, size, ctx.element),
		link: ctx.link ? linkTarget(ctx, ctx.link) : isSpace(ch) ? null : linkAt(ctx, box),
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
function hasUnderline(paths: PaintedPath[], box: Box, line: Box): boolean {
	// Probe from the glyph's left edge to just past its middle: an underline runs from a
	// run's first glyph's left edge and ends a hair before its last glyph's middle; a
	// dotted underline is dots a point or two apart, one of which lies in that span.
	const x0 = box.x + 0.2
	const x1 = box.x + Math.max(box.width, 0.5) / 2 + 0.75
	for (const p of paths) {
		if (p.kind !== 'fill' || p.box.height > 1.5) continue
		if (p.box.y > box.y + 0.5 || p.box.y < box.y - 3.5) continue
		if (!(p.box.x < x1 && p.box.x + p.box.width > x0)) continue
		// A table rule under the line runs past the text at both ends (into the cell's
		// padding and beyond); an underline is drawn under the text it marks.
		if (p.box.x < line.x - 4 && p.box.x + p.box.width > line.x + line.width + 4) continue
		return true
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
	const top = shadingPathBehind(paths, lines, [])
	return top === null || top.colour === '#ffffff' ? null : top.colour
}

type Bbox = [number, number, number, number]

/** The topmost fill behind a block's lines and figures that extends beyond them (see
 *  `shadingBehind`); white counts here, since a white cell drawn over a shaded table is a
 *  cell of its own. Figures alone (an icon cell) are located by their boxes. */
function shadingPathBehind(
	paths: PaintedPath[],
	lines: Line[],
	figures: Bbox[],
): PaintedPath | null {
	const spots = [
		...lines.map((l) => ({ x0: l.x0, x1: l.x1, y0: l.y - 1, y1: l.y + 1 })),
		...figures.map(([x0, y0, x1, y1]) => ({
			x0,
			x1,
			y0: (y0 + y1) / 2 - 1,
			y1: (y0 + y1) / 2 + 1,
		})),
	]
	if (spots.length === 0) return null
	const x0 = Math.min(...spots.map((s) => s.x0))
	const x1 = Math.max(...spots.map((s) => s.x1))
	let top: PaintedPath | null = null
	const covering: PaintedPath[] = []
	for (const p of paths) {
		if (p.kind !== 'fill' || p.box.height < 6) continue
		const extendsBeyond = p.box.x < x0 - 4 || p.box.x + p.box.width > x1 + 4
		if (!extendsBeyond) continue
		const covers = spots.every(
			(s) =>
				p.box.y <= s.y1 &&
				p.box.y + p.box.height >= s.y0 &&
				p.box.x < s.x1 &&
				p.box.x + p.box.width > s.x0,
		)
		if (!covers) continue
		covering.push(p)
		top = p
	}
	if (!top) return null
	// Word paints a paragraph's shading line by line OVER the cell's fill in the same
	// colour; the cell is the largest of those, so the topmost names the colour and the
	// largest same-coloured fill beneath it gives the extent.
	const colour = top.colour
	return covering
		.filter((p) => p.colour === colour)
		.reduce(
			(best, p) => (p.box.width * p.box.height > best.box.width * best.box.height ? p : best),
			top,
		)
}

function contentBox(lines: Line[], figures: Bbox[]): Box | null {
	const xs: number[] = []
	const ys: number[] = []
	for (const l of lines) {
		xs.push(l.x0, l.x1)
		ys.push(l.y - l.size * 0.25, l.y + l.size * 0.75)
	}
	for (const [x0, y0, x1, y1] of figures) {
		xs.push(x0, x1)
		ys.push(y0, y1)
	}
	if (xs.length === 0) return null
	const x = Math.min(...xs)
	const y = Math.min(...ys)
	return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/**
 * The table's logical grid, read from the drawing rather than from Word's cell order.
 * Word writes no RowSpan/ColSpan attributes and pads merged regions and gutters with
 * empty cells, so rows arrive with different cell counts and a cell's index says little
 * about its column. Instead: the LOGICAL COLUMNS are the x-extents where cells with
 * content sit (clustered by overlap); the LOGICAL ROWS are the table rows that hold any
 * content; a cell's SPAN is how many of those columns and rows its shading rectangle
 * covers. Empty cells are Word's spacers or merged remainders and are dropped. A table
 * with no empty cell and no spanning shade comes back unchanged.
 */
function inferSpans(rows: TableRow[], geometry: CellGeometry[][]): TableRow[] {
	interface Placed {
		cell: TableCell
		geo: CellGeometry
		/** The cell's index in its Word row, the fallback position for a cell that has
		 *  content but no geometry (a figure without a box). */
		index: number
	}
	const hasContent = (cell: TableCell, geo: CellGeometry | undefined): boolean =>
		geo?.content === true || cellHasContent(cell)
	const liveRows: Placed[][] = []
	let empties = 0
	for (const [r, row] of rows.entries()) {
		const placed: Placed[] = []
		for (const [c, cell] of row.cells.entries()) {
			const geo = geometry[r]?.[c] ?? { bbox: null, shade: null, content: false }
			if (hasContent(cell, geo)) placed.push({ cell, geo, index: c })
			else empties++
		}
		if (placed.length > 0) liveRows.push(placed)
	}
	/** Where cells at this Word index sit in other rows, when this one has no geometry. */
	const boxAtIndex = (index: number): Box | null =>
		liveRows.flatMap((placed) =>
			placed.flatMap((p) => (p.index === index && p.geo.bbox ? [p.geo.bbox] : [])),
		)[0] ?? null
	if (liveRows.length === 0) return rows

	// Columns are the x-ranges the NARROW cells occupy: cells are taken narrowest first,
	// and one that overlaps a single known column widens it, one that overlaps none
	// starts a column, and one that overlaps several is a spanning cell and starts nothing.
	// (Left edges alone fail on centred text; index order fails on Word's ragged rows.)
	interface Column {
		x0: number
		x1: number
	}
	const columns: Column[] = []
	const overlapping = (x0: number, x1: number): Column[] =>
		columns.filter((col) => {
			const overlap = Math.min(col.x1, x1) - Math.max(col.x0, x0)
			return overlap > Math.min(col.x1 - col.x0, x1 - x0) * 0.3
		})
	const boxes = liveRows
		.flatMap((placed) => placed.flatMap((p) => (p.geo.bbox ? [p.geo.bbox] : [])))
		.sort((a, b) => a.width - b.width)
	for (const b of boxes) {
		const hits = overlapping(b.x, b.x + b.width)
		if (hits.length === 1 && hits[0]) {
			hits[0].x0 = Math.min(hits[0].x0, b.x)
			hits[0].x1 = Math.max(hits[0].x1, b.x + b.width)
		} else if (hits.length === 0) columns.push({ x0: b.x, x1: b.x + b.width })
	}
	columns.sort((a, b) => a.x0 - b.x0)
	if (columns.length === 0) return rows
	/** The contiguous run of columns a horizontal extent covers: [first, count]. */
	const columnsUnder = (x0: number, x1: number): [number, number] => {
		const indices = columns.flatMap((col, i) => (overlapping(x0, x1).includes(col) ? [i] : []))
		if (indices.length === 0) {
			const centre = (x0 + x1) / 2
			let nearest = 0
			for (const [i, col] of columns.entries()) {
				if (
					Math.abs((col.x0 + col.x1) / 2 - centre) <
					Math.abs(((columns[nearest]?.x0 ?? 0) + (columns[nearest]?.x1 ?? 0)) / 2 - centre)
				)
					nearest = i
			}
			return [nearest, 1]
		}
		const first = indices[0] ?? 0
		let count = 1
		while (indices.includes(first + count)) count++
		return [first, count]
	}
	const width = columns.length
	const rowCentre = liveRows.map((placed) => {
		const boxes = placed.flatMap((p) => (p.geo.bbox ? [p.geo.bbox] : []))
		if (boxes.length === 0) return Number.NaN
		const y0 = Math.min(...boxes.map((b) => b.y))
		const y1 = Math.max(...boxes.map((b) => b.y + b.height))
		return (y0 + y1) / 2
	})
	const centreOf = (c: number): number => ((columns[c]?.x0 ?? 0) + (columns[c]?.x1 ?? 0)) / 2
	const covers = (shade: Box, c: number): boolean =>
		centreOf(c) > shade.x && centreOf(c) < shade.x + shade.width
	const coversRow = (shade: Box, r: number): boolean => {
		const centre = rowCentre[r]
		return (
			centre !== undefined &&
			!Number.isNaN(centre) &&
			centre > shade.y &&
			centre < shade.y + shade.height
		)
	}

	// Pass one: every cell's home column, from its own content (never its shading — one
	// fill often runs under a whole row). Two cells landing on one column keep their
	// order: the later moves right.
	interface Homed extends Placed {
		c: number
		colSpan: number
		rowSpan: number
	}
	const homed: Homed[][] = liveRows.map((placed) => {
		const taken = new Set<number>()
		const row: Homed[] = []
		let cursor = 0
		for (const p of placed) {
			const bbox = p.geo.bbox ?? boxAtIndex(p.index)
			let c = bbox ? columnsUnder(bbox.x, bbox.x + bbox.width)[0] : cursor
			while (taken.has(c) && c < width - 1) c++
			taken.add(c)
			row.push({ ...p, c, colSpan: 1, rowSpan: 1 })
			cursor = c + 1
		}
		return row.sort((a, b) => a.c - b.c)
	})

	// Pass two: spans. A cell grows right into columns no cell of its row calls home, and
	// down into rows where those columns are free, as far as its shading covers them (or,
	// without shading, as far as its own content reaches).
	const homes = homed.map((row) => new Set(row.map((h) => h.c)))
	const occupied: boolean[][] = liveRows.map(() => Array.from({ length: width }, () => false))
	let spanning = false
	for (const [r, row] of homed.entries()) {
		for (const h of row) {
			const shade = h.geo.shade
			const bbox = h.geo.bbox
			const reach = shade ?? bbox
			if (reach) {
				while (h.c + h.colSpan < width) {
					const next = h.c + h.colSpan
					if (homes[r]?.has(next) || occupied[r]?.[next] || !covers(reach, next)) break
					h.colSpan++
				}
			}
			if (shade) {
				while (r + h.rowSpan < liveRows.length) {
					const below = r + h.rowSpan
					if (!coversRow(shade, below)) break
					let blocked = false
					for (let dc = 0; dc < h.colSpan; dc++) {
						if (homes[below]?.has(h.c + dc) || occupied[below]?.[h.c + dc]) blocked = true
					}
					if (blocked) break
					h.rowSpan++
				}
			}
			for (let dr = 0; dr < h.rowSpan; dr++) {
				for (let dc = 0; dc < h.colSpan; dc++) {
					const slots = occupied[r + dr]
					if (slots) slots[h.c + dc] = true
				}
			}
			if (h.colSpan > 1 || h.rowSpan > 1) spanning = true
		}
	}

	// Pass three: rows come out with a cell in every column that nothing spans into, so
	// the rendered grid keeps its alignment; the fillers are Word's empty gutters.
	const filler = (): TableCell => ({
		header: false,
		rowSpan: 1,
		colSpan: 1,
		background: null,
		blocks: [],
	})
	const spannedInto: boolean[][] = liveRows.map(() => Array.from({ length: width }, () => false))
	for (const [r, row] of homed.entries()) {
		for (const h of row) {
			for (let dr = 0; dr < h.rowSpan; dr++) {
				for (let dc = 0; dc < h.colSpan; dc++) {
					if (dr > 0 || dc > 0) {
						const slots = spannedInto[r + dr]
						if (slots) slots[h.c + dc] = true
					}
				}
			}
		}
	}
	const out: TableRow[] = homed.map((row, r) => {
		const cells: TableCell[] = []
		for (let c = 0; c < width; c++) {
			const own = row.find((h) => h.c === c)
			if (own) cells.push({ ...own.cell, colSpan: own.colSpan, rowSpan: own.rowSpan })
			else if (!spannedInto[r]?.[c]) cells.push(filler())
		}
		return { cells }
	})
	return empties === 0 && !spanning && out.length === rows.length ? rows : out
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
			into.splice(start, into.length - start, ...markLooseEndnotes(ctx, into.slice(start)))
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
		// Small against the text it follows: a marker that wrapped onto a line of its own
		// ("44,45,46,47,48" under "use of AI") is the only text on that line, and five
		// markers outweigh the item's own words in the element, so neither the line's nor
		// the element's dominant size can be the reference — the largest full-size text
		// read so far in the element is.
		const bodySize = Math.max(
			ctx.element?.bodySize || 0,
			...into.filter((s) => s.text.trim() !== '' && !s.superscript).map((s) => s.size),
		)
		if (
			/^\d{1,3}$/.test(label) &&
			target &&
			'page' in target &&
			target.page !== ctx.pageNumber &&
			markerSegs.every(
				(s) => s.text.trim() === '' || s.superscript || s.size < (bodySize || s.lineSize) * 0.8,
			)
		) {
			const trailing = detachTrailingSpace(markerSegs)
			// The marker is the digits; a space Word drew inside the Link stays a plain space.
			for (const seg of markerSegs) {
				seg.link = null
				if (seg.text.trim() === '') continue
				seg.endnote = Number(label)
				seg.superscript = true
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
			if (seg.text.trim() === '') continue
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

/** A raised bare number in body prose is an endnote marker whatever the tags say: Word
 *  sometimes writes the marker's Link around an empty span and leaves the digit inside the
 *  paragraph's own run (p.8 of the 2026 cancer template). The number IS the note number,
 *  so nothing is lost by reading it without its link. */
/** A raised run of one or more small integers directly after prose — "7", "34,35,36",
 *  "12–14" — is the endnote marker(s) it names (Word tags some markers outside their
 *  Link, and sets a list of markers as one run). A list becomes one reference per number,
 *  a range every number in it, with the printed separators kept as raised text between
 *  them; each piece takes a proportional share of the run's extent. */
const MARKER_RUN = /^\d{1,3}(?:\s*[,–-]\s*\d{1,3})*$/

function markLooseEndnotes(ctx: Context, segs: Seg[]): Seg[] {
	if (ctx.inNotesPart) return segs
	const out: Seg[] = []
	for (const [i, seg] of segs.entries()) {
		const text = seg.text.trim()
		const marker =
			seg.endnote === null && seg.footnote === null && seg.superscript && MARKER_RUN.test(text)
		// Directly after text (a marker), not a number standing on its own.
		const before = segs.slice(0, i).findLast((s) => s.text.trim() !== '')
		if (!marker || !before || before.endnote !== null || /\s$/.test(before.text)) {
			out.push(seg)
			continue
		}
		const pieces: { text: string; endnote: number | null }[] = []
		for (const part of text.split(/([,–-])/)) {
			if (part === '') continue
			if (/^\d+$/.test(part)) {
				const number = Number(part)
				const previous = pieces.at(-1)
				const last = pieces.findLast((p) => p.endnote !== null)
				// "12–14" is every number from 12 to 14.
				if (
					previous &&
					/[–-]/.test(previous.text) &&
					last?.endnote !== null &&
					last &&
					last.endnote < number
				) {
					pieces.pop()
					for (let n = last.endnote + 1; n <= number; n++) {
						pieces.push({ text: ',', endnote: null }, { text: String(n), endnote: n })
					}
				} else pieces.push({ text: part, endnote: number })
			} else pieces.push({ text: part, endnote: null })
		}
		const width = seg.x1 - seg.x0
		const total = pieces.reduce((n, p) => n + p.text.length, 0) || 1
		let x = seg.x0
		for (const piece of pieces) {
			const share = (width * piece.text.length) / total
			out.push({
				...seg,
				text: piece.text,
				endnote: piece.endnote,
				link: null,
				x0: x,
				x1: x + share,
			})
			x += share
		}
	}
	return out
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
			// Word's soft return under a title line: a first line wholly in one emphasised
			// style and colour, followed by a line in another colour, is a paragraph of its
			// own (a tile's title), not a lead-in that happened to fill the line.
			if (current.length === 1 && titlesLine(previous, line)) breakHere = true
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

const inked = (line: Line): Seg[] => line.segs.filter((s) => s.text.trim() !== '')

/** Whether `first` is a title over `next`: every run of it bold in one colour, and the
 *  next line opening in a different colour. */
function titlesLine(first: Line, next: Line): boolean {
	const segs = inked(first)
	const colour = segs[0]?.colour
	if (colour === undefined || !segs.every((s) => s.bold && s.colour === colour)) return false
	const nextColour = inked(next)[0]?.colour
	return nextColour !== undefined && nextColour !== colour
}

/** Lines → runs. Lines join with a space, a margin-broken word rejoins without one, and a
 *  line the author ended early ends in a hard break (`'\n'` run). `context` is every line
 *  of the element these lines came from, for its margins. */
function runsFromLines(lines: Line[], context: Line[] = lines, frame?: Frame): TextRun[] {
	const runs: TextRun[] = []
	// After a hyphen broken at the margin the next line's leading space is dropped too.
	let joinToNext = false
	for (const [i, line] of lines.entries()) {
		for (const seg of line.segs) {
			const { y: _y, x0: _x0, x1: _x1, lineSize: _s, ...run } = seg
			const last = runs.at(-1)
			// One space between words, whichever side of a run boundary each half was drawn on.
			let text = last?.text.endsWith(' ') || joinToNext ? run.text.replace(/^\s+/, '') : run.text
			if (text === '') continue
			joinToNext = false
			if (last && sameStyle(last, run)) last.text += text
			else runs.push({ ...run, text })
			text = ''
		}
		const next = lines[i + 1]
		if (next) {
			const last = runs.at(-1)
			const nextText = plainText(next.segs)
			// A line ending in a hyphen followed by a lower-case continuation is one word
			// broken at the margin ("sub-" / "headings"): rejoin it without a space.
			const hyphenated = last?.text.trimEnd().endsWith('-') && /^[a-z]/.test(nextText.trimStart())
			if (last && hyphenated) {
				last.text = last.text.trimEnd()
				joinToNext = true
			} else if (last && endsEarly(line, next, context, frame)) {
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
function endsEarly(line: Line, next: Line, context: Line[], frame?: Frame): boolean {
	// The left edge is where the lines start — the most common x0, so a first line that
	// begins with the item's own marker glyph ("✓ Provide clear instructions…") does not
	// move it away from the wrapped lines it is compared with.
	const starts = new Map<number, number>()
	for (const l of context) {
		const x = Math.round(l.x0 * 2) / 2
		starts.set(x, (starts.get(x) ?? 0) + 1)
	}
	const left = [...starts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0
	// The margin is where wrapped lines end: two lines reaching the same x say so. In a
	// drawn cell too short to show it (two lines: "…expected timeframe" then "Document
	// this instruction…"), the cell's right edge less Word's padding is the margin.
	const ends = context.map((l) => l.x1).sort((a, b) => b - a)
	let right = ends.find((x1) => context.filter((l) => Math.abs(l.x1 - x1) <= 3).length >= 2)
	const fromFrame = right === undefined && frame !== undefined && context.length >= 2
	if (fromFrame) right = frame.x1 - 6.5
	if (right === undefined) return false
	if (Math.abs(line.x0 - left) > 2 || Math.abs(next.x0 - left) > 2) return false
	const firstWord = firstWordWidth(next)
	if (firstWord <= 0) return false
	const space = next.size * 0.28
	// The word's width is estimated from its run's average glyph width, and a cell's
	// margin is inferred rather than observed: against a frame the gap must clear the
	// estimate with room ("OCP" at 15pt estimated, 22pt drawn, never breaks a line).
	// An author's return leaves a gap no wrapped word explains; a wrap before a word that
	// nearly fitted leaves a gap about that word's width. Against an inferred margin the
	// gap must be a clear one: half a line at body size, at least.
	return fromFrame
		? right - line.x1 > Math.max(1.5 * firstWord + 3 * space, next.size * 6)
		: right - line.x1 > firstWord + 2 * space
}

/** The drawn width of a line's first word, from its segments' extents. */
function firstWordWidth(line: Line): number {
	// Leading spaces (the inter-word space Word carried onto the line) are not the word.
	let width = 0
	let started = false
	for (const seg of line.segs) {
		const perChar = seg.text.length > 0 ? (seg.x1 - seg.x0) / seg.text.length : 0
		for (const ch of seg.text) {
			if (isSpace(ch)) {
				if (started) return width
				continue
			}
			started = true
			width += perChar
		}
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

/** How lines sit in their element: centred when their midpoints agree and their left
 *  edges do not; right-aligned when their right edges agree and their left edges do not.
 *  A single line counts only when it sits clear of the element's left margin. */
/** How lines sit in their frame — the drawn cell, the list body or the page's text
 *  column, never the lines' own extent (a single centred line would frame itself). Word
 *  insets a cell's text by its padding, so a line within that of an edge sits on it. */
function alignmentOf(lines: Line[], frame: Frame): Alignment {
	const { x0: left, x1: right } = frame
	const width = right - left
	if (lines.length === 0 || width < 20) return 'left'
	const centre = (left + right) / 2
	// Word's default cell padding is 5.4pt, drawn from the cell boundary at the middle of a
	// half-point rule: text within 6.5pt of an edge sits on it.
	const edge = 6.5
	const tolerance = Math.max(3, width * 0.01)
	const centred = lines.every((l) => Math.abs((l.x0 + l.x1) / 2 - centre) < tolerance)
	const leftEdged = lines.every((l) => l.x0 - left < edge)
	const rightEdged = lines.every((l) => right - l.x1 < edge)
	const inset = lines.some((l) => l.x0 > left + edge)
	if (centred && !leftEdged && inset) return 'center'
	// A single line ending at the right edge is right-aligned only when it sits in the
	// right half; a longer one could as well be left-aligned text beside a picture.
	const rightHalf = lines.length > 1 || lines.every((l) => l.x0 > centre)
	if (rightEdged && !leftEdged && inset && rightHalf) return 'right'
	return 'left'
}

function paragraphFromLines(
	ctx: Context,
	lines: Line[],
	context: Line[] = lines,
): Paragraph | null {
	// Only a drawn cell's frame stands in for an unproven margin (the page column's right
	// edge is where the widest line on the page ends, not this paragraph's margin).
	const runs = runsFromLines(lines, context, ctx.frame ?? undefined)
	if (runs.length === 0) return null
	return {
		kind: 'paragraph',
		runs,
		page: ctx.pageNumber,
		background: shadingBehind(ctx.page.paths, lines),
		align: alignmentOf(lines, ctx.frame ?? enclosingBox(ctx, lines) ?? ctx.pageFrame),
	}
}

/** The smallest drawn box (a stroked rectangle: a text box, a bordered frame) enclosing
 *  every line, when one does: its text is aligned within it, not within the page. */
function enclosingBox(ctx: Context, lines: Line[]): Frame | null {
	if (lines.length === 0) return null
	const x0 = Math.min(...lines.map((l) => l.x0))
	const x1 = Math.max(...lines.map((l) => l.x1))
	const y0 = Math.min(...lines.map((l) => l.y - l.size * 0.25))
	const y1 = Math.max(...lines.map((l) => l.y + l.size * 0.75))
	let best: PaintedPath | null = null
	for (const p of ctx.page.paths) {
		if (p.kind !== 'stroke' || p.box.width < 20 || p.box.height < 6) continue
		const { x, y, width, height } = p.box
		if (x > x0 || x + width < x1 || y > y0 || y + height < y1) continue
		if (!best || width * height < best.box.width * best.box.height) best = p
	}
	return best ? { x0: best.box.x, x1: best.box.x + best.box.width } : null
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
			pageFrame: pageFrameOf(page),
			frame: null,
			taglessLinks: false,
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

/** Tick and cross glyphs, incl. Wingdings' private-use codes (FC ü tick, FE þ boxed tick;
 *  FB û cross, FD ý boxed cross). */
const CHECK_GLYPHS = new Set(['✓', '✔', '', '', 'ü', 'þ'])
const CROSS_GLYPHS = new Set(['☒', '✗', '✘', '', '', 'û', 'ý'])

function markerKind(label: string, font: string | undefined): ListMarker {
	const l = label.trim()
	if (/^\d+[.)]?$/.test(l) || /^[a-z][.)]$/i.test(l)) return 'number'
	if (l === '•' || l === '' || l === '' || l === '○' || l === '▪' || l === '■' || l === '·')
		return 'bullet'
	if (l === '–' || l === '-' || l === '—') return 'dash'
	if (CHECK_GLYPHS.has(l)) return 'check'
	if (CROSS_GLYPHS.has(l)) return 'cross'
	if ((font ?? '').toLowerCase().includes('wingdings') && l !== '') return 'check'
	return 'other'
}

/** A list item's paragraphs are aligned in the item's body: from the body's own left edge
 *  (past the marker) to the enclosing frame's right. */
function itemFrame(ctx: Context, item: TreeNode): Frame {
	const outer = ctx.frame ?? ctx.pageFrame
	const body = (item.children ?? []).filter((part) => isLeaf(part) || part.role !== 'Lbl')
	const xs = body.flatMap((part) => geometrySegs(ctx, part).map((s) => s.x0))
	return { x0: xs.length > 0 ? Math.min(...xs) : outer.x0, x1: outer.x1 }
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
		const outerFrame = ctx.frame
		ctx.frame = itemFrame(ctx, child)
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
		ctx.frame = outerFrame
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

/** What a cell's content occupies on the page, for reading merged cells off the drawing. */
interface CellGeometry {
	/** The union of the cell's text lines and figures; null for an empty cell. */
	bbox: Box | null
	/** The shading rectangle drawn behind the cell, when it is shaded. */
	shade: Box | null
	content: boolean
}

/** The boxes of the figures directly in a container (not those of a nested table). */
function figureBoxes(node: TreeNode, into: Bbox[] = []): Bbox[] {
	for (const child of node.children ?? []) {
		if (isLeaf(child) || child.role === 'Table') continue
		const element: TreeNode = child
		const b = element.bbox
		if (child.role === 'Figure') {
			if (b && b.length === 4) into.push([b[0] ?? 0, b[1] ?? 0, b[2] ?? 0, b[3] ?? 0])
			continue
		}
		figureBoxes(child, into)
	}
	return into
}

/** The vertical edges drawn through a table — rule lines and the sides of cell shading —
 *  and its outer extent, for framing its cells. Word draws no cell boxes for an
 *  unbordered layout table, so the extent falls back to the content, widened by a column
 *  when the inner edges show one pitch (Word's equal division) and the outer columns'
 *  content sits within that width. */
interface TableEdges {
	x0: number
	x1: number
	inner: { x: number; y0: number; y1: number }[]
}

function tableEdges(ctx: Context, segs: Seg[], figures: Bbox[]): TableEdges | null {
	const ys = [
		...segs.flatMap((s) => [s.y - s.lineSize * 0.25, s.y + s.lineSize * 0.75]),
		...figures.flatMap(([, y0, , y1]) => [y0, y1]),
	]
	const xs = [...segs.flatMap((s) => [s.x0, s.x1]), ...figures.flatMap(([x0, , x1]) => [x0, x1])]
	if (ys.length === 0) return null
	const top = Math.max(...ys)
	const bottom = Math.min(...ys)
	const inner: TableEdges['inner'] = []
	for (const p of ctx.page.paths) {
		// Table drawing (shading, rules) is outside any marked content; a fill inside one
		// is a highlight or a figure's own artwork.
		if (p.kind !== 'fill' || p.mcid !== null || p.colour === '#ffffff' || p.box.height < 6) continue
		// A fill as wide as the page is a background band, not a cell.
		if (p.box.width > ctx.page.width * 0.92) continue
		if (p.box.y > top || p.box.y + p.box.height < bottom) continue
		const span = { y0: p.box.y, y1: p.box.y + p.box.height }
		if (p.box.width <= 1.5) inner.push({ x: p.box.x, ...span })
		else if (p.box.width > 20)
			inner.push({ x: p.box.x, ...span }, { x: p.box.x + p.box.width, ...span })
	}
	let x0 = Math.min(...xs, ...inner.map((e) => e.x))
	let x1 = Math.max(...xs, ...inner.map((e) => e.x))
	// Distinct inner positions (edges within a point of each other are one), in order.
	const positions: number[] = []
	for (const x of inner.map((e) => e.x).sort((a, b) => a - b)) {
		if (x <= x0 + 2 || x >= x1 - 2) continue
		const last = positions.at(-1)
		if (last === undefined || x - last > 1) positions.push(x)
	}
	if (positions.length >= 2) {
		const gaps = positions.slice(1).map((x, i) => x - (positions[i] ?? x))
		const pitch = gaps.reduce((a, b) => a + b, 0) / gaps.length
		if (gaps.every((gap) => Math.abs(gap - pitch) < 1.5)) {
			const first = positions[0] ?? x0
			const last = positions.at(-1) ?? x1
			if (first - pitch < x0 && x0 - (first - pitch) < pitch * 0.5) x0 = first - pitch
			if (last + pitch > x1 && last + pitch - x1 < pitch * 0.5) x1 = last + pitch
		}
	}
	return { x0: Math.max(0, x0), x1: Math.min(ctx.page.width, x1), inner }
}

/** The frame a cell's paragraphs are aligned in: its shading when it is shaded, else the
 *  nearest drawn edge on either side of its content, else the table's edge. */
function cellFrame(
	lines: Line[],
	figures: Bbox[],
	shade: PaintedPath | null,
	edges: TableEdges | null,
): Frame | null {
	if (shade) return { x0: shade.box.x, x1: shade.box.x + shade.box.width }
	const box = contentBox(lines, figures)
	if (!box || !edges) return null
	const near = edges.inner.filter((e) => e.y0 < box.y + box.height && e.y1 > box.y)
	const lefts = near.filter((e) => e.x <= box.x + 1).map((e) => e.x)
	const rights = near.filter((e) => e.x >= box.x + box.width - 1).map((e) => e.x)
	return {
		x0: lefts.length > 0 ? Math.max(...lefts) : edges.x0,
		x1: rights.length > 0 ? Math.min(...rights) : edges.x1,
	}
}

function tableOf(ctx: Context, node: TreeNode): Table | null {
	const rows: TableRow[] = []
	const geometry: CellGeometry[][] = []
	const tableSegs = geometrySegs(ctx, node)
	const edges = tableEdges(ctx, tableSegs, figureBoxes(node))
	const outerFrame = ctx.frame
	const walkRows = (n: TreeNode) => {
		for (const child of n.children ?? []) {
			if (isLeaf(child)) continue
			if (child.role === 'TR') {
				const cells: TableCell[] = []
				const geos: CellGeometry[] = []
				for (const cellNode of child.children ?? []) {
					if (isLeaf(cellNode) || (cellNode.role !== 'TD' && cellNode.role !== 'TH')) continue
					const lines = linesOf(geometrySegs(ctx, cellNode))
					const figures = figureBoxes(cellNode)
					const shade = shadingPathBehind(ctx.page.paths, lines, figures)
					// The cell's paragraphs are aligned within the drawn cell, not their own extent.
					ctx.frame = cellFrame(lines, figures, shade, edges) ?? outerFrame
					const blocks: Block[] = []
					try {
						blockChildren(ctx, cellNode, blocks)
					} finally {
						ctx.frame = outerFrame
					}
					cells.push({
						header: cellNode.role === 'TH',
						rowSpan: cellNode.rowSpan ?? 1,
						colSpan: cellNode.colSpan ?? 1,
						background: shade && shade.colour !== '#ffffff' ? shade.colour : null,
						blocks,
					})
					geos.push({
						bbox: contentBox(lines, figures),
						shade: shade?.box ?? null,
						content: lines.length > 0 || figures.length > 0,
					})
				}
				if (cells.length > 0) {
					rows.push({ cells })
					geometry.push(geos)
				}
			} else walkRows(child)
		}
	}
	walkRows(node)
	if (rows.length === 0) return null
	// Word writes no RowSpan/ColSpan attributes: merged cells arrive as their first grid
	// cell with content and empty cells for the rest. The drawing knows better — but the
	// reading waits until page-split shells are re-joined (`normaliseBlocks`), since a
	// shell's empty rows are the other page's, not spacers.
	const table: Table = { kind: 'table', rows, page: ctx.pageNumber, border: null }
	tableGeometry.set(table, geometry)
	if (tableSegs.length === 0) return table
	const x0 = Math.min(...tableSegs.map((s) => s.x0))
	const x1 = Math.max(...tableSegs.map((s) => s.x1))
	for (const p of ctx.page.paths) {
		if (p.kind !== 'fill' || p.box.height > 1.2 || p.box.width < (x1 - x0) * 0.6) continue
		if (p.colour === '#ffffff') continue
		if (p.box.x <= x0 + 8 && p.box.x + p.box.width >= x1 - 8) {
			table.border = p.colour
			break
		}
	}
	return table
}

/** Each table's cell geometry, kept beside the model until the spans are read (after the
 *  page-split shells are joined) and never serialised. */
const tableGeometry = new WeakMap<Table, CellGeometry[][]>()

/** A table with its merged cells read from the drawing, when its geometry is known. */
function withSpans(table: Table): Table {
	const geometry = tableGeometry.get(table)
	if (!geometry) return table
	const shaped = inferSpans(table.rows, geometry)
	return shaped === table.rows ? table : { ...table, rows: shaped }
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
	// The title is the heading without its note markers ("Principles of multidisciplinary
	// care⁵²"); the runs keep them.
	const titleRuns = heading.filter(
		(r) =>
			r.endnote === null &&
			r.footnote === null &&
			!(r.superscript && /^\d{1,3}$/.test(r.text.trim())),
	)
	const headingText = plainText(titleRuns).replace(/\s+/g, ' ').trim()
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
		icon: null,
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

/** The rows of a table node in reading order. */
function rowNodes(node: TreeNode): TreeNode[] {
	const rows: TreeNode[] = []
	const collect = (n: TreeNode) => {
		for (const c of n.children ?? []) {
			if (isLeaf(c)) continue
			if (c.role === 'TR') rows.push(c)
			else collect(c)
		}
	}
	collect(node)
	return rows
}

const cellNodes = (row: TreeNode): TreeNode[] =>
	(row.children ?? []).filter(
		(c): c is TreeNode => !isLeaf(c) && (c.role === 'TD' || c.role === 'TH'),
	)

/** A table's rows from the first that holds any text or figure (Word writes empty rows
 *  ahead of a frame's heading row). */
function liveRowNodes(ctx: Context, node: TreeNode): TreeNode[] {
	const rows = rowNodes(node)
	const start = rows.findIndex((row) =>
		cellNodes(row).some((cell) => geometrySegs(ctx, cell).length > 0 || hasFigure(cell)),
	)
	return start < 0 ? [] : rows.slice(start)
}

/** A table whose first live row is a heading-styled line beside (at most) an icon cell is
 *  a heading frame — Word lays a titled page's heading and its icon out as a table, and
 *  sometimes the callout under the heading as further rows of the same table. */
function isFrame(ctx: Context, node: TreeNode): boolean {
	const [first] = liveRowNodes(ctx, node)
	if (!first) return false
	const cells = cellNodes(first)
	if (cells.length === 0 || cells.length > 2) return false
	// One cell carries a heading; any other cell is an icon beside it (a principle's title
	// in the Principles document: an icon cell and a heading cell in a two-cell table).
	const titled = cells.filter((cell) =>
		linesOf(geometrySegs(ctx, cell)).some((line) => headingLevelOf(ctx, line) !== null),
	)
	const iconOnly = cells.filter((cell) => geometrySegs(ctx, cell).length === 0 && hasFigure(cell))
	return titled.length === 1 && titled.length + iconOnly.length === cells.length
}

const hasFigure = (node: TreeNode): boolean =>
	(node.children ?? []).some((c) => !isLeaf(c) && (c.role === 'Figure' || hasFigure(c)))

/** A frame table: its heading cell is walked first so the heading opens the section, then
 *  its icon cell, whose figure lands in that section; any further rows are an ordinary
 *  table of that section. */
function walkFrame(ctx: Context, outline: Outline, table: TreeNode): void {
	const [first, ...rest] = liveRowNodes(ctx, table)
	const cells = first ? cellNodes(first) : []
	const withText = cells.filter((cell) => geometrySegs(ctx, cell).length > 0)
	const iconOnly = cells.filter((cell) => !withText.includes(cell))
	const before = outline.stack.at(-1)
	for (const cell of withText) walkFlow(ctx, outline, cell)
	const opened = outline.stack.at(-1)
	for (const cell of iconOnly) {
		const blocks: Block[] = []
		blockChildren(ctx, cell, blocks)
		const figure = blocks.find((b): b is Figure => b.kind === 'figure')
		// The icon belongs to the heading it frames (decision 65): the section it just
		// opened takes it; otherwise it stays a figure in the flow.
		if (figure && opened && opened !== before && opened.icon === null) opened.icon = figure
		else currentBlocks(outline).push(...blocks)
	}
	if (rest.length > 0) {
		const remainder = tableOf(ctx, { role: 'Table', children: rest })
		if (remainder) currentBlocks(outline).push(remainder)
	}
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
			walkFrame(ctx, outline, child)
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
			pageFrame: pageFrameOf(page),
			frame: null,
			taglessLinks: linksAreTagless(page),
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
	// Shells are joined BEFORE the descent reads spans: a shell's empty rows belong to the
	// other page, and a joined table (two pages' geometry) is left as Word drew it.
	return nestTrailingLists(joinPageSplitTables(blocks).map(descend))
}

function descend(block: Block): Block {
	if (block.kind === 'list')
		return nestMixedMarkers({
			...block,
			items: block.items.map((i) => ({ ...i, blocks: normaliseBlocks(i.blocks) })),
		})
	if (block.kind === 'table') {
		const shaped = withSpans(joinContinuationRows(block))
		return {
			...shaped,
			rows: shaped.rows.map((r) => ({
				cells: r.cells.map((c) => ({ ...c, blocks: normaliseBlocks(c.blocks) })),
			})),
		}
	}
	return block
}

/** Word's third way of breaking a row over a page: the same table holds the row twice,
 *  the second copy with its label cell empty and its text cell carrying the sentence on
 *  ("…impacted by any cancer. Services" | "include navigation and emotional support…").
 *  Such a row continues the row above it. */
function joinContinuationRows(table: Table): Table {
	const rows: TableRow[] = []
	const keptRows = new Set<number>()
	for (const [index, row] of table.rows.entries()) {
		keptRows.add(index)
		const previous = rows.at(-1)
		// A row holding only list items with NO marker glyph, after a row that ends in a
		// list, is that list's last item carried on ("Referrals can be made to…" under the
		// ACNNP check row, p.70): its paragraphs are the item's.
		const previousCell = previous?.cells.length === 1 ? previous.cells[0] : undefined
		const previousList = previousCell?.blocks.at(-1)
		if (previous && previousCell && previousList?.kind === 'list' && unmarkedListRow(row)) {
			const carried = row.cells[0]?.blocks.flatMap((b) =>
				b.kind === 'list' ? b.items.flatMap((i) => i.blocks) : [],
			)
			const tail = previousList.items.at(-1)
			if (tail && carried && carried.length > 0) {
				const items = [
					...previousList.items.slice(0, -1),
					{ ...tail, blocks: [...tail.blocks, ...carried] },
				]
				const blocks = [...previousCell.blocks.slice(0, -1), { ...previousList, items }]
				rows[rows.length - 1] = { cells: [{ ...previousCell, blocks }] }
				keptRows.delete(index)
				continue
			}
		}
		if (previous && previous.cells.length === row.cells.length && continuesRow(previous, row)) {
			const cells = previous.cells.map((cellA, j) => {
				const cellB = row.cells[j]
				if (!cellB || !cellHasContent(cellB)) return cellA
				if (!cellHasContent(cellA)) return { ...cellB, header: cellA.header || cellB.header }
				return { ...cellA, blocks: continueBlocks(cellA.blocks, cellB.blocks) }
			})
			rows[rows.length - 1] = { cells }
			keptRows.delete(index)
			continue
		}
		rows.push(row)
	}
	if (rows.length === table.rows.length) return table
	// The joined table keeps its cells' drawn geometry (kept beside the model), less the
	// rows folded away, so its merged cells are still read from the drawing.
	const joined: Table = { ...table, rows }
	const geometry = tableGeometry.get(table)
	if (geometry)
		tableGeometry.set(
			joined,
			geometry.filter((_g, i) => keptRows.has(i)),
		)
	return joined
}

/** A single-cell row whose content is list items Word drew no marker for. */
const unmarkedListRow = (row: TableRow): boolean => {
	const cell = row.cells.length === 1 ? row.cells[0] : undefined
	if (!cell || cell.blocks.length === 0) return false
	return cell.blocks.every(
		(b) =>
			b.kind === 'list' &&
			b.items.every(
				(i) =>
					i.label === '' &&
					i.blocks.some((x) => x.kind === 'paragraph' && plainText(x.runs).trim() !== ''),
			),
	)
}

/** Whether `row` carries `previous` on: a cell filled above stands empty here, and some
 *  cell filled in both begins mid-sentence. */
function continuesRow(previous: TableRow, row: TableRow): boolean {
	let emptied = false
	let carried = false
	for (const [j, cellA] of previous.cells.entries()) {
		const cellB = row.cells[j]
		if (!cellB) return false
		const inA = cellHasContent(cellA)
		const inB = cellHasContent(cellB)
		if (inA && !inB) emptied = true
		if (inA && inB) {
			const before = lastParagraphText(cellA.blocks)
			const start = firstText(cellB.blocks)
			if (before !== '' && !/[.!?:;]$/.test(before) && /^[a-z(]/.test(start)) carried = true
		}
	}
	return emptied && carried
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
	if (b.page !== a.page + 1) return null
	if (a.rows.length !== b.rows.length) return joinContinuationShell(a, b)
	const rows: TableRow[] = []
	const geoA = tableGeometry.get(a)
	const geoB = tableGeometry.get(b)
	const geometry: CellGeometry[][] = []
	let shared = 0
	for (const [i, rowA] of a.rows.entries()) {
		const rowB = b.rows[i]
		if (!rowB || rowA.cells.length !== rowB.cells.length) return null
		const cells: TableCell[] = []
		const geoRow: CellGeometry[] = []
		for (const [j, cellA] of rowA.cells.entries()) {
			const cellB = rowB.cells[j]
			if (!cellB) return null
			const inA = cellHasContent(cellA)
			const inB = cellHasContent(cellB)
			// Each page drew only the cells it filled; the cell's drawing is the page's that
			// held its text (a cell filled on both keeps the first page's).
			const geo = (inB && !inA ? geoB?.[i]?.[j] : geoA?.[i]?.[j]) ?? {
				bbox: null,
				shade: null,
				content: false,
			}
			geoRow.push(geo)
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
		geometry.push(geoRow)
	}
	const joined: Table = { kind: 'table', rows, page: a.page, border: a.border ?? b.border }
	if (geoA && geoB) tableGeometry.set(joined, geometry)
	return joined
}

const firstText = (blocks: Block[]): string => {
	const first = blocks.find((b) => b.kind === 'paragraph')
	return first?.kind === 'paragraph' ? plainText(first.runs).trim() : ''
}

/** Word's other way of breaking a table over a page: two tables, the second beginning
 *  with the row the break fell inside, whose cells hold only what ran over. That first
 *  row has the last row's shape and either an empty cell where the last row's was
 *  filled (the label column) or text that carries a sentence on (no full stop before,
 *  lower case after); it continues the last row, and the rows after it are the table's. */
function joinContinuationShell(a: Table, b: Table): Table | null {
	const lastRow = a.rows.at(-1)
	const firstRow = b.rows[0]
	if (!lastRow || !firstRow || lastRow.cells.length !== firstRow.cells.length) return null
	if (!continuesRow(lastRow, firstRow)) return null
	const cells: TableCell[] = lastRow.cells.map((cellA, j) => {
		const cellB = firstRow.cells[j]
		if (!cellB || !cellHasContent(cellB)) return cellA
		if (!cellHasContent(cellA)) return { ...cellB, header: cellA.header || cellB.header }
		return { ...cellA, blocks: continueBlocks(cellA.blocks, cellB.blocks) }
	})
	const joined: Table = {
		kind: 'table',
		rows: [...a.rows.slice(0, -1), { cells }, ...b.rows.slice(1)],
		page: a.page,
		border: a.border ?? b.border,
	}
	// Each page drew its own rows whole, and both pages share the table's columns, so the
	// joined table keeps both drawings; the broken row takes the geometry of whichever
	// half held each cell's text.
	const geoA = tableGeometry.get(a)
	const geoB = tableGeometry.get(b)
	const lastGeo = geoA?.at(-1)
	const firstGeo = geoB?.[0]
	if (geoA && geoB && lastGeo && firstGeo)
		tableGeometry.set(joined, [
			...geoA.slice(0, -1),
			lastRow.cells.map(
				(cellA, j) =>
					(cellHasContent(cellA) ? lastGeo[j] : firstGeo[j]) ??
					lastGeo[j] ??
					firstGeo[j] ?? { bbox: null, shade: null, content: false },
			),
			...geoB.slice(1),
		])
	return joined
}

/** The two halves of a cell the page break fell inside. A list broken over the break
 *  continues as one list (a continuation item with no text of its own carries the nested
 *  items of the item before it; items in another marker continue the last item's nested
 *  list); paragraphs that ran over after a list are the last item's; a sentence broken
 *  mid-way continues as one paragraph. */
function continueBlocks(before: Block[], after: Block[]): Block[] {
	const last = before.at(-1)
	const first = after[0]
	if (last?.kind === 'list' && first?.kind === 'paragraph') {
		// A check row is one cell: its paragraphs on the next page belong to the row's item.
		const tail = last.items.at(-1)
		if (tail) {
			let n = 0
			while (after[n]?.kind === 'paragraph') n++
			const items = [
				...last.items.slice(0, -1),
				{ ...tail, blocks: [...tail.blocks, ...after.slice(0, n)] },
			]
			return [...before.slice(0, -1), { ...last, items }, ...after.slice(n)]
		}
	}
	if (last?.kind === 'list' && first?.kind === 'list') {
		const tail = last.items.at(-1)
		const nested = tail?.blocks.at(-1)
		const marker = first.items[0]?.marker
		if (
			tail &&
			nested?.kind === 'list' &&
			marker !== undefined &&
			marker !== tail.marker &&
			marker === nested.items[0]?.marker
		) {
			// "…should cover:" then seven bullets, the break after the first: the six that
			// ran over continue the nested list, not the check list around it.
			const grown: List = { ...nested, items: [...nested.items, ...first.items] }
			const items = [
				...last.items.slice(0, -1),
				{ ...tail, blocks: [...tail.blocks.slice(0, -1), grown] },
			]
			return [...before.slice(0, -1), { ...last, items }, ...after.slice(1)]
		}
		const items = [...last.items]
		const rest = [...first.items]
		const carried = rest[0]
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
