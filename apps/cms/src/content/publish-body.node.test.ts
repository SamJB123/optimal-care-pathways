/**
 * The publishable form and the review diff over EVERY seeded template body: publishing
 * strips guidance and fills the subject without ever producing a document the schema
 * rejects, and every body diffs against nothing (first publication) into a valid
 * annotated body. What a page does for every section, proven on the real corpus.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mapTemplate } from '#/template/extract/map-to-content.ts'
import type { ExtractedDocument } from '#/template/extract/model.ts'
import { TEMPLATES } from '#/template/templates.ts'
import { deterministicId } from '../../scripts/ids.ts'
import { annotateChanges } from './diff.ts'
import { publishBody } from './publish.ts'
import { type JsonNode, parseBody } from './schema.ts'

const readModel = (key: string): ExtractedDocument =>
	JSON.parse(
		readFileSync(
			new URL(`../../template/2026/extracted/${key}.model.json`, import.meta.url),
			'utf8',
		),
	)

describe('publishable bodies and first-publication diffs over the seeded templates', () => {
	for (const template of TEMPLATES) {
		it(`${template.key}: every section publishes and diffs to a valid body`, () => {
			const mapped = mapTemplate({
				model: readModel(template.key),
				template,
				orgId: 'org-test',
				id: deterministicId,
			})
			const failures: string[] = []
			for (const section of mapped.sections) {
				if (!section.bodyJson) continue
				try {
					const publishable = publishBody(section.bodyJson, 'breast cancer')
					if (publishable) parseBody(publishable)
					const annotated = annotateChanges(null, publishable)
					parseBody(annotated.body)
				} catch (error) {
					failures.push(
						`${section.address}: ${error instanceof Error ? error.message : String(error)}`,
					)
				}
			}
			expect(failures).toEqual([])
		})

		it(`${template.key}: the developer instructions are apparatus, never a pathway's section`, () => {
			const mapped = mapTemplate({ model: readModel(template.key), template, orgId: 'org-test', id: deterministicId })
			const instructions = mapped.sections.filter((s) => /(^|\/)instructions-for-developers(\/|$)/.test(s.address))
			if (template.kind === 'principles') return
			expect(instructions.length).toBeGreaterThan(0)
			for (const s of instructions) expect(s.apparatus).toBe(true)
		})
	}
})

describe('subject placeholders', () => {
	const text = (label: string, written = label): JsonNode => ({
		type: 'doc',
		content: [{ type: 'paragraph', content: [{ type: 'text', text: 'For people with ' }, { type: 'text', text: written, marks: [{ type: 'placeholder', attrs: { label } }] }] }],
	})
	const filled = (label: string, written?: string) => {
		const body = text(label, written)
		parseBody(body)
		return JSON.stringify(publishBody(body, 'breast cancer'))
	}
	it('fill every form the templates write, the stop after it kept', () => {
		expect(filled('[cancer type]')).toContain('"text":"breast cancer"')
		expect(filled('[Cancer type]')).toContain('breast cancer')
		expect(filled('<cancer type>')).toContain('breast cancer')
		expect(filled('[insert cancer type]')).toContain('breast cancer')
		expect(filled('[cancer type].')).toContain('breast cancer.')
		expect(filled('[cancer type]')).not.toContain('placeholder')
	})
	it('leave every other placeholder for the author', () => {
		expect(filled('[insert timeframe]')).toContain('[insert timeframe]')
	})
})
