/**
 * The content schema in the Workers runtime: the server parses, validates and renders
 * bodies there, so the ProseKit spec union must build without a DOM.
 */

import { describe, expect, it } from 'vitest'
import { contentSchema, emptyBody, parseBody } from './schema.ts'

describe('content schema (workerd)', () => {
	it('builds from the spec-only extension', () => {
		for (const name of [
			'paragraph',
			'heading',
			'list',
			'table',
			'image',
			'banner',
			'timeframe',
			'guidance',
			'citation',
		])
			expect(contentSchema.nodes[name], name).toBeDefined()
		for (const name of [
			'bold',
			'italic',
			'underline',
			'strike',
			'superscript',
			'subscript',
			'link',
			'placeholder',
			'sectionLink',
		])
			expect(contentSchema.marks[name], name).toBeDefined()
	})

	it('puts paragraph first, so empty containers fill without recursing', () => {
		const firstBlock = Object.values(contentSchema.nodes).find(
			(node) => node.isBlock && node.name !== 'doc',
		)
		expect(firstBlock?.name).toBe('paragraph')
		expect(contentSchema.topNodeType.createAndFill()?.firstChild?.type.name).toBe('paragraph')
		expect(contentSchema.nodes.guidance?.createAndFill()?.firstChild?.type.name).toBe('paragraph')
		expect(contentSchema.nodes.tableCell?.createAndFill()?.firstChild?.type.name).toBe('paragraph')
	})

	it('gives the list node the point-of-care attribute', () => {
		expect(contentSchema.nodes.list?.spec.attrs?.pointOfCare?.default).toBe(false)
	})

	it('accepts a template body and rejects a malformed one', () => {
		expect(() => parseBody(emptyBody())).not.toThrow()
		expect(() =>
			parseBody({
				type: 'doc',
				content: [
					{
						type: 'guidance',
						content: [
							{ type: 'paragraph', content: [{ type: 'text', text: 'Complete the timeframe' }] },
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
									{ type: 'text', text: 'Refer promptly' },
									{ type: 'citation', attrs: { referenceId: 'ref-1' } },
								],
							},
						],
					},
				],
			}),
		).not.toThrow()
		expect(() =>
			parseBody({ type: 'doc', content: [{ type: 'timeframe', content: [{ type: 'list' }] }] }),
		).toThrow()
	})
})
