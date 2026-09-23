/**
 * The structure doors: what a team may do to the shape of its document, as the template
 * allows it, as plain functions over the lifecycle's bindings so the workerd tests exercise
 * them directly; `structure-fns.ts` wraps them as server functions.
 *
 * THE RULES (the template's own). Numbered headings cannot be changed or reordered: a
 * canonical section keeps its title, number and place, and the database refuses otherwise
 * (the section_search migration's triggers). A section that is not relevant is REMOVED by
 * hiding it, with everything under it: restorable, and no number shifts. A team may add
 * unnumbered subheadings, and only those — the `added` sections — may be renamed, moved or
 * deleted. What was hidden and added since the published version is reported with a review
 * request (`structureChanges` in lifecycle.ts).
 *
 * WHAT A DOOR TOUCHES. The rows it changes, the search index for a title or a body it
 * writes, the live topic after the commit, and one event. Never `updated_at`: that is the
 * body's clock, which the document room reads to tell whether D1 moved without it; a
 * structure change bumping it would make the room throw away edits not yet folded.
 */

import { eq, inArray } from 'drizzle-orm'
import { publishableHash, publishAsFor } from '#/content/publish.ts'
import { emptyBody } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import { publishSectionDeletes, publishSectionRows } from '#/lib/live-publish.ts'
import { documentOf, type Lifecycle, record, refuse, requireRole } from './lifecycle.ts'
import { reindex, unindex } from './search-index.ts'

type SectionRow = typeof schema.sections.$inferSelect
type DocumentRow = typeof schema.documents.$inferSelect

/** D1 binds at most 100 parameters to one statement: ids are written in groups of this. */
const GROUP = 90

/** The longest heading a team may give a subsection. */
const TITLE_MAX = 200

// ---------------------------------------------------------------------------
// Reading the tree
// ---------------------------------------------------------------------------

/** The section and its document; refused when either is missing. */
async function sectionOf(
	lc: Lifecycle,
	sectionId: string,
): Promise<{ section: SectionRow; document: DocumentRow }> {
	const section = (
		await lc.d.select().from(schema.sections).where(eq(schema.sections.id, sectionId)).limit(1)
	)[0]
	if (!section) return refuse('Section not found.')
	return { section, document: await documentOf(lc, section.documentId) }
}

/** The shape of every section of a document: enough to walk the tree, no bodies. */
async function treeOf(lc: Lifecycle, documentId: string) {
	return lc.d
		.select({
			id: schema.sections.id,
			parentId: schema.sections.parentId,
			address: schema.sections.address,
			title: schema.sections.title,
			orderIndex: schema.sections.orderIndex,
			headingLevel: schema.sections.headingLevel,
			stepNumber: schema.sections.stepNumber,
			added: schema.sections.added,
			canonical: schema.sections.canonical,
			apparatus: schema.sections.apparatus,
			hidden: schema.sections.hidden,
		})
		.from(schema.sections)
		.where(eq(schema.sections.documentId, documentId))
}

type TreeRow = Awaited<ReturnType<typeof treeOf>>[number]

/** A parent's children, in order. */
const childrenOf = (rows: readonly TreeRow[], parentId: string): TreeRow[] =>
	rows.filter((r) => r.parentId === parentId).sort((a, b) => a.orderIndex - b.orderIndex)

/** A section and everything under it, each with its depth below the section (0 for the
 *  section itself), in reading order. */
function subtreeOf(rows: readonly TreeRow[], rootId: string): { row: TreeRow; depth: number }[] {
	const root = rows.find((r) => r.id === rootId)
	if (!root) return []
	const out: { row: TreeRow; depth: number }[] = []
	const walk = (row: TreeRow, depth: number) => {
		out.push({ row, depth })
		for (const child of childrenOf(rows, row.id)) walk(child, depth + 1)
	}
	walk(root, 0)
	return out
}

/** Scaffolding the document never renders has no structure a team can change. */
const refuseApparatus = (section: { apparatus: boolean }) => {
	if (section.apparatus)
		refuse('This part of the template is scaffolding the document never shows; it has no place to change.')
}

