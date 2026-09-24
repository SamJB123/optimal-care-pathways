/**
 * Open items in a body (content/derived.ts): guidance not ticked done, placeholders,
 * and a `variants` group (alternatives of which the author keeps one) count as open;
 * ticked guidance and a kept alternative do not.
 */

import { describe, expect, it } from 'vitest'
import { openChoicesIn, openItemsIn } from './derived.ts'
import type { JsonNode } from './schema.ts'

const text = (t: string, marks?: JsonNode['marks']): JsonNode => ({ type: 'text', text: t, marks })
const paragraph = (...content: JsonNode[]): JsonNode => ({ type: 'paragraph', content })
const doc = (...content: JsonNode[]): JsonNode => ({ type: 'doc', content })
const variants = (...alternatives: JsonNode[][]): JsonNode => ({
	type: 'variants',
	content: alternatives.map((content) => ({ type: 'variant', content })),
})

describe('open items', () => {
	it('counts an unchosen alternatives group once, with the guidance and placeholders around it', () => {
		const body = doc(
			{ type: 'guidance', attrs: { done: false }, content: [paragraph(text('Pick one.'))] },
			{ type: 'guidance', attrs: { done: true }, content: [paragraph(text('Done already.'))] },
			variants(
				[paragraph(text('Screening is offered from age 50.'))],
				[
					paragraph(
						text('Screening is not recommended for '),
						text('[cancer type]', [{ type: 'placeholder', attrs: { label: '[cancer type]' } }]),
					),
				],
			),
		)
		expect(openChoicesIn(body)).toBe(1)
		// The open guidance, the placeholder inside an alternative, and the choice itself.
		expect(openItemsIn(body)).toBe(3)
	})

	it('a kept alternative leaves no choice open', () => {
		const body = doc(paragraph(text('Screening is not recommended.')))
		expect(openChoicesIn(body)).toBe(0)
		expect(openItemsIn(body)).toBe(0)
		expect(openChoicesIn(null)).toBe(0)
	})

	it('a group nested in a box or a timeframe counts too', () => {
		const body = doc({
			type: 'box',
			attrs: { kind: 'developer', icon: 'pen', family: '', variant: 'soft' },
			content: [
				{ type: 'banner', attrs: { tone: 'band' }, content: [text('Population-based screening')] },
				variants([paragraph(text('A'))], [paragraph(text('B'))], [paragraph(text('C'))]),
			],
		})
		expect(openChoicesIn(body)).toBe(1)
	})
})
