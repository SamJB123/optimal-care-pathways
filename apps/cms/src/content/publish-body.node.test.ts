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
import { parseBody } from './schema.ts'

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
	}
})
