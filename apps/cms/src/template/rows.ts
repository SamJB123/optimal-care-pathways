/**
 * The rows a template seed produces — the `templates` row, the CORE-CONTENT document for
 * the template kind, its sections with bodies in the content schema, and its references.
 * Pure data; `scripts/seed-templates.ts` turns them into SQL.
 */

import type { JsonNode } from '#/content/schema.ts'
import type { Audience, Ownership, TemplateKind } from '#/db/schema.ts'

export interface TemplateRow {
	id: string
	kind: TemplateKind
	label: string
	sourceFile: string
	issuedOn: string
	pageCount: number
}

export interface DocumentRow {
	id: string
	kind: 'core'
	templateId: string
	orgId: string
	slug: string
	title: string
	subject: string
	audience: Audience
}

export interface SectionRow {
	id: string
	documentId: string
	parentId: string | null
	address: string
	canonical: boolean
	printedNumber: string | null
	title: string | null
	headingLevel: number | null
	orderIndex: number
	stepNumber: number | null
	ownership: 'owned'
	pathwayOwnership: Ownership
	apparatus: boolean
	bodyJson: JsonNode
}

export interface ReferenceRow {
	id: string
	documentId: string
	citation: string
	url: string | null
	printedNumber: number
}

export interface SeedResult {
	template: TemplateRow
	document: DocumentRow
	sections: SectionRow[]
	references: ReferenceRow[]
	/** Counts a test or a script can hold against the source. */
	stats: {
		checkItems: number
		citations: number
		footnotes: number
		timeframes: number
		guidance: number
		boxes: number
		variants: number
		tables: number
		figures: number
		links: number
		placeholders: number
	}
}
