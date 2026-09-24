/**
 * What the Insert menu and the Cite and Link tools put into a section body: each builder
 * returns the JSON of the nodes to insert at the caret, in the content schema's own
 * terms (content/schema.ts). An empty text block is left empty for the author to write
 * in; the caret lands in the first one. `insert.node.test.ts` proves every builder's
 * output is a body the schema accepts.
 */

import type { JsonNode } from '#/content/schema.ts'

const paragraph = (): JsonNode => ({ type: 'paragraph' })

/** A bordered box headed by a title band: the band to write the title in, then the text. */
export const boxWithTitle = (): JsonNode[] => [
	{
		type: 'box',
		attrs: { kind: 'plain', icon: '', family: '', variant: 'soft' },
		content: [{ type: 'banner', attrs: { tone: 'band' } }, paragraph()],
	},
]

/** A timeframe box: the care point, then its statement. */
export const timeframe = (): JsonNode[] => [
	{ type: 'timeframe', content: [{ type: 'carePoint' }, paragraph()] },
]

/** Two mutually exclusive alternatives ("Or"), of which the author keeps one. */
export const orAlternative = (): JsonNode[] => [
	{
		type: 'variants',
		content: [
			{ type: 'variant', content: [paragraph()] },
			{ type: 'variant', content: [paragraph()] },
		],
	},
]

/** A Find out more entry: a titled link with a line describing it. */
export const findOutMoreResource = (): JsonNode[] => [
	{
		type: 'resourceList',
		content: [{ type: 'resource', attrs: { title: '', url: '' }, content: [paragraph()] }],
	},
]

/** One check row, not yet marked for the quick reference guide. */
export const checkItem = (): JsonNode[] => [
	{
		type: 'list',
		attrs: { kind: 'check', checked: false, pointOfCare: false },
		content: [paragraph()],
	},
]

/** Two columns side by side. */
export const twoColumns = (): JsonNode[] => [
	{
		type: 'columns',
		content: [
			{ type: 'column', content: [paragraph()] },
			{ type: 'column', content: [paragraph()] },
		],
	},
]

/** A table of `columns` columns: a header row (unless asked without), then `rows` body
 *  rows. Rows and columns are clamped to something a page can hold. */
export const table = (rows = 2, columns = 3, header = true): JsonNode[] => {
	const count = (n: number, max: number) => Math.min(max, Math.max(1, Math.floor(n) || 1))
	const row = (cell: 'tableHeaderCell' | 'tableCell'): JsonNode => ({
		type: 'tableRow',
		content: Array.from({ length: count(columns, 12) }, () => ({
			type: cell,
			content: [paragraph()],
		})),
	})
	return [
		{
			type: 'table',
			content: [
				...(header ? [row('tableHeaderCell')] : []),
				...Array.from({ length: count(rows, 50) }, () => row('tableCell')),
			],
		},
	]
}

export const quote = (): JsonNode[] => [{ type: 'blockquote', content: [paragraph()] }]

export const rule = (): JsonNode[] => [{ type: 'horizontalRule' }]

/** A footnote marker carrying its note. */
export const footnote = (text: string): JsonNode[] => [
	{ type: 'footnote', attrs: { text: text.trim() } },
]

/** An uploaded figure with its alternative text. */
export const image = (src: string, alt: string): JsonNode[] => [
	{ type: 'image', attrs: { src, alt: alt.trim() } },
]

/** A citation of a reference row; its number is derived at render. */
export const citation = (referenceId: string): JsonNode[] => [
	{ type: 'citation', attrs: { referenceId } },
]

/** A cross-reference written in place: the section's own heading as the linked words,
 *  for when nothing is selected to link. */
export const crossReference = (words: string, address: string): JsonNode[] => [
	{ type: 'text', text: words, marks: [{ type: 'sectionLink', attrs: { address } }] },
]
