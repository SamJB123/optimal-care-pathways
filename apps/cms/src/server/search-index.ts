/**
 * The full-text index the jump searches (`section_search`, an FTS5 table — see the
 * section_search migration): one row per section that holds a body of its own, its title
 * and its body's words. Every writer of a body keeps it current through here — the room's
 * fold, the structure doors, the seeds (which write the same rows as SQL). A shared
 * section is found through its core section, so it has no row.
 *
 * The table is not in the drizzle schema (drizzle models no virtual tables), so these few
 * statements are written as SQL, once, here.
 */

import { sql } from 'drizzle-orm'
import type { JsonNode } from '#/content/schema.ts'
import type { Db } from '#/db/index.ts'

/** A body's words, blocks separated, marks and attributes dropped. */
export function searchText(body: JsonNode | null | undefined): string {
	if (!body) return ''
	const out: string[] = []
	const walk = (node: JsonNode) => {
		if (node.type === 'text') {
			out.push(node.text ?? '')
			return
		}
		for (const child of node.content ?? []) walk(child)
		if (node.content) out.push('\n')
	}
	walk(body)
	return out
		.join('')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n\s*\n+/g, '\n')
		.trim()
}

export interface IndexedSection {
	id: string
	documentId: string
	title: string | null
	printedNumber: string | null
	/** The body the section holds itself; null for a shared section (not indexed). */
	body: JsonNode | null
	ownership: 'shared' | 'owned'
}

/** The statements that make the index hold `section` as it now stands. */
export function indexStatements(d: Db, section: IndexedSection) {
	const drop = d.run(sql`DELETE FROM section_search WHERE section_id = ${section.id}`)
	if (section.ownership === 'shared') return [drop]
	const title = [section.printedNumber, section.title].filter(Boolean).join(' ')
	return [
		drop,
		d.run(
			sql`INSERT INTO section_search (section_id, document_id, title, body) VALUES (${section.id}, ${section.documentId}, ${title}, ${searchText(section.body)})`,
		),
	]
}

/** Bring the index up to date for these sections, in one batch. */
export async function reindex(d: Db, sections: readonly IndexedSection[]): Promise<void> {
	const statements = sections.flatMap((s) => indexStatements(d, s))
	for (let i = 0; i < statements.length; i += 50) {
		const [first, ...rest] = statements.slice(i, i + 50)
		if (first) await d.batch([first, ...rest])
	}
}

/** Take sections out of the index (a deleted subsection). */
export async function unindex(d: Db, sectionIds: readonly string[]): Promise<void> {
	for (const id of sectionIds) await d.run(sql`DELETE FROM section_search WHERE section_id = ${id}`)
}
