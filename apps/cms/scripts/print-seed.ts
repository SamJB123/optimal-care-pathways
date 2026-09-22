/**
 * Prints what the CMS will hold for a template — the mapped sections and their bodies in
 * the content schema — as readable text, for the page-by-page audit against the PDF:
 *
 *   pnpm exec tsx scripts/print-seed.ts cancer-template [--pages 13-24]
 *
 * Section lines show the address, printed number, title, ownership rule and heading
 * level. Body markers: `▣ kind/icon` opens a box (indented), `▌ BANNER`, `┃ GUIDANCE`,
 * `⏱ care point`, `⑂ VARIANTS` / `│ variant N`, list rows `•` `1.` `☐`, `|` table cells
 * (`#` header), `[figure: alt → src]`, `**bold**`, `_italic_`, `__underline__`, `^sup^`,
 * `⟦placeholder⟧`, `⟨instruction⟩`, `[text](href)`, `{→address}` section link, `[^n]`
 * citation, `[fn: text]` footnote.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { JsonMark, JsonNode } from '../src/content/schema.ts'
import { mapTemplate } from '../src/template/extract/map-to-content.ts'
import type { ExtractedDocument } from '../src/template/extract/model.ts'
import { templateByKey } from '../src/template/templates.ts'
import { deterministicId } from './ids.ts'

const [key, ...rest] = process.argv.slice(2)
if (!key) {
	console.error('usage: tsx scripts/print-seed.ts <template key> [--pages a-b]')
	process.exit(2)
}
const template = templateByKey(key)
const model: ExtractedDocument = JSON.parse(
	readFileSync(join(import.meta.dirname, '..', 'template', '2026', 'extracted', `${key}.model.json`), 'utf8'),
)
const result = mapTemplate({ model, template, orgId: 'audit', id: deterministicId })
const referenceNumber = new Map(result.references.map((r) => [r.id, r.printedNumber]))

const pagesFlag = rest.indexOf('--pages')
const range = pagesFlag >= 0 ? (rest[pagesFlag + 1] ?? '').split('-').map(Number) : null
// Sections carry no page in the rows; the mapper emits them in the model's walk order, so
// the model's sections line up with the rows by index.
const modelSections: ExtractedDocument['sections'] = []
const walkModel = (sections: ExtractedDocument['sections']) => {
	for (const s of sections) {
		modelSections.push(s)
		walkModel(s.children)
	}
}
walkModel(model.sections)

const wrapMark = (t: string, mark: JsonMark): string => {
	switch (mark.type) {
		case 'bold':
			return `**${t}**`
		case 'italic':
			return `_${t}_`
		case 'underline':
			return `__${t}__`
		case 'strike':
			return `~~${t}~~`
		case 'superscript':
			return `^${t}^`
		case 'subscript':
			return `~${t}~`
		case 'link':
			return `[${t}](${String(mark.attrs?.href ?? '')})`
		case 'placeholder':
			return `⟦${t}⟧`
		case 'instruction':
			return `⟨${t}⟩`
		case 'sectionLink':
			return `${t}{→${String(mark.attrs?.address ?? '')}}`
		default:
			return t
	}
}

const inline = (nodes: JsonNode[] | undefined): string =>
	(nodes ?? [])
		.map((n) => {
			if (n.type === 'text') return (n.marks ?? []).reduce(wrapMark, n.text ?? '')
			if (n.type === 'citation') return `[^${referenceNumber.get(String(n.attrs?.referenceId ?? '')) ?? '?'}]`
			if (n.type === 'footnote') return `[fn: ${String(n.attrs?.text ?? '')}]`
			if (n.type === 'hardBreak') return ' ⏎ '
			return `<${n.type}>`
		})
		.join('')

const lines: string[] = []
const emit = (indent: number, text: string) => lines.push(`${'  '.repeat(indent)}${text}`)

function block(node: JsonNode, indent: number): void {
	switch (node.type) {
		case 'paragraph':
			emit(indent, inline(node.content) || '¶')
			return
		case 'heading':
			emit(indent, `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inline(node.content)}`)
			return
		case 'banner':
			emit(indent, `▌ BANNER: ${inline(node.content)}`)
			return
		case 'guidance':
			emit(indent, '┃ GUIDANCE')
			for (const c of node.content ?? []) block(c, indent + 1)
			return
		case 'box':
			emit(indent, `▣ ${String(node.attrs?.kind ?? '')}${node.attrs?.icon ? `/${String(node.attrs.icon)}` : ''}`)
			for (const c of node.content ?? []) block(c, indent + 1)
			return
		case 'variants':
			emit(indent, '⑂ VARIANTS')
			;(node.content ?? []).forEach((v, i) => {
				emit(indent + 1, `│ variant ${i + 1}`)
				for (const c of v.content ?? []) block(c, indent + 2)
			})
			return
		case 'timeframe': {
			const [carePoint, ...rest] = node.content ?? []
			emit(indent, `⏱ ${carePoint?.type === 'carePoint' ? inline(carePoint.content) : ''}`)
			for (const c of rest) block(c, indent + 1)
			return
		}
		case 'timeframeSnapshot':
			emit(indent, '⌗ TIMEFRAME SNAPSHOT (derived from the document’s timeframes at render)')
			return
		case 'list': {
			const kind = String(node.attrs?.kind ?? 'bullet')
			const marker = kind === 'check' ? (node.attrs?.pointOfCare ? '☑' : '☐') : kind === 'ordered' ? '1.' : '•'
			const [first, ...more] = node.content ?? []
			emit(indent, `${marker} ${first?.type === 'paragraph' ? inline(first.content) : ''}`)
			if (first && first.type !== 'paragraph') block(first, indent + 1)
			for (const c of more) block(c, indent + 1)
			return
		}
		case 'table':
			emit(indent, `┌ table (${(node.content ?? []).length} rows)`)
			for (const row of node.content ?? []) {
				emit(
					indent,
					`│ ${(row.content ?? [])
						.map((cell) => {
							const save = lines.length
							for (const cb of cell.content ?? []) block(cb, 0)
							const cellLines = lines.splice(save)
							return `${cell.type === 'tableHeaderCell' ? '#' : ''}${cellLines.map((l) => l.trim()).join(' ⏎ ')}`
						})
						.join(' | ')}`,
				)
			}
			emit(indent, '└')
			return
		case 'image':
			emit(indent, `[figure: ${String(node.attrs?.alt ?? '')} → ${String(node.attrs?.src ?? '')}]`)
			return
		case 'blockquote':
			for (const c of node.content ?? []) block(c, indent)
			return
		case 'horizontalRule':
			emit(indent, '---')
			return
		default:
			emit(indent, `<${node.type}>`)
	}
}

const byId = new Map(result.sections.map((s) => [s.id, s]))
const depth = (s: (typeof result.sections)[number]): number => (s.parentId ? 1 + depth(byId.get(s.parentId) ?? s) : 0)
for (const [index, s] of result.sections.entries()) {
	const page = modelSections[index]?.page ?? 0
	if (range && page && (page < (range[0] ?? 0) || page > (range[1] ?? range[0] ?? Number.POSITIVE_INFINITY))) continue
	lines.push('')
	emit(
		0,
		`${'#'.repeat(Math.min(6, depth(s) + 1))} [${s.address}] ${s.printedNumber ? `${s.printedNumber} ` : ''}${s.title ?? ''}  (${s.pathwayOwnership}${s.apparatus ? ', apparatus' : ''}${s.canonical ? ', canonical' : ''}, H${s.headingLevel}${page ? `, p.${page}` : ''})`,
	)
	for (const c of s.bodyJson.content ?? []) block(c, 0)
}
if (!range) {
	lines.push('')
	emit(0, `=== references (${result.references.length})`)
	for (const r of result.references) emit(0, `[^${r.printedNumber}] ${r.citation}${r.url ? `  <${r.url}>` : ''}`)
	lines.push('')
	emit(0, `=== stats ${JSON.stringify(result.stats)}`)
}
console.log(lines.join('\n'))
