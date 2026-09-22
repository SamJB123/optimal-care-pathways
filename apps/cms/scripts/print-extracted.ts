/**
 * Prints an extracted document model as readable text for the page-by-page audit:
 *
 *   pnpm exec tsx scripts/print-extracted.ts cancer-template [--pages 13-24]
 *
 * Sections show level, number, heading and page. Runs show their marks: `**bold**`,
 * `_italic_`, `__underline__`, `^sup^`, `~sub~`, `{#00b050 …}` a non-body colour,
 * `⟦…⟧` a highlighted background (its colour after the text when not yellow),
 * `[text](url|→p.N)` links, `[^n]` endnote markers, `[fn:b]` footnote markers. Lists
 * show their markers with nesting by indent; tables show `|` cells with `#` for header
 * cells and `▮colour` for shading; figures show their alt text.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Block, ExtractedDocument, Section, TextRun } from '../src/template/extract/model.ts'

const [name, ...rest] = process.argv.slice(2)
if (!name) {
	console.error('usage: tsx scripts/print-extracted.ts <model name> [--pages a-b]')
	process.exit(2)
}
const pagesFlag = rest.indexOf('--pages')
const range = pagesFlag >= 0 ? (rest[pagesFlag + 1] ?? '').split('-').map(Number) : null
const from = range?.[0] ?? 1
const to = range?.[1] ?? range?.[0] ?? Number.POSITIVE_INFINITY

const model: ExtractedDocument = JSON.parse(
	readFileSync(
		join(import.meta.dirname, '..', 'template', '2026', 'extracted', `${name}.model.json`),
		'utf8',
	),
)

const BODY_COLOURS = new Set(['#000000', '#414042', '#0f1e64'])

function runText(r: TextRun): string {
	let t = r.text
	if (r.footnote !== null) return `[fn:${model.footnotes[r.footnote]?.label ?? '?'}]`
	if (r.endnote !== null) return `[^${r.endnote}]`
	if (r.bold) t = `**${t}**`
	if (r.italic) t = `_${t}_`
	if (r.underline) t = `__${t}__`
	if (r.superscript) t = `^${t}^`
	if (r.subscript) t = `~${t}~`
	if (r.background) t = r.background === '#ffff00' ? `⟦${t}⟧` : `⟦${t}⟧${r.background}`
	if (!BODY_COLOURS.has(r.colour)) t = `{${r.colour} ${t}}`
	if (r.link) t = `[${t}](${'url' in r.link ? r.link.url : `→p.${r.link.page}`})`
	return t
}
const runs = (rs: TextRun[]) => rs.map(runText).join('')

const lines: string[] = []
const emit = (indent: number, text: string) => lines.push(`${'  '.repeat(indent)}${text}`)

function block(b: Block, indent: number): void {
	switch (b.kind) {
		case 'paragraph':
			emit(indent, `${b.background ? `▮${b.background} ` : ''}${runs(b.runs)}`)
			return
		case 'list':
			for (const item of b.items) {
				const marker =
					item.marker === 'check'
						? '☑'
						: item.marker === 'cross'
							? '☒'
							: item.marker === 'dash'
								? '–'
								: item.marker === 'number'
									? item.label
									: '•'
				const [first, ...more] = item.blocks
				if (first?.kind === 'paragraph') emit(indent, `${marker} ${runs(first.runs)}`)
				else {
					emit(indent, marker)
					if (first) block(first, indent + 1)
				}
				for (const rest of more) block(rest, indent + 1)
			}
			return
		case 'table':
			emit(indent, `┌ table${b.border ? ` border ${b.border}` : ''} (${b.rows.length} rows)`)
			for (const row of b.rows) {
				emit(
					indent,
					`│ ${row.cells
						.map((c) => {
							const cellLines: string[] = []
							const save = lines.length
							for (const cb of c.blocks) block(cb, 0)
							cellLines.push(...lines.splice(save))
							return `${c.header ? '#' : ''}${c.background ? `▮${c.background} ` : ''}${c.colSpan > 1 ? `⇔${c.colSpan} ` : ''}${cellLines.map((l) => l.trim()).join(' ⏎ ')}`
						})
						.join(' | ')}`,
				)
			}
			emit(indent, '└')
			return
		case 'figure':
			emit(indent, `[figure: ${b.alt || '(no alt)'}]`)
	}
}

function section(s: Section): void {
	const inRange = s.page >= from && s.page <= to
	if (inRange) {
		lines.push('')
		emit(
			0,
			`${'#'.repeat(s.level)} ${s.number ? `${s.number} ` : ''}${runs(s.heading)}  (${s.id}, p.${s.page})`,
		)
		for (const b of s.blocks) block(b, 0)
	}
	for (const c of s.children) section(c)
}

if (from <= 1) {
	emit(0, `=== ${model.title} — ${model.source} (${model.pages} pages)`)
	for (const b of model.front) block(b, 0)
}
for (const s of model.sections) section(s)
if (to === Number.POSITIVE_INFINITY || from <= 1) {
	lines.push('')
	emit(0, `=== footnotes (${model.footnotes.length})`)
	for (const [i, f] of model.footnotes.entries()) {
		emit(0, `[fn:${f.label}] (p.${f.page}) #${i}`)
		for (const b of f.blocks) block(b, 1)
	}
	emit(0, `=== endnotes (${model.endnotes.length})`)
	for (const e of model.endnotes) emit(0, `[^${e.number}] (p.${e.page}) ${runs(e.runs)}`)
	emit(0, `=== warnings (${model.warnings.length})`)
	for (const w of model.warnings) emit(0, `p.${w.page}: ${w.message}`)
}
console.log(lines.join('\n'))
