/**
 * The seed against the real template files: every body satisfies the content schema,
 * the verified structure survives (sections, tick rows, endnotes and their markers), and
 * the pieces the builder re-assembles (timeframes, guidance, links inside sentences)
 * come out where the template put them.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { type JsonNode, parseBody } from '#/content/schema.ts'
import { deterministicId } from '../../scripts/ids.ts'
import type { CanonicalTemplate, InlineRuns } from './canonical.ts'
import {
	isApparatus,
	knownWords,
	recordText,
	repairSpacing,
	type SeedResult,
	seedTemplate,
	templateIdFor,
} from './seed.ts'

const read = <T>(name: string): T =>
	JSON.parse(readFileSync(new URL(`../../template/2026/${name}`, import.meta.url), 'utf8')) as T

const inlineOf = (doc: string): InlineRuns => read<InlineRuns>(`${doc}.inline.json`)

const seed = (doc: string): { canonical: CanonicalTemplate; result: SeedResult } => {
	const canonical = read<CanonicalTemplate>(`${doc}.tagged-canonical.json`)
	return {
		canonical,
		result: seedTemplate({
			canonical,
			inline: inlineOf(doc),
			orgId: 'org-test',
			id: deterministicId,
		}),
	}
}

/** The longest stretch of `text` that is not one of `parts` (a paragraph's own words). */
const longestSegment = (text: string, parts: string[]): string => {
	let cursor = 0
	let best = ''
	for (const part of parts) {
		const at = text.indexOf(part, cursor)
		if (at < 0) continue
		const segment = text.slice(cursor, at).trim()
		if (segment.length > best.length) best = segment
		cursor = at + part.length
	}
	const tail = text.slice(cursor).trim()
	return tail.length > best.length ? tail : best
}

const walk = (node: JsonNode, visit: (n: JsonNode) => void) => {
	visit(node)
	for (const child of node.content ?? []) walk(child, visit)
}
const count = (result: SeedResult, type: string) => {
	let n = 0
	for (const s of result.sections) walk(s.bodyJson, (node) => node.type === type && n++)
	return n
}
const plain = (node: JsonNode): string => node.text ?? (node.content ?? []).map(plain).join('')

describe.each(['cancer-template', 'population-template', 'principles'])('%s', (doc) => {
	const { canonical, result } = seed(doc)

	it('keeps the verified section set, one row per heading, addresses unique', () => {
		expect(result.sections).toHaveLength(canonical.sections.length)
		expect(new Set(result.sections.map((s) => s.address)).size).toBe(canonical.sections.length)
		const ids = new Set(result.sections.map((s) => s.id))
		for (const s of result.sections) if (s.parentId) expect(ids.has(s.parentId)).toBe(true)
	})

	it('builds a body the content schema accepts for every section', () => {
		for (const s of result.sections) expect(() => parseBody(s.bodyJson)).not.toThrow()
	})

	it('keeps every verified tick row as a check item', () => {
		let checks = 0
		for (const s of result.sections)
			walk(s.bodyJson, (n) => n.type === 'list' && n.attrs?.kind === 'check' && checks++)
		expect(checks).toBe(canonical.checklistItems.length)
	})

	it('keeps every endnote as a reference and every marker as a citation', () => {
		expect(result.references).toHaveLength(canonical.endnoteEntries.length)
		expect(count(result, 'citation')).toBe(canonical.endnoteMarkers.length)
		const referenceIds = new Set(result.references.map((r) => r.id))
		for (const s of result.sections)
			walk(s.bodyJson, (node) => {
				if (node.type === 'citation')
					expect(referenceIds.has(String(node.attrs?.referenceId))).toBe(true)
			})
	})

	it('loses no prose: every block text appears in its section body', () => {
		// What the builder consumes by design: list markers, citation numbers, the 'Or'
		// between timeframe alternatives, and the care-point label above a statement.
		const markerBlocks = new Set(canonical.endnoteMarkers.map((m) => m.blockEntryId))
		const carePoints = new Set(canonical.timeframeComponents.map((t) => t.carePoint.trim()))
		const bodyText = new Map(result.sections.map((s) => [s.address, plain(s.bodyJson)]))
		const sectionAddress = new Map(canonical.sections.map((s) => [s.entryId, s.address]))
		const known = knownWords(canonical)
		const sectionOf = new Map(canonical.sections.map((s) => [s.entryId, s]))
		const missing: string[] = []
		for (const b of canonical.blocks) {
			if (b.role === 'Lbl' || markerBlocks.has(b.entryId)) continue
			const record = inlineOf(doc)[String(b.sourceElement.seq)]
			const section = sectionOf.get(b.sectionEntryId)
			// A paragraph rebuilt from reading order: check its longest own-text segment.
			const needle = (
				record && section
					? longestSegment(
							recordText(record, b, section, known),
							record.parts.map((p) => repairSpacing(p.text)),
						)
					: b.textContent
			)
				.replace(/^[•✓✗–-]\s*/, '')
				.replace(/[\s,]*\d+\s*$/, (tail) => (markerBlocks.has(b.entryId) ? '' : tail))
				.trim()
			if (!needle || /^or$/i.test(needle) || carePoints.has(needle)) continue
			const haystack = bodyText.get(sectionAddress.get(b.sectionEntryId) ?? '') ?? ''
			if (!haystack.includes(needle)) missing.push(`${b.entryId}: ${needle.slice(0, 60)}`)
		}
		expect(missing).toEqual([])
	})

	it('flags the apparatus and nothing else', () => {
		const flagged = result.sections.filter((s) => s.apparatus).map((s) => s.address)
		expect(flagged.every(isApparatus)).toBe(true)
		expect(flagged.some((a) => a === 'contents' || a === 'cover/contents')).toBe(true)
		expect(
			result.sections
				.filter((s) => s.address.startsWith('find-out-more'))
				.every((s) => !s.apparatus),
		).toBe(true)
	})

	it('carries the template ownership rule onto each section', () => {
		const shared = canonical.sections.filter((s) => s.ownership === 'shared').length
		expect(result.sections.filter((s) => s.pathwayOwnership === 'shared')).toHaveLength(shared)
		expect(result.sections.every((s) => s.ownership === 'owned')).toBe(true)
	})
})

