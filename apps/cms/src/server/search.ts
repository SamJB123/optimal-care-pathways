/**
 * Full-text search for the jump (decision: search inside the text, both scopes): the
 * words of every section the caller may read, in the document at hand first — its own
 * sections, and the core sections its shared sections render — then, for the central
 * team, in the other documents. Each hit names the section where the reader would find
 * it, with a few words either side of the match.
 */

import { createServerFn } from '@tanstack/solid-start'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import { inGroups, schema } from '#/db/index.ts'
import { documentName } from '#/lib/labels.ts'
import { visibleDocuments } from './visibility.ts'
import { envOf, requireUser } from './env.ts'

export interface SearchHit {
	documentId: string
	documentName: string
	sectionId: string
	address: string
	/** The top-level section the hit sits under: the part that opens. */
	part: string
	label: string
	snippet: string
	/** In the document the search was made from. */
	here: boolean
}

/** The reader's words as an FTS5 query: every word must appear, each as a prefix. */
function matchQuery(query: string): string | null {
	const words = query
		.split(/\s+/)
		.map((w) => w.replace(/["*^():]/g, '').trim())
		.filter((w) => w.length > 0)
		.slice(0, 8)
	return words.length === 0 ? null : words.map((w) => `"${w}"*`).join(' ')
}

type Row = { section_id: string; document_id: string; snip: string }

export const searchSections = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ query: z.string().trim().min(2).max(200), documentId: z.string().min(1).max(64).nullable() }))
	.handler(async ({ data, context }): Promise<SearchHit[]> => {
		const userId = requireUser(context.userId)
		const match = matchQuery(data.query)
		if (!match) return []
		const { d } = await envOf()
		const { documents, central } = await visibleDocuments(userId)
		const visible = new Map(documents.map((x) => [x.row.id, x.row]))
		const here = data.documentId && visible.has(data.documentId) ? data.documentId : null

		// The document at hand reads its shared sections from the core: its core
		// documents' words count as its own.
		const shared = here
			? await d
					.select({ id: schema.sections.id, coreSectionId: schema.sections.coreSectionId })
					.from(schema.sections)
					.where(and(eq(schema.sections.documentId, here), eq(schema.sections.ownership, 'shared')))
			: []
		const sharedByCore = new Map(shared.flatMap((s) => (s.coreSectionId ? [[s.coreSectionId, s.id] as const] : [])))
		const coreDocs = here
			? (
					await inGroups([...sharedByCore.keys()], (group) =>
						d
							.selectDistinct({ documentId: schema.sections.documentId })
							.from(schema.sections)
							.where(inArray(schema.sections.id, group)),
					)
				).map((r) => r.documentId)
			: []

		const search = async (docIds: string[], limit: number): Promise<Row[]> => {
			if (docIds.length === 0) return []
			const rows = await inGroups(docIds, (group) =>
				d.all<Row>(
					sql`SELECT section_id, document_id, snippet(section_search, 3, '', '', '…', 14) AS snip FROM section_search WHERE section_search MATCH ${match} AND document_id IN (${sql.join(
						group.map((id) => sql`${id}`),
						sql`, `,
					)}) ORDER BY rank LIMIT ${limit}`,
				),
			)
			return rows.slice(0, limit)
		}

		const nearRows = here ? await search([here, ...new Set(coreDocs)], 20) : []
		// A core hit counts for the document at hand only through a section it shares.
		const near = nearRows.flatMap((r) =>
			r.document_id === here
				? [{ ...r, target: r.section_id, targetDocument: here }]
				: sharedByCore.has(r.section_id)
					? [{ ...r, target: sharedByCore.get(r.section_id) ?? r.section_id, targetDocument: here }]
					: [],
		)
		const elsewhere = central
			? (await search([...visible.keys()].filter((id) => id !== here), 12)).map((r) => ({
					...r,
					target: r.section_id,
					targetDocument: r.document_id,
				}))
			: []

		const hits = [...near, ...elsewhere]
		const targets = [...new Set(hits.map((h) => h.target))]
		const rows = await inGroups(targets, (group) =>
			d
				.select({
					id: schema.sections.id,
					documentId: schema.sections.documentId,
					address: schema.sections.address,
					printedNumber: schema.sections.printedNumber,
					title: schema.sections.title,
				})
				.from(schema.sections)
				.where(inArray(schema.sections.id, group)),
		)
		const byId = new Map(rows.map((r) => [r.id, r]))
		// The part a section opens in is its first address segment's top-level section.
		return hits.flatMap((h) => {
			const row = byId.get(h.target)
			const doc = visible.get(h.targetDocument ?? '')
			if (!row || !doc) return []
			return [
				{
					documentId: doc.id,
					documentName: documentName(doc),
					sectionId: row.id,
					address: row.address,
					part: row.address.split('/')[0]?.split('.')[0] ?? row.address,
					label: [row.printedNumber, row.title ?? row.address].filter(Boolean).join(' '),
					snippet: h.snip.replace(/\s+/g, ' ').trim(),
					here: h.targetDocument === here,
				},
			]
		})
	})
