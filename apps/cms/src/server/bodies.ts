/**
 * A section's RESTING body: what a page shows before (or instead of) a live editor. An
 * owned section rests on its own draft body; a shared section renders its core section's
 * body as PUBLISHED, or the core's draft while the core has never published (decision 98).
 *
 * The one rule, applied to one section (the margin, a late-added row) or to a whole part
 * at once (the part page's loader, so the layout is final at first paint). Pure over the
 * database handle: the server functions in documents.ts check membership and call in.
 */

import { inArray } from 'drizzle-orm'
import type { JsonNode } from '#/content/schema.ts'
import { type Db, inGroups, schema } from '#/db/index.ts'

export interface RestingBody {
	body: JsonNode | null
	/** For a shared section: which core body it rests on. Null for an owned section. */
	coreSource: 'published' | 'draft' | null
}

type SectionRow = Pick<
	typeof schema.sections.$inferSelect,
	'id' | 'ownership' | 'coreSectionId' | 'bodyJson'
>

/** The resting bodies of `sections`, by section id. Core bodies are read in two queries
 *  for the lot (the published rows, then the drafts of those without one). */
export async function restingBodiesOf(
	d: Db,
	sections: readonly SectionRow[],
): Promise<Record<string, RestingBody>> {
	const out: Record<string, RestingBody> = {}
	const coreIds = new Set<string>()
	for (const s of sections) {
		if (s.ownership === 'owned' || !s.coreSectionId)
			out[s.id] = { body: s.bodyJson ?? null, coreSource: null }
		else coreIds.add(s.coreSectionId)
	}
	if (coreIds.size === 0) return out
	const published = new Map(
		(
			await inGroups([...coreIds], (group) =>
				d
					.select({
						sectionId: schema.publishedSections.sectionId,
						bodyJson: schema.publishedSections.bodyJson,
					})
					.from(schema.publishedSections)
					.where(inArray(schema.publishedSections.sectionId, group)),
			)
		).map((p) => [p.sectionId, p.bodyJson ?? null]),
	)
	const unpublished = [...coreIds].filter((id) => !published.has(id))
	const drafts = new Map(
		unpublished.length === 0
			? []
			: (
					await inGroups(unpublished, (group) =>
						d
							.select({ id: schema.sections.id, bodyJson: schema.sections.bodyJson })
							.from(schema.sections)
							.where(inArray(schema.sections.id, group)),
					)
				).map((c) => [c.id, c.bodyJson ?? null]),
	)
	for (const s of sections) {
		if (s.id in out || !s.coreSectionId) continue
		out[s.id] = published.has(s.coreSectionId)
			? { body: published.get(s.coreSectionId) ?? null, coreSource: 'published' }
			: { body: drafts.get(s.coreSectionId) ?? null, coreSource: 'draft' }
	}
	return out
}

/** The rows of one part: the top-level section at `part` and everything under it, hidden
 *  rows included (the page may show them). Empty when the document has no such part. */
export function partSections<T extends { id: string; parentId: string | null; address: string }>(
	rows: readonly T[],
	part: string,
): T[] {
	const root = rows.find((r) => r.parentId === null && r.address === part)
	if (!root) return []
	const byParent = new Map<string | null, T[]>()
	for (const r of rows) {
		const list = byParent.get(r.parentId) ?? []
		list.push(r)
		byParent.set(r.parentId, list)
	}
	const out: T[] = []
	const walk = (node: T) => {
		out.push(node)
		for (const child of byParent.get(node.id) ?? []) walk(child)
	}
	walk(root)
	return out
}
