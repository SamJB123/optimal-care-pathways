/**
 * Coverage audit for a legacy extraction (decision 133: a full visual pass on one
 * document per family, assertions on the rest). The assertion is simple and total:
 * every word the PDF prints above the footer is placed in the model exactly once —
 * except figure lettering, which the model carries as a rendered figure, and running
 * furniture the reader drops on purpose (a quick guide's repeated foot line).
 *
 * The audit consumes the model's words as a multiset while walking the PDF's lines, so a
 * word placed twice shows up as an EXTRA and a word never placed shows up as MISSING,
 * with the line it came from.
 */

import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Block, ExtractedDocument, Section, TextRun } from '../template/extract/model.ts'
import { readPage } from '../template/extract/pdf-page.ts'
import { OPEN_URL, type PageLine, pageTextLines } from './read-layout.ts'

export interface MissingLine {
	page: number
	text: string
	/** Words of the line the model does not have. */
	missing: string[]
}

export interface CoverageReport {
	pages: number
	/** Words printed on the pages (footer and figure lettering excluded). */
	printed: number
	matched: number
	/** Lines with at least one unplaced word. */
	missingLines: MissingLine[]
	/** Lines the reader treated as figure lettering (informational). */
	figureLines: { page: number; text: string }[]
	/** Model words left over after every printed word was matched: text placed twice. */
	extras: { word: string; count: number }[]
}

