/**
 * A document's references (decisions 15, 118), as plain functions over the lifecycle's
 * bindings so the workerd tests exercise them directly; `references-fns.ts` wraps them as
 * server functions with the caller's identity.
 *
 * WHAT A DOCUMENT'S REFERENCES ARE. The rows its RESOLVED bodies cite, wherever those rows
 * live — a pathway's shared sections render the core's bodies, so a pathway cites core
 * rows it does not own — numbered in first-cited order (a heading's own citations first
 * in its section), then the rows it owns that nothing cites yet. Numbers are derived here
 * exactly as the page derives them, never stored.
 *
 * A PUBLISHED EDITION NEVER CHANGES. Published bodies are frozen, but the public pages
 * read the reference rows they cite by id as they are now. So a row a frozen edition
 * cites is never rewritten: editing it writes a new row that `supersedes` it and repoints
 * the draft's citations to the new row, leaving the edition citing exactly what it
 * printed. A row no edition cites is edited in place.
 *
 * WHO OWNS A ROW. Only the document a row belongs to edits or deletes it. A pathway reads
 * the core's rows through its shared sections and asks the central team for a change the
 * way it asks for any change to shared content: a suggestion.
 */

import { and, eq, inArray, ne, or, sql } from 'drizzle-orm'
import { citationNumbers, citedBody, walkNodes } from '#/content/derived.ts'
import { publishableHash, publishAsFor } from '#/content/publish.ts'
import type { JsonNode } from '#/content/schema.ts'
import { inGroups, schema } from '#/db/index.ts'
import { publishSectionRows } from '#/lib/live-publish.ts'
import {
	documentOf,
	foldRoom,
	type Lifecycle,
	live,
	record,
	refuse,
	requireRole,
	resolveSections,
	roleOn,
} from './lifecycle.ts'
import { reindex } from './search-index.ts'

type DocumentRow = typeof schema.documents.$inferSelect
export type ReferenceRow = typeof schema.references.$inferSelect

/** A section that cites a reference, on its body or on its heading. */
export interface CitingSection {
	sectionId: string
	address: string
	printedNumber: string | null
	title: string | null
}

/** One entry of a document's reference list. */
export interface ReferenceEntry {
	id: string
	/** The number the document prints for it; null for a row nothing cites. */
	number: number | null
	citation: string
	url: string | null
	/** The number the source document printed, for provenance. */
	printedNumber: number | null
	/** The row belongs to this document (else it is the core's, read through a shared
	 *  section, and editable only there). */
	own: boolean
	/** An own row nothing in the draft cites. */
	unused: boolean
	/** A citation names a row that no longer exists. */
	missing: boolean
	/** The row this one replaced, when an edit wrote it for a published edition's sake. */
	supersedes: string | null
	/** The row that replaced this one: an earlier wording kept for a published edition. */
	supersededBy: string | null
	citedIn: CitingSection[]
	/** A published or archived version of this document cites it. */
	inPublished: boolean
}

export interface ReferenceList {
	references: ReferenceEntry[]
	/** Reference id → number, in first-cited order: the draft's derived numbering. */
	numbers: Record<string, number>
}

const MISSING_CITATION = '(reference missing)'
const SEARCH_LIMIT = 30

// ---------------------------------------------------------------------------
// Citations in bodies
// ---------------------------------------------------------------------------

/** The reference ids a body cites, in reading order, repeats included. */
function citationsIn(body: JsonNode | null): string[] {
	if (!body) return []
	const ids: string[] = []
	walkNodes(body, (n) => {
		const id = n.type === 'citation' ? n.attrs?.referenceId : undefined
		if (typeof id === 'string') ids.push(id)
	})
	return ids
}

/** The body with every citation of `from` naming `to` instead. */
function repoint(node: JsonNode, from: string, to: string): JsonNode {
	const next: JsonNode = { ...node }
	if (node.type === 'citation' && node.attrs?.referenceId === from)
		next.attrs = { ...node.attrs, referenceId: to }
	if (node.content) next.content = node.content.map((c) => repoint(c, from, to))
	return next
}

/** How a citation of `id` is written in a stored body (drizzle stores JSON as
 *  `JSON.stringify` writes it), to find candidate rows in SQL before reading them. */
const bodyNeedle = (id: string): string => `${JSON.stringify('referenceId')}:${JSON.stringify(id)}`
const titleNeedle = (id: string): string => JSON.stringify(id)

// ---------------------------------------------------------------------------
// Where a row is cited
// ---------------------------------------------------------------------------

