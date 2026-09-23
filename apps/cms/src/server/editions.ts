/**
 * The edition imprint and the comparison of any two editions, as plain functions over the
 * `Lifecycle` (lifecycle.ts) so the workerd tests call them directly; `editions-fns.ts`
 * wraps them as server functions with the caller's identity.
 *
 * AN EDITION is a published or archived version: its sections are frozen in
 * `version_sections`, bodies as published, a hidden section frozen with its flag. THE
 * DRAFT is the version in work: its sections are the live `sections` rows, resolved as
 * they would publish (`resolveSections(...).publishable`). Either side of a comparison
 * may be the draft, so an edition is compared with an edition, or with the draft.
 *
 * A section is ON a side when it has a row there that is not hidden; a hidden row counts
 * as absent from the text but present in the outline, which is what tells 'hidden' and
 * 'shown' apart from 'removed' and 'added'. Unchanged sections are left out. Entries
 * group by the CURRENT outline's spine band, so the comparison reads in the order the
 * workspace shows; a section no longer in the outline reads last, in its frozen order.
 *
 * Holds no env: the worker's bindings arrive in the `Lifecycle` (lifecycle-env.ts), so
 * nothing here drags them into the client bundle.
 */

import { and, desc, eq } from 'drizzle-orm'
import { type AnnotatedBody, annotateChanges } from '#/content/diff.ts'
import type { JsonNode } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import { bandLabel, outlineOrder, SPINE_BANDS, type SpineBand, spineOf } from '#/lib/outline.ts'
import {
	changedSections,
	documentOf,
	ensureDraft,
	type Lifecycle,
	live,
	refuse,
	resolveSections,
	roleOn,
} from './lifecycle.ts'

type VersionRow = typeof schema.versions.$inferSelect
type VersionStatus = VersionRow['status']

/** An edition by its number, or the draft in work. */
export type EditionRef = number | 'draft'

// ---------------------------------------------------------------------------
// The imprint
// ---------------------------------------------------------------------------

export interface EditionEntry {
	versionNo: number
	status: VersionStatus
	label: string | null
	releaseNotes: string | null
	publishedAt: number | null
	/** Who published it, by name; null for the draft. */
	publisherName: string | null
	/** How many sections this edition changed (for the draft: changed since the published
	 *  edition, or written, before the first). Hidden sections are not counted. */
	changed: number
}

async function requireMember(lc: Lifecycle, documentId: string, userId: string) {
	const document = await documentOf(lc, documentId)
	if (!(await roleOn(lc, userId, document))) refuse('You are not a member of this document.')
	return document
}

/** Every version of the document, newest first: the draft, then the editions. */
export async function editionsOf(
	lc: Lifecycle,
	documentId: string,
	userId: string,
): Promise<EditionEntry[]> {
	await requireMember(lc, documentId, userId)
	await ensureDraft(lc, documentId, userId)
	const [versions, frozen, draftChanged] = await Promise.all([
		lc.d
			.select()
			.from(schema.versions)
			.where(eq(schema.versions.documentId, documentId))
			.orderBy(desc(schema.versions.versionNo)),
		lc.d
			.select({
				versionId: schema.versionSections.versionId,
				hidden: schema.versionSections.hidden,
				lastChangedVersionNo: schema.versionSections.lastChangedVersionNo,
			})
			.from(schema.versionSections)
			.innerJoin(schema.versions, eq(schema.versions.id, schema.versionSections.versionId))
			.where(eq(schema.versions.documentId, documentId)),
		changedSections(lc, documentId),
	])
	const numberOf = new Map(versions.map((v) => [v.id, v.versionNo]))
	const changedIn = new Map<string, number>()
	for (const f of frozen)
		if (!f.hidden && f.lastChangedVersionNo === numberOf.get(f.versionId))
			changedIn.set(f.versionId, (changedIn.get(f.versionId) ?? 0) + 1)
	// A publisher who is not a person (the import of a printed edition) goes unnamed: its
	// release notes say where the edition came from.
	const names = new Map<string, string | null>()
	for (const id of new Set(versions.flatMap((v) => (v.publishedBy ? [v.publishedBy] : []))))
		names.set(id, (await lc.auth.getUserById(id))?.name ?? null)
	return versions.map((v) => ({
		versionNo: v.versionNo,
		status: v.status,
		label: v.label,
		releaseNotes: v.releaseNotes,
		publishedAt: v.publishedAt?.getTime() ?? null,
		publisherName: v.publishedBy ? (names.get(v.publishedBy) ?? null) : null,
		changed: v.status === 'draft' ? draftChanged.length : (changedIn.get(v.id) ?? 0),
	}))
}

