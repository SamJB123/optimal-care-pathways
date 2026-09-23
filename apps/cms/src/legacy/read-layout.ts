/**
 * Stage one for UNTAGGED PDFs (decision 131): the legacy Optimal Care Pathways are
 * InDesign exports with no structure tree, so what a page SAYS and how it is ORGANISED
 * has to be read from the drawing — glyph positions, font size and weight, fills and
 * strokes — and written into the same document model the template extractor produces
 * (`../template/extract/model.ts`), so the mapper downstream is shared.
 *
 * WHAT THE DRAWING TELLS US (probe of all 67 PDFs, 2026-09-23):
 *   - one heading ladder across the 2021–2025 design: 23 Roman = chapter, 14 Roman =
 *     step / principle / appendix part, 11 Medium = numbered section (N.M), 9.5 Medium
 *     = numbered subsection (N.M.P) or a short run-in heading; 9.5 Light = body;
 *   - InDesign draws glyphs at `Tf 1` and scales with the text matrix, so a run's size
 *     is its page-space height, never the operator's font size;
 *   - weight is in the font name (Light / Roman / Medium / Black), and Medium inside a
 *     body line is bold;
 *   - columns exist only where text sits side by side (quick-guide pages, references);
 *     an indented block on a body page is an indent, not a column;
 *   - a bullet is a literal "•" glyph, a checklist item a ZapfDingbats "❏"; wrapped
 *     lines hang-indent by about 11pt;
 *   - a paragraph break is a vertical gap of about 1.5 lines;
 *   - a callout is a stroked rounded rectangle in the accent colour; a lead statement
 *     sits on a filled accent band; the timeframe table is rounded fills in three tones;
 *   - the footer lives below y 40; there are no running headers;
 *   - figures are vector art with loose labels under a "Figure N:" caption;
 *   - the January-2020 design prints its quick guide as step ROWS: a narrow rounded
 *     label cell ("Step N" over the title) beside a pale content cell whose text flows
 *     in two or three columns, with stroked callouts inside a column and bold "Label:"
 *     lead-ins naming the panels (see `guideRowsOf`).
 *
 * Every rule here is a rule about InDesign's output, not about one document.
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
} from '../template/extract/model.ts'
import {
	type Box,
	type LinkAnnotation,
	type PaintedPath,
	type PdfPage,
	readPage,
} from '../template/extract/pdf-page.ts'

// ---------------------------------------------------------------------------
// Runs and lines
// ---------------------------------------------------------------------------

type Weight = 'light' | 'roman' | 'medium' | 'black'

interface Run {
	text: string
	box: Box
	size: number
	weight: Weight
	italic: boolean
	dingbat: boolean
	link: TextRun['link']
}

interface Line {
	page: number
	y: number
	x0: number
	x1: number
	/** The dominant size of the line's runs. */
	size: number
	weight: Weight
	runs: Run[]
	text: string
	/** Left edge of the column the line sits in (set once the page's columns are known). */
	columnX: number
}

/** A line's indent within its column. */
const indentOf = (line: Line): number => line.x0 - line.columnX

const weightOf = (fontName: string): Weight => {
	const name = fontName.toLowerCase()
	if (/black|blk|heavy|bold/.test(name)) return 'black'
	if (/medium|-md\b|md$|semibold|demi/.test(name)) return 'medium'
	if (/light|-lt\b|lt$|thin/.test(name)) return 'light'
	return 'roman'
}

const isItalicFont = (fontName: string): boolean => /italic|oblique|-it$|it$/i.test(fontName)
const isDingbatFont = (fontName: string): boolean => /dingbat|symbol|wingding/i.test(fontName)

/** The page's text as runs with their face resolved. Empty runs and off-page runs dropped. */
function runsOf(page: PdfPage): Run[] {
	const out: Run[] = []
	for (const r of page.textRuns) {
		if (r.text.trim() === '') continue
		const face = page.fonts.get(r.fontName)
		const name = face?.name ?? r.fontName
		const size = Math.round(r.box.height * 2) / 2
		if (r.box.x < -5 || r.box.x > page.width + 5 || r.box.y < -5 || r.box.y > page.height + 5) continue
		out.push({
			text: r.text,
			box: r.box,
			size,
			weight: weightOf(name),
			italic: isItalicFont(name),
			dingbat: isDingbatFont(name),
			link: null,
		})
	}
	return out
}

/** A gap between two runs on one baseline wider than this is a break between two
 *  pieces of text set side by side (table cells, columns), not a word space. */
const SIDE_BY_SIDE_GAP = 12

/** A short label a tab separates from its text: a heading number, a list marker. */
const LABEL = /^(\d+(?:\.\d+)*\.?|[A-Z]?\d+\.|[•·▪●❑❒❏☐☑☒□✗✘✖–—-]|\(?[a-z]\)|[ivx]+\.)$/
/** A contents entry's page number, set flush right of its entry. */
const PAGE_NUMBER = /^(\d{1,3}|[ivx]{1,4})$/

/**
 * Group runs into lines by baseline, each line sorted by x. Runs on one baseline set
 * side by side (a table's cells, two columns) are separate lines: a break falls at a
 * wide gap, or at a column edge — an x where runs start beside earlier text on three
 * or more baselines — even when justified text leaves only a word space before it.
 */
function linesFrom(runs: Run[], page: number): Line[] {
	const sorted = [...runs].sort((a, b) => b.box.y - a.box.y || a.box.x - b.box.x)
	const baselines: Run[][] = []
	let lastY = Number.NaN
	let lastSize = 0
	for (const run of sorted) {
		const last = baselines.at(-1)
		// Runs of one line share a baseline; a superscript or a dingbat marker sits a
		// little off it, so a size difference widens the tolerance.
		const tolerance = Math.min(lastSize, run.size) / Math.max(lastSize, run.size) < 0.85 ? Math.max(3.5, Math.min(lastSize, run.size) * 0.6) : 2.5
		// Two runs that overlap horizontally cannot be one line (a foot line drawn across
		// the page two points below a column's last line).
		const overlaps = last?.some((r) => r.box.x < run.box.x + run.box.width - 1 && run.box.x < r.box.x + r.box.width - 1) ?? false
		if (last && !overlaps && Math.abs(lastY - run.box.y) <= tolerance) {
			last.push(run)
			continue
		}
		baselines.push([run])
		lastY = run.box.y
		lastSize = run.size
	}
	for (const baseline of baselines) baseline.sort((a, b) => a.box.x - b.box.x)
	// Column edges: an x where, on ≥ 3 baselines, a run starts after an earlier run ended.
	const besideCounts = new Map<number, number>()
	for (const baseline of baselines) {
		const seen = new Set<number>()
		for (const [i, run] of baseline.entries()) {
			const previous = baseline[i - 1]
			if (!previous || run.box.x - (previous.box.x + previous.box.width) < 3) continue
			if (LABEL.test(baseline.slice(0, i).map((r) => r.text).join('').trim())) continue
			seen.add(Math.round(run.box.x / 2) * 2)
		}
		for (const x of seen) besideCounts.set(x, (besideCounts.get(x) ?? 0) + 1)
	}
	const edges = new Set([...besideCounts.entries()].filter(([, n]) => n >= 3).map(([x]) => x))
	const lines: Line[] = []
	for (const baseline of baselines) {
		let piece: Run[] = []
		for (const [i, run] of baseline.entries()) {
			const previous = piece.at(-1)
			const gap = previous ? run.box.x - (previous.box.x + previous.box.width) : 0
			const label = LABEL.test(piece.map((r) => r.text).join('').trim())
			// Headings run across columns and are never split at a column edge.
			const atEdge = gap >= 1 && edges.has(Math.round(run.box.x / 2) * 2) && Math.max(run.size, previous?.size ?? 0) < 10.5
			// A contents entry's page number is set at the text's size; a small digit is a
			// footnote marker, which belongs to the word it follows, not to this piece.
			const pageNumber = run.size >= 8 && PAGE_NUMBER.test(baseline.slice(i).map((r) => r.text).join('').trim())
			if (previous && (gap > SIDE_BY_SIDE_GAP || atEdge) && !label && !pageNumber) {
				lines.push(lineOf(piece, page))
				piece = []
			}
			piece.push(run)
		}
		if (piece.length > 0) lines.push(lineOf(piece, page))
	}
	// A marker glyph set a little off its text's baseline (a 14pt ❏ beside 9pt text)
	// rejoins the line to its right; a footnote marker raised off its word's baseline
	// (a small digit alone) rejoins the line it ends.
	const out: Line[] = []
	const isText = (l: Line) => !l.runs.every((r) => r.dingbat) && !isRaisedMarker(l)
	for (const line of lines) {
		if (line.runs.every((r) => r.dingbat)) {
			const text = lines.find((l) => l !== line && isText(l) && Math.abs(l.y - line.y) <= 8 && l.x0 >= line.x1 - 2 && l.x0 - line.x1 <= 30)
			if (text) {
				text.runs.unshift(...line.runs)
				finishLine(text)
				text.columnX = text.x0
				continue
			}
		} else if (isRaisedMarker(line)) {
			const word = lines.find((l) => l !== line && isText(l) && Math.abs(l.y - line.y) <= 8 && line.x0 >= l.x1 - 2 && line.x0 - l.x1 <= 6)
			if (word) {
				word.runs.push(...line.runs)
				finishLine(word)
				continue
			}
		}
		out.push(line)
	}
	return out
}

/** A line that is only a small digit or two: a footnote marker set apart from its word. */
const isRaisedMarker = (line: Line): boolean => line.runs.every((r) => r.size <= 7) && /^\d{1,2}$/.test(line.text.trim())

const lineOf = (runs: Run[], page: number): Line => {
	const line: Line = { page, y: 0, x0: 0, x1: 0, size: 0, weight: 'light', runs, text: '', columnX: 0 }
	finishLine(line)
	line.columnX = line.x0
	return line
}

function finishLine(line: Line): void {
	line.runs.sort((a, b) => a.box.x - b.box.x)
	line.x0 = Math.min(...line.runs.map((r) => r.box.x))
	line.x1 = Math.max(...line.runs.map((r) => r.box.x + r.box.width))
	// Size and weight: of the run with the most characters (a superscript never wins).
	const byChars = new Map<string, { size: number; weight: Weight; chars: number }>()
	for (const r of line.runs) {
		const key = `${r.size}|${r.weight}`
		const entry = byChars.get(key) ?? { size: r.size, weight: r.weight, chars: 0 }
		entry.chars += r.text.length
		byChars.set(key, entry)
	}
	const dominant = [...byChars.values()].sort((a, b) => b.chars - a.chars)[0]
	line.size = dominant?.size ?? 9.5
	line.weight = dominant?.weight ?? 'light'
	// The baseline is the text's, not a superscript's (a raised footnote marker sits a
	// few points above it and would push the line away from the one below).
	const onBaseline = line.runs.filter((r) => r.size >= line.size - 1.5)
	line.y = Math.max(...(onBaseline.length > 0 ? onBaseline : line.runs).map((r) => r.box.y))
	line.text = joinRuns(line.runs)
}

/** Runs joined with a space where the drawing left a word gap. */
function joinRuns(runs: Run[]): string {
	let out = ''
	let prev: Run | null = null
	for (const r of runs) {
		if (prev) {
			const gap = r.box.x - (prev.box.x + prev.box.width)
			if (gap > Math.min(prev.size, r.size) * 0.18 && !out.endsWith(' ') && !r.text.startsWith(' ')) out += ' '
		}
		out += r.text
		prev = r
	}
	return out.replace(/\s+/g, ' ')
}

// ---------------------------------------------------------------------------
// Page furniture: footer, ornaments, figures
// ---------------------------------------------------------------------------

const FOOTER_Y = 40

/** Vector art: filled paths that are not rectangles (5 segments) nor rounded cells (11). */
const isArt = (p: PaintedPath): boolean => p.kind === 'fill' && p.segments > 6 && p.segments !== 11 && p.segments !== 14

const isRoundedCell = (p: PaintedPath): boolean => p.kind === 'fill' && p.segments === 11 && p.box.width > 40 && p.box.height > 14