const SPLIT = /[\s/_\-–—<>()[\]{},.;:!?'"’‘“”•·▪●❏❑❒☐☑☒✗✘✖*+=&%^#~|]+/

/** Words as the audit compares them: lower case, split at every punctuation and
 *  between letters and digits (a footnote marker glued to its word). */
export const wordsOf = (text: string): string[] =>
	text
		.toLowerCase()
		.replace(/(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/g, ' ')
		.split(SPLIT)
		.map((w) => w.trim())
		.filter((w) => w.length > 0)

function runsText(runs: TextRun[]): string {
	return runs.map((r) => r.text).join('')
}

/** A piece of the model's text and the page it was read from. */
export interface PlacedText {
	page: number
	text: string
}

function collectBlocks(blocks: Block[], out: PlacedText[]): void {
	for (const b of blocks) {
		switch (b.kind) {
			case 'paragraph':
				out.push({ page: b.page, text: runsText(b.runs) })
				break
			case 'list':
				for (const item of b.items) {
					if (item.marker === 'number' || item.marker === 'other')
						out.push({ page: b.page, text: item.label })
					collectBlocks(item.blocks, out)
				}
				break
			case 'table':
				for (const row of b.rows) for (const cell of row.cells) collectBlocks(cell.blocks, out)
				break
			case 'figure':
				out.push({ page: b.page, text: b.alt })
				break
		}
	}
}

function collectSections(sections: Section[], out: PlacedText[]): void {
	for (const s of sections) {
		out.push({ page: s.page, text: runsText(s.heading) })
		collectBlocks(s.blocks, out)
		collectSections(s.children, out)
	}
}

/** Every piece of text the model carries, with its page. */
export function modelTexts(model: ExtractedDocument): PlacedText[] {
	const out: PlacedText[] = [{ page: 1, text: model.title }]
	collectBlocks(model.front, out)
	collectSections(model.sections, out)
	// A footnote's label is printed twice: the marker run keeps its text, and the note
	// carries its label apart from its text.
	for (const f of model.footnotes) {
		out.push({ page: f.page, text: f.label })
		collectBlocks(f.blocks, out)
	}
	for (const e of model.endnotes)
		out.push({ page: e.page, text: `${e.number} ${runsText(e.runs)}` })
	return out
}

export async function auditCoverage(
	doc: PDFDocumentProxy,
	model: ExtractedDocument,
): Promise<CoverageReport> {
	// One pool per page. A block carries the page of its first line, so a word printed
	// on page n may sit in the pool of n − 1 (a paragraph carried over) — those are
	// tried next; the front matter's blocks are pooled where they were printed.
	const pools = new Map<number, Map<string, number>>()
	const poolOf = (page: number) => {
		const pool = pools.get(page) ?? new Map<string, number>()
		pools.set(page, pool)
		return pool
	}
	for (const placed of modelTexts(model)) {
		const pool = poolOf(placed.page)
		for (const w of wordsOf(placed.text)) pool.set(w, (pool.get(w) ?? 0) + 1)
	}
	const takeFrom = (page: number, word: string): boolean => {
		const pool = pools.get(page)
		const left = pool?.get(word) ?? 0
		if (!pool || left === 0) return false
		pool.set(word, left - 1)
		return true
	}

	const figuresByPage = new Map<number, [number, number, number, number][]>()
	const walkFigures = (blocks: Block[]) => {
		for (const b of blocks) {
			if (b.kind === 'figure' && b.bbox)
				figuresByPage.set(b.page, [...(figuresByPage.get(b.page) ?? []), b.bbox])
			else if (b.kind === 'list') for (const item of b.items) walkFigures(item.blocks)
			else if (b.kind === 'table')
				for (const row of b.rows) for (const cell of row.cells) walkFigures(cell.blocks)
		}
	}
	const walkSections = (sections: Section[]) => {
		for (const s of sections) {
			walkFigures(s.blocks)
			walkSections(s.children)
		}
	}
	walkFigures(model.front)
	walkSections(model.sections)

	// What the reader dropped or merged on purpose, recorded in its warnings: furniture
	// lines, and "… continued" headings — merged into the open section (the line is not
	// in the model) or opened as a new one (the word "continued" is not).
	const tagged = (tag: string) =>
		new Set(
			model.warnings
				.filter((w) => w.message.startsWith(`${tag}: `))
				.map((w) => `${w.page}|${w.message.slice(tag.length + 2)}`),
		)
	const furniture = tagged('furniture')
	const mergedContinued = tagged('continued-merged')
	const headingContinued = tagged('continued-heading')

	const report: CoverageReport = {
		pages: doc.numPages,
		printed: 0,
		matched: 0,
		missingLines: [],
		figureLines: [],
		extras: [],
	}
	// First pass: every page against its own pool. Second pass: what is left tries the
	// neighbouring pages' leftovers, so a word a page does have is never taken from a
	// neighbour ahead of that neighbour's own lines.
	const pending: { page: number; text: string; words: string[] }[] = []
	for (let n = 1; n <= doc.numPages; n++) {
		const page = await readPage(doc, n)
		const figures = figuresByPage.get(n) ?? []
		const pageLines = joinUrlBreaks(pageTextLines(page))
		for (const line of pageLines) {
			// A label's baseline lies inside the figure's box; a caption just above it does not.
			// A label set on its side is judged by its ink: laid flat, its advance runs past the
			// figure's box (which is cut to the ink).
			const inFigure = figures.some(
				([x0, y0, x1, y1]) =>
					line.y >= y0 - 3 &&
					line.y <= y1 - 3 &&
					((line.x0 >= x0 - 6 && line.x1 <= x1 + 6) ||
						(line.ink.x >= x0 - 6 && line.ink.x + line.ink.width <= x1 + 6)),
			)
			if (inFigure) {
				report.figureLines.push({ page: n, text: line.text })
				continue
			}
			if (furniture.has(`${n}|${line.text}`)) continue
			// A wrapped heading's pieces are one line to the reader; its warnings name the
			// whole. Match a line that is the whole, or its first or last piece — never a
			// line that merely repeats words of it (the panel heading a band names). A heading
			// printed whole on one line has no pieces: another line that happens to open with
			// its first word ("Checklist" under "Checklist continued") is text of its own.
			const continuedKey = [...mergedContinued, ...headingContinued].find((k) => {
				if (!k.startsWith(`${n}|`)) return false
				const whole = k.slice(k.indexOf('|') + 1)
				if (whole === line.text) return true
				if (pageLines.some((l) => l.text === whole)) return false
				return whole.startsWith(`${line.text} `) || whole.endsWith(` ${line.text}`)
			})
			if (continuedKey && mergedContinued.has(continuedKey)) continue
			const text = continuedKey ? line.text.replace(/\s*continued$/i, '') : line.text
			const left: string[] = []
			for (const w of wordsOf(text)) {
				report.printed++
				if (takeFrom(n, w)) report.matched++
				else left.push(w)
			}
			if (left.length > 0) pending.push({ page: n, text: line.text, words: left })
		}
	}
	for (const p of pending) {
		const missing = p.words.filter((w) => {
			const found = takeFrom(p.page - 1, w) || takeFrom(p.page + 1, w)
			if (found) report.matched++
			return !found
		})
		if (missing.length > 0) report.missingLines.push({ page: p.page, text: p.text, missing })
	}
	const extras = new Map<string, number>()
	for (const [page, pool] of pools)
		for (const [word, count] of pool)
			if (count > 0) extras.set(`p.${page} ${word}`, (extras.get(`p.${page} ${word}`) ?? 0) + count)
	report.extras = [...extras.entries()]
		.map(([word, count]) => ({ word, count }))
		.sort((a, b) => b.count - a.count)
	return report
}

/**
 * A web address that wraps is printed on two lines but is one word; the reader joins
 * it, so the audit joins the printed pieces too — the continuation is the next line
 * down the same column.
 */
function joinUrlBreaks(lines: PageLine[]): PageLine[] {
	const out: PageLine[] = []
	const consumed = new Set<PageLine>()
	for (const line of lines) {
		if (consumed.has(line)) continue
		let joined = line
		for (;;) {
			if (!OPEN_URL.test(joined.text)) break
			const next = lines.find(
				(l) =>
					!consumed.has(l) &&
					l !== line &&
					l.y < joined.y - 2 &&
					l.y > joined.y - joined.size * 1.8 &&
					Math.abs(l.x0 - joined.x0) <= 14 &&
					l.x0 < joined.x0 + 30,
			)
			if (!next) break
			consumed.add(next)
			joined = { ...joined, text: `${joined.text}${next.text}`, y: next.y }
		}
		out.push(joined)
	}
	return out
}

/** The report as lines for a terminal or a ledger. */
export function formatReport(report: CoverageReport, options: { maxLines?: number } = {}): string {
	const max = options.maxLines ?? 60
	const lines: string[] = []
	const missingWords = report.missingLines.reduce((n, l) => n + l.missing.length, 0)
	const extraWords = report.extras.reduce((n, e) => n + e.count, 0)
	lines.push(
		`pages ${report.pages}; printed words ${report.printed}; matched ${report.matched}; missing ${missingWords} in ${report.missingLines.length} lines; extra ${extraWords}; figure lettering lines ${report.figureLines.length}`,
	)
	for (const l of report.missingLines.slice(0, max))
		lines.push(`  p.${l.page} MISSING [${l.missing.join(' ')}] ← ${l.text}`)
	if (report.missingLines.length > max)
		lines.push(`  … ${report.missingLines.length - max} more lines`)
	const extras = report.extras.slice(0, 40)
	if (extras.length > 0)
		lines.push(`  EXTRA ${extras.map((e) => `${e.word}×${e.count}`).join(' ')}`)
	return lines.join('\n')
}
