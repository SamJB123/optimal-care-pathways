/**
 * The review diff in the Workers runtime: an annotated body is a valid body, carries
 * the insertion and deletion marks where the text changed, and an unchanged body is
 * reported unchanged.
 */

import { describe, expect, it } from 'vitest'
import { annotateChanges, bodyHash } from './diff.ts'
import type { JsonNode } from './schema.ts'
import { parseBody } from './schema.ts'

const para = (text: string): JsonNode => ({
	type: 'doc',
	content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const marksOf = (body: JsonNode, mark: string): string[] => {
	const out: string[] = []
	const walk = (n: JsonNode) => {
		if (n.type === 'text' && n.marks?.some((m) => m.type === mark)) out.push(n.text ?? '')
		for (const c of n.content ?? []) walk(c)
	}
	walk(body)
	return out
}

describe('annotateChanges', () => {
	it('reports an unchanged body unchanged', () => {
		const result = annotateChanges(para('Refer within two weeks.'), para('Refer within two weeks.'))
		expect(result.changed).toBe(false)
		expect(result.inserted).toBe(0)
	})

	it('marks a replaced word as a deletion beside an insertion, in one valid body', () => {
		const result = annotateChanges(
			para('Refer within two weeks of diagnosis.'),
			para('Refer within four weeks of diagnosis.'),
		)
		expect(result.changed).toBe(true)
		expect(marksOf(result.body, 'insertion').join('')).toContain('four')
		expect(marksOf(result.body, 'deletion').join('')).toContain('two')
		expect(() => parseBody(result.body)).not.toThrow()
	})

	it('treats a body never published as wholly inserted', () => {
		const result = annotateChanges(null, para('New section text.'))
		expect(marksOf(result.body, 'insertion')).toEqual(['New section text.'])
		expect(result.deleted).toBe(0)
	})

	it('puts a deleted paragraph back as a struck paragraph', () => {
		const before: JsonNode = {
			type: 'doc',
			content: [
				{ type: 'paragraph', content: [{ type: 'text', text: 'Kept.' }] },
				{ type: 'paragraph', content: [{ type: 'text', text: 'Removed entirely.' }] },
			],
		}
		const result = annotateChanges(before, para('Kept.'))
		expect(marksOf(result.body, 'deletion').join('')).toContain('Removed entirely.')
		expect(() => parseBody(result.body)).not.toThrow()
	})
})

describe('bodyHash', () => {
	it('is stable for equal bodies and differs when text differs', async () => {
		expect(await bodyHash(para('a'))).toBe(await bodyHash(para('a')))
		expect(await bodyHash(para('a'))).not.toBe(await bodyHash(para('b')))
		expect(await bodyHash(null)).toBe(
			await bodyHash({ type: 'doc', content: [{ type: 'paragraph' }] }),
		)
	})
})
