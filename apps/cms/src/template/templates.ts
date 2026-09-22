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
	/** Sections whose printed table or figure is a VIEW of other content (decisions 50,
	 *  63): the seed replaces it with the named derived node and the CMS renders it. */
	derived: readonly { address: string; node: 'timeframeSnapshot' | 'pathwayMap' }[]
	/** The steps schematic's topology (decision 72), when the template has one. */
	map: PathwayMapTopology | null
}

/**
 * The steps schematic as the template draws it (decisions 63, 69, 72): which step sits
 * where on the wide grid, the note boxes that are not steps, the connectors, the rail
 * that spans every step and the band beneath. Titles, icons and states come from the
 * document's sections at render; only the SHAPE is declared here.
 */
export interface PathwayMapTopology {
	steps: readonly { step: number; column: number; row: number; rowSpan?: number }[]
	notes: readonly { id: string; label: string; column: number; row: number }[]
	/** Node ids: `step-<n>` for a step, a note's id for a note. */
	edges: readonly {
		from: string
		to: string
		route: 'down' | 'side' | 'elbow'
		kind?: 'arrow' | 'both' | 'line'
	}[]
	rail: {
		label: string
		/** Each step's own section for the rail's subject, by address suffix
		 *  ("supportive-care" → `<step>/supportive-care`). */
		sectionSuffix: string
	}
	footer: { label: string }
	caption: string
}

const TIMEFRAME_SNAPSHOT = {
	address: 'snapshot-of-optimal-timeframes',
	node: 'timeframeSnapshot',
} as const

const STEPS_MAP = {
	address: 'steps-of-the-optimal-care-pathway',
	node: 'pathwayMap',
} as const

/** The 2026 pathway templates' schematic: seven steps in two columns, 6 beside 4 and 5
 *  and fed from 3, 7 under 6, Life after cancer under 5. */
const PATHWAY_MAP: PathwayMapTopology = {
	steps: [
		{ step: 1, column: 1, row: 1 },
		{ step: 2, column: 1, row: 2 },
		{ step: 3, column: 1, row: 3 },
		{ step: 4, column: 1, row: 4 },
		{ step: 5, column: 1, row: 5 },
		{ step: 6, column: 2, row: 4, rowSpan: 2 },
		{ step: 7, column: 2, row: 6 },
	],
	notes: [{ id: 'life-after-cancer', label: 'Life after cancer', column: 1, row: 6 }],
	edges: [
		{ from: 'step-1', to: 'step-2', route: 'down' },
		{ from: 'step-2', to: 'step-3', route: 'down' },
		{ from: 'step-3', to: 'step-4', route: 'down' },
		{ from: 'step-4', to: 'step-5', route: 'down' },
		{ from: 'step-5', to: 'life-after-cancer', route: 'down' },
		{ from: 'step-3', to: 'step-6', route: 'elbow' },
		{ from: 'step-4', to: 'step-6', route: 'side', kind: 'both' },
		{ from: 'step-5', to: 'step-6', route: 'side', kind: 'both' },
		{ from: 'step-6', to: 'step-7', route: 'down' },
	],
	rail: { label: 'Supportive care', sectionSuffix: 'supportive-care' },
	footer: { label: 'Underpinned by the Principles for Optimal Cancer Care' },
	caption:
		'Optimal care is not always linear and is shaped by cancer type, stage of disease, and the person’s circumstances, needs and preferences.',
}

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
		map: null,
	},
	{
		key: 'cancer-template',
		kind: 'cancer',
		sourceFile:
			'Attachment-B-Optimal-Care-Pathway-for-people-with-x-cancer-template_1784776024.pdf',
		issuedOn: '20 July 2026',
		templateId: 'cancer-2026-07',
		coreSlug: 'core-cancer',
		coreSubject: '[cancer type]',
		derived: [TIMEFRAME_SNAPSHOT, STEPS_MAP],
		map: PATHWAY_MAP,
	},
	{
		key: 'population-template',
		kind: 'population',
		sourceFile:
			'Attachment-C-Optimal-care-pathway-for-X-population-group-with-cancer-template_1784776049.pdf',
		issuedOn: '20 July 2026',
		templateId: 'population-2026-07',
		coreSlug: 'core-population',
		coreSubject: '[population group]',
		derived: [TIMEFRAME_SNAPSHOT, STEPS_MAP],
		map: PATHWAY_MAP,
	},
]

export function templateByKey(key: string): TemplateInfo {
	const found = TEMPLATES.find((t) => t.key === key)
	if (!found)
		throw new Error(`unknown template '${key}'; one of ${TEMPLATES.map((t) => t.key).join(', ')}`)
	return found
}

/** Where a template's rendered figures live, as a URL path the app serves statically. */
export const figureUrl = (key: string, page: number, index: number): string =>
	`/template-figures/${key}/p${page}-${index}.png`
