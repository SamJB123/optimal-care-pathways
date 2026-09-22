/**
 * Prints one PDF page the way the extractor sees it: the structure tree, and under each
 * leaf the text pdf.js read together with the style the drawing gave it (font face, bold,
 * italic, size, colour, rise), the filled shapes behind it (highlights, bands, shading),
 * the link each Link element resolves to; then the page's painted paths by colour and
 * kind, and its link annotations.
 *
 *   pnpm exec tsx scripts/inspect-pdf-page.ts template/2026/source/Attachment-B-….pdf 13
 *
 * For checking what the source actually carries before deciding how to extract it.
 */

import {
	annotationIdOf,
	type Box,
	openPdf,
	overlaps,
	readPage,
	type StructTreeContent,
	type TreeNode,
} from '../src/template/extract/pdf-page.ts'

const [path, pageArg] = process.argv.slice(2)
if (!path || !pageArg) {
	console.error('usage: tsx scripts/inspect-pdf-page.ts <pdf> <page>')
	process.exit(2)
}

const doc = await openPdf(path)
const page = await readPage(doc, Number(pageArg))

const fmt = (n: number) => Math.round(n * 10) / 10
const boxStr = (b: Box) => `(${fmt(b.x)},${fmt(b.y)} ${fmt(b.width)}×${fmt(b.height)})`

const lines: string[] = []
const emit = (depth: number, text: string) => lines.push(`${'  '.repeat(depth)}${text}`)

function describeLeaf(id: string, depth: number): void {
	const texts = page.textByMcid.get(id) ?? []
	const spans = page.spansByMcid.get(id) ?? []
	const text = texts.map((t) => t.text + (t.hasEOL ? '⏎' : '')).join('')
	emit(depth, `#${id} "${text}"`)
	for (const s of spans) {
		const flags = [
			s.bold ? 'B' : '',
			s.italic ? 'I' : '',
			s.rise > 0 ? `↑${fmt(s.rise)}` : s.rise < 0 ? `↓${fmt(-s.rise)}` : '',
		]
			.filter(Boolean)
			.join('')
		emit(depth + 1, `~ ${s.font} ${fmt(s.size)} ${s.fill}${flags ? ` ${flags}` : ''} "${s.text}"`)
	}
	// Filled shapes drawn behind this text (highlights, cell shading, bands).
	const behind = new Set<string>()
	for (const t of texts) {
		for (const p of page.paths) {
			if (p.kind === 'fill' && p.colour !== '#ffffff' && overlaps(t.box, p.box)) {
				behind.add(`${p.colour} ${boxStr(p.box)}`)
			}
		}
	}
	for (const b of behind) emit(depth + 1, `▮ behind: ${b}`)
}

function walk(node: TreeNode | StructTreeContent, depth: number): void {
	if ('type' in node) {
		if (node.type === 'content' && node.id) describeLeaf(node.id, depth)
		else if (node.type === 'annotation') {
			const link = page.linksById.get(annotationIdOf(node))
			emit(
				depth,
				`→ ${link ? (link.url ?? `dest ${link.dest ?? '?'}`) : `annotation ${node.id} (not a link)`}`,
			)
		} else emit(depth, `<${node.type}${node.id ? ` ${node.id}` : ''}>`)
		return
	}
	const extras = [
		node.alt ? `alt="${node.alt}"` : '',
		node.bbox ? `bbox=[${node.bbox.map(fmt).join(',')}]` : '',
		node.rowSpan ? `rowSpan=${node.rowSpan}` : '',
		node.colSpan ? `colSpan=${node.colSpan}` : '',
		node.lang ? `lang=${node.lang}` : '',
	]
		.filter(Boolean)
		.join(' ')
	emit(depth, `${node.role}${extras ? ` ${extras}` : ''}`)
	for (const child of node.children ?? []) walk(child, depth + 1)
}

emit(
	0,
	`page ${page.pageNumber}: ${fmt(page.width)}×${fmt(page.height)} pt; ${page.textRuns.length} text runs; ${page.paths.length} painted paths; ${page.links.length} links`,
)
emit(
	0,
	`fonts: ${[...page.fonts.values()].map((f) => `${f.alias}=${f.name}${f.bold ? ' B' : ''}${f.italic ? ' I' : ''}`).join(', ')}`,
)
if (page.tree) walk(page.tree, 0)
else emit(0, '(no structure tree)')
if (page.untaggedMcids.length > 0) {
	emit(0, `untagged marked content (${page.untaggedMcids.length}):`)
	for (const id of page.untaggedMcids) describeLeaf(id, 1)
}
emit(0, 'painted paths by colour:')
const byColour = new Map<string, number>()
for (const p of page.paths) {
	if (p.colour === '#ffffff') continue
	const key = `${p.kind} ${p.colour}`
	byColour.set(key, (byColour.get(key) ?? 0) + 1)
}
for (const [key, count] of [...byColour.entries()].sort((a, b) => b[1] - a[1]))
	emit(1, `${key} ×${count}`)
emit(0, 'stroked rectangles (borders):')
for (const p of page.paths) {
	if (p.kind === 'stroke' && p.segments >= 4 && p.box.width > 100 && p.colour !== '#ffffff')
		emit(1, `${p.colour} ${boxStr(p.box)}`)
}
emit(0, 'links:')
for (const l of page.links) emit(1, `${l.id} ${boxStr(l.box)} ${l.url ?? `dest ${l.dest ?? '?'}`}`)
console.log(lines.join('\n'))
