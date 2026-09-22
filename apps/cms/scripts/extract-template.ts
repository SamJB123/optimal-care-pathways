/**
 * Stage one of the template pipeline: a template PDF → the extracted document model, and
 * its figures rendered to PNG.
 *
 *   pnpm template:extract cancer-template            (or principles, population-template)
 *   → template/2026/extracted/<key>.model.json
 *   → public/template-figures/<key>/p<page>-<n>.png
 *
 * Both outputs are committed: the model is the seed's input and the audit's subject, the
 * figures are what the image nodes reference. Re-running on the same PDF reproduces them.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Block, ExtractedDocument, Section } from '../src/template/extract/model.ts'
import { openPdf } from '../src/template/extract/pdf-page.ts'
import { readDocument } from '../src/template/extract/read-document.ts'
import { renderFigures } from '../src/template/extract/render-figures.ts'
import { TEMPLATES, templateByKey } from '../src/template/templates.ts'

const key = process.argv[2]
if (!key) {
	console.error(`usage: tsx scripts/extract-template.ts <${TEMPLATES.map((t) => t.key).join('|')}> [--no-figures]`)
	process.exit(2)
}
const template = templateByKey(key)
const appDir = join(import.meta.dirname, '..')
const dataDir = join(appDir, 'template', '2026')
const doc = await openPdf(join(dataDir, 'source', template.sourceFile))
const model = await readDocument(doc, template.sourceFile)

const outDir = join(dataDir, 'extracted')
mkdirSync(outDir, { recursive: true })
const target = join(outDir, `${template.key}.model.json`)
writeFileSync(target, `${JSON.stringify(model, null, '\t')}\n`)

const counts = { sections: 0, paragraphs: 0, lists: 0, listItems: 0, tables: 0, cells: 0, figures: 0 }
const countBlocks = (blocks: Block[]) => {
	for (const b of blocks) {
		if (b.kind === 'paragraph') counts.paragraphs++
		else if (b.kind === 'list') {
			counts.lists++
			for (const item of b.items) {
				counts.listItems++
				countBlocks(item.blocks)
			}
		} else if (b.kind === 'table') {
			counts.tables++
			for (const row of b.rows) for (const cell of row.cells) {
				counts.cells++
				countBlocks(cell.blocks)
			}
		} else counts.figures++
	}
}
const countSections = (sections: Section[]) => {
	for (const s of sections) {
		counts.sections++
		countBlocks(s.blocks)
		countSections(s.children)
	}
}
countBlocks(model.front)
countSections(model.sections)
const summary = (m: ExtractedDocument) =>
	`${m.source}: ${m.pages} pages, ${counts.sections} sections, ${counts.paragraphs} paragraphs, ${counts.lists} lists (${counts.listItems} items), ${counts.tables} tables (${counts.cells} cells), ${counts.figures} figures, ${m.footnotes.length} footnotes, ${m.endnotes.length} endnotes, ${m.warnings.length} warnings`
console.log(summary(model))
for (const w of model.warnings.slice(0, 40)) console.log(`  p.${w.page}: ${w.message}`)
if (model.warnings.length > 40) console.log(`  … ${model.warnings.length - 40} more`)
console.log(`→ ${target}`)

if (!process.argv.includes('--no-figures')) {
	const figuresDir = join(appDir, 'public', 'template-figures', template.key)
	const written = await renderFigures(doc, model, figuresDir)
	console.log(`${written} figures → ${figuresDir}`)
}