const area = (b: Box): number => b.width * b.height

const contains = (outer: Box, inner: Box, tolerance = 3): boolean =>
	inner.x >= outer.x - tolerance &&
	inner.x + inner.width <= outer.x + outer.width + tolerance &&
	inner.y >= outer.y - tolerance &&
	inner.y + inner.height <= outer.y + outer.height + tolerance

const union = (boxes: Box[]): Box => {
	const x0 = Math.min(...boxes.map((b) => b.x))
	const y0 = Math.min(...boxes.map((b) => b.y))
	const x1 = Math.max(...boxes.map((b) => b.x + b.width))
	const y1 = Math.max(...boxes.map((b) => b.y + b.height))
	return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

const lineBox = (line: Line): Box => ({
	x: line.x0,
	y: line.y - 1,
	width: line.x1 - line.x0,
	height: Math.max(line.size, 6),
})

/**
 * Decorative fills a design repeats on many pages (the population pathways' corner
 * motifs): the same box on ≥ 4 pages, or a fill reaching off the page.
 */
function ornamentKeys(pages: PdfPage[]): Set<string> {
	const seen = new Map<string, number>()
	const key = (p: PaintedPath) => `${Math.round(p.box.x)},${Math.round(p.box.y)},${Math.round(p.box.width)},${Math.round(p.box.height)}`
	for (const page of pages) {
		const onPage = new Set<string>()
		for (const p of page.paths) if (isArt(p)) onPage.add(key(p))
		for (const k of onPage) seen.set(k, (seen.get(k) ?? 0) + 1)
	}
	return new Set([...seen.entries()].filter(([, n]) => n >= 4).map(([k]) => k))
}

const isOffPage = (p: PaintedPath, page: PdfPage): boolean =>
	p.box.x < -2 || p.box.y < -2 || p.box.x + p.box.width > page.width + 2 || p.box.y + p.box.height > page.height + 2

// ---------------------------------------------------------------------------
// Columns and reading order
// ---------------------------------------------------------------------------

interface ColumnModel {
	/** Left edges of the page's text columns, ascending. One entry = a single column. */
	starts: number[]
	/** Heights of the page's band separators (a step's title band drawn across the
	 *  columns): text above one is read before any text below it. */
	separators: number[]
}

/** Wide, short fills drawn across the text: the band separators. */
function separatorsOf(page: PdfPage, lines: Line[]): number[] {
	const textWidth = textWidthOf(lines)
	return page.paths
		.filter((p) => p.kind === 'fill' && p.colour !== '#ffffff' && p.box.width >= textWidth * 0.7 && p.box.height >= 15 && p.box.height <= 60)
		.map((p) => p.box.y + p.box.height / 2)
}

/**
 * Columns are where text sits SIDE BY SIDE. Left edges are clustered; two clusters are
 * columns only when lines from both share baselines, otherwise the right one is an
 * indent of the left (a callout's inset, a list's hang).
 */
function columnsOf(lines: Line[], page?: PdfPage): ColumnModel {
	const separators = page ? separatorsOf(page, lines) : []
	const edges = new Map<number, Line[]>()
	for (const line of lines) {
		const bucket = Math.round(line.x0 / 6) * 6
		edges.set(bucket, [...(edges.get(bucket) ?? []), line])
	}
	const peaks = [...edges.entries()].filter(([, ls]) => ls.length >= 3).sort((a, b) => a[0] - b[0])
	const clusters: { x: number; lines: Line[] }[] = []
	for (const [x, ls] of peaks) {
		const last = clusters.at(-1)
		if (last && x - last.x <= 18) last.lines.push(...ls)
		else clusters.push({ x, lines: [...ls] })
	}
	const columns: number[] = []
	for (const cluster of clusters) {
		const x = Math.min(...cluster.lines.map((l) => l.x0))
		const previous = columns.at(-1)
		if (previous === undefined) {
			columns.push(x)
			continue
		}
		// A column is a column's width away and has text BESIDE the previous column's
		// text: lines on the same baseline as a previous-column line that ends before it.
		if (x - previous < 60) continue
		const previousLines = lines.filter((l) => l.x0 >= previous - 3 && l.x0 < x - 3)
		const shared = cluster.lines.filter((l) => previousLines.some((p) => Math.abs(p.y - l.y) <= 3 && p.x1 < l.x0 - 4)).length
		if (shared >= 3) columns.push(x)
	}
	return { starts: columns.length > 0 ? columns : [Math.min(...lines.map((l) => l.x0))], separators }
}

/** Split a baseline's runs at the column boundaries the page has. A heading runs across
 *  the columns and stays whole (its "continued" tag may start inside the last column). */
function splitByColumns(lines: Line[], columns: ColumnModel, headingSize = Number.POSITIVE_INFINITY): Line[] {
	if (columns.starts.length <= 1) return lines
	const out: Line[] = []
	for (const line of lines) {
		if (line.size >= headingSize) {
			out.push(line)
			continue
		}
		const groups: Run[][] = columns.starts.map(() => [])
		for (const run of line.runs) {
			let index = 0
			for (let i = 0; i < columns.starts.length; i++) {
				const start = columns.starts[i] ?? 0
				if (run.box.x >= start - 8) index = i
			}
			groups[index]?.push(run)
		}
		for (const runs of groups) {
			if (runs.length === 0) continue
			const part: Line = { ...line, runs, x0: 0, x1: 0, text: '' }
			finishLine(part)
			out.push(part)
		}
	}
	return out
}

/** Tell each line which column it sits in. */
function assignColumns(lines: Line[], columns: ColumnModel): void {
	for (const line of lines) line.columnX = columns.starts[columnIndex(line, columns)] ?? line.x0
}

/** Which column a line starts in. */
const columnIndex = (line: Line, columns: ColumnModel): number => {
	let index = 0
	for (let i = 0; i < columns.starts.length; i++) if (line.x0 >= (columns.starts[i] ?? 0) - 8) index = i
	return index
}

/** A line that runs across more than one column (a band heading) breaks the columns. */
const spansColumns = (line: Line, columns: ColumnModel): boolean => {
	if (columns.starts.length <= 1) return false
	const index = columnIndex(line, columns)
	const next = columns.starts[index + 1]
	return next !== undefined && line.x1 > next + 20
}

/**
 * Reading order for a page: bands top to bottom; within a band, columns left to right,
 * each top to bottom. A band is what lies between two column-spanning lines or two
 * drawn separators.
 */
function orderLines(lines: Line[], columns: ColumnModel): Line[] {
	assignColumns(lines, columns)
	if (columns.starts.length <= 1) return [...lines].sort((a, b) => b.y - a.y || a.x0 - b.x0)
	const byY = [...lines].sort((a, b) => b.y - a.y || a.x0 - b.x0)
	const out: Line[] = []
	let band: Line[] = []
	let bandIndex = -1
	const flush = () => {
		for (let c = 0; c < columns.starts.length; c++)
			out.push(...band.filter((l) => columnIndex(l, columns) === c).sort((a, b) => b.y - a.y))
		band = []
	}
	for (const line of byY) {
		const index = columns.separators.filter((s) => line.y < s).length
		if (index !== bandIndex) {
			flush()
			bandIndex = index
		}
		if (spansColumns(line, columns)) {
			flush()
			out.push(line)
		} else band.push(line)
	}
	flush()
	return out
}

// ---------------------------------------------------------------------------
// Blocks from lines
// ---------------------------------------------------------------------------

const BULLET = /^[•·▪●]\s*/
const DASH = /^[–—-]\s+/
/** The dash glyph alone is a run of its own; strip it with or without its space. */
const DASH_STRIP = /^[–—-]\s*/
const NUMBERED = /^(\d+(?:\.\d+)*)\s+(?=\S)/
const STEP = /^(Step\s+\d+)\b/i
const CAPTION = /^Figure\s+[A-Z]?\d+\s*:/

const toRun = (r: Run, options: { boldWeights: Set<Weight> }): TextRun => ({
	text: r.text,
	bold: options.boldWeights.has(r.weight),
	italic: r.italic,
	underline: false,
	superscript: false,
	subscript: false,
	size: r.size,
	colour: '#000000',
	background: null,
	link: r.link,
	footnote: footnoteRuns.get(r) ?? null,
	endnote: endnoteRuns.get(r) ?? null,
})

/** Text so far ends inside an angle-bracketed web address ("<www.…" without its ">"). */
export const OPEN_URL = /<(?:https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})[^>\s]*$/i

/**
 * Runs of consecutive lines joined into one paragraph's runs. Within a line a space is
 * where the drawing left a word gap; a line break is a space — unless the line broke at
 * a hyphen and the next line carries the word on in lower case (the print's own word
 * break), or broke inside a <URL>, which has no spaces. A run drawn smaller than its
 * line is a superscript (an exponent, a footnote marker) and sits tight to its word.
 */
function runsOfLines(lines: Line[], boldWeights: Set<Weight>, strip?: RegExp): TextRun[] {
	const out: TextRun[] = []
	for (const [index, line] of lines.entries()) {
		let first = true
		let previousRun: Run | null = null
		for (const r of line.runs) {
			let text = r.text
			if (first && index === 0 && strip) text = text.replace(strip, '')
			const startsLine = first
			first = false
			if (text === '') continue
			const superscript = !r.dingbat && r.size < line.size - 1.5
			const previous = out.at(-1)
			if (previous && !previous.text.endsWith(' ') && !text.startsWith(' ') && !superscript) {
				let space: boolean
				if (startsLine || previousRun === null) {
					const hyphenated = /-$/.test(previous.text) && /^[a-z]/.test(text)
					const inUrl = OPEN_URL.test(out.map((o) => o.text).join(''))
					space = !hyphenated && !inUrl
				} else {
					const gap = r.box.x - (previousRun.box.x + previousRun.box.width)
					space = gap > Math.min(previousRun.size, r.size) * 0.18
				}
				if (space) previous.text += ' '
			}
			const run = toRun(r, { boldWeights })
			run.text = text
			if (superscript && run.footnote === null) run.superscript = true
			if (previous && sameStyle(previous, run)) previous.text += text
			else out.push(run)
			previousRun = r
		}
	}
	return out.map((r) => ({ ...r, text: r.text.replace(/\s+/g, ' ') }))
}

const sameStyle = (a: TextRun, b: TextRun): boolean =>
	a.bold === b.bold &&
	a.italic === b.italic &&
	a.superscript === b.superscript &&
	a.size === b.size &&
	JSON.stringify(a.link) === JSON.stringify(b.link) &&
	a.footnote === null &&
	b.footnote === null

interface Ladder {
	/** Body size (the size with the most characters). */
	body: number
	chapter: number
	part: number
	section: number
}

/** The heading ladder, learned from the document's size histogram. */
function learnLadder(lines: Line[]): Ladder {
	const chars = new Map<number, number>()
	const count = new Map<number, number>()
	for (const l of lines) {
		chars.set(l.size, (chars.get(l.size) ?? 0) + l.text.length)
		count.set(l.size, (count.get(l.size) ?? 0) + 1)
	}
	const body = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 9.5
	// Heading sizes RECUR: a chapter title on most chapter pages, a part heading many
	// times. A size used on four lines (the cover title, twice) is not a rung.
	const recurring = [...count.entries()]
		.filter(([s, n]) => s > body + 0.75 && n >= 8)
		.map(([s]) => s)
		.sort((a, b) => b - a)
	const chapter = recurring.find((s) => s >= body * 2) ?? recurring[0] ?? body * 2.4
	const section = recurring.find((s) => s > body + 0.75 && s <= body * 1.25) ?? body + 1.5
	const part = recurring.find((s) => s > section + 0.75 && s < chapter - 0.75) ?? body * 1.47
	return { body, chapter, part, section }
}

/** 1 chapter, 2 part (step, principle, appendix), 3 numbered section, 4 numbered
 *  subsection, 5 run-in heading at body size. */
type HeadingLevel = 1 | 2 | 3 | 4 | 5

/** A heading set at body size (numbered or not). */
const runIn = (level: HeadingLevel | null): boolean => level === 4 || level === 5

