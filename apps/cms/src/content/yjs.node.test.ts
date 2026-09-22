/**
 * Resting form ↔ live form, over every seeded section body: a body hydrated into a yjs
 * root and read back must be the same node tree. This is what makes D1 the truth and
 * the room rebuildable from it.
 */

import { readFileSync } from 'node:fs'
import { Doc } from '@y/y'
import { describe, expect, it } from 'vitest'
import { mapTemplate } from '#/template/extract/map-to-content.ts'
import type { ExtractedDocument } from '#/template/extract/model.ts'
import { TEMPLATES } from '#/template/templates.ts'
import { deterministicId } from '../../scripts/ids.ts'
import { type JsonNode, parseBody } from './schema.ts'
import { bodyFromRoot, hydrateRoot } from './yjs.ts'

const readModel = (key: string): ExtractedDocument =>
	JSON.parse(readFileSync(new URL(`../../template/2026/extracted/${key}.model.json`, import.meta.url), 'utf8'))

const roundTrip = (body: JsonNode): JsonNode => {
	const doc = new Doc()
	hydrateRoot(doc.get(''), body)
	return bodyFromRoot(doc.get(''))
}

describe('yjs round trip', () => {
	it('keeps a hand-built body with every block kind', () => {
		const body: JsonNode = {
			type: 'doc',
			content: [
				{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Staging' }] },
				{
					type: 'box',
					attrs: { kind: 'developer', icon: 'pen' },
					content: [
						{ type: 'banner', content: [{ type: 'text', text: 'Signs and symptoms' }] },
						{
							type: 'guidance',
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Complete the timeframe' }] }],
						},
						{
							type: 'variants',
							content: [
								{ type: 'variant', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Option one' }] }] },
								{ type: 'variant', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Option two' }] }] },
							],
						},
					],
				},
				{
					type: 'timeframe',
					attrs: { carePoint: 'Timeframe for treatment' },
					content: [
						{
							type: 'paragraph',
							content: [
								{ type: 'text', text: 'Treatment should start within ' },
								{
									type: 'text',
									text: '[timeframe]',
									marks: [{ type: 'placeholder', attrs: { label: '[timeframe]' } }],
								},
								{ type: 'citation', attrs: { referenceId: 'ref-7' } },
								{ type: 'footnote', attrs: { text: 'Not all risk factors are relevant for all cancer types' } },
							],
						},
					],
				},
				{
					type: 'list',
					attrs: { kind: 'check', pointOfCare: true },
					content: [
						{
							type: 'paragraph',
							content: [
								{ type: 'text', text: 'Refer ', marks: [{ type: 'bold' }] },
								{ type: 'text', text: 'promptly' },
								{ type: 'text', text: ' <for one OCP only>', marks: [{ type: 'instruction' }] },
							],
						},
						{
							type: 'list',
							attrs: { kind: 'bullet' },
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sub item' }] }],
						},
					],
				},
				{
					type: 'table',
					content: [
						{
							type: 'tableRow',
							content: [
								{
									type: 'tableHeaderCell',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Modality' }] }],
								},
								{
									type: 'tableCell',
									content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Surgery' }] }],
								},
							],
						},
					],
				},
				{ type: 'image', attrs: { src: '/template-figures/cancer-template/p9-1.png', alt: 'Steps of the pathway' } },
				{
					type: 'paragraph',
					content: [
						{ type: 'text', text: 'See ' },
						{
							type: 'text',
							text: 'section 3.2',
							marks: [{ type: 'sectionLink', attrs: { address: '3.2' } }],
						},
						{ type: 'text', text: ' and ' },
						{
							type: 'text',
							text: 'the plan',
							marks: [{ type: 'link', attrs: { href: 'https://example.org' } }],
						},
					],
				},
			],
		}
		expect(roundTrip(body)).toEqual(parseBody(body).toJSON())
	})

	describe.each(TEMPLATES.map((t) => t.key))('%s', (key) => {
		it('keeps every seeded section body', () => {
			const template = TEMPLATES.find((t) => t.key === key)
			if (!template) throw new Error(key)
			const { sections } = mapTemplate({ model: readModel(key), template, orgId: 'org-test', id: deterministicId })
			const mismatches: string[] = []
			for (const section of sections) {
				const expected = parseBody(section.bodyJson).toJSON()
				const actual = roundTrip(section.bodyJson)
				if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push(section.address)
			}
			expect(mismatches).toEqual([])
		})
	})
})
