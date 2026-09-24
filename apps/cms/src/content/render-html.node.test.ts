/**
 * The published outputs (decision 97) over the real renderer: the HTML is the Solid
 * body renderer run to a string (citations numbered, marks as their elements), and the
 * Markdown writer gives the partner site the same content as text.
 */

import { describe, expect, it } from 'vitest'
import type { DerivedView } from './derived.ts'
import { bodyToMarkdown } from './markdown.ts'
import { renderBodyHtml } from './render-html.tsx'
import type { JsonNode } from './schema.ts'

const body: JsonNode = {
	type: 'doc',
	content: [
		{ type: 'banner', content: [{ type: 'text', text: 'Signs and symptoms' }] },
		{
			type: 'paragraph',
			content: [
				{ type: 'text', text: 'Refer people with ' },
				{ type: 'text', text: 'breast cancer', marks: [{ type: 'bold' }] },
				{ type: 'text', text: ' promptly.' },
				{ type: 'citation', attrs: { referenceId: 'ref-a' } },
			],
		},
		{
			type: 'list',
			attrs: { kind: 'check' },
			content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Screen for distress' }] }],
		},
		{
			type: 'resourceList',
			content: [
				{
					type: 'resource',
					attrs: { title: 'eviQ', url: 'https://www.eviq.org.au' },
					content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Protocols.' }] }],
				},
			],
		},
	],
}

const derived: DerivedView = { referenceNumbers: { 'ref-a': 1 }, timeframes: [], map: null }

describe('renderBodyHtml', () => {
	it('renders the body with the site’s components and numbered citations', () => {
		const html = renderBodyHtml(body, derived)
		expect(html).toContain('class="ocp-body ocp-body-static"')
		expect(html).toContain('<strong>breast cancer</strong>')
		expect(html).toContain('data-number="1"')
		expect(html).toContain('data-list-kind="check"')
		expect(html).toContain('Signs and symptoms')
	})

	it('marks a link whose words are its own address, scheme or not', () => {
		const link = (text: string, href: string): JsonNode => ({
			type: 'paragraph',
			content: [{ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] }],
		})
		const html = renderBodyHtml(
			{
				type: 'doc',
				content: [
					link('https://www.vics.org.au/pics', 'https://www.vics.org.au/pics'),
					link('www.allg.org.au', 'http://www.allg.org.au/'),
					link('the ALLG site', 'http://www.allg.org.au/'),
				],
			},
			derived,
		)
		expect(html.match(/data-url-text/g)?.length).toBe(2)
		expect(html).toMatch(/<a[^>]*href="http:\/\/www\.allg\.org\.au\/"[^>]*>the ALLG site<\/a>/)
		expect(html).not.toMatch(/<a[^>]*data-url-text[^>]*>the ALLG site/)
	})

	it('carries a table’s dragged column widths as a colgroup', () => {
		const cell = (text: string, colwidth: number[] | null): JsonNode => ({
			type: 'tableCell',
			attrs: { colspan: 1, rowspan: 1, colwidth },
			content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
		})
		const table: JsonNode = {
			type: 'doc',
			content: [
				{
					type: 'table',
					content: [
						{ type: 'tableRow', content: [cell('Label', [160]), cell('Value', null)] },
						{ type: 'tableRow', content: [cell('A', null), cell('B', null)] },
					],
				},
			],
		}
		const html = renderBodyHtml(table, derived)
		expect(html).toMatch(/<colgroup><col style="width:\s*160px"><col[^>]*><\/colgroup>/)
	})
})

describe('bodyToMarkdown', () => {
	it('writes the nearest Markdown a reader would', () => {
		const md = bodyToMarkdown(body, derived)
		expect(md).toContain('**Signs and symptoms**')
		expect(md).toContain('Refer people with **breast cancer** promptly.[^1]')
		// An action row, not a task: never "[x]" (done) or "[ ]" (to do).
		expect(md).toContain('- ✓ Screen for distress')
		expect(md).not.toMatch(/- \[[ x]\]/)
		expect(md).toContain('[eviQ](https://www.eviq.org.au) — Protocols.')
	})
})