/** A line set wholly in one weight (a superscript or dingbat aside). */
const wholly = (line: Line, weight: Weight): boolean =>
	line.runs.filter((r) => !r.dingbat && r.size >= line.size - 1.5).every((r) => r.weight === weight)

/** A line set wholly in italic (a dingbat aside apart). */
const whollyItalic = (line: Line): boolean => {
	const runs = line.runs.filter((r) => !r.dingbat && r.size >= line.size - 1.5)
	return runs.length > 0 && runs.every((r) => r.italic)
}

/** What heading level a line is, or null for text. `standalone` = the line opens after a
 *  paragraph gap (or a page), which an italic run-in heading must. */
function headingLevelOf(line: Line, ladder: Ladder, next: Line | undefined, standalone = true): HeadingLevel | null {
	if (line.runs.every((r) => r.dingbat)) return null
	if (line.size >= ladder.chapter - 0.75) return 1
	// An italic run-in heading at body size ("Timeframe for starting treatment" over its
	// bullets): one short whole line in italic after a gap, no end punctuation, body text
	// under it. A publication title wrapped inside a paragraph is not standalone.
	if (
		standalone &&
		Math.abs(line.size - ladder.body) <= 0.75 &&
		whollyItalic(line) &&
		!markerOf(line) &&
		!CAPTION.test(line.text) &&
		line.text.length <= 70 &&
		!/[.:;,!?]$/.test(line.text.trim()) &&
		next !== undefined &&
		!whollyItalic(next) &&
		Math.abs(next.size - ladder.body) <= 1
	)
		return 5
	if (line.size >= ladder.part - 0.75 && (line.weight === 'roman' || line.weight === 'medium')) return 2
	if (line.size >= ladder.section - 0.5 && line.size < ladder.part - 0.75 && line.weight !== 'light') return 3
	// A run-in heading at body size: one whole line in the medium weight, short, not a
	// sentence, not a bullet, and not the first line of a bold paragraph (the next line
	// does not continue it in lower case).
	if (
		Math.abs(line.size - ladder.body) <= 0.75 &&
		wholly(line, 'medium') &&
		!BULLET.test(line.text) &&
		!CAPTION.test(line.text) &&
		!markerOf(line) &&
		line.text.length <= 110 &&
		!/[.:;,]$/.test(line.text.trim()) &&
		!/\b(and|or|the|of|for|to|with|in|a|an)$/i.test(line.text.trim()) &&
		(NUMBERED.test(line.text) ||
			next === undefined ||
			(Math.abs(next.size - ladder.body) <= 1 &&
				!/^[a-z]/.test(next.text) &&
				// The first line of a bold paragraph is followed by more bold text; a short
				// heading over a bold lead-in ("Communication" over "The GP's role is:") is not.
				(!wholly(next, 'medium') || line.text.length <= 40)))
	)
		return NUMBERED.test(line.text) ? 4 : 5
	return null
}

interface Draft {
	kind: 'heading' | 'paragraph' | 'item' | 'caption'
	level?: HeadingLevel
	lines: Line[]
	marker?: ListMarker
	label?: string
	/** Indent depth for list nesting: x0 of the marker. */
	indent?: number
	/** A one-line paragraph nothing continues (a signature). */
	closed?: boolean
}

/**
 * Consecutive lines into paragraphs, list items and headings. A paragraph continues while
 * the gap to the next line is under 1.5 lines, the size class holds and no marker starts.
 */
function draftsOf(lines: Line[], ladder: Ladder): Draft[] {
	const drafts: Draft[] = []
	let current: Draft | null = null
	let previous: Line | null = null
	const close = () => {
		if (current) drafts.push(current)
		current = null
	}
	for (const [index, line] of lines.entries()) {
		const marker = markerOf(line)
		const gap = previous && previous.page === line.page ? previous.y - line.y : Number.POSITIVE_INFINITY
		const pitch = Math.max(line.size, previous?.size ?? line.size) * 1.55
		const sizeBreak = previous ? Math.abs(previous.size - line.size) > 0.75 : true
		// Reading order jumps UP the page at a column break; text flows across it only when
		// the sentence is unfinished (a paragraph continued in the next column).
		const columnBreak = previous !== null && previous.page === line.page && line.y > previous.y + 2
		// Two pieces of one baseline (a line the column edges split) are one line.
		const sameBaseline =
			previous !== null && previous.page === line.page && previous.columnX === line.columnX && Math.abs(previous.y - line.y) <= 2 && line.x0 > previous.x1 - 2
		const near: boolean = sameBaseline || (columnBreak ? previous !== null && current !== null && current.kind !== 'heading' && textFlows(previous, line) : gap < pitch)
		const captionLike = CAPTION.test(line.text) && line.weight === 'medium'
		// A signature at the foot of a letter (a bold name over a role, far below the text)
		// is not a heading.
		const signature = index >= lines.length - 2 && gap > pitch * 3
		const standalone: boolean = previous === null || previous.page !== line.page || columnBreak || gap >= pitch || current?.kind === 'heading'
		const candidate: HeadingLevel | null = captionLike || sameBaseline ? null : headingLevelOf(line, ladder, lines[index + 1], standalone)
		if (runIn(candidate) && signature) {
			close()
			current = { kind: 'paragraph', lines: [line], closed: true }
			previous = line
			continue
		}
		// A bold paragraph or item that wraps: its second line is wholly medium too, but it
		// hangs under the first (an item's indent) or follows a wholly-medium line closely.
		const continuesBold: boolean =
			runIn(candidate) &&
			current !== null &&
			current.kind !== 'heading' &&
			!columnBreak &&
			near &&
			!sizeBreak &&
			(indentOf(line) > indentOf(current.lines[0] ?? line) + 4 || (previous !== null && wholly(previous, 'medium')))
		const level: HeadingLevel | null = continuesBold ? null : candidate
		// A heading that wraps: the next line has the same level, size and weight and sits
		// one line below (a chapter title over two lines, a long step title).
		const wraps =
			level !== null &&
			current?.kind === 'heading' &&
			current.level === level &&
			!columnBreak &&
			gap < pitch &&
			!sizeBreak &&
			line.weight === current.lines[0]?.weight
		if (level !== null && !wraps) {
			close()
			current = { kind: 'heading', level, lines: [line] }
			previous = line
			continue
		}
		if (wraps && current) {
			current.lines.push(line)
			previous = line
			continue
		}
		if (current?.kind === 'heading') {
			// A heading wraps when the next line is the same size and weight, close below. A
			// run-in heading at body size never wraps: bold text under it is a bold lead-in.
			if (level === null && !runIn(current.level ?? null) && !columnBreak && gap < pitch && !sizeBreak && line.weight === current.lines[0]?.weight && !marker) {
				current.lines.push(line)
				previous = line
				continue
			}
			close()
		}
		if (current?.kind === 'caption' && level === null && previous !== null && !columnBreak && captionWraps(previous, line)) {
			current.lines.push(line)
			previous = line
			continue
		}
		if (captionLike) {
			close()
			current = { kind: 'caption', lines: [line] }
			previous = line
			continue
		}
		if (marker && !sameBaseline) {
			close()
			current = { kind: 'item', lines: [line], marker: marker.marker, label: marker.label, indent: indentOf(line) }
			previous = line
			continue
		}
		// A numbered reference entry ("12. Author, A.; …") hangs its wrapped lines under
		// the text, past the number.
		const hanging = current?.kind === 'paragraph' && /^\d{1,3}\.(?!\d)/.test(current.lines[0]?.text ?? '') ? 26 : 14
		const continues =
			current !== null &&
			!current.closed &&
			near &&
			(!sizeBreak || sameBaseline) &&
			// A wrapped line of an item or paragraph starts at or right of the first line
			// (within its column); a line carried into the next column starts at its edge.
			(columnBreak ||
				sameBaseline ||
				(current.kind === 'item' ? indentOf(line) >= (current.indent ?? 0) + 4 : Math.abs(indentOf(line) - indentOf(current.lines[0] ?? line)) <= hanging))
		if (continues && current) current.lines.push(line)
		else {
			close()
			current = { kind: 'paragraph', lines: [line] }
		}
		previous = line
	}
	close()
	return drafts
}

/** Whether text carried over a column break: the sentence before is unfinished and the
 *  line after does not begin like a new one. */