/** Draft sections of any document citing the row, on the body or the heading. */
async function draftCitations(
	lc: Lifecycle,
	referenceId: string,
): Promise<{ documentTitle: string; address: string }[]> {
	const rows = await lc.d
		.select({
			address: schema.sections.address,
			bodyJson: schema.sections.bodyJson,
			titleCitations: schema.sections.titleCitations,
			documentTitle: schema.documents.title,
		})
		.from(schema.sections)
		.innerJoin(schema.documents, eq(schema.documents.id, schema.sections.documentId))
		.where(
			or(
				sql`instr(${schema.sections.bodyJson}, ${bodyNeedle(referenceId)}) > 0`,
				sql`instr(${schema.sections.titleCitations}, ${titleNeedle(referenceId)}) > 0`,
			),
		)
	return rows
		.filter(
			(r) =>
				(r.titleCitations ?? []).includes(referenceId) ||
				citationsIn(r.bodyJson ?? null).includes(referenceId),
		)
		.map((r) => ({ documentTitle: r.documentTitle, address: r.address }))
}

/** Published or archived versions of any document whose frozen bodies cite the row. A
 *  pathway's edition freezes the core bodies it shared, so this finds a core row cited
 *  by any pathway's edition as well as by the core's own. */
async function frozenCitations(
	lc: Lifecycle,
	referenceId: string,
): Promise<{ documentTitle: string; versionNo: number; address: string }[]> {
	const rows = await lc.d
		.select({
			address: schema.versionSections.address,
			bodyJson: schema.versionSections.bodyJson,
			versionNo: schema.versions.versionNo,
			documentTitle: schema.documents.title,
		})
		.from(schema.versionSections)
		.innerJoin(schema.versions, eq(schema.versions.id, schema.versionSections.versionId))
		.innerJoin(schema.documents, eq(schema.documents.id, schema.versions.documentId))
		.where(
			and(
				ne(schema.versions.status, 'draft'),
				sql`instr(${schema.versionSections.bodyJson}, ${bodyNeedle(referenceId)}) > 0`,
			),
		)
	return rows
		.filter((r) => citationsIn(r.bodyJson ?? null).includes(referenceId))
		.map((r) => ({ documentTitle: r.documentTitle, versionNo: r.versionNo, address: r.address }))
}

