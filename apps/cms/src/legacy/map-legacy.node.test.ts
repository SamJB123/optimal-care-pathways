/**
 * The legacy import on the breast cancer pathway (the design-2021 family's exemplar,
 * decision 133): every body the seed writes parses against the content schema; the
 * scaffold is the template's; the placements the visual pass settled hold; citations
 * resolve; the published edition is complete.
 *
 * Needs `legacy/extracted/breast-cancer-2nd-edition.model.json` (pnpm legacy:extract).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deterministicId } from '../../scripts/ids.ts'
import { parseBody } from '../content/schema.ts'
import { mapTemplate } from '../template/extract/map-to-content.ts'
import type { ExtractedDocument } from '../template/extract/model.ts'
import { templateByKey } from '../template/templates.ts'
import { legacyBySlug } from './catalogue.ts'
import { type LegacyImport, mapLegacy } from './map-legacy.ts'

const appDir = join(import.meta.dirname, '..', '..')
const read = (path: string): ExtractedDocument => JSON.parse(readFileSync(join(appDir, path), 'utf8'))
const modelPath = 'legacy/extracted/breast-cancer-2nd-edition.model.json'

describe.skipIf(!existsSync(join(appDir, modelPath)))('legacy import: breast cancer (second edition)', () => {
	const pathway = legacyBySlug('breast-cancer-2nd-edition')
	if (!pathway) throw new Error('catalogue entry missing')
	const core = mapTemplate({ model: read('template/2026/extracted/cancer-template.model.json'), template: templateByKey('cancer-template'), orgId: 'central', id: deterministicId })
	const result: LegacyImport = mapLegacy({ model: read(modelPath), pathway, core, id: deterministicId, orgId: 'pending:breast-cancer', actorId: 'test' })

	it('writes bodies the content schema accepts, everywhere', () => {
		for (const s of result.sections) if (s.bodyJson) parseBody(s.bodyJson)
		for (const s of result.legacySections) parseBody(s.bodyJson)
		for (const s of result.versionSections) if (s.bodyJson) parseBody(s.bodyJson)
	})

	it('scaffolds the pathway from the template spine and keeps shared sections shared', () => {
		const addresses = new Set(result.sections.map((s) => s.address))
		for (const c of core.sections.filter((s) => !s.apparatus)) expect(addresses.has(c.address)).toBe(true)
		const shared = result.sections.filter((s) => s.ownership === 'shared')
		expect(shared.length).toBe(core.sections.filter((s) => !s.apparatus && s.pathwayOwnership === 'shared').length)
		for (const s of shared) {
			expect(s.bodyJson).toBeNull()
			expect(s.coreSectionId).toBeTruthy()
		}
		expect(new Set(result.sections.map((s) => s.address)).size).toBe(result.sections.length)
		expect(new Set(result.sections.map((s) => s.id)).size).toBe(result.sections.length)
		for (const s of result.sections) if (s.parentId) expect(result.sections.some((p) => p.id === s.parentId)).toBe(true)
	})

	it('places the legacy step sections the visual pass settled', () => {
		const to = (key: string) => result.ledger.placements.filter((p) => p.legacyKey === key).map((p) => `${p.how}:${p.destination}`)
		expect(to('step-1/risk-factors-for-female-breast-cancer')).toEqual(['title:1.1.1'])
		expect(to('step-1/risk-reduction')).toEqual(['title:1.1.2'])
		expect(to('step-1/early-detection/screening-recommendations')).toEqual(['title:1.2.1'])
		expect(to('step-2/signs-and-symptoms')).toEqual(['title:2.1'])
		expect(to('step-2/initial-referral')).toEqual(['title:2.3'])
		expect(to('step-3/staging-investigations-for-distant-disease')).toEqual(['title:3.3'])
		expect(to('step-3/performance-status')).toEqual(['title:3.4'])
		expect(to('step-4/treatment-options/surgery')).toEqual(['title:4.4.1'])
		expect(to('step-4/treatment-options/radiation-therapy')).toEqual(['title:4.4.2'])
		expect(to('step-6/advance-care-planning')).toEqual(['title:6.7'])
		expect(to('step-6/palliative-care')).toEqual(['title:6.6'])
		// Every step's supportive care goes to the template's per-step section.
		for (const n of [2, 3, 4, 5, 6, 7]) expect(to(`step-${n}/support-and-communication/supportive-care`)).toEqual([`title:${n}/supportive-care`])
		// A shared match keeps the core text and puts the legacy text beside it, flagged.
		expect(to('step-1/prevention')).toEqual(['provenance:1.1', 'proposed:1.1/prevention'])
		// What the template has no slot for is appended under its step and flagged.
		const unplaced = result.sections.filter((s) => s.migrationNote?.startsWith('unplaced'))
		expect(unplaced.map((s) => s.address)).toContain('3/research-and-clinical-trials')
		expect(unplaced.map((s) => s.address)).toContain('1/risk-assessment-tools')
		for (const s of unplaced) {
			expect(s.canonical).toBe(false)
			expect(s.ownership).toBe('owned')
		}
	})

	it('turns timeframe subsections into timeframe boxes and checklists into point-of-care items', () => {
		const body = (address: string) => result.sections.find((s) => s.address === address)?.bodyJson
		const types = (node: unknown): string[] => {
			const out: string[] = []
			const walk = (n: { type: string; content?: unknown[] }) => {
				out.push(n.type)
				for (const c of n.content ?? []) walk(c as { type: string; content?: unknown[] })
			}
			walk(node as { type: string; content?: unknown[] })
			return out
		}
		expect(types(body('2.1'))).toContain('timeframe')
		expect(types(body('4.4.1'))).toContain('timeframe')
		expect(result.ledger.timeframes.boxes).toBeGreaterThanOrEqual(7)
		for (const n of [1, 2, 3, 4, 5, 6, 7]) {
			const checklist = result.sections.find((s) => s.address === `${n}/checklist`)
			expect(checklist?.pointOfCare).toBe(true)
			const lists = JSON.stringify(checklist?.bodyJson)
			expect(lists).toContain('"pointOfCare":true')
		}
	})

	it('reads the references and resolves the author–year citations', () => {
		expect(result.references.length).toBeGreaterThan(80)
		expect(result.ledger.citations.matched).toBeGreaterThan(180)
		expect(result.ledger.citations.unmatched.length).toBeLessThan(12)
		// The legacy bodies cite legacy references only (the template scaffold's own
		// bodies cite the core's rows, which is right: shared content is stored once).
		const cited = new Set<string>()
		const walk = (n: { type: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
			if (n.type === 'citation' && typeof n.attrs?.referenceId === 'string') cited.add(n.attrs.referenceId)
			for (const c of n.content ?? []) walk(c as { type: string; attrs?: Record<string, unknown>; content?: unknown[] })
		}
		for (const s of result.legacySections) if (s.bodyJson) walk(s.bodyJson)
		expect(cited.size).toBeGreaterThan(60)
		const ids = new Set(result.references.map((r) => r.id))
		for (const id of cited) expect(ids.has(id)).toBe(true)
	})

	it('publishes the legacy edition as version 1 and opens version 2 as the draft', () => {
		const [v1, v2] = result.versions
		expect(v1?.status).toBe('published')
		expect(v1?.versionNo).toBe(1)
		expect(v1?.label).toBe('Second edition')
		expect(v1?.publishedAt?.toISOString().slice(0, 7)).toBe('2021-06')
		expect(v2?.status).toBe('draft')
		expect(v2?.versionNo).toBe(2)
		expect(result.versionSections.length).toBe(result.legacySections.length)
		expect(result.versionSections.filter((s) => s.hidden).map((s) => s.address)).toEqual(['contents'])
		expect(result.legacyDocument.edition).toBe('Second edition')
		expect(result.document.slug).toBe('breast-cancer')
	})

	it('records where every placed body came from', () => {
		const sectionIds = new Set(result.sections.map((s) => s.id))
		const legacyIds = new Set(result.legacySections.map((s) => s.id))
		for (const o of result.origins) {
			expect(sectionIds.has(o.sectionId)).toBe(true)
			expect(legacyIds.has(o.legacySectionId)).toBe(true)
		}
		// Every legacy section is accounted for: placed, provenance, merged or derived.
		const seen = new Set(result.ledger.placements.map((p) => p.legacyKey))
		for (const s of result.legacySections) expect(seen.has(s.key ?? '')).toBe(true)
	})
})
