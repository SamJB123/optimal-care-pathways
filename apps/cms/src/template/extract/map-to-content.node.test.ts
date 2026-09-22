/**
 * Stage two against the real cancer template: the grammar the mapper reads off the model
 * (instruction colour, boxes, variants, timeframes, placeholders, addresses) checked on
 * the pages the audit compared with the rendered PDF. Each test pins a page the mapper
 * once got wrong.
 */

import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { JsonNode } from '#/content/schema.ts'
import { templateByKey } from '../templates.ts'
import { mapTemplate } from './map-to-content.ts'
import { openPdf } from './pdf-page.ts'
import { readDocument } from './read-document.ts'

const SOURCE = 'Attachment-B-Optimal-Care-Pathway-for-people-with-x-cancer-template_1784776024.pdf'
const path = join(import.meta.dirname, '..', '..', '..', 'template', '2026', 'source', SOURCE)

let result: ReturnType<typeof mapTemplate>

beforeAll(async () => {
	const doc = await openPdf(path)
	const model = await readDocument(doc, SOURCE)
	result = mapTemplate({
		model,
		template: templateByKey('cancer-template'),
		orgId: 'test-org',
		id: (kind, key) => `${kind}:${key}`,
	})
}, 60_000)

const section = (address: string) => {
	const row = result.sections.find((s) => s.address === address)
	if (!row) throw new Error(`no section at ${address}`)
	return row
}
const body = (address: string): JsonNode[] => section(address).bodyJson.content ?? []

const walk = (nodes: JsonNode[], visit: (n: JsonNode) => void): void => {
	for (const n of nodes) {
		visit(n)
		if (n.content) walk(n.content, visit)
	}
}
const find = (nodes: JsonNode[], type: string): JsonNode[] => {
	const out: JsonNode[] = []
	walk(nodes, (n) => {
		if (n.type === type) out.push(n)
	})
	return out
}
const textOf = (nodes: JsonNode[]): string => {
	let out = ''
	walk(nodes, (n) => {
		if (n.type === 'text') out += n.text ?? ''
	})
	return out
}
const marked = (nodes: JsonNode[], mark: string): string[] => {
	const out: string[] = []
	walk(nodes, (n) => {
		if (n.type === 'text' && n.marks?.some((m) => m.type === mark)) out.push(n.text ?? '')
	})
	return out
}