/** Every reference id the document's published and archived versions cite. */
async function frozenIdsOf(lc: Lifecycle, documentId: string): Promise<Set<string>> {
	const rows = await lc.d
		.select({ bodyJson: schema.versionSections.bodyJson })
		.from(schema.versionSections)
		.innerJoin(schema.versions, eq(schema.versions.id, schema.versionSections.versionId))
		.where(and(eq(schema.versions.documentId, documentId), ne(schema.versions.status, 'draft')))
	return new Set(rows.flatMap((r) => citationsIn(r.bodyJson ?? null)))
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** The document's reference list: cited rows in first-cited order, then its own rows
 *  nothing cites. */
async function referenceEntries(lc: Lifecycle, document: DocumentRow): Promise<ReferenceList> {
	const resolved = (await resolveSections(lc, document.id)).filter(live)
	const numbers = citationNumbers(resolved.map((s) => citedBody(s.row.titleCitations, s.body)))
	const citedIn = new Map<string, CitingSection[]>()
	for (const s of resolved) {
		const ids = new Set([...(s.row.titleCitations ?? []), ...citationsIn(s.body)])
		for (const id of ids) {
			const list = citedIn.get(id) ?? []
			list.push({
				sectionId: s.row.id,
				address: s.row.address,
				printedNumber: s.row.printedNumber,
				title: s.row.title,
			})
			citedIn.set(id, list)
		}
	}
	const citedIds = Object.keys(numbers).sort((a, b) => (numbers[a] ?? 0) - (numbers[b] ?? 0))
	const [citedRows, ownRows, frozen] = await Promise.all([
		citedIds.length > 0
			? inGroups(citedIds, (group) =>
					lc.d.select().from(schema.references).where(inArray(schema.references.id, group)),
				)
			: Promise.resolve([]),
		lc.d
			.select()
			.from(schema.references)
			.where(eq(schema.references.documentId, document.id))
			.orderBy(schema.references.createdAt),
		frozenIdsOf(lc, document.id),
	])
	const byId = new Map([...citedRows, ...ownRows].map((r) => [r.id, r]))
	const supersededBy = new Map<string, string>()
	for (const r of byId.values()) if (r.supersedes) supersededBy.set(r.supersedes, r.id)
	const entry = (id: string, row: ReferenceRow | undefined): ReferenceEntry => ({
		id,
		number: numbers[id] ?? null,
		citation: row?.citation ?? MISSING_CITATION,
		url: row?.url ?? null,
		printedNumber: row?.printedNumber ?? null,
		own: row?.documentId === document.id,
		unused: numbers[id] === undefined,
		missing: row === undefined,
		supersedes: row?.supersedes ?? null,
		supersededBy: supersededBy.get(id) ?? null,
		citedIn: citedIn.get(id) ?? [],
		inPublished: frozen.has(id),
	})
	return {
		references: [
			...citedIds.map((id) => entry(id, byId.get(id))),
			...ownRows.filter((r) => numbers[r.id] === undefined).map((r) => entry(r.id, r)),
		],
		numbers,
	}
}

/** The document's reference list, for any member. */
export async function listReferences(
	lc: Lifecycle,
	input: { documentId: string; userId: string },
): Promise<ReferenceList> {
	const document = await documentOf(lc, input.documentId)
	if (!(await roleOn(lc, input.userId, document)))
		return refuse('You are not a member of this document.')
	return referenceEntries(lc, document)
}

/**
 * The Cite tool's finder: the references this document can cite — its own rows and every
 * row its resolved bodies already cite — whose citation holds every word of the query,
 * cited ones first in their order. An earlier wording kept for a published edition is
 * left out: the draft cites the row that replaced it.
 */
export async function searchReferences(
	lc: Lifecycle,
	input: { documentId: string; query: string; userId: string },
): Promise<ReferenceEntry[]> {
	const document = await documentOf(lc, input.documentId)
	await requireRole(lc, input.userId, document, 'member', 'cite a reference')
	const words = input.query.toLowerCase().split(/\s+/).filter(Boolean)
	const { references } = await referenceEntries(lc, document)
	return references
		.filter((r) => !r.missing && !(r.unused && r.supersededBy !== null))
		.filter((r) => {
			const text = r.citation.toLowerCase()
			return words.every((w) => text.includes(w))
		})
		.slice(0, SEARCH_LIMIT)
}

// ---------------------------------------------------------------------------
// Writing references
// ---------------------------------------------------------------------------

/** A citation as stored: trimmed, 1–4000 characters. */
function cleanCitation(citation: string): string {
	const text = citation.trim()
	if (text.length === 0) return refuse('Write the citation first.')
	if (text.length > 4000) return refuse('A citation may be at most 4000 characters.')
	return text
}

/** A link as stored: trimmed, null when blank, else an http or https address. */
function cleanUrl(url: string | null): string | null {
	const text = url?.trim() ?? ''
	if (text.length === 0) return null
	const parsed = URL.canParse(text) ? new URL(text) : null
	if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:'))
		return refuse('A link must be a web address starting with http:// or https://.')
	return text
}

async function referenceOf(lc: Lifecycle, referenceId: string): Promise<ReferenceRow> {
	const row = (
		await lc.d
			.select()
			.from(schema.references)
			.where(eq(schema.references.id, referenceId))
			.limit(1)
	)[0]
	return row ?? refuse('Reference not found.')
}

/** Refuse a change to a row this document does not own, saying whose it is. */
async function requireOwn(lc: Lifecycle, row: ReferenceRow, document: DocumentRow): Promise<void> {
	if (row.documentId === document.id) return
	const owner = (
		await lc.d
			.select({ kind: schema.documents.kind })
			.from(schema.documents)
			.where(eq(schema.documents.id, row.documentId))
			.limit(1)
	)[0]
	refuse(
		owner?.kind === 'core'
			? 'This reference belongs to the core template, so it can only be changed there. Suggest the change on the shared section that cites it.'
			: 'This reference belongs to another document, so it can only be changed there.',
	)
}

/** A new reference of the document's own, for a drafter to cite. */
export async function addReference(
	lc: Lifecycle,
	input: { documentId: string; citation: string; url: string | null; userId: string },
): Promise<ReferenceRow> {
	const document = await documentOf(lc, input.documentId)
	await requireRole(lc, input.userId, document, 'member', 'add a reference')
	const inserted = await lc.d
		.insert(schema.references)
		.values({
			id: crypto.randomUUID(),
			documentId: document.id,
			citation: cleanCitation(input.citation),
			url: cleanUrl(input.url),
			createdBy: input.userId,
		})
		.returning()
	const row = inserted[0] ?? refuse('Could not save the reference.')
	await record(lc, document.id, 'reference.added', input.userId, { referenceId: row.id })
	return row
}

/**
 * Change a reference the document owns. When no published or archived edition cites it,
 * the row changes in place. When one does, the edition must keep what it printed: a new
 * row supersedes it, and every citation of the old row in this document's own draft
 * sections — bodies and headings — names the new one. The live bodies are folded first so
 * nothing typed in the room is lost; the rewritten rows move `updated_at`, which the room
 * reads as D1 moving without it and re-hydrates from.
 */
export async function editReference(
	lc: Lifecycle,
	input: {
		referenceId: string
		documentId: string
		citation: string
		url: string | null
		userId: string
	},
): Promise<{ id: string; copied: boolean }> {
	const document = await documentOf(lc, input.documentId)
	await requireRole(lc, input.userId, document, 'member', 'edit a reference')
	const row = await referenceOf(lc, input.referenceId)
	await requireOwn(lc, row, document)
	const successor = (
		await lc.d
			.select({ id: schema.references.id })
			.from(schema.references)
			.where(eq(schema.references.supersedes, row.id))
			.limit(1)
	)[0]
	if (successor)
		return refuse(
			'This is an earlier wording kept for a published edition; edit the reference that replaced it.',
		)
	const citation = cleanCitation(input.citation)
	const url = cleanUrl(input.url)
	if (citation === row.citation && url === row.url) return { id: row.id, copied: false }

	await foldRoom(lc, document.id)
	const frozen = await frozenCitations(lc, row.id)
	if (frozen.length === 0) {
		await lc.d
			.update(schema.references)
			.set({ citation, url })
			.where(eq(schema.references.id, row.id))
		await record(lc, document.id, 'reference.edited', input.userId, {
			from: row.id,
			to: row.id,
			copied: false,
		})
		return { id: row.id, copied: false }
	}

	const next = crypto.randomUUID()
	const citing = await lc.d
		.select()
		.from(schema.sections)
		.where(
			and(
				eq(schema.sections.documentId, document.id),
				eq(schema.sections.ownership, 'owned'),
				or(
					sql`instr(${schema.sections.bodyJson}, ${bodyNeedle(row.id)}) > 0`,
					sql`instr(${schema.sections.titleCitations}, ${titleNeedle(row.id)}) > 0`,
				),
			),
		)
	const now = new Date()
	const rewrites = []
	for (const s of citing) {
		const body = s.bodyJson ?? null
		const title = s.titleCitations ?? []
		const inBody = citationsIn(body).includes(row.id)
		const inTitle = title.includes(row.id)
		if (!inBody && !inTitle) continue
		const bodyJson = body && inBody ? repoint(body, row.id, next) : body
		rewrites.push({
			id: s.id,
			set: {
				bodyJson,
				titleCitations: inTitle ? title.map((id) => (id === row.id ? next : id)) : s.titleCitations,
				draftHash: await publishableHash(bodyJson, document.subject, publishAsFor(document.kind)),
				updatedAt: now,
				updatedBy: input.userId,
			},
		})
	}
	await lc.d.batch([
		lc.d.insert(schema.references).values({
			id: next,
			documentId: document.id,
			citation,
			url,
			printedNumber: row.printedNumber,
			supersedes: row.id,
			createdBy: input.userId,
		}),
		...rewrites.map((r) =>
			lc.d.update(schema.sections).set(r.set).where(eq(schema.sections.id, r.id)),
		),
	])
	if (rewrites.length > 0) {
		const updated = await inGroups(
			rewrites.map((r) => r.id),
			(group) => lc.d.select().from(schema.sections).where(inArray(schema.sections.id, group)),
		)
		void publishSectionRows(document.id, updated)
		await reindex(
			lc.d,
			updated.map((s) => ({ ...s, body: s.bodyJson ?? null })),
		)
	}
	await record(lc, document.id, 'reference.edited', input.userId, {
		from: row.id,
		to: next,
		copied: true,
		sections: rewrites.length,
	})
	return { id: next, copied: true }
}

/** Where a row is cited, as a reader would name it, a few places at most. */
function describePlaces(places: string[]): string {
	const unique = [...new Set(places)]
	const shown = unique.slice(0, 5).join('; ')
	return unique.length > 5 ? `${shown}; and ${unique.length - 5} more` : shown
}

/** Delete a reference the document owns and nothing cites — no draft body or heading
 *  anywhere, and no published or archived edition. */
export async function deleteReference(
	lc: Lifecycle,
	input: { referenceId: string; documentId: string; userId: string },
): Promise<{ id: string }> {
	const document = await documentOf(lc, input.documentId)
	await requireRole(lc, input.userId, document, 'member', 'delete a reference')
	const row = await referenceOf(lc, input.referenceId)
	await requireOwn(lc, row, document)
	await foldRoom(lc, document.id)
	const [drafts, frozen] = await Promise.all([
		draftCitations(lc, row.id),
		frozenCitations(lc, row.id),
	])
	if (drafts.length > 0 || frozen.length > 0)
		return refuse(
			`This reference is still cited, so it cannot be deleted: ${describePlaces([
				...drafts.map((p) => `section ${p.address} of ${p.documentTitle} (draft)`),
				...frozen.map((p) => `section ${p.address} of ${p.documentTitle}, version ${p.versionNo}`),
			])}.`,
		)
	await lc.d.delete(schema.references).where(eq(schema.references.id, row.id))
	await record(lc, document.id, 'reference.deleted', input.userId, {
		referenceId: row.id,
		citation: row.citation,
	})
	return { id: row.id }
}
