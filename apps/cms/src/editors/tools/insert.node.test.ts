/**
 * Every Insert builder's JSON is content the schema accepts: a block builder's nodes as a
 * body of their own, an inline builder's inside a paragraph — where the editor puts them.
 */

import { describe, expect, it } from 'vitest'
import { contentSchema, type JsonNode, parseBody } from '#/content/schema.ts'
import * as insert from './insert.ts'

const isInline = (node: JsonNode): boolean => contentSchema.nodes[node.type]?.isInline ?? false

const asBody = (nodes: JsonNode[]): JsonNode =>
	nodes.every(isInline)
		? { type: 'doc', content: [{ type: 'paragraph', content: nodes }] }
		: { type: 'doc', content: nodes }

const builders: [string, () => JsonNode[]][] = [
	['box with a title', insert.boxWithTitle],
	['timeframe', insert.timeframe],
	['or alternative', insert.orAlternative],
	['find out more resource', insert.findOutMoreResource],
	['check item', insert.checkItem],
	['two columns', insert.twoColumns],
	['table', () => insert.table()],
	['table, 4 by 5', () => insert.table(4, 5)],
	['quote', insert.quote],
	['rule', insert.rule],
	['footnote', () => insert.footnote('  Adapted from the 2021 edition.  ')],
	['image', () => insert.image('/files/images/doc-1/abc.png', 'A flow chart of referral.')],
	['citation', () => insert.citation('ref-1')],
	['cross-reference', () => insert.crossReference('4.2 Diagnosis', '4.2')],
]

describe('insert builders', () => {
	it.each(builders)('%s passes the content schema', (_name, build) => {
		const nodes = build()
		expect(nodes.length).toBeGreaterThan(0)
		expect(() => parseBody(asBody(nodes))).not.toThrow()
	})

	it('builds a table with a header row and the asked-for body rows', () => {
		const [node] = insert.table()
		const parsed = parseBody(asBody([node ?? { type: 'paragraph' }]))
		const tableNode = parsed.firstChild
		expect(tableNode?.type.name).toBe('table')
		expect(tableNode?.childCount).toBe(3)
		expect(tableNode?.firstChild?.firstChild?.type.name).toBe('tableHeaderCell')
		expect(tableNode?.lastChild?.childCount).toBe(3)
		expect(tableNode?.lastChild?.firstChild?.type.name).toBe('tableCell')
	})

	it('makes a check item that is not yet marked for the guide', () => {
		const parsed = parseBody(asBody(insert.checkItem()))
		expect(parsed.firstChild?.attrs.kind).toBe('check')
		expect(parsed.firstChild?.attrs.pointOfCare).toBe(false)
	})

	it('trims a footnote and an image description', () => {
		expect(insert.footnote('  note ')[0]?.attrs?.text).toBe('note')
		expect(insert.image('/x.png', ' a chart ')[0]?.attrs?.alt).toBe('a chart')
	})
})