/** Only a subheading the team added may be renamed, moved or deleted. */
const requireAdded = (section: { added: boolean; canonical: boolean }, what: string) => {
	if (section.added) return
	refuse(
		section.canonical
			? `This section is numbered by the template: its heading and its place are fixed, so it cannot be ${what}. It can be hidden.`
			: `This heading comes from the template, so it cannot be ${what}. Only a subheading your team added can be; a template section can be hidden.`,
	)
}

/** A heading as a team typed it, trimmed and within bounds. */
function titleFrom(value: string): string {
	const title = value.trim()
	if (title.length === 0) refuse('A subheading needs a title.')
	if (title.length > TITLE_MAX) refuse(`A subheading's title can be at most ${TITLE_MAX} characters.`)
	return title
}

/** An address segment from a heading: lower case, words joined by hyphens. */
const slugify = (value: string): string =>
	value
		.toLowerCase()
		.replace(/[’']/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64) || 'section'

/** Update these sections in one batch, the ids in groups D1 accepts; the committed rows. */
async function updateAll(
	lc: Lifecycle,
	ids: readonly string[],
	set: Partial<Pick<SectionRow, 'hidden' | 'pointOfCare'>>,
): Promise<SectionRow[]> {
	const statements = []
	for (let i = 0; i < ids.length; i += GROUP)
		statements.push(
			lc.d
				.update(schema.sections)
				.set(set)
				.where(inArray(schema.sections.id, ids.slice(i, i + GROUP)))
				.returning(),
		)
	const [first, ...rest] = statements
	if (!first) return []
	return (await lc.d.batch([first, ...rest])).flat()
}

// ---------------------------------------------------------------------------
// Hide and show
// ---------------------------------------------------------------------------

/**
 * Remove a section from the document, as the template allows where it is not relevant, or
 * bring it back: the section and everything under it are hidden (or shown) together, in
 * one batch. Nothing is renumbered and nothing is lost. Any section but scaffolding.
 */
export async function setSectionHidden(
	lc: Lifecycle,
	input: { sectionId: string; hidden: boolean; userId: string },
): Promise<{ sections: number }> {
	const { section, document } = await sectionOf(lc, input.sectionId)
	await requireRole(lc, input.userId, document, 'member', input.hidden ? 'hide a section' : 'show a section')
	refuseApparatus(section)
	const rows = await treeOf(lc, document.id)
	if (!input.hidden && section.parentId) {
		const parent = rows.find((r) => r.id === section.parentId)
		if (parent?.hidden) refuse('The section this one sits under is hidden: show that one first.')
	}
	const ids = subtreeOf(rows, section.id).map((s) => s.row.id)
	const updated = await updateAll(lc, ids, { hidden: input.hidden })
	await record(lc, document.id, input.hidden ? 'section.hidden' : 'section.shown', input.userId, {
		sectionId: section.id,
		address: section.address,
		sections: updated.length,
	})
	void publishSectionRows(document.id, updated)
	return { sections: updated.length }
}

// ---------------------------------------------------------------------------
// Added subheadings
// ---------------------------------------------------------------------------

/**
 * A team adds an unnumbered subheading under a section: after the sibling `afterId`, or
 * first when null. It is the team's own (owned, with an empty body), addressed by its
 * parent and its title (`3/supportive-care`, `-2` and on when taken); its address never
 * changes after, whatever it is renamed or moved to, because an address is identity.
 */
export async function addSubsection(
	lc: Lifecycle,
	input: { parentId: string; title: string; afterId: string | null; userId: string },
): Promise<{ id: string; address: string }> {
	const { section: parent, document } = await sectionOf(lc, input.parentId)
	await requireRole(lc, input.userId, document, 'member', 'add a subheading')
	refuseApparatus(parent)
	const title = titleFrom(input.title)
	const rows = await treeOf(lc, document.id)
	const siblings = childrenOf(rows, parent.id)
	let orderIndex: number
	if (input.afterId === null) orderIndex = (siblings[0]?.orderIndex ?? 1) - 1
	else {
		const at = siblings.findIndex((s) => s.id === input.afterId)
		const after = siblings[at]
		if (!after) return refuse('The section to add after is not under this heading.')
		const next = siblings[at + 1]
		orderIndex = next ? (after.orderIndex + next.orderIndex) / 2 : after.orderIndex + 1
	}
	const taken = new Set(rows.map((r) => r.address))
	const base = `${parent.address}/${slugify(title)}`
	let address = base
	for (let n = 2; taken.has(address); n++) address = `${base}-${n}`
	const body = emptyBody()
	let inserted: SectionRow[]
	try {
		inserted = await lc.d
			.insert(schema.sections)
			.values({
				id: crypto.randomUUID(),
				documentId: document.id,
				parentId: parent.id,
				address,
				canonical: false,
				printedNumber: null,
				title,
				headingLevel: parent.headingLevel === null ? null : parent.headingLevel + 1,
				orderIndex,
				stepNumber: parent.stepNumber,
				ownership: 'owned',
				added: true,
				bodyJson: body,
				draftHash: await publishableHash(body, document.subject, publishAsFor(document.kind)),
				// A new body, written now: its clock starts here.
				updatedAt: new Date(),
				updatedBy: input.userId,
			})
			.returning()
	} catch (error) {
		// Two subheadings of the same name added at once: the second finds the address taken.
		if (error instanceof Error && /UNIQUE/i.test(error.message))
			return refuse('A subheading of that name was added just now; try again.')
		throw error
	}
	const row = inserted[0]
	if (!row) return refuse('Could not add the subheading.')
	await reindex(lc.d, [{ ...row, body: row.bodyJson ?? null }])
	await record(lc, document.id, 'section.added', input.userId, {
		sectionId: row.id,
		address: row.address,
		title,
		parentAddress: parent.address,
	})
	void publishSectionRows(document.id, inserted)
	return { id: row.id, address: row.address }
}

/** A team renames a subheading it added. Its address stays: an address is identity. */
export async function renameSection(
	lc: Lifecycle,
	input: { sectionId: string; title: string; userId: string },
): Promise<{ id: string; title: string }> {
	const { section, document } = await sectionOf(lc, input.sectionId)
	await requireRole(lc, input.userId, document, 'member', 'rename a subheading')
	requireAdded(section, 'renamed')
	const title = titleFrom(input.title)
	const updated = await lc.d
		.update(schema.sections)
		.set({ title })
		.where(eq(schema.sections.id, section.id))
		.returning()
	const row = updated[0]
	if (!row) return refuse('Section not found.')
	await reindex(lc.d, [{ ...row, body: row.bodyJson ?? null }])
	await record(lc, document.id, 'section.renamed', input.userId, {
		sectionId: section.id,
		address: section.address,
		from: section.title,
		to: title,
	})
	void publishSectionRows(document.id, updated)
	return { id: row.id, title }
}

/**
 * A team moves a subheading it added: under `parentId` (in the same document, never
 * under itself), before the child `beforeId`, or last when null. What hangs under it
 * travels with it; the moved sections take the new place's step and heading depth. The
 * address stays: an address is identity, not position.
 */
export async function moveSection(
	lc: Lifecycle,
	input: { sectionId: string; parentId: string; beforeId: string | null; userId: string },
): Promise<{ id: string; parentId: string; orderIndex: number }> {
	const { section, document } = await sectionOf(lc, input.sectionId)
	await requireRole(lc, input.userId, document, 'member', 'move a subheading')
	requireAdded(section, 'moved')
	const rows = await treeOf(lc, document.id)
	const parent = rows.find((r) => r.id === input.parentId)
	if (!parent) return refuse('The section to move under is not in this document.')
	refuseApparatus(parent)
	const subtree = subtreeOf(rows, section.id)
	if (subtree.some((s) => s.row.id === parent.id))
		return refuse('A section cannot be moved under itself or under one of its own subheadings.')
	const siblings = childrenOf(rows, parent.id).filter((r) => r.id !== section.id)
	let orderIndex: number
	if (input.beforeId === null) orderIndex = (siblings.at(-1)?.orderIndex ?? -1) + 1
	else {
		const at = siblings.findIndex((s) => s.id === input.beforeId)
		const before = siblings[at]
		if (!before) return refuse('The section to move before is not under that heading.')
		const previous = siblings[at - 1]
		orderIndex = previous ? (previous.orderIndex + before.orderIndex) / 2 : before.orderIndex - 1
	}
	// Heading depth follows the new parent, the subtree keeping its shape under the moved one.
	const level = parent.headingLevel === null ? null : parent.headingLevel + 1
	const shift = level !== null && section.headingLevel !== null ? level - section.headingLevel : null
	const statements = subtree.map(({ row, depth }) =>
		lc.d
			.update(schema.sections)
			.set({
				stepNumber: parent.stepNumber,
				headingLevel:
					depth === 0
						? level
						: shift !== null && row.headingLevel !== null
							? row.headingLevel + shift
							: row.headingLevel,
				...(depth === 0 ? { parentId: parent.id, orderIndex } : {}),
			})
			.where(eq(schema.sections.id, row.id))
			.returning(),
	)
	const updated: SectionRow[] = []
	for (let i = 0; i < statements.length; i += 50) {
		const [first, ...rest] = statements.slice(i, i + 50)
		if (first) updated.push(...(await lc.d.batch([first, ...rest])).flat())
	}
	await record(lc, document.id, 'section.moved', input.userId, {
		sectionId: section.id,
		address: section.address,
		fromParentId: section.parentId,
		toParentAddress: parent.address,
	})
	void publishSectionRows(document.id, updated)
	return { id: section.id, parentId: parent.id, orderIndex }
}

/**
 * A team deletes a subheading it added, with everything under it — refused when anything
 * under it came from the template (that can only be hidden). Deepest first; its comments
 * go with it.
 */
export async function deleteSection(
	lc: Lifecycle,
	input: { sectionId: string; userId: string },
): Promise<{ deleted: string[] }> {
	const { section, document } = await sectionOf(lc, input.sectionId)
	await requireRole(lc, input.userId, document, 'member', 'delete a subheading')
	requireAdded(section, 'deleted')
	const subtree = subtreeOf(await treeOf(lc, document.id), section.id)
	const template = subtree.find((s) => !s.row.added)
	if (template)
		return refuse(
			`“${template.row.title ?? template.row.address}” under this subheading comes from the template and cannot be deleted; hide this subheading instead.`,
		)
	const deepestFirst = [...subtree].sort((a, b) => b.depth - a.depth).map((s) => s.row.id)
	const statements = []
	for (let i = 0; i < deepestFirst.length; i += GROUP)
		statements.push(
			lc.d.delete(schema.sections).where(inArray(schema.sections.id, deepestFirst.slice(i, i + GROUP))),
		)
	const [first, ...rest] = statements
	if (first) await lc.d.batch([first, ...rest])
	await unindex(lc.d, deepestFirst)
	await record(lc, document.id, 'section.deleted', input.userId, {
		sectionId: section.id,
		address: section.address,
		title: section.title,
		sections: deepestFirst.length,
	})
	void publishSectionDeletes(document.id, deepestFirst)
	return { deleted: deepestFirst }
}

// ---------------------------------------------------------------------------
// The quick reference guide
// ---------------------------------------------------------------------------

/** Mark a section for the quick reference guide (the point-of-care view), or unmark it. */
export async function setPointOfCare(
	lc: Lifecycle,
	input: { sectionId: string; on: boolean; userId: string },
): Promise<{ id: string; pointOfCare: boolean }> {
	const { section, document } = await sectionOf(lc, input.sectionId)
	await requireRole(lc, input.userId, document, 'member', 'mark a section for the quick reference guide')
	refuseApparatus(section)
	const updated = await updateAll(lc, [section.id], { pointOfCare: input.on })
	await record(lc, document.id, 'section.point_of_care', input.userId, {
		sectionId: section.id,
		address: section.address,
		on: input.on,
	})
	void publishSectionRows(document.id, updated)
	return { id: section.id, pointOfCare: input.on }
}