// ---------------------------------------------------------------------------
// Compare any two
// ---------------------------------------------------------------------------

export type CompareKind = 'added' | 'removed' | 'changed' | 'hidden' | 'shown'

/** One side of a comparison, as the page names it. */
export interface CompareSide {
	ref: EditionRef
	versionNo: number
	status: VersionStatus
	/** The edition's label, 'Edition 2', or 'Draft of edition 3'. */
	label: string
	publishedAt: number | null
}

export interface CompareEntry {
	sectionId: string
	kind: CompareKind
	/** The section's address now, or as last frozen when it is no longer in the outline. */
	address: string
	/** The top-level section it sits under, for the workspace link; null when the section is
	 *  no longer in the document. */
	part: string | null
	/** Its heading as of the later side (the draft is later than any edition). */
	printedNumber: string | null
	title: string | null
	/** The earlier-named side's body against the later-named one's: `from` → `to`. */
	annotated: AnnotatedBody
}

export interface CompareGroup {
	/** A spine band, or 'gone' for the sections no longer in the outline. */
	key: SpineBand | 'gone'
	label: string
	entries: CompareEntry[]
}

export interface Comparison {
	from: CompareSide
	to: CompareSide
	totals: Record<CompareKind, number>
	/** Non-empty groups in reading order. */
	groups: CompareGroup[]
}

/** A section as one side holds it. */
interface SideSection {
	address: string
	printedNumber: string | null
	title: string | null
	hidden: boolean
	body: JsonNode | null
	/** Its place in that side's reading order. */
	order: number
}

interface ResolvedSide {
	side: CompareSide
	sections: Map<string, SideSection>
}

const editionLabel = (v: Pick<VersionRow, 'label' | 'versionNo'>): string =>
	v.label ?? `Edition ${v.versionNo}`

/** A side read: the draft's resolved sections, or an edition's frozen ones. */
async function sideOf(
	lc: Lifecycle,
	documentId: string,
	ref: EditionRef,
	userId: string,
): Promise<ResolvedSide> {
	if (ref === 'draft') {
		const draft = await ensureDraft(lc, documentId, userId)
		const resolved = await resolveSections(lc, documentId)
		return {
			side: {
				ref,
				versionNo: draft.versionNo,
				status: 'draft',
				label: `Draft of edition ${draft.versionNo}`,
				publishedAt: null,
			},
			// resolveSections returns reading order.
			sections: new Map(
				resolved.map((s, order) => [
					s.row.id,
					{
						address: s.row.address,
						printedNumber: s.row.printedNumber,
						title: s.row.title,
						hidden: !live(s),
						body: s.publishable,
						order,
					},
				]),
			),
		}
	}
	const version = (
		await lc.d
			.select()
			.from(schema.versions)
			.where(and(eq(schema.versions.documentId, documentId), eq(schema.versions.versionNo, ref)))
			.limit(1)
	)[0]
	if (!version) return refuse(`There is no edition ${ref} of this document.`)
	if (version.status === 'draft')
		return refuse(`Edition ${ref} is the draft in work and has not been published.`)
	const rows = await lc.d
		.select({
			sectionId: schema.versionSections.sectionId,
			parentAddress: schema.versionSections.parentAddress,
			address: schema.versionSections.address,
			title: schema.versionSections.title,
			printedNumber: schema.versionSections.printedNumber,
			orderIndex: schema.versionSections.orderIndex,
			hidden: schema.versionSections.hidden,
			bodyJson: schema.versionSections.bodyJson,
		})
		.from(schema.versionSections)
		.where(eq(schema.versionSections.versionId, version.id))
	// Frozen rows name their parent by address: the outline is rebuilt on addresses.
	const ordered = outlineOrder(
		rows.map((r) => ({ ...r, id: r.address, parentId: r.parentAddress })),
	)
	return {
		side: {
			ref,
			versionNo: version.versionNo,
			status: version.status,
			label: editionLabel(version),
			publishedAt: version.publishedAt?.getTime() ?? null,
		},
		sections: new Map(
			ordered.map((r, order) => [
				r.sectionId,
				{
					address: r.address,
					printedNumber: r.printedNumber,
					title: r.title,
					hidden: r.hidden,
					body: r.bodyJson ?? null,
					order,
				},
			]),
		),
	}
}