describe('cancer template specifics', () => {
	const { canonical, result } = seed('cancer-template')
	const section = (address: string) => {
		const row = result.sections.find((s) => s.address === address)
		if (!row) throw new Error(`no section ${address}`)
		return row
	}

	it('names the template by kind and consultation month', () => {
		expect(result.template.id).toBe('cancer-2026-07')
		expect(templateIdFor('principles', '20 July 2026')).toBe('principles-2026-07')
		expect(result.document.slug).toBe('core-cancer')
	})

	it('folds the timeframe label and its alternatives into one timeframe box', () => {
		const body = section('2.1').bodyJson
		const boxes: JsonNode[] = []
		walk(body, (n) => n.type === 'timeframe' && boxes.push(n))
		expect(boxes).toHaveLength(1)
		const [box] = boxes
		expect(box?.attrs?.carePoint).toBe('Timeframe for general practitioner (GP) consultation')
		expect(box?.content).toHaveLength(3)
		expect(plain(body)).not.toMatch(/\bOr\b/)
		const statementBlocks = new Set(
			canonical.timeframeComponents
				.filter((t) => t.carePoint !== 'Timeframe')
				.map((t) => t.blockEntryId),
		)
		expect(result.stats.timeframes).toBe(statementBlocks.size)
	})

	it('puts the developer prompts in guidance boxes, in place', () => {
		const body = section('2.1').bodyJson
		expect(body.content?.[0]?.type).toBe('guidance')
		expect(plain(body.content?.[0] ?? { type: 'doc' })).toContain(
			'Complete the appropriate box(es)',
		)
		expect(result.stats.guidance).toBeGreaterThan(100)
	})

	it('marks the editable slots as placeholders', () => {
		const body = section('2.1').bodyJson
		const labels: string[] = []
		walk(body, (n) => {
			for (const m of n.marks ?? [])
				if (m.type === 'placeholder') labels.push(String(m.attrs?.label))
		})
		expect(labels).toContain('[cancer type]')
		expect(labels).toContain('[insert weeks]')
	})

	it('puts a link back inside its sentence', () => {
		const about = section('about-optimal-care-pathways')
		const paragraphs = (about.bodyJson.content ?? []).filter((n) => n.type === 'paragraph')
		const withLink = paragraphs.find((p) =>
			p.content?.some((r) => r.marks?.some((m) => m.type === 'link')),
		)
		expect(withLink).toBeDefined()
		const text = plain(withLink ?? { type: 'doc' })
		expect(text).toContain('embedded within the Australian Cancer Plan as national standards')
		expect(text).toContain('guided by the National Optimal Care Pathways Framework, which')
		const linked = (withLink?.content ?? [])
			.filter((r) => r.marks?.some((m) => m.type === 'link'))
			.map((r) => r.text)
			.join('')
		expect(linked).toContain('National Optimal Care Pathways Framework')
		// 379 resource rows, less the contents page (apparatus links) and split titles.
		expect(result.stats.links).toBeGreaterThan(250)
	})

	it('attaches a URL to a reference the References list linked', () => {
		expect(result.references.filter((r) => r.url).length).toBeGreaterThan(40)
		expect(result.references.find((r) => r.printedNumber === 22)?.url).toContain('racgp.org.au')
	})

	it('reads the References list as a reference per endnote, in printed order', () => {
		expect(result.references.map((r) => r.printedNumber)).toEqual(
			canonical.endnoteEntries.map((e) => e.printedNumber),
		)
	})
})