const textFlows = (before: Line, after: Line): boolean =>
	!/[.!?:;]\s*$/.test(before.text) && !markerOf(after) && (/^[a-z(]/.test(after.text) || /[,–—-]$/.test(before.text.trim()) || !/^[A-Z]/.test(after.text))

function markerOf(line: Line): { marker: ListMarker; label: string } | null {
	const first = line.runs[0]
	if (!first) return null
	if (first.dingbat) {
		const glyph = first.text.trim()
		if (/[❑❒❏☐☑☒□]/.test(glyph)) return { marker: 'check', label: '❏' }
		if (/[✗✘✖]/.test(glyph)) return { marker: 'cross', label: '✗' }
		return { marker: 'bullet', label: glyph || '•' }
	}
	if (BULLET.test(line.text)) return { marker: 'bullet', label: '•' }
	if (DASH.test(line.text) && line.runs[0] && /^[–—-]/.test(line.runs[0].text)) return { marker: 'dash', label: '–' }
	return null
}

// ---------------------------------------------------------------------------
// Assembling blocks
// ---------------------------------------------------------------------------

interface PageContext {
	page: PdfPage
	pageNumber: number
	ladder: Ladder
	boldWeights: Set<Weight>
	figures: Figure[]
	warnings: Warning[]
}

/** The page's content in reading order: a heading opens a section, a block joins it. */
interface Event {
	y: number
	heading?: Draft
	block?: Block
}

function blocksOf(drafts: Draft[], ctx: PageContext): Event[] {
	const events: Event[] = []
	const blocks: Block[] = []
	const push = (block: Block, y: number) => {
		blocks.push(block)
		events.push({ y, block })
	}
	let list: List | null = null
	let stack: { indent: number; list: List }[] = []
	const closeLists = () => {
		list = null
		stack = []
	}
	for (const draft of drafts) {
		const y = draft.lines[0]?.y ?? 0
		if (draft.kind === 'item') {
			const item: ListItem = {
				label: draft.label ?? '•',
				marker: draft.marker ?? 'bullet',
				blocks: [paragraphOf(draft.lines, ctx, draft.marker === 'check' || draft.marker === 'cross' ? undefined : draft.marker === 'dash' ? DASH_STRIP : BULLET)],
			}
			// Strip a dingbat marker run outright: it is the marker, not text.
			if (draft.marker === 'check' || draft.marker === 'cross') stripLeadingDingbat(item.blocks[0])
			const indent = draft.indent ?? 0
			// Nesting by indent: a marker further right than the open list's is a child.
			while (stack.length > 0 && indent < (stack.at(-1)?.indent ?? 0) - 6) stack.pop()
			const open = stack.at(-1)
			if (open && indent > open.indent + 6) {
				const parentItem = open.list.items.at(-1)
				if (parentItem) {
					const nested: List = { kind: 'list', items: [item], page: ctx.pageNumber }
					parentItem.blocks.push(nested)
					stack.push({ indent, list: nested })
					continue
				}
			}
			if (open && Math.abs(indent - open.indent) <= 6) {
				open.list.items.push(item)
				continue
			}
			list = { kind: 'list', items: [item], page: ctx.pageNumber }
			stack = [{ indent, list }]
			push(list, y)
			continue
		}
		closeLists()
		if (draft.kind === 'heading') {
			events.push({ y, heading: draft })
			continue
		}
		if (draft.kind === 'caption') {
			// The caption names the figure nearest it on the page and takes its place.
			const figure = ctx.figures
				.filter((f) => f.page === ctx.pageNumber && f.alt === '')
				.sort((a, b) => Math.abs((a.bbox?.[3] ?? 0) - y) - Math.abs((b.bbox?.[3] ?? 0) - y))[0]
			if (figure) {
				figure.alt = draft.lines.map((l) => l.text).join(' ')
				push(figure, y)
				continue
			}
			push(paragraphOf(draft.lines, ctx), y)
			continue
		}
		push(paragraphOf(draft.lines, ctx), y)
	}
	return events
}

function stripLeadingDingbat(block: Block | undefined): void {
	if (block?.kind !== 'paragraph') return
	const first = block.runs[0]
	if (first && /^[❑❒❏☐☑☒□✗✘✖]\s*$/.test(first.text)) block.runs.shift()
	// The glyph's style may have let it merge into the text's own run.
	else if (first) first.text = first.text.replace(/^[❑❒❏☐☑☒□✗✘✖]\s*/, '')
	const next = block.runs[0]
	if (next) next.text = next.text.replace(/^\s+/, '')
}

const paragraphOf = (lines: Line[], ctx: PageContext, strip?: RegExp): Paragraph => ({
	kind: 'paragraph',
	runs: extendLinks(runsOfLines(lines, ctx.boldWeights, strip)),
	page: ctx.pageNumber,
	background: null,
	align: 'left',
})

/**
 * A link annotation covers one printed line; a <URL> that wraps carries its link over
 * the runs that follow until the closing ">" — the whole address is the link.
 */
function extendLinks(runs: TextRun[]): TextRun[] {
	let carried: TextRun['link'] = null
	return runs.map((r) => {
		if (r.link) {
			const opens = r.text.lastIndexOf('<')
			carried = opens >= 0 && r.text.indexOf('>', opens) < 0 ? r.link : null
			return r
		}
		if (!carried) return r
		const closes = r.text.indexOf('>')
		if (closes < 0) return { ...r, link: carried }
		const link = carried
		carried = null
		// The run ends the address: only the part up to ">" is linked.
		return { ...r, link, text: r.text }
	})
}

// ---------------------------------------------------------------------------
// Boxes: callouts, bands, the timeframe table
// ---------------------------------------------------------------------------

interface Region {
	box: Box
	kind: 'callout' | 'band' | 'table' | 'figure'
	colour: string | null
	/** For a table: its cells, each with the lines it holds. */
	cells?: { box: Box; colour: string }[]
}

/** The page's rounded fills that are not ornaments and not part of a figure. */
const roundedCells = (page: PdfPage, ornaments: Set<string>, figureBoxes: Box[]): PaintedPath[] =>
	page.paths.filter(
		(p) =>
			isRoundedCell(p) &&
			!ornaments.has(`${Math.round(p.box.x)},${Math.round(p.box.y)},${Math.round(p.box.width)},${Math.round(p.box.height)}`) &&
			!figureBoxes.some((f) => overlapsBox(f, p.box)),
	)

const textWidthOf = (lines: Line[]): number => Math.max(...lines.map((l) => l.x1)) - Math.min(...lines.map((l) => l.x0))

/**
 * The cell grid (the timeframe table): many NARROW rounded fills in at least two
 * x-positions, each position holding at least two cells.
 */
function gridRegion(page: PdfPage, lines: Line[], ornaments: Set<string>, figureBoxes: Box[]): Region | null {
	const textWidth = textWidthOf(lines)
	const rounded = roundedCells(page, ornaments, figureBoxes)
	const cells = rounded.filter((c) => c.box.width < textWidth * 0.6 && c.box.height <= page.height * 0.5)
	const perColumn = new Map<number, number>()
	for (const c of cells) perColumn.set(Math.round(c.box.x / 10), (perColumn.get(Math.round(c.box.x / 10)) ?? 0) + 1)
	const gridColumns = [...perColumn.values()].filter((n) => n >= 2).length
	if (cells.length < 6 || gridColumns < 2) return null
	// A fill as wide as the grid that sits against it is a row spanning its columns (the
	// screening statement printed as the table's first row).
	const grid = union(cells.map((c) => c.box))
	const spanning = rounded.filter(
		(c) =>
			!cells.includes(c) &&
			c.box.height <= 90 &&
			Math.abs(c.box.x - grid.x) <= 6 &&
			Math.abs(c.box.x + c.box.width - (grid.x + grid.width)) <= 6 &&
			(Math.abs(c.box.y - (grid.y + grid.height)) <= 12 || Math.abs(c.box.y + c.box.height - grid.y) <= 12),
	)
	const all = [...cells, ...spanning]
	return {
		box: union(all.map((c) => c.box)),
		kind: 'table',
		colour: null,
		cells: all.map((c) => ({ box: c.box, colour: c.colour })),
	}
}

/** Regions drawn on the page that group text: stroked callouts, filled bands, the grid.
 *  Fills inside a figure belong to the figure. */
function regionsOf(page: PdfPage, lines: Line[], ornaments: Set<string>, figureBoxes: Box[], grid: Region | null): Region[] {
	const regions: Region[] = grid ? [grid] : []
	const textWidth = textWidthOf(lines)
	// Stroked rounded rectangles wide enough to hold text: callouts.
	for (const p of page.paths) {
		if (p.kind !== 'stroke' || p.segments < 8 || p.box.width < 120 || p.box.height < 18) continue
		if (p.box.height > page.height * 0.7) continue
		if (figureBoxes.some((f) => overlapsBox(f, p.box))) continue
		regions.push({ box: p.box, kind: 'callout', colour: p.colour })
	}
	// A wide, short rounded fill is a band behind a statement; a tall one is a panel
	// behind a column (the quick guide's) and groups nothing.
	const rounded = roundedCells(page, ornaments, figureBoxes)
	const bandLike = (p: PaintedPath) => p.box.width >= textWidth * 0.5 && p.box.height >= 18 && p.box.height <= 90
	for (const c of rounded) if (bandLike(c) && !regions.some((r) => r.kind === 'table' && contains(r.box, c.box, 2))) regions.push({ box: c.box, kind: 'band', colour: c.colour })
	// Plain filled rectangles behind a statement (5 segments), wide and short.
	for (const p of page.paths) {
		if (p.kind !== 'fill' || p.segments > 6 || p.colour === '#ffffff') continue
		if (!bandLike(p) || figureBoxes.some((f) => overlapsBox(f, p.box))) continue
		if (regions.some((r) => contains(r.box, p.box, 2))) continue
		regions.push({ box: p.box, kind: 'band', colour: p.colour })
	}
	// A band whose text is a heading is the heading's decoration, not a box.
	return regions.filter((r) => !(r.kind === 'band' && linesWithin(lines, r.box).every((l) => l.size >= ladderPartOf(lines))))
}

/** The part-heading size on this page's lines: the smallest size ≥ 1.35× the body size. */
function ladderPartOf(lines: Line[]): number {
	const chars = new Map<number, number>()
	for (const l of lines) chars.set(l.size, (chars.get(l.size) ?? 0) + l.text.length)
	const body = [...chars.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 9.5
	return body * 1.35
}

/** Text lines inside a region's box. */
const linesWithin = (lines: Line[], box: Box): Line[] => lines.filter((l) => contains(box, lineBox(l), 4))

/** A callout or band as a one-cell table the mapper reads as a box. A heading inside
 *  a callout is its title: a bold paragraph where it stood. */
function boxTable(region: Region, lines: Line[], ctx: PageContext): Table {
	const inner = draftsOf(orderLines(lines, columnsOf(lines)), ctx.ladder)
	const blocks: Block[] = []
	for (const e of blocksOf(inner, ctx)) {
		if (e.heading) {
			const p = paragraphOf(e.heading.lines, ctx)
			for (const r of p.runs) r.bold = true
			blocks.push(p)
		} else if (e.block) blocks.push(e.block)
	}
	return {
		kind: 'table',
		rows: [
			{
				cells: [
					{
						header: false,
						rowSpan: 1,
						colSpan: 1,
						background: region.kind === 'band' ? region.colour : null,
						blocks,
					},
				],
			},
		],
		page: ctx.pageNumber,
		border: region.kind === 'callout' ? region.colour : null,
	}
}

/** Cell blocks: the lines inside one table cell, read as a single column. */
function cellBlocks(lines: Line[], x: number, ctx: PageContext): Block[] {
	return blocksOf(draftsOf(orderLines(lines, { starts: [x], separators: [] }), ctx.ladder), ctx).flatMap((e) =>
		e.block ? [e.block] : e.heading ? [paragraphOf(e.heading.lines, ctx)] : [],
	)
}

/**
 * The timeframe table: rounded fills in columns; rows are the finest column's cells; a
 * fill spanning several row bands is a row-spanning cell. Header labels sit just above.
 */
function cellTable(region: Region, lines: Line[], headerLines: Line[], ctx: PageContext): Table {
	const all = region.cells ?? []
	// A cell spanning the grid's width is a row of its own across every column.
	const spans = (c: { box: Box }) => c.box.width >= region.box.width * 0.9
	const cells = all.filter((c) => !spans(c))
	const columnX = [...new Set(cells.map((c) => Math.round(c.box.x / 10) * 10))].sort((a, b) => a - b)
	const columnOf = (b: Box) => columnX.findIndex((x) => Math.abs(Math.round(b.x / 10) * 10 - x) <= 10)
	// Row bands from the column with the most cells, plus one per spanning cell.
	const perColumn = columnX.map((_, i) => cells.filter((c) => columnOf(c.box) === i))
	const finest = perColumn.reduce((a, b) => (b.length > a.length ? b : a), perColumn[0] ?? [])
	const bands = [...finest, ...all.filter(spans)].map((c) => ({ top: c.box.y + c.box.height, bottom: c.box.y })).sort((a, b) => b.top - a.top)
	const rowOf = (b: Box): { first: number; count: number } => {
		const top = b.y + b.height
		const bottom = b.y
		const first = bands.findIndex((band) => band.top <= top + 4)
		let count = 0
		for (let i = Math.max(0, first); i < bands.length; i++) if ((bands[i]?.bottom ?? 0) >= bottom - 4) count++
		return { first: Math.max(0, first), count: Math.max(1, count) }
	}
	const rows: TableRow[] = bands.map(() => ({ cells: [] }))
	const placed: { row: number; col: number; cell: TableCell }[] = []
	for (const c of all) {
		const { first, count } = rowOf(c.box)
		const spanning = spans(c)
		placed.push({
			row: first,
			col: spanning ? 0 : columnOf(c.box),
			cell: {
				header: false,
				rowSpan: spanning ? 1 : count,
				colSpan: spanning ? Math.max(1, columnX.length) : 1,
				background: c.colour,
				blocks: cellBlocks(linesWithin(lines, c.box), c.box.x, ctx),
			},
		})
	}
	placed.sort((a, b) => a.row - b.row || a.col - b.col)
	for (const p of placed) rows[p.row]?.cells.push(p.cell)
	// The header labels share one baseline: split them by the table's columns.
	const headerParts = splitByColumns(headerLines, { starts: columnX, separators: [] })
	const header: TableRow | null =
		headerParts.length > 0
			? {
					cells: columnX.map((x, i) => {
						const next = columnX[i + 1] ?? Number.POSITIVE_INFINITY
						const own = headerParts.filter((l) => l.x0 >= x - 12 && l.x0 < next - 12)
						return {
							header: true,
							rowSpan: 1,
							colSpan: 1,
							background: null,
							blocks: own.length > 0 ? [paragraphOf(own, ctx)] : [],
						}
					}),
				}
			: null
	return {
		kind: 'table',
		rows: [...(header ? [header] : []), ...rows.filter((r) => r.cells.length > 0)],
		page: ctx.pageNumber,
		border: null,
	}
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/**
 * Vector art on a page (non-rectangular fills, image draws) clustered into figure
 * regions with the small labels inside them. The cover's icon field and page ornaments
 * are excluded by the caller.
 */
function figureRegions(page: PdfPage, lines: Line[], ladder: Ladder, ornaments: Set<string>, images: Box[]): { box: Box; labels: Line[] }[] {
	const art = page.paths.filter(
		(p) =>
			isArt(p) &&
			p.colour !== '#ffffff' &&
			area(p.box) > 30 &&
			!isOffPage(p, page) &&
			!ornaments.has(`${Math.round(p.box.x)},${Math.round(p.box.y)},${Math.round(p.box.width)},${Math.round(p.box.height)}`),
	)
	const seeds: Box[] = [...art.map((p) => p.box), ...images]
	if (seeds.length === 0) return []
	// Cluster boxes that touch or overlap (grown by 12pt).
	const clusters: Box[][] = []
	for (const b of seeds) {
		const grown = { x: b.x - 12, y: b.y - 12, width: b.width + 24, height: b.height + 24 }
		const hit = clusters.findIndex((cluster) => cluster.some((c) => overlapsBox(grown, c)))
		if (hit >= 0) clusters[hit]?.push(b)
		else clusters.push([b])
	}
	// Merge clusters that overlap after growth (one pass more is enough for these pages).
	let merged = true
	while (merged) {
		merged = false
		for (let i = 0; i < clusters.length && !merged; i++)
			for (let j = i + 1; j < clusters.length && !merged; j++) {
				const a = union(clusters[i] ?? [])
				const b = union(clusters[j] ?? [])
				if (overlapsBox({ x: a.x - 12, y: a.y - 12, width: a.width + 24, height: a.height + 24 }, b)) {
					clusters[i] = [...(clusters[i] ?? []), ...(clusters[j] ?? [])]
					clusters.splice(j, 1)
					merged = true
				}
			}
	}
	const regions: { box: Box; labels: Line[] }[] = []
	for (const cluster of clusters) {
		let box = union(cluster)
		if (area(box) < 2500) continue
		// The figure's own boxes (a diagram's rounded step boxes, a tiered chart's bars)
		// sit among its art.
		const owned = page.paths.filter(
			(p) =>
				p.kind === 'fill' &&
				p.colour !== '#ffffff' &&
				!pageSized(p.box, page) &&
				!isOffPage(p, page) &&
				overlapsBox({ x: box.x - 12, y: box.y - 12, width: box.width + 24, height: box.height + 24 }, p.box),
		)
		if (owned.length > 0) box = union([box, ...owned.map((p) => p.box)])
		// Labels: short lines inside the region (or its horizontal reach), smaller than body
		// or of a heading weight at body size — figure lettering, not prose.
		const within = (l: Line) => {
			const lb = lineBox(l)
			return overlapsBox(box, lb) || (lb.y >= box.y - 6 && lb.y <= box.y + box.height + 6 && lb.x >= box.x - 40 && lb.x <= box.x + box.width + 40)
		}
		// Drawing with paragraphs of body text on it is a panel behind text (a tinted
		// table column, a page tint), not a figure.
		const prose = lines.filter((l) => within(l) && l.size >= ladder.body - 0.5 && l.text.length >= 40)
		if (prose.length >= 3) continue
		const labels = lines.filter((l) => within(l) && (l.size < ladder.body - 0.5 || (l.weight !== 'light' && l.text.length < 60) || (l.size <= ladder.body + 1.5 && l.text.length < 40)))
		regions.push({ box: labels.length > 0 ? union([box, ...labels.map(lineBox)]) : box, labels })
	}
	return regions
}

const overlapsBox = (a: Box, b: Box): boolean =>
	a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** A page-sized fill is a background, not a figure panel. */
const pageSized = (box: Box, page: PdfPage): boolean => box.width > page.width * 0.8 && box.height > page.height * 0.5

/**
 * Figure panels: a large rounded fill with other drawing inside it (the pathway wheel's
 * plate) is a figure, and every line on it is a label.
 */
function panelRegions(page: PdfPage, lines: Line[]): { box: Box; labels: Line[] }[] {
	const drawn = page.paths.filter((p) => p.colour !== '#ffffff' && !isOffPage(p, page))
	const regions: { box: Box; labels: Line[] }[] = []
	for (const p of drawn) {
		if (p.kind !== 'fill' || p.segments !== 11 || area(p.box) < 20000 || pageSized(p.box, page)) continue
		const inside = drawn.filter((q) => q !== p && contains(p.box, q.box, 2))
		if (inside.length < 2) continue
		const labels = lines.filter((l) => overlapsBox(p.box, lineBox(l)))
		regions.push({ box: union([p.box, ...labels.map(lineBox)]), labels })
	}
	return regions
}

/**
 * A figure named by a "Figure N:" caption that no art or panel claimed (the principles
 * strip: a row of pale cells with six-point labels): everything drawn between the
 * caption and the next line of the text flow. The grid is the timeframe table, not this.
 */
function captionRegion(caption: Line, page: PdfPage, lines: Line[], ladder: Ladder, grid: Region | null): { box: Box; labels: Line[] } | null {
	// A caption that fills its measure wraps: the figure starts under its last line.
	let last = caption
	for (;;) {
		const next = lines.find((l) => captionWraps(last, l))
		if (!next) break
		last = next
	}
	const below = lines.filter((l) => l.y < last.y - 4).sort((a, b) => b.y - a.y)
	const stop = below.find(
		(l) => Math.abs(l.x0 - caption.x0) <= 8 && l.size >= ladder.body - 0.25 && (l.weight === 'light' || l.size >= ladder.section - 0.5),
	)
	const floor = stop ? stop.y + stop.size : FOOTER_Y
	// The caption names the cell grid (the timeframes table) when the grid lies under it,
	// even with a key band between: that is a table, not a drawing.
	if (grid && grid.box.y + grid.box.height < last.y && grid.box.y + grid.box.height > floor - 2) return null
	const labels = below.filter((l) => l.y > floor)
	const drawn = [
		...page.paths.filter((p) => p.colour !== '#ffffff' && !isOffPage(p, page) && !pageSized(p.box, page)).map((p) => p.box),
		...page.images.filter((b) => !pageSized(b, page)),
	].filter((b) => b.y + b.height <= last.y + 2 && b.y >= floor - 2)
	if (drawn.length === 0 && labels.length < 2) return null
	return { box: union([...drawn, ...labels.map(lineBox)]), labels }
}

/** The line under a caption that continues it: same left edge, weight and size, one
 *  line below, and the caption line above it filled its measure. */
const captionWraps = (above: Line, line: Line): boolean =>
	line.y < above.y - 4 &&
	line.y > above.y - above.size * 1.6 &&
	Math.abs(line.x0 - above.x0) <= 2 &&
	line.weight === 'medium' &&
	Math.abs(line.size - above.size) <= 0.5 &&
	above.x1 - above.x0 > 300 &&
	!/[.!?]$/.test(above.text.trim())

// ---------------------------------------------------------------------------
// Footnotes
// ---------------------------------------------------------------------------

/** Footnote texts: small lines near the page foot that begin with a marker digit. */
function footnotesOf(lines: Line[], ladder: Ladder, pageNumber: number): { notes: Footnote[]; consumed: Set<Line> } {
	const notes: Footnote[] = []
	const consumed = new Set<Line>()
	const small = lines.filter((l) => l.size < ladder.body - 1 && l.y < 120 && l.y > FOOTER_Y).sort((a, b) => b.y - a.y)
	let current: { label: string; lines: Line[] } | null = null
	const flush = () => {
		if (!current) return
		const runs = runsOfLines(current.lines, new Set(['medium', 'black']))
		// The printed label is the note's `label`, not its text — whether InDesign set it
		// as a run of its own (a tab before the text) or glued to the note's first word.
		const first = runs[0]
		if (first && /^\d{1,2}\s*$/.test(first.text)) runs.shift()
		else if (first) first.text = first.text.replace(/^\d{1,2}\s+/, '')
		notes.push({
			label: current.label,
			page: pageNumber,
			blocks: [{ kind: 'paragraph', runs, page: pageNumber, background: null, align: 'left' }],
		})
		current = null
	}
	for (const line of small) {
		const m = /^(\d{1,2})\s+\S/.exec(line.text)
		if (m?.[1]) {
			flush()
			current = { label: m[1], lines: [line] }
			consumed.add(line)
		} else if (current) {
			current.lines.push(line)
			consumed.add(line)
		}
	}
	flush()
	return { notes, consumed }
}

// ---------------------------------------------------------------------------
// Quick-guide step rows (the January-2020 design)
// ---------------------------------------------------------------------------

/**
 * A step row of the 2020 quick guide: the label cell at the left margin and what it
 * holds — "Step N" over the step's title, and in Step 4 the treatment intent in small
 * type — with the content printed beside it and the lines printed under it before the
 * next row (a full-width callout, a "For more information" line).
 */
interface GuideRow {
	cell: PaintedPath
	top: number
	bottom: number
	step: Line
	title: Line[]
	notes: Line[]
	content: Line[]
	below: Line[]
}

/** A stroked rounded rectangle wide enough to hold text: a callout. */
const isCalloutStroke = (p: PaintedPath): boolean => p.kind === 'stroke' && p.segments >= 8 && p.box.width >= 120 && p.box.height >= 18

/**
 * The page's step rows: a narrow rounded cell at the left margin holding "Step N" at
 * the part size, with a fill of the same height starting where the cell ends.
 */
function guideRowsOf(page: PdfPage, lines: Line[], ladder: Ladder): GuideRow[] {
	const cells = page.paths
		.filter((p) => isRoundedCell(p) && p.box.width < 100 && p.box.x < 100 && p.box.height >= 50 && !isOffPage(p, page))
		.sort((a, b) => b.box.y - a.box.y)
	const rows: GuideRow[] = []
	for (const cell of cells) {
		const inside = lines.filter((l) => contains(cell.box, lineBox(l), 3))
		const step = inside.find((l) => /^Step\s+\d+$/i.test(l.text.trim()) && l.size >= ladder.part - 0.75)
		if (!step) continue
		const top = cell.box.y + cell.box.height
		const bottom = cell.box.y
		// The content beside the cell: one fill of the row's height, or a fill per column
		// under a band — any fill starting at the cell's edge and lying within the row.
		const beside = page.paths.some(
			(p) =>
				p.kind === 'fill' &&
				p !== cell &&
				Math.abs(p.box.x - (cell.box.x + cell.box.width)) <= 12 &&
				p.box.y >= bottom - 4 &&
				p.box.y + p.box.height <= top + 4 &&
				p.box.height >= 15,
		)
		if (!beside) continue
		const rest = inside.filter((l) => l !== step)
		rows.push({
			cell,
			top,
			bottom,
			step,
			title: rest.filter((l) => l.size >= ladder.body - 0.5).sort((a, b) => b.y - a.y),
			notes: rest.filter((l) => l.size < ladder.body - 0.5).sort((a, b) => b.y - a.y),
			content: [],
			below: [],
		})
	}
	return rows
}

/** A copy of the line with its last run's text rewritten. */
function withLastRun(line: Line, rewrite: (text: string) => string): Line {
	const runs = line.runs.map((r, i) => (i === line.runs.length - 1 ? { ...r, text: rewrite(r.text) } : r))
	const copy = lineOf(runs, line.page)
	copy.columnX = line.columnX
	return copy
}

const withoutColon = (line: Line): Line => withLastRun(line, (t) => t.replace(/\s*:\s*$/, ''))

/** Every run of the line (a superscript or dingbat aside) is set in a bold weight. */
const boldLine = (line: Line, boldWeights: Set<Weight>): boolean => {
	const runs = line.runs.filter((r) => !r.dingbat && r.size >= line.size - 1.5)
	return runs.length > 0 && runs.every((r) => boldWeights.has(r.weight))
}

/** `below` sits one line under `above`, in the same column of the same page. */
const closeBelow = (above: Line | undefined, below: Line): boolean =>
	above !== undefined && above.page === below.page && below.y < above.y && above.y - below.y < Math.max(above.size, below.size) * 1.9 && Math.abs(above.columnX - below.columnX) <= 8

/**
 * A bold "Label:" opening a line names a panel: the bold runs up to the colon are the
 * heading, the rest of the line (if any) opens its text. The colon itself may have
 * been set in the text's own face ("**Signs and symptoms**: Patients …").
 */
function labelOf(line: Line, boldWeights: Set<Weight>): { head: Line; rest: Line | null } | null {
	if (markerOf(line)) return null
	let n = 0
	while (n < line.runs.length) {
		const run = line.runs[n]
		if (!run || !(run.dingbat || boldWeights.has(run.weight) || run.size < line.size - 1.5)) break
		n++
	}
	if (n === 0) return null
	let prefix = joinRuns(line.runs.slice(0, n)).trim()
	let rest = line.runs.slice(n)
	const following = rest[0]
	if (!/:$/.test(prefix) && following && /^\s*:/.test(following.text)) {
		prefix = `${prefix}:`
		const trimmed = following.text.replace(/^\s*:\s*/, '')
		rest = trimmed ? [{ ...following, text: trimmed }, ...rest.slice(1)] : rest.slice(1)
	}
	if (!/:$/.test(prefix) || prefix.split(/\s+/).length > 8) return null
	const head = withoutColon(lineOf(line.runs.slice(0, n), line.page))
	head.columnX = line.columnX
	const restLine = rest.length > 0 ? lineOf(rest, line.page) : null
	if (restLine) restLine.columnX = line.columnX
	return { head, rest: restLine }
}

/**
 * A label that wraps: bold lines, the last of them ending in the colon ("General/primary
 * practitioner" / "investigations: The five-yearly …"), over the text that follows.
 */
function labelOfLines(lines: Line[], boldWeights: Set<Weight>): { head: Line[]; rest: Line[] } | null {
	const head: Line[] = []
	for (const [j, line] of lines.entries()) {
		const label = labelOf(line, boldWeights)
		if (label) {
			const all = [...head, label.head]
			if (all.map((l) => l.text).join(' ').split(/\s+/).length > 8) return null
			return { head: all, rest: [...(label.rest ? [label.rest] : []), ...lines.slice(j + 1)] }
		}
		if (j < 2 && boldLine(line, boldWeights) && !markerOf(line) && !/[.!?:]$/.test(line.text.trim())) {
			head.push(line)
			continue
		}
		return null
	}
	return null
}

/**
 * The drafts of a guide row with its panel labels read as headings, and the misreadings
 * a narrow column invites undone: a bold statement set short enough to look like a
 * run-in heading is a paragraph when it ends like a sentence or bold text carries on
 * under it; a label that wraps ("Risk factors for bone" / "sarcoma include:") is one
 * heading.
 */
function labelDrafts(drafts: Draft[], ctx: PageContext): Draft[] {
	const out: Draft[] = []
	for (let i = 0; i < drafts.length; i++) {
		const draft = drafts[i]
		if (!draft) continue
		const next = drafts[i + 1]
		if (draft.kind === 'heading' && runIn(draft.level ?? null)) {
			const text = draft.lines.map((l) => l.text).join(' ').trim()
			const nextLine = next?.kind === 'paragraph' && !next.closed ? next.lines[0] : undefined
			const nextBold = nextLine !== undefined && boldLine(nextLine, ctx.boldWeights) && closeBelow(draft.lines.at(-1), nextLine)
			if (next && nextLine && nextBold && next.lines.length === 1 && /:$/.test(nextLine.text.trim())) {
				out.push({ kind: 'heading', level: 5, lines: [...draft.lines, withoutColon(nextLine)] })
				i++
				continue
			}
			if (/[.!?]$/.test(text) || (next && nextBold)) {
				out.push({ kind: 'paragraph', lines: [...draft.lines, ...(next && nextBold ? next.lines : [])] })
				if (next && nextBold) i++
				continue
			}
			out.push(draft)
			continue
		}
		if (draft.kind === 'paragraph' && !draft.closed) {
			const label = labelOfLines(draft.lines, ctx.boldWeights)
			if (label) {
				out.push({ kind: 'heading', level: 5, lines: label.head })
				if (label.rest.length > 0) out.push({ kind: 'paragraph', lines: label.rest })
				continue
			}
		}
		out.push(draft)
	}
	return out
}

/**
 * A callout's title split at its dash: "Communication – lead clinician to:" is the
 * panel "Communication" over the lead-in "lead clinician to:", as the 2021 design
 * prints the same panel.
 */
function splitAtDash(lines: Line[]): { head: Line[]; rest: Line[] } | null {
	for (const [j, line] of lines.entries()) {
		for (const [i, run] of line.runs.entries()) {
			const at = run.text.search(/[–—]/)
			if (at < 0) continue
			const before = run.text.slice(0, at).trimEnd()
			const after = run.text.slice(at + 1).trimStart()
			const ratio = run.text.length > 0 ? before.length / run.text.length : 0
			const headRuns = [...line.runs.slice(0, i), ...(before ? [{ ...run, text: before, box: { ...run.box, width: run.box.width * ratio } }] : [])]
			const restRuns = [...(after ? [{ ...run, text: after, box: { ...run.box, x: run.box.x + run.box.width * ratio, width: run.box.width * (1 - ratio) } }] : []), ...line.runs.slice(i + 1)]
			if (headRuns.length === 0) return null
			const head = [...lines.slice(0, j), lineOf(headRuns, line.page)]
			const rest = [...(restRuns.length > 0 ? [lineOf(restRuns, line.page)] : []), ...lines.slice(j + 1)]
			for (const l of [...head, ...rest]) l.columnX = line.columnX
			return { head, rest }
		}
	}
	return null
}

/** A callout inside a guide row: its title is a panel heading, its text the panel's. */
function calloutEvents(within: Line[], ctx: PageContext): Event[] {
	if (within.length === 0) return []
	const x = Math.min(...within.map((l) => l.x0))
	const drafts = draftsOf(orderLines(within, { starts: [x], separators: [] }), ctx.ladder)
	const events: Event[] = []
	const first = drafts[0]
	const firstLine = first?.lines[0]
	if (first && firstLine && (first.kind === 'heading' || (first.kind === 'paragraph' && boldLine(firstLine, ctx.boldWeights)))) {
		const titleLines = first.kind === 'heading' ? first.lines : [firstLine]
		const split = splitAtDash(titleLines)
		const head = split ? split.head : titleLines
		const last = head.at(-1)
		const heading = last ? [...head.slice(0, -1), withoutColon(last)] : head
		events.push({ y: firstLine.y, heading: { kind: 'heading', level: 5, lines: heading } })
		const rest = [...(split ? split.rest : []), ...(first.kind === 'paragraph' ? first.lines.slice(1) : [])]
		if (rest.length > 0) events.push({ y: rest[0]?.y ?? firstLine.y, block: paragraphOf(rest, ctx) })
		drafts.shift()
	}
	events.push(...blocksOf(labelDrafts(drafts, ctx), ctx))
	return events
}

/**
 * A baseline two columns share may have come through as one line (a word space is all
 * that separates "examination," from "aided by" at the next column's edge): split it
 * where a run starts at a column's edge after a gap wider than a word space.
 */
function splitAtColumnStarts(line: Line, starts: number[]): Line[] {
	const pieces: Line[] = []
	let runs: Run[] = []
	for (const run of line.runs) {
		const previous = runs.at(-1)
		if (previous) {
			const end = previous.box.x + previous.box.width
			const atEdge = starts.some((s) => s > line.x0 + 30 && run.box.x >= s - 8 && end < s - 2) && run.box.x - end >= 4
			if (atEdge) {
				pieces.push(lineOf(runs, line.page))
				runs = []
			}
		}
		runs.push(run)
	}
	if (pieces.length === 0) return [line]
	if (runs.length > 0) pieces.push(lineOf(runs, line.page))
	return pieces
}

/**
 * A row's content in reading order. Inside a row everything set side by side is a
 * column (the row is designed as columns; a wrapped item hangs by a few points), so
 * the columns are the left edges — of free lines and of callouts — a column's width
 * apart. A line running across the columns (a statement on a band under them) closes
 * a band: columns read left to right above it, each top to bottom with its callouts
 * dropped in where their tops fall, then the line, then the columns below it. Text
 * flows from one column into the next; a callout closes the flow.
 */
function guideRowEvents(content: Line[], callouts: PaintedPath[], ctx: PageContext): Event[] {
	const inCallout = new Map<PaintedPath, Line[]>()
	let free: Line[] = []
	for (const l of content) {
		const callout = callouts.find((p) => contains(p.box, lineBox(l), 4))
		if (callout) inCallout.set(callout, [...(inCallout.get(callout) ?? []), l])
		else free.push(l)
	}
	const xs = [...free.map((l) => l.x0), ...callouts.map((c) => c.box.x + 6)].sort((a, b) => a - b)
	const starts: number[] = []
	for (const x of xs) {
		const last = starts.at(-1)
		if (last === undefined || x - last >= 60) starts.push(x)
	}
	free = free.flatMap((l) => splitAtColumnStarts(l, starts))
	const columnOf = (x: number): number => {
		let index = 0
		for (const [i, start] of starts.entries()) if (x >= start - 8) index = i
		return index
	}
	for (const l of free) l.columnX = starts[columnOf(l.x0)] ?? l.x0
	const spans = (l: Line): boolean => {
		const next = starts[columnOf(l.x0) + 1]
		return next !== undefined && l.x1 > next + 20
	}
	const spanning = free.filter(spans).sort((a, b) => b.y - a.y)
	let pool = free.filter((l) => !spans(l))
	let boxes = [...callouts]
	type Item = { line: Line } | { callout: PaintedPath }
	const sequence: Item[] = []
	const columnOrder = (band: Line[], bandBoxes: PaintedPath[]) => {
		for (const c of starts.keys()) {
			const own = band.filter((l) => columnOf(l.x0) === c).sort((a, b) => b.y - a.y)
			const inColumn = bandBoxes.filter((p) => columnOf(p.box.x + 6) === c).sort((a, b) => b.box.y - a.box.y)
			for (const line of own) {
				while (inColumn.length > 0 && (inColumn[0]?.box.y ?? 0) + (inColumn[0]?.box.height ?? 0) > line.y + 2) {
					const callout = inColumn.shift()
					if (callout) sequence.push({ callout })
				}
				sequence.push({ line })
			}
			sequence.push(...inColumn.map((callout) => ({ callout })))
		}
	}
	for (const cut of [...spanning.map((s) => s.y), Number.NEGATIVE_INFINITY]) {
		const above = (y: number) => y > cut + 1
		columnOrder(
			pool.filter((l) => above(l.y)),
			boxes.filter((c) => above(c.box.y + c.box.height)),
		)
		pool = pool.filter((l) => !above(l.y))
		boxes = boxes.filter((c) => !above(c.box.y + c.box.height))
		const span = spanning.find((s) => s.y === cut)
		if (span) sequence.push({ line: span })
	}
	const events: Event[] = []
	let run: Line[] = []
	const flush = () => {
		if (run.length > 0) events.push(...blocksOf(labelDrafts(draftsOf(run, ctx.ladder), ctx), ctx))
		run = []
	}
	for (const item of sequence) {
		if ('line' in item) run.push(item.line)
		else {
			flush()
			events.push(...calloutEvents(inCallout.get(item.callout) ?? [], ctx))
		}
	}
	flush()
	return events
}

/**
 * A quick-guide page of step rows. Lines above the first row (the chapter title, the
 * guide's note) open the page; each row opens its step, then its content; lines under
 * a row belong to it; lines under the last row (the guide's closing band) belong to
 * the chapter. The rotated side band at the margin repeats on every guide page: it is
 * furniture the mapper places once.
 */
function readGuidePage(page: PdfPage, rows: GuideRow[], lines: Line[], ctx: PageContext, outline: Outline, front: Block[], warnings: Warning[]): void {
	const n = ctx.pageNumber
	const margin = Math.min(...rows.map((r) => r.cell.box.x))
	const labelLines = new Set(rows.flatMap((r) => [r.step, ...r.title, ...r.notes]))
	const before: Line[] = []
	const after: Line[] = []
	for (const l of lines) {
		if (labelLines.has(l)) continue
		// The side band runs up the margin alongside the rows; the guide's note above the
		// first row starts at the page margin too and is text.
		if (l.x0 < margin - 5 && l.x1 - l.x0 > 200 && rows.some((r) => l.y >= r.bottom - 2 && l.y <= r.top + 2)) {
			warnings.push({ page: n, message: `furniture: ${l.text}` })
			continue
		}
		const row = rows.find((r) => l.y >= r.bottom - 2 && l.y <= r.top + 2 && l.x0 > r.cell.box.x + r.cell.box.width - 2)
		if (row) {
			row.content.push(l)
			continue
		}
		const aboveIndex = rows.findLastIndex((r) => r.bottom > l.y)
		if (aboveIndex < 0) before.push(l)
		else if (aboveIndex === rows.length - 1) after.push(l)
		else rows[aboveIndex]?.below.push(l)
	}
	const emit = (events: Event[]) => {
		for (const e of events) {
			if (e.heading) {
				pushSection(outline, e.heading.level ?? 5, e.heading.lines, n, ctx.boldWeights, warnings)
				continue
			}
			if (!e.block) continue
			const open = outline.stack.at(-1)
			if (open) open.blocks.push(e.block)
			else front.push(e.block)
		}
	}
	const flowOf = (ls: Line[]): Event[] => {
		if (ls.length === 0) return []
		const columns = columnsOf(ls, page)
		return blocksOf(draftsOf(orderLines(ls, columns), ctx.ladder), ctx)
	}
	const calloutsBetween = (top: number, bottom: number): PaintedPath[] =>
		page.paths.filter((p) => isCalloutStroke(p) && p.box.y + p.box.height <= top + 2 && p.box.y >= bottom - 2)
	emit(flowOf(before))
	for (const [i, row] of rows.entries()) {
		// "Step 4" over "Treatment:" is the heading "Step 4: Treatment", as every other
		// design prints it.
		const step = withLastRun(row.step, (t) => `${t.trimEnd()}:`)
		emit([{ y: row.top, heading: { kind: 'heading', level: 2, lines: [step, ...row.title.map(withoutColon)] } }])
		if (row.notes.length > 0) {
			const x = Math.min(...row.notes.map((l) => l.x0))
			for (const l of row.notes) l.columnX = x
			emit(blocksOf(draftsOf(row.notes, ctx.ladder), ctx))
		}
		emit(guideRowEvents(row.content, calloutsBetween(row.top, row.bottom), ctx))
		if (row.below.length > 0) {
			const next = rows[i + 1]
			emit(guideRowEvents(row.below, calloutsBetween(row.bottom, next?.top ?? FOOTER_Y), ctx))
		}
	}
	if (after.length > 0) {
		while (outline.stack.length > 1) outline.stack.pop()
		emit(flowOf(after))
	}
}

// ---------------------------------------------------------------------------
// The document
// ---------------------------------------------------------------------------

export interface LayoutOptions {
	/** Weights that read as bold inside body text. */
	boldWeights?: Weight[]
}

interface Outline {
	sections: Section[]
	stack: Section[]
	next: number
}

/** The descendants of `root` down to the first that satisfies `test`, root excluded. */
function pathTo(root: Section, test: (s: Section) => boolean): Section[] | null {
	for (const child of root.children) {
		if (test(child)) return [child]
		const deeper = pathTo(child, test)
		if (deeper) return [child, ...deeper]
	}
	return null
}

/** The heading without its printed number. */
const titleOf = (headingText: string, number: string | null): string => {
	const text = headingText.replace(/\s+/g, ' ').trim()
	if (!number) return text
	return text.replace(new RegExp(`^${number.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:?\\s*`, 'i'), '').trim() || text
}

function pushSection(outline: Outline, level: HeadingLevel, heading: Line[], page: number, boldWeights: Set<Weight>, warnings: Warning[]): Section {
	// A heading is styled by its level; its weight is not a bold mark.
	let runs = runsOfLines(heading, boldWeights).map((r) => ({ ...r, bold: false }))
	const printed = heading.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim()
	let text = printed
	// "Step 2: … continued" carries a section over a page: the section continues, and the
	// word is the page's, not the heading's. The warning records what the page printed.
	const continued = /\s+continued$/i.test(text)
	if (continued) {
		text = text.replace(/\s+continued$/i, '')
		while (runs.length > 0 && /^\s*continued\s*$/i.test(runs.at(-1)?.text ?? '')) runs = runs.slice(0, -1)
		const last = runs.at(-1)
		if (last) last.text = last.text.replace(/\s*continued\s*$/i, '')
	}
	const numbered = NUMBERED.exec(text)
	const step = STEP.exec(text)
	// A continued step band may name the subsection it resumes: "Step 1: … – Screening
	// recommendations continued".
	const resumed = continued && step ? /\s[–—-]\s(.+)$/.exec(text)?.[1]?.trim() : undefined
	// The open section with this heading continues: a "continued" heading by its text,
	// or a step that runs over a page in the quick guide and repeats its title band (the
	// wording may differ slightly) by its number.
	const open = outline.stack.find(
		(s) => s.level === level && ((continued && s.headingText === text) || (step !== null && s.number?.toLowerCase() === step[1]?.toLowerCase())),
	)
	if (open) {
		if (continued) warnings.push({ page, message: `continued-merged: ${printed}` })
		while (outline.stack.at(-1) !== open) outline.stack.pop()
		if (resumed) {
			// Back into the named subsection, so what follows the band continues it.
			const path = pathTo(open, (s) => titleOf(s.headingText, s.number).toLowerCase() === resumed.toLowerCase())
			if (path) {
				outline.stack.push(...path)
				return path.at(-1) ?? open
			}
		}
		return open
	}
	if (continued) warnings.push({ page, message: `continued-heading: ${printed}` })
	const section: Section = {
		id: `s${outline.next++}`,
		level,
		heading: runs,
		headingText: text,
		number: numbered?.[1] ?? (step ? step[1].replace(/\s+/g, ' ') : null),
		page,
		y: heading[0]?.y ?? 0,
		icon: null,
		blocks: [],
		children: [],
	}
	while (outline.stack.length > 0 && (outline.stack.at(-1)?.level ?? 0) >= level) outline.stack.pop()
	const parent = outline.stack.at(-1)
	if (parent) parent.children.push(section)
	else outline.sections.push(section)
	outline.stack.push(section)
	return section
}

/** Read an untagged PDF into the extractor's document model. */
export async function readLayoutDocument(
	doc: PDFDocumentProxy,
	source: string,
	options: LayoutOptions = {},
): Promise<ExtractedDocument> {
	const boldWeights = new Set<Weight>(options.boldWeights ?? ['medium', 'black'])
	const pages: PdfPage[] = []
	for (let n = 1; n <= doc.numPages; n++) pages.push(await readPage(doc, n))
	const ornaments = ornamentKeys(pages)
	const pageOfRef = new Map<string, number>()
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await doc.getPage(n)
		if (page.ref) pageOfRef.set(`${page.ref.num}R${page.ref.gen}`, n)
	}

	// Lines of every page, footers dropped, sizes learned across the whole document.
	const pageLines = new Map<number, Line[]>()
	for (const page of pages) {
		const runs = runsOf(page)
		await resolveLinks(doc, page, runs, pageOfRef)
		const lines = linesFrom(runs, page.pageNumber).filter((l) => l.y >= FOOTER_Y)
		pageLines.set(page.pageNumber, lines)
	}
	// Running artifacts: the same long line at the same size on three or more pages (the
	// quick guide's "Support: …" foot line, a running header) is furniture. The size
	// matters: a step title recurs in the contents and a list at body size, and once as
	// a heading.
	const ladder = learnLadder([...pageLines.values()].flat())
	const warnings: Warning[] = []
	// Running furniture: the same long body-size line on three or more pages that runs
	// outside the text columns — into the margin or across the page (the quick guide's
	// "Support: …" foot line, a running header). Boilerplate a document repeats in every
	// step sits inside its column and stays.
	const repeatKey = (l: Line) => `${l.size}|${l.text}`
	const furnitureLike = (l: Line) => {
		const page = pages[l.page - 1]
		return l.text.length > 40 && l.size < ladder.section - 0.5 && page !== undefined && (l.x1 > page.width - 20 || l.x0 < 30)
	}
	const repeats = new Map<string, number>()
	for (const lines of pageLines.values())
		for (const key of new Set(lines.filter(furnitureLike).map(repeatKey)))
			repeats.set(key, (repeats.get(key) ?? 0) + 1)
	for (const [n, lines] of pageLines) {
		const kept: Line[] = []
		for (const l of lines) {
			if (furnitureLike(l) && (repeats.get(repeatKey(l)) ?? 0) >= 3) warnings.push({ page: n, message: `furniture: ${l.text}` })
			else kept.push(l)
		}
		pageLines.set(n, kept)
	}
	// The contents page opens the document proper; what precedes it (title page,
	// endorsements, imprint) is front matter.
	const contentsPage =
		[...pageLines.entries()].find(([, lines]) => lines.some((l) => l.size >= ladder.chapter - 0.75 && /^contents$/i.test(l.text.trim())))?.[0] ??
		2

	// A numbered reference list ("12. Author, A.; …" under the References title) is cited
	// by raised numbers: its entries become the document's endnotes, as the template's own.
	const referencesPage = [...pageLines.entries()].find(([, lines]) => lines.some((l) => l.size >= ladder.chapter - 0.75 && /^references$/i.test(l.text.trim())))?.[0]
	const numberedEntries = new Set<number>()
	if (referencesPage !== undefined) {
		for (const [n, lines] of pageLines) {
			if (n < referencesPage) continue
			// "12. Author" — or, past 99, "100.Author" with the space squeezed out.
			for (const l of lines) {
				const m = /^(\d{1,3})\.\s*(?=\p{L})/u.exec(l.text)
				if (m?.[1]) numberedEntries.add(Number(m[1]))
			}
		}
		if (numberedEntries.size < 20) numberedEntries.clear()
	}

	const footnotes: Footnote[] = []
	const outline: Outline = { sections: [], stack: [], next: 1 }
	const front: Block[] = []
	let title = ''
	const figuresOut: Figure[] = []

	for (const page of pages) {
		const n = page.pageNumber
		const ctx: PageContext = { page, pageNumber: n, ladder, boldWeights, figures: [], warnings }
		let lines = pageLines.get(n) ?? []
		if (lines.length === 0) continue

		// The cover: the largest text is the document's title; everything else is art.
		if (n === 1) {
			const big = lines.filter((l) => l.size >= ladder.chapter - 0.75).sort((a, b) => b.y - a.y)
			title = big.map((l) => l.text).join(' ').replace(/\s+/g, ' ').trim()
			const rest = lines.filter((l) => !big.includes(l) && l.size >= ladder.body - 0.5)
			for (const d of draftsOf(rest, ladder)) front.push(paragraphOf(d.lines, ctx))
			continue
		}
		// Front matter before the contents page: paragraphs only (a heading there, and the
		// title page's repeat of the title, is a bold line).
		if (n < contentsPage) {
			// Drawn marks on the title page (the endorsing organisations' logos beside
			// "Endorsed by") are a figure of the front matter, labelled by the line they sit on.
			const marks: Figure[] = []
			for (const region of figureRegions(page, lines, ladder, ornaments, page.images)) {
				if (pageSized(region.box, page)) continue
				// The logos' caption may sit to their left on the same band ("Endorsed by" before
				// the endorsing organisations' marks).
				const beside =
					region.labels.length === 0
						? lines.find((l) => l.y >= region.box.y - 6 && l.y <= region.box.y + region.box.height + 6 && l.x1 <= region.box.x + 2 && region.box.x - l.x1 < 160)
						: undefined
				const labels = beside ? [beside] : region.labels
				if (labels.length === 0) continue
				const box = union([region.box, ...labels.map(lineBox)])
				marks.push({ kind: 'figure', alt: labels.map((l) => l.text).join(' '), page: n, bbox: [box.x, box.y, box.x + box.width, box.y + box.height] })
				lines = lines.filter((l) => !labels.includes(l))
			}
			for (const d of draftsOf(lines, ladder)) {
				const p = paragraphOf(d.lines, ctx, d.marker === 'dash' ? DASH_STRIP : d.marker ? BULLET : undefined)
				if (d.kind === 'heading') for (const r of p.runs) r.bold = true
				front.push(p)
			}
			front.push(...marks)
			continue
		}

		// Footnotes at the page foot.
		const { notes, consumed } = footnotesOf(lines, ladder, n)
		const footnoteBase = footnotes.length
		footnotes.push(...notes)
		lines = lines.filter((l) => !consumed.has(l))
		if (notes.length > 0) markFootnoteRefs(lines, notes, footnoteBase)
		if (numberedEntries.size > 0 && referencesPage !== undefined && n < referencesPage) markEndnoteRefs(lines, numberedEntries, warnings, n)

		// A quick guide printed as step rows (the January-2020 design) is read row by row.
		const rows = guideRowsOf(page, lines, ladder)
		if (rows.length >= 2) {
			readGuidePage(page, rows, lines, ctx, outline, front, warnings)
			continue
		}

		// Figures: panels, then art regions, then caption-named drawings; each takes its
		// labels out of the text flow.
		const figureBoxes: Box[] = []
		const claim = (region: { box: Box; labels: Line[] }) => {
			const figure: Figure = {
				kind: 'figure',
				alt: '',
				page: n,
				bbox: [region.box.x, region.box.y, region.box.x + region.box.width, region.box.y + region.box.height],
			}
			ctx.figures.push(figure)
			figureBoxes.push(region.box)
			lines = lines.filter((l) => !region.labels.includes(l))
		}
		for (const region of panelRegions(page, lines)) claim(region)
		// Images: off-page and tiny ones (a bleed, a bullet glyph) are not figures.
		const images = page.images.filter((b) => b.width * b.height >= 400 && b.x >= -2 && b.y >= -2 && b.x + b.width <= page.width + 2 && b.y + b.height <= page.height + 2)
		for (const region of figureRegions(page, lines, ladder, ornaments, images)) {
			// A region with no labels and little area is decoration (a booklet's cover
			// thumbnail beside its description is a picture, not a figure, until it is large);
			// a page-wide one is a background panel (the quick guide's pale column panel); a
			// region inside a claimed panel is part of it — none is a figure of its own.
			const pictured = images.some((b) => overlapsBox(b, region.box))
			if (region.labels.length === 0 && area(region.box) < (pictured ? 20000 : 8000)) continue
			if (pageSized(region.box, page)) continue
			if (figureBoxes.some((f) => overlapsBox(f, region.box))) continue
			// A picture inside a stroked callout with no lettering of its own is the
			// callout's decoration (a booklet's cover beside its description).
			if (region.labels.length === 0 && page.paths.some((p) => p.kind === 'stroke' && p.segments >= 8 && p.box.width >= 120 && contains(p.box, region.box, 4))) continue
			claim(region)
		}
		const grid = gridRegion(page, lines, ornaments, figureBoxes)
		for (const caption of lines.filter((l) => CAPTION.test(l.text) && l.weight === 'medium')) {
			if (figureBoxes.some((f) => f.y + f.height > caption.y - 60 && f.y + f.height < caption.y + 4)) continue
			const region = captionRegion(caption, page, lines, ladder, grid)
			if (region) claim(region)
		}

		// Boxes: callouts, bands and the cell table take their lines out of the flow and
		// come back as one block each, placed where their top sits.
		const boxes = regionsOf(page, lines, ornaments, figureBoxes, grid)
		const extras: Event[] = []
		for (const region of boxes.sort((a, b) => area(b.box) - area(a.box))) {
			const within = linesWithin(lines, region.box)
			if (within.length === 0) continue
			if (region.kind === 'table') {
				const header = lines.filter((l) => l.y > region.box.y + region.box.height && l.y < region.box.y + region.box.height + 24 && l.weight === 'medium' && l.x1 <= region.box.x + region.box.width + 20)
				extras.push({ y: region.box.y + region.box.height, block: cellTable(region, within, header, ctx) })
				lines = lines.filter((l) => !within.includes(l) && !header.includes(l))
				continue
			}
			extras.push({ y: region.box.y + region.box.height, block: boxTable(region, within, ctx) })
			lines = lines.filter((l) => !within.includes(l))
		}

		const columns = columnsOf(lines, page)
		const ordered = orderLines(splitByColumns(lines, columns, ladder.section - 0.5), columns)
		const flow = blocksOf(draftsOf(ordered, ladder), ctx)
		// A figure no caption claimed stands where its top sits.
		for (const figure of ctx.figures) {
			figuresOut.push(figure)
			if (figure.alt === '') extras.push({ y: figure.bbox?.[3] ?? 0, block: figure })
		}
		// Headings open sections where they fall; boxes and figures drop in by y among
		// the flow. A column page keeps the reading order its columns gave.
		const sequence = columns.starts.length > 1 ? mergeByY(flow, extras) : [...flow, ...extras].sort((a, b) => b.y - a.y)
		for (const e of sequence) {
			if (e.heading) {
				pushSection(outline, e.heading.level ?? 5, e.heading.lines, n, boldWeights, warnings)
				continue
			}
			if (!e.block) continue
			const open = outline.stack.at(-1)
			if (open) open.blocks.push(e.block)
			else front.push(e.block)
		}
	}

	// The contents list has no headings of its own: its bold entries are entries.
	for (const section of outline.sections) {
		if (!/^contents$/i.test(section.headingText.trim())) continue
		const flattened: Block[] = [...section.blocks]
		const walk = (children: Section[]) => {
			for (const child of children) {
				const heading: Paragraph = { kind: 'paragraph', runs: child.heading.map((r) => ({ ...r, bold: true })), page: child.page, background: null, align: 'left' }
				flattened.push(heading, ...child.blocks)
				walk(child.children)
			}
		}
		walk(section.children)
		section.blocks = flattened
		section.children = []
	}

	// The numbered reference list's entries move to the endnotes; the chapter keeps any
	// prose of its own.
	const endnotes: Endnote[] = []
	if (numberedEntries.size > 0) {
		const references = outline.sections.find((s) => /^references$/i.test(s.headingText.trim()))
		const take = (section: Section) => {
			const kept: Block[] = []
			for (const b of section.blocks) {
				const m = b.kind === 'paragraph' ? /^(\d{1,3})\.\s*(?=\p{L})/u.exec(b.runs.map((r) => r.text).join('')) : null
				if (b.kind === 'paragraph' && m?.[1]) endnotes.push({ number: Number(m[1]), page: b.page, runs: cutPrefix(b.runs, m[0].length) })
				else kept.push(b)
			}
			section.blocks = kept
			for (const child of section.children) take(child)
		}
		if (references) take(references)
	}

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

/** The flow in its own order, with the extras dropped in by y before the first flow
 *  event that sits below them. */
function mergeByY(flow: Event[], extras: Event[]): Event[] {
	const out: Event[] = []
	const pending = [...extras].sort((a, b) => b.y - a.y)
	for (const e of flow) {
		while (pending.length > 0 && (pending[0]?.y ?? 0) > e.y + 8) {
			const extra = pending.shift()
			if (extra) out.push(extra)
		}
		out.push(e)
	}
	out.push(...pending)
	return out
}

/** Superscript digits in the text that name a footnote on the page become markers. */
function markFootnoteRefs(lines: Line[], notes: Footnote[], base: number): void {
	const labels = new Map(notes.map((n, i) => [n.label, base + i]))
	for (const line of lines) {
		for (const run of line.runs) {
			if (run.size >= line.size - 1.5) continue
			const digit = run.text.trim()
			const index = labels.get(digit)
			if (index === undefined) continue
			// Rewrite the run as a marker: the paragraph builder reads `footnoteIndex`.
			footnoteRuns.set(run, index)
		}
	}
}

const footnoteRuns = new WeakMap<Run, number>()
const endnoteRuns = new WeakMap<Run, number>()

/** The numbers a raised run names: "21,22" → 21, 22; "4–6" → 4, 5, 6 (each its own marker;
 *  the separators stay raised for the mapper to drop). */
function markerPieces(text: string): string[] {
	const numbers: number[] = []
	for (const part of text.split(/\s*,\s*/)) {
		const range = /^(\d+)\s*[–-]\s*(\d+)$/.exec(part)
		if (range?.[1] && range[2]) {
			const [a, b] = [Number(range[1]), Number(range[2])]
			if (b > a && b - a <= 20) for (let n = a; n <= b; n++) numbers.push(n)
			else numbers.push(a, b)
		} else numbers.push(Number(part))
	}
	return numbers.flatMap((n, i) => (i > 0 ? [',', String(n)] : [String(n)]))
}

/**
 * A document whose reference list is numbered cites by raised numbers in the text: each
 * raised run of numbers becomes one endnote marker per number the list has. A number the
 * list lacks stays as printed and is recorded.
 */
function markEndnoteRefs(lines: Line[], entries: Set<number>, warnings: Warning[], page: number): void {
	for (const line of lines) {
		const runs: Run[] = []
		let changed = false
		for (const run of line.runs) {
			const text = run.text.trim()
			const raised = !run.dingbat && run.size < line.size - 1.5 && footnoteRuns.get(run) === undefined
			if (!raised || !/^\d{1,3}(?:\s*[,–-]\s*\d{1,3})*$/.test(text)) {
				runs.push(run)
				continue
			}
			const pieces = markerPieces(text)
			const unit = run.box.width / Math.max(1, pieces.join('').length)
			let x = run.box.x
			for (const piece of pieces) {
				const part: Run = { ...run, text: piece, box: { ...run.box, x, width: unit * piece.length } }
				x += unit * piece.length
				if (/^\d+$/.test(piece)) {
					const number = Number(piece)
					if (entries.has(number)) endnoteRuns.set(part, number)
					else warnings.push({ page, message: `citation-number-missing: ${piece}` })
				}
				runs.push(part)
			}
			changed = true
		}
		if (changed) {
			line.runs = runs
			finishLine(line)
		}
	}
}

/** The first `count` characters cut from the runs (a reference entry's printed number). */
function cutPrefix(runs: TextRun[], count: number): TextRun[] {
	let left = count
	const out: TextRun[] = []
	for (const r of runs) {
		if (left <= 0) {
			out.push(r)
			continue
		}
		if (r.text.length <= left) {
			left -= r.text.length
			continue
		}
		out.push({ ...r, text: r.text.slice(left) })
		left = 0
	}
	return out
}

/** URL and internal link annotations attached to the runs they cover. */
async function resolveLinks(doc: PDFDocumentProxy, page: PdfPage, runs: Run[], pageOfRef: Map<string, number>): Promise<void> {
	for (const link of page.links) {
		const target = await linkTarget(doc, link, pageOfRef)
		if (!target) continue
		for (const run of runs) {
			const b = run.box
			const overlapX = Math.min(b.x + b.width, link.box.x + link.box.width) - Math.max(b.x, link.box.x)
			const overlapY = Math.min(b.y + b.height, link.box.y + link.box.height) - Math.max(b.y, link.box.y)
			if (overlapX > Math.min(b.width, 6) * 0.5 && overlapY > 0) run.link = target
		}
	}
}

async function linkTarget(doc: PDFDocumentProxy, link: LinkAnnotation, pageOfRef: Map<string, number>): Promise<TextRun['link']> {
	if (link.url) return { url: link.url }
	if (!link.dest) return null
	try {
		const dest = await doc.getDestination(link.dest)
		const ref = Array.isArray(dest) ? dest[0] : null
		if (!ref || typeof ref !== 'object' || !('num' in ref) || !('gen' in ref)) return null
		const page = pageOfRef.get(`${ref.num}R${ref.gen}`)
		if (page === undefined) return null
		const y = Array.isArray(dest) && typeof dest[3] === 'number' ? dest[3] : null
		return { page, y }
	} catch {
		return null
	}
}

/** The footnote index a marker run carries, once `markFootnoteRefs` has seen it. */
export const footnoteIndexOf = (run: Run): number | null => footnoteRuns.get(run) ?? null

/** What a page says, line by line, above the footer — the coverage audit's ground truth. */
export interface PageLine {
	y: number
	x0: number
	x1: number
	size: number
	text: string
}

export const pageTextLines = (page: PdfPage): PageLine[] =>
	linesFrom(runsOf(page), page.pageNumber)
		.filter((l) => l.y >= FOOTER_Y)
		.map((l) => ({ y: l.y, x0: l.x0, x1: l.x1, size: l.size, text: l.text }))
