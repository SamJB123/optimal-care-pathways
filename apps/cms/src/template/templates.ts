/**
 * The three 2026 templates: which PDF each is, what kind of core document it seeds, and
 * the issue it was consulted as. One registry for the extractor, the figure renderer, the
 * mapper and the seed.
 */

import type { TemplateKind } from '#/db/schema.ts'

export interface TemplateInfo {
	/** The key scripts take and the extracted files are named by. */
	key: string
	kind: TemplateKind
	/** The PDF under template/2026/source. */
	sourceFile: string
	/** As printed on the consultation draft. */
	issuedOn: string
	/** `templates.id`: kind and issue month. */
	templateId: string
	/** The core document's slug and subject placeholder. */
	coreSlug: string
	coreSubject: string
	/** Sections whose printed table is a VIEW of other content (decision 50): the seed
	 *  replaces the table with the named derived node and the CMS renders it. */
	derived: readonly { address: string; node: 'timeframeSnapshot' }[]
}

const TIMEFRAME_SNAPSHOT = { address: 'snapshot-of-optimal-timeframes', node: 'timeframeSnapshot' } as const

export const TEMPLATES: readonly TemplateInfo[] = [
	{
		key: 'principles',
		kind: 'principles',
		sourceFile: 'Attachment-A-Principles-for-Optimal-Cancer-Care_1784775997.pdf',
		issuedOn: '20 July 2026',
		templateId: 'principles-2026-07',
		coreSlug: 'principles',
		coreSubject: 'optimal cancer care',
		derived: [],
	},
	{
		key: 'cancer-template',
		kind: 'cancer',
		sourceFile: 'Attachment-B-Optimal-Care-Pathway-for-people-with-x-cancer-template_1784776024.pdf',
		issuedOn: '20 July 2026',
		templateId: 'cancer-2026-07',
		coreSlug: 'core-cancer',
		coreSubject: '[cancer type]',
		derived: [TIMEFRAME_SNAPSHOT],
	},
	{
		key: 'population-template',
		kind: 'population',
		sourceFile: 'Attachment-C-Optimal-care-pathway-for-X-population-group-with-cancer-template_1784776049.pdf',
		issuedOn: '20 July 2026',
		templateId: 'population-2026-07',
		coreSlug: 'core-population',
		coreSubject: '[population group]',
		derived: [TIMEFRAME_SNAPSHOT],
	},
]

export function templateByKey(key: string): TemplateInfo {
	const found = TEMPLATES.find((t) => t.key === key)
	if (!found) throw new Error(`unknown template '${key}'; one of ${TEMPLATES.map((t) => t.key).join(', ')}`)
	return found
}

/** Where a template's rendered figures live, as a URL path the app serves statically. */
export const figureUrl = (key: string, page: number, index: number): string =>
	`/template-figures/${key}/p${page}-${index}.png`
