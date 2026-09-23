/**
 * Per-pathway fixtures for the legacy import (decision 150), all 33 pathways. For each one
 * the test reads the extracted model, maps it and audits it against the PDF, then:
 *
 * - holds three things absolutely: every printed word placed once (coverage 0 missing,
 *   0 extra), every Figure 3 row a timeframe box, and every citation either resolved or
 *   an exception with its reason;
 * - compares what the import is — the printed outline, the construct counts, the Figure 3
 *   rows, the citation exceptions and year slips — with the committed fixture at
 *   `legacy/fixtures/<slug>.json`, so any change to the reader or the mapper shows up as a
 *   diff to read against the page before the fixture is updated (`vitest -u`).
 *
 * Needs `legacy/extracted/<slug>.model.json` (pnpm legacy:extract); a pathway whose model
 * is missing is skipped.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deterministicId } from '../../scripts/ids.ts'
import { mapTemplate } from '../template/extract/map-to-content.ts'
import type { Block, ExtractedDocument, Section } from '../template/extract/model.ts'
import { openPdf } from '../template/extract/pdf-page.ts'
import { TEMPLATES } from '../template/templates.ts'
import { auditCoverage } from './audit.ts'
import { LEGACY_PATHWAYS } from './catalogue.ts'
import { mapLegacy } from './map-legacy.ts'

const appDir = join(import.meta.dirname, '..', '..')
const read = (path: string): ExtractedDocument => JSON.parse(readFileSync(join(appDir, path), 'utf8'))
const modelPathOf = (slug: string) => `legacy/extracted/${slug}.model.json`

const cores = new Map(
	TEMPLATES.filter((t) => t.kind !== 'principles').map((t) => [t.kind, () => mapTemplate({ model: read(`template/2026/extracted/${t.key}.model.json`), template: t, orgId: 'central', id: deterministicId })]),
)

/** Counts of each printed construct the model carries. */
function constructsOf(model: ExtractedDocument) {
	const counts = { sections: 0, paragraphs: 0, lists: 0, listItems: 0, checkItems: 0, tables: 0, tableRows: 0, figures: 0, footnotes: model.footnotes.length, endnotes: model.endnotes.length }
	const blocks = (list: Block[]) => {
		for (const b of list) {
			if (b.kind === 'paragraph') counts.paragraphs++
			else if (b.kind === 'figure') counts.figures++
			else if (b.kind === 'list') {
				counts.lists++
				for (const item of b.items) {
					counts.listItems++
					if (item.marker === 'check') counts.checkItems++
					blocks(item.blocks)
				}
			} else {
				counts.tables++
				counts.tableRows += b.rows.length
				for (const row of b.rows) for (const cell of row.cells) blocks(cell.blocks)
			}
		}
	}
	const sections = (list: Section[]) => {
		for (const s of list) {
			counts.sections++
			blocks(s.blocks)
			sections(s.children)
		}
	}
	blocks(model.front)
	sections(model.sections)
	for (const f of model.footnotes) blocks(f.blocks)
	return counts
}

/** The printed outline: one line per heading, its level as indentation. */
function spineOf(sections: Section[], out: string[] = []): string[] {
	for (const s of sections) {
		out.push(`${'  '.repeat(Math.max(0, s.level - 1))}${s.headingText} (p.${s.page})`)
		spineOf(s.children, out)
	}
	return out
}

const distinct = (values: string[]) => [...new Set(values)].sort()

for (const pathway of LEGACY_PATHWAYS) {
	const modelPath = modelPathOf(pathway.slug)
	describe.skipIf(!existsSync(join(appDir, modelPath)))(`legacy fixture: ${pathway.slug}`, () => {
		it('matches the page and its committed fixture', { timeout: 300_000 }, async () => {
			const model = read(modelPath)
			const core = cores.get(pathway.audience)?.()
			if (!core) throw new Error(`no template core for ${pathway.audience}`)
			const result = mapLegacy({ model, pathway, core, id: deterministicId, orgId: `pending:${pathway.pathwaySlug}`, actorId: 'test' })
			const report = await auditCoverage(await openPdf(join(appDir, 'public', 'legacy-sources', pathway.file)), model)

			// Every printed word placed once.
			expect(report.missingLines.map((l) => `p.${l.page} ${l.missing.join(' ')} ← ${l.text}`)).toEqual([])
			expect(report.extras.map((e) => `${e.word}×${e.count}`)).toEqual([])
			// Every Figure 3 row is a timeframe box: the body's own, or one made from the row.
			expect(result.ledger.timeframes.rows.filter((r) => r.source === 'row' && r.destination === null)).toEqual([])
			// Every citation resolves or is an exception whose reason the ledger gives.
			for (const u of result.ledger.citations.unmatched) expect(u).toMatch(/ — "[^"]+": (?:no entry in the printed reference list|the list has )/)

			const fixture = {
				slug: pathway.slug,
				pages: model.pages,
				edition: result.legacyDocument.edition,
				constructs: constructsOf(model),
				references: result.references.length,
				coverage: { printed: report.printed, figureLines: report.figureLines.length },
				timeframes: {
					figureRows: result.ledger.timeframes.figureRows,
					boxes: result.ledger.timeframes.boxes,
					rows: result.ledger.timeframes.rows.map((r) => `Step ${r.step ?? '?'} · ${r.carePoint} · ${r.source === 'body' ? 'body box' : `box from the row → ${r.destination}`}`),
				},
				citations: {
					matched: result.ledger.citations.matched,
					exceptions: distinct(result.ledger.citations.unmatched),
					yearSlips: distinct(result.ledger.citations.byName),
				},
				spine: spineOf(model.sections),
			}
			await expect(`${JSON.stringify(fixture, null, '\t')}\n`).toMatchFileSnapshot(join(appDir, 'legacy', 'fixtures', `${pathway.slug}.json`))
		})
	})
}