describe('stage two: the cancer template mapped to the content schema', () => {
	it('learns the instruction colour from the pen boxes and folds instructions into guidance', () => {
		expect(result.stats.guidance).toBeGreaterThan(150)
		// p.11: every "Complete the box" line is guidance, the key table keeps its labels.
		const epidemiology = body('about-this-cancer/epidemiology-and-burden-of-disease')
		const [box] = find(epidemiology, 'box')
		expect(box?.attrs).toEqual({ kind: 'developer', icon: 'pen', family: '' })
		expect(textOf(find(box ? [box] : [], 'guidance').slice(0, 1))).toMatch(/^Complete the boxes/)
		const [table] = find(epidemiology, 'table')
		expect(table?.content?.length).toBe(6)
		expect(textOf(find(table ? [table] : [], 'tableHeaderCell'))).toContain('Incidence')
	})

	it('addresses steps and numbered sections and strips the number from the title', () => {
		expect(section('1').title).toBe('Prevention, screening and early detection')
		expect(section('1').printedNumber).toBe('Step 1')
		expect(section('1.1.1').title).toBe('Risk factors')
		expect(section('1.1.1').parentId).toBe(section('1.1').id)
		expect(section('1.1').parentId).toBe(section('1').id)
		expect(section('1.1.1').pathwayOwnership).toBe('owned')
		expect(section('1.1').pathwayOwnership).toBe('shared')
	})

	it('reads "Or" rows as variants, with the heading rows outside and guidance-only alternatives kept (p.13–14)', () => {
		// 1.1.1: banner, then [guidance bullets] OR [statement].
		const [riskBox] = find(body('1.1.1'), 'box')
		const [variants] = find(riskBox ? [riskBox] : [], 'variants')
		expect(riskBox?.content?.map((n) => n.type)).toEqual(['guidance', 'banner', 'variants'])
		expect(variants?.content?.length).toBe(2)
		expect(variants?.content?.[0]?.content?.map((n) => n.type)).toEqual(['guidance'])
		expect(textOf(variants?.content?.[1]?.content ?? [])).toBe(
			'The causes of [cancer type] are not fully understood.',
		)
		// 1.1.3: three alternatives, the third headed by its own banner.
		const [geneticBox] = find(body('1.1.3'), 'box')
		const [geneticVariants] = find(geneticBox ? [geneticBox] : [], 'variants')
		expect(geneticVariants?.content?.length).toBe(3)
		expect(geneticVariants?.content?.[2]?.content?.[0]?.type).toBe('banner')
	})

	it('marks highlights as placeholders including their brackets, and never the shading behind a line (pp.12, 36)', () => {
		const snapshot = body('snapshot-of-optimal-timeframes')
		const placeholders = marked(snapshot, 'placeholder')
		expect(placeholders).toContain('[insert OCP name]')
		expect(placeholders.some((p) => p.startsWith('Shorter timeframes'))).toBe(false)
		// p.21: "within [insert timeframe]" — the highlight started a glyph into the word
		// in the drawing, and the bracket sat outside it.
		expect(marked(body('2.3'), 'placeholder')).toContain('[insert timeframe]')
		const summary = body('4.3.1')
		const summaryPlaceholders = marked(summary, 'placeholder')
		expect(summaryPlaceholders).toContain('Surgery')
		expect(summaryPlaceholders).toContain('[cancer type]')
		expect(summaryPlaceholders.some((p) => p.startsWith('Select from the list'))).toBe(false)
		// The pen box guidance is guidance, not a placeholder.
		expect(textOf(find(summary, 'guidance'))).toContain(
			'Select from the list of treatment modalities',
		)
	})

	it('keeps a callout Word stacked under a developer box as a box of its own (p.12)', () => {
		const snapshot = body('snapshot-of-optimal-timeframes')
		const boxes = find(snapshot, 'box')
		expect(boxes.map((b) => b.attrs?.kind)).toEqual(['developer', 'callout'])
		expect(textOf(boxes[1] ? [boxes[1]] : [])).toMatch(/^Notes on timeframes/)
	})

	it('joins a box broken over a page break and a table butted against a box (pp.26–27, 35–36)', () => {
		const germline = body('3.2.1')
		const actions = find(germline, 'box').filter((b) => b.attrs?.kind === 'actions')
		expect(actions.length).toBe(1)
		const checks = find(actions, 'list').filter((l) => l.attrs?.kind === 'check')
		expect(checks.length).toBe(7)
		expect(textOf(checks[6] ? [checks[6]] : [])).toMatch(/^Document all discussions/)
		const prehab = body('4.2')
		const [prehabBox] = find(prehab, 'box').filter((b) => b.attrs?.kind === 'developer')
		const [alternatives] = find(prehabBox ? [prehabBox] : [], 'variants')
		expect(alternatives?.content?.length).toBe(2)
		expect(textOf(alternatives?.content?.[1]?.content ?? [])).toBe(
			'Prehabilitation is not relevant for [cancer type].',
		)
	})

	it('reads the stopwatch rows as timeframes, one per care point, over a merged icon cell (p.37)', () => {
		const timeframes = find(body('4.3.1'), 'timeframe')
		const carePoints = timeframes
			.map((t) => t.content?.[0])
			.filter((n): n is JsonNode => n !== undefined)
		expect(carePoints.map((c) => c.type)).toEqual(['carePoint', 'carePoint'])
		expect(carePoints.map((c) => textOf([c]))).toEqual([
			'Timeframe for treatment',
			'Timeframe for [treatment modality]',
		])
		// The second care point's placeholder survives as a mark, not flattened text.
		expect(marked(carePoints[1] ? [carePoints[1]] : [], 'placeholder')).toEqual([
			'[treatment modality]',
		])
		expect(marked(timeframes[0] ? [timeframes[0]] : [], 'placeholder')).toEqual([
			'[timeframe]',
			'[specialist referral, multidisciplinary team meeting]',
		])
	})

	it('replaces the snapshot schematic with the derived node and keeps its notes (p.12)', () => {
		const snapshot = body('snapshot-of-optimal-timeframes')
		expect(find(snapshot, 'table')).toEqual([])
		expect(snapshot.at(-1)?.type).toBe('timeframeSnapshot')
		expect(find(snapshot, 'box').map((b) => b.attrs?.kind)).toEqual(['developer', 'callout'])
	})

	it('keeps footnotes and citations as atoms, with the prose spacing intact (p.13)', () => {
		const [first] = body('1.1.1')
		expect(first?.type).toBe('paragraph')
		expect(first?.content?.map((n) => n.type)).toEqual([
			'text',
			'footnote',
			'text',
			'citation',
			'text',
			'citation',
		])
		expect(first?.content?.[2]?.text).toBe(' risk factors for cancer include:')
		expect(first?.content?.[1]?.attrs?.text).toBe(
			'Not all risk factors are relevant for all cancer types',
		)
		expect(result.references.length).toBe(89)
		expect(result.references.find((r) => r.printedNumber === 22)?.citation).toMatch(
			/^Royal Australian College of General Practitioners\./,
		)
	})

	it('emits valid, non-empty bodies for every section', () => {
		for (const s of result.sections) {
			expect(s.bodyJson.type).toBe('doc')
			expect((s.bodyJson.content ?? []).length).toBeGreaterThan(0)
		}
	})
})