const sameBody = (a: JsonNode | null, b: JsonNode | null): boolean =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** How a section differs from `before` to `after`, or null when it reads the same. */
function kindOf(before: SideSection | undefined, after: SideSection | undefined): CompareKind | null {
	const was = before !== undefined && !before.hidden
	const is = after !== undefined && !after.hidden
	if (was && is) return sameBody(before.body, after.body) ? null : 'changed'
	if (was) return after ? 'hidden' : 'removed'
	if (is) return before ? 'shown' : 'added'
	return null
}

/** Which ref is later in the document's life: the draft is later than any edition. */
const rank = (ref: EditionRef): number => (ref === 'draft' ? Number.POSITIVE_INFINITY : ref)

/**
 * Every section that reads differently between `from` and `to`, annotated from → to and
 * grouped by the current outline's spine band. Members only.
 */
export async function compareEditions(
	lc: Lifecycle,
	input: { documentId: string; from: EditionRef; to: EditionRef; userId: string },
): Promise<Comparison> {
	await requireMember(lc, input.documentId, input.userId)
	if (input.from === input.to) refuse('Choose two different editions to compare.')
	const [from, to, current] = await Promise.all([
		sideOf(lc, input.documentId, input.from, input.userId),
		sideOf(lc, input.documentId, input.to, input.userId),
		lc.d
			.select({
				id: schema.sections.id,
				parentId: schema.sections.parentId,
				orderIndex: schema.sections.orderIndex,
				stepNumber: schema.sections.stepNumber,
				address: schema.sections.address,
			})
			.from(schema.sections)
			.where(eq(schema.sections.documentId, input.documentId)),
	])
	const [earlier, later] = rank(input.from) < rank(input.to) ? [from, to] : [to, from]

	// The current outline: each section's band, reading position and part.
	const bandOf = new Map<string, SpineBand>()
	const position = new Map<string, number>()
	for (const band of spineOf(current))
		for (const s of band.sections) {
			bandOf.set(s.id, band.band)
			position.set(s.id, position.size)
		}
	const byId = new Map(current.map((s) => [s.id, s]))
	const partOf = (id: string): string | null => {
		let at = byId.get(id)
		while (at?.parentId) {
			const parent = byId.get(at.parentId)
			if (!parent) break
			at = parent
		}
		return at?.address ?? null
	}

	const totals: Record<CompareKind, number> = { added: 0, removed: 0, changed: 0, hidden: 0, shown: 0 }
	const grouped = new Map<SpineBand | 'gone', { entry: CompareEntry; order: number }[]>()
	for (const id of new Set([...from.sections.keys(), ...to.sections.keys()])) {
		const before = from.sections.get(id)
		const after = to.sections.get(id)
		const kind = kindOf(before, after)
		if (!kind) continue
		const annotated = annotateChanges(
			before && !before.hidden ? before.body : null,
			after && !after.hidden ? after.body : null,
		)
		// A body whose JSON differs but whose document is equal is no change to read.
		if (kind === 'changed' && !annotated.changed) continue
		const heading = later.sections.get(id) ?? earlier.sections.get(id)
		if (!heading) continue
		const inOutline = byId.get(id)
		const band = bandOf.get(id)
		const key: SpineBand | 'gone' = inOutline && band !== undefined ? band : 'gone'
		const entry: CompareEntry = {
			sectionId: id,
			kind,
			address: inOutline?.address ?? heading.address,
			part: inOutline ? partOf(id) : null,
			printedNumber: heading.printedNumber,
			title: heading.title,
			annotated,
		}
		totals[kind] += 1
		const list = grouped.get(key) ?? []
		list.push({ entry, order: key === 'gone' ? heading.order : (position.get(id) ?? 0) })
		grouped.set(key, list)
	}

	const keys: (SpineBand | 'gone')[] = [...SPINE_BANDS, 'gone']
	return {
		from: from.side,
		to: to.side,
		totals,
		groups: keys.flatMap((key) => {
			const list = grouped.get(key)
			if (!list || list.length === 0) return []
			return [
				{
					key,
					label: key === 'gone' ? 'No longer in the document' : bandLabel(key),
					entries: list.sort((a, b) => a.order - b.order).map((e) => e.entry),
				},
			]
		}),
	}
}
