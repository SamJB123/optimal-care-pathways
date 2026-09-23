/**
 * `jsonOf` writes a node as ProseMirror's own `toJSON` does, key for key and in the same
 * order, so a body's stored JSON and its hash do not move. (Every seeded body is checked
 * the same way through the yjs round trip, yjs.node.test.ts.)
 */

import { describe, expect, it } from 'vitest'
import { type JsonNode, jsonOf, parseBody } from './schema.ts'

const body: JsonNode = {
	type: 'doc',
	content: [
		{ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Staging' }] },
		{
			type: 'paragraph',
			content: [
				{ type: 'text', text: 'Use ' },
				{ type: 'text', text: 'the scale', marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'https://example.org' } }] },
				{ type: 'text', text: '[insert scale]', marks: [{ type: 'placeholder', attrs: { label: '[insert scale]' } }] },
				{ type: 'citation', attrs: { referenceId: 'ref-1' } },
			],
		},
		{
			type: 'table',
			content: [
				{
					type: 'tableRow',
					content: [
						{
							type: 'tableCell',
							attrs: { colspan: 1, rowspan: 1, colwidth: [120] },
							content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Surgery' }] }],
						},
					],
				},
			],
		},
	],
}

describe('jsonOf', () => {
	it('writes what ProseMirror writes, key for key, a list-valued attribute included', () => {
		const node = parseBody(body)
		const theirs: unknown = node.toJSON()
		expect(JSON.stringify(jsonOf(node))).toBe(JSON.stringify(theirs))
		expect(JSON.stringify(jsonOf(node))).toContain('"colwidth":[120]')
	})
})
