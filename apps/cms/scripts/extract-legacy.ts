/**
 * Reads one legacy pathway PDF (untagged InDesign) into the extractor's document model
 * with the layout reader, and renders its figures to PNG:
 *
 *   pnpm exec tsx scripts/extract-legacy.ts <slug|all> [--pdf-dir <dir>] [--no-figures]
 *   → legacy/extracted/<slug>.model.json
 *   → public/legacy-figures/<slug>/p<page>-<n>.png
 *
 * The PDFs are read from public/legacy-sources by default (decision 139).
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_PATHWAYS, legacyBySlug } from '../src/legacy/catalogue.ts'
import { readLayoutDocument } from '../src/legacy/read-layout.ts'
import type { Block } from '../src/template/extract/model.ts'
import { openPdf } from '../src/template/extract/pdf-page.ts'
import { renderFigures } from '../src/template/extract/render-figures.ts'

const args = process.argv.slice(2)
const which = args[0]
if (!which) {
	console.error('usage: tsx scripts/extract-legacy.ts <slug|all> [--pdf-dir <dir>] [--no-figures]')
	process.exit(2)
}
const pdfDirFlag = args.indexOf('--pdf-dir')
const appDir = join(import.meta.dirname, '..')
const pdfDir = pdfDirFlag > 0 ? (args[pdfDirFlag + 1] ?? '') : join(appDir, 'public', 'legacy-sources')
const outDir = join(appDir, 'legacy', 'extracted')
mkdirSync(outDir, { recursive: true })

const targets = which === 'all' ? LEGACY_PATHWAYS : [legacyBySlug(which)].flatMap((p) => (p ? [p] : []))
if (targets.length === 0) {
	console.error(`unknown pathway "${which}"`)
	process.exit(2)
}

for (const pathway of targets) {
	const doc = await openPdf(join(pdfDir, pathway.file))
	const model = await readLayoutDocument(doc, pathway.file)
	writeFileSync(join(outDir, `${pathway.slug}.model.json`), `${JSON.stringify(model, null, '\t')}\n`)
	const counts = { sections: 0, paragraphs: 0, lists: 0, items: 0, tables: 0, figures: 0 }
	const countBlocks = (blocks: Block[]) => {
		for (const b of blocks) {
			if (b.kind === 'paragraph') counts.paragraphs++
			else if (b.kind === 'list') {
				counts.lists++
				for (const item of b.items) {
					counts.items++
					countBlocks(item.blocks)
				}
			} else if (b.kind === 'table') {
				counts.tables++
				for (const row of b.rows) for (const cell of row.cells) countBlocks(cell.blocks)
			} else counts.figures++
		}
	}
	const walk = (sections: typeof model.sections) => {
		for (const s of sections) {
			counts.sections++
			countBlocks(s.blocks)
			walk(s.children)
		}
	}
	countBlocks(model.front)
	walk(model.sections)
	console.log(
		`${pathway.slug}: "${model.title}" ${model.pages} pages, ${counts.sections} sections, ${counts.paragraphs} paragraphs, ${counts.lists} lists (${counts.items} items), ${counts.tables} tables, ${counts.figures} figures, ${model.footnotes.length} footnotes, ${model.warnings.length} warnings`,
	)
	if (!args.includes('--no-figures')) {
		const written = await renderFigures(doc, model, join(appDir, 'public', 'legacy-figures', pathway.slug))
		console.log(`  ${written} figures rendered`)
	}
}
