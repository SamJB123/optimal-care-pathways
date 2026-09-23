/**
 * The front door's data (decisions U1, U11, U20, S1): the ATLAS a signed-in member lands
 * on — every document they can see as a row against the seven-step spine, one tick per
 * section — and the public LIBRARY a signed-out visitor lands on, plus the index the jump
 * (⌘K) searches.
 *
 * A tick's state is read without a single body: a section's `draft_hash` beside its
 * published version's `body_hash` says "changed since published"; the current review's
 * sections say "in review" and how they were decided. So the whole atlas is a handful of
 * narrow queries whatever the size of the documents.
 */

import { createServerFn } from '@tanstack/solid-start'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { inGroups, schema } from '#/db/index.ts'
import { documentName } from '#/lib/labels.ts'
import { type SpineBand, spineOf } from '#/lib/outline.ts'
import { OCP_NAMESPACE, ROLE_LADDER, type Role } from '#/lib/roles.ts'
import * as access from './access.ts'
import { envOf, requireUser } from './env.ts'

/** A tick: published unchanged, changed in the draft, new since (or never) published; and
 *  under review — undecided, approved, changes requested. */
export type TickState = 'published' | 'changed' | 'new' | 'review' | 'approved' | 'changes'

export interface AtlasBand {
	band: SpineBand
	/** The part a click on the band opens: the address of its first top-level section. */
	part: string | null
	ticks: TickState[]
}

export interface AtlasRow {
	id: string
	kind: 'core' | 'pathway'
	audience: 'cancer' | 'population' | 'principles'
	slug: string
	name: string
	title: string
	subject: string
	accent: string | null
	/** A legacy import still waiting for its organisation (the admin door). */
	pending: boolean
	role: Role
	published: { versionNo: number; label: string | null; publishedAt: number | null } | null
	draft: { versionNo: number | null; changed: number; sections: number }
	review: { total: number; decided: number; decision: 'approved' | 'changes_requested' | null } | null
	lastChange: { at: number; by: string | null } | null
	bands: AtlasBand[]
}

export interface AtlasSnapshot {
	rows: AtlasRow[]
	central: boolean
	/** The core documents wait for the central organisation: the set-up door is open. */
	setUp: boolean
	/** Imports waiting for their organisations. */
	pending: number
	/** The server's clock, so "3 h ago" reads the same on both sides of hydration. */
	now: number
}

type SectionLite = {
	id: string
	documentId: string
	parentId: string | null
	address: string
	printedNumber: string | null
	title: string | null
	orderIndex: number
	stepNumber: number | null
	hidden: boolean
	apparatus: boolean
	draftHash: string | null
	updatedAt: Date | null
	updatedBy: string | null
}

/** What the caller may see, and in what role: the one visibility rule of the documents
 *  topic (a member sees their organisations' documents; a central member sees all). */
async function visibleDocuments(userId: string) {
	const { env, d } = await envOf()
	const memberships = await env.AUTH.listUserOrgs(userId, OCP_NAMESPACE)
	const orgIds = memberships.map((m) => m.organizationId)
	const central = await access.centralOrgId(env.AUTH, d)
	const isCentral = central !== null && orgIds.includes(central)
	const rows = isCentral
		? await d.select().from(schema.documents)
		: orgIds.length === 0
			? []
			: await inGroups(orgIds, (group) => d.select().from(schema.documents).where(inArray(schema.documents.orgId, group)))
	const roleByOrg = new Map(memberships.map((m) => [m.organizationId, ROLE_LADDER.find((r) => r === m.role) ?? null]))
	const withRole = rows.flatMap((row) => {
		const role = roleByOrg.get(row.orgId) ?? (isCentral ? ('admin' as const) : null)
		return role ? [{ row, role }] : []
	})
	return { documents: withRole, central: isCentral, setUp: central === null }
}

const live = (s: SectionLite) => !s.hidden && !s.apparatus

/** Every tick state of one document, keyed by section id. */
function tickStates(
	sections: SectionLite[],
	published: Map<string, string | null> | null,
	decisions: Map<string, 'approved' | 'changes_requested' | null> | null,
): Map<string, TickState> {
	const out = new Map<string, TickState>()
	for (const s of sections) {
		if (decisions?.has(s.id)) {
			const decision = decisions.get(s.id)
			out.set(s.id, decision === 'approved' ? 'approved' : decision === 'changes_requested' ? 'changes' : 'review')
			continue
		}
		if (!published?.has(s.id)) out.set(s.id, 'new')
		else out.set(s.id, s.draftHash !== null && s.draftHash === published.get(s.id) ? 'published' : 'changed')
	}
	return out
}

/** The signed-in front door: every visible document against the spine. */
export const atlasSnapshot = createServerFn({ method: 'GET' }).handler(async ({ context }): Promise<AtlasSnapshot> => {
	const userId = requireUser(context.userId)
	const { env, d } = await envOf()
	const { documents, central, setUp } = await visibleDocuments(userId)
	const ids = documents.map((x) => x.row.id)
	if (ids.length === 0) return { rows: [], central, setUp, pending: 0, now: Date.now() }

	const sectionColumns = {
		id: schema.sections.id,
		documentId: schema.sections.documentId,
		parentId: schema.sections.parentId,
		address: schema.sections.address,
		printedNumber: schema.sections.printedNumber,
		title: schema.sections.title,
		orderIndex: schema.sections.orderIndex,
		stepNumber: schema.sections.stepNumber,
		hidden: schema.sections.hidden,
		apparatus: schema.sections.apparatus,
		draftHash: schema.sections.draftHash,
		updatedAt: schema.sections.updatedAt,
		updatedBy: schema.sections.updatedBy,
	}
	const [sections, versions, publishedHashes] = await Promise.all([
		central
			? d.select(sectionColumns).from(schema.sections)
			: inGroups(ids, (group) => d.select(sectionColumns).from(schema.sections).where(inArray(schema.sections.documentId, group))),
		inGroups(ids, (group) =>
			d
				.select({
					id: schema.versions.id,
					documentId: schema.versions.documentId,
					status: schema.versions.status,
					versionNo: schema.versions.versionNo,
					label: schema.versions.label,
					publishedAt: schema.versions.publishedAt,
				})
				.from(schema.versions)
				.where(and(inArray(schema.versions.documentId, group), inArray(schema.versions.status, ['draft', 'published']))),
		),
		inGroups(ids, (group) =>
			d
				.select({
					documentId: schema.versions.documentId,
					sectionId: schema.versionSections.sectionId,
					bodyHash: schema.versionSections.bodyHash,
				})
				.from(schema.versionSections)
				.innerJoin(schema.versions, eq(schema.versions.id, schema.versionSections.versionId))
				.where(and(eq(schema.versions.status, 'published'), inArray(schema.versions.documentId, group))),
		),
	])
	const drafts = versions.filter((v) => v.status === 'draft')
	const reviews = await inGroups(
		drafts.map((v) => v.id),
		(group) =>
			d
				.select()
				.from(schema.reviewState)
				.where(and(inArray(schema.reviewState.versionId, group), eq(schema.reviewState.superseded, 0))),
	)
	const reviewSections = await inGroups(
		reviews.map((r) => r.reviewId),
		(group) => d.select().from(schema.reviewSections).where(inArray(schema.reviewSections.reviewId, group)),
	)

	const byDocument = <T extends { documentId: string }>(rows: T[]) => {
		const map = new Map<string, T[]>()
		for (const r of rows) map.set(r.documentId, [...(map.get(r.documentId) ?? []), r])
		return map
	}
	const sectionsOf = byDocument(sections)
	const hashesOf = byDocument(publishedHashes)
	const reviewOf = new Map(reviews.map((r) => [r.documentId, r]))
	const decisionsOf = new Map<string, Map<string, 'approved' | 'changes_requested' | null>>()
	for (const r of reviews)
		decisionsOf.set(
			r.documentId,
			new Map(reviewSections.filter((s) => s.reviewId === r.reviewId).map((s) => [s.sectionId, s.decision])),
		)

	// The last change per document, and who made it.
	const lastOf = new Map<string, { at: number; by: string | null }>()
	for (const s of sections) {
		const at = s.updatedAt?.getTime()
		if (!at) continue
		const current = lastOf.get(s.documentId)
		if (!current || at > current.at) lastOf.set(s.documentId, { at, by: s.updatedBy })
	}
	const people = await env.AUTH.getUsersByIds([...new Set([...lastOf.values()].flatMap((l) => (l.by ? [l.by] : [])))])

	const rows: AtlasRow[] = documents.map(({ row, role }) => {
		const mine = sectionsOf.get(row.id) ?? []
		const published = versions.find((v) => v.documentId === row.id && v.status === 'published')
		const draft = versions.find((v) => v.documentId === row.id && v.status === 'draft')
		const hashes = published ? new Map((hashesOf.get(row.id) ?? []).map((h) => [h.sectionId, h.bodyHash])) : null
		const review = reviewOf.get(row.id)
		const states = tickStates(mine, hashes, decisionsOf.get(row.id) ?? null)
		const bands = spineOf(mine, live).map(
			(b): AtlasBand => ({
				band: b.band,
				part: b.roots[0]?.address ?? null,
				ticks: b.sections.map((s) => states.get(s.id) ?? 'new'),
			}),
		)
		const counted = bands.flatMap((b) => b.ticks)
		const last = lastOf.get(row.id)
		return {
			id: row.id,
			kind: row.kind,
			audience: row.audience,
			slug: row.slug,
			name: documentName(row),
			title: row.title,
			subject: row.subject,
			accent: row.accent,
			pending: row.orgId.startsWith('pending:'),
			role,
			published: published
				? { versionNo: published.versionNo, label: published.label, publishedAt: published.publishedAt?.getTime() ?? null }
				: null,
			draft: {
				versionNo: draft?.versionNo ?? null,
				changed: counted.filter((t) => t !== 'published').length,
				sections: counted.length,
			},
			review: review ? { total: review.total, decided: review.decided, decision: review.decision } : null,
			lastChange: last ? { at: last.at, by: last.by ? (people[last.by]?.name ?? null) : null } : null,
			bands,
		}
	})
	return { rows, central, setUp, pending: rows.filter((r) => r.pending).length, now: Date.now() }
})

export interface AtlasCellSection {
	address: string
	part: string
	label: string
	state: TickState
	updatedAt: number | null
	by: string | null
}

/** One band of one document, section by section: what the atlas's hover card lists. */
export const atlasCell = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: z.string().min(1).max(64), band: z.union([z.literal('front'), z.literal('back'), z.number().int().min(1).max(7)]) }))
	.handler(async ({ data, context }): Promise<AtlasCellSection[]> => {
		const userId = requireUser(context.userId)
		const { env, d } = await envOf()
		const document = (await d.select().from(schema.documents).where(eq(schema.documents.id, data.documentId)).limit(1))[0]
		if (!document || !(await access.documentRoleOf(env.AUTH, d, userId, document.orgId))) throw new Error('You are not a member of this document.')
		const sections = await d
			.select({
				id: schema.sections.id,
				documentId: schema.sections.documentId,
				parentId: schema.sections.parentId,
				address: schema.sections.address,
				printedNumber: schema.sections.printedNumber,
				title: schema.sections.title,
				orderIndex: schema.sections.orderIndex,
				stepNumber: schema.sections.stepNumber,
				hidden: schema.sections.hidden,
				apparatus: schema.sections.apparatus,
				draftHash: schema.sections.draftHash,
				updatedAt: schema.sections.updatedAt,
				updatedBy: schema.sections.updatedBy,
			})
			.from(schema.sections)
			.where(eq(schema.sections.documentId, data.documentId))
		const band = spineOf(sections, live).find((b) => b.band === data.band)
		if (!band) return []
		const published = (
			await d
				.select({ id: schema.versions.id })
				.from(schema.versions)
				.where(and(eq(schema.versions.documentId, data.documentId), eq(schema.versions.status, 'published')))
				.limit(1)
		)[0]
		const hashes = published
			? new Map(
					(
						await d
							.select({ sectionId: schema.versionSections.sectionId, bodyHash: schema.versionSections.bodyHash })
							.from(schema.versionSections)
							.where(eq(schema.versionSections.versionId, published.id))
					).map((h) => [h.sectionId, h.bodyHash]),
				)
			: null
		const draft = (
			await d
				.select({ id: schema.versions.id })
				.from(schema.versions)
				.where(and(eq(schema.versions.documentId, data.documentId), eq(schema.versions.status, 'draft')))
				.limit(1)
		)[0]
		const review = draft
			? (
					await d
						.select()
						.from(schema.reviewState)
						.where(and(eq(schema.reviewState.versionId, draft.id), eq(schema.reviewState.superseded, 0)))
						.orderBy(desc(schema.reviewState.requestedAt))
						.limit(1)
				)[0]
			: undefined
		const decisions = review
			? new Map(
					(await d.select().from(schema.reviewSections).where(eq(schema.reviewSections.reviewId, review.reviewId))).map((s) => [
						s.sectionId,
						s.decision,
					]),
				)
			: null
		const states = tickStates(band.sections, hashes, decisions)
		const people = await env.AUTH.getUsersByIds([...new Set(band.sections.flatMap((s) => (s.updatedBy ? [s.updatedBy] : [])))])
		const rootOf = new Map<string, string>()
		const byId = new Map(sections.map((s) => [s.id, s]))
		for (const s of band.sections) {
			let at = s
			for (let parent = at.parentId ? byId.get(at.parentId) : undefined; parent; parent = at.parentId ? byId.get(at.parentId) : undefined) at = parent
			rootOf.set(s.id, at.address)
		}
		return band.sections.map((s) => ({
			address: s.address,
			part: rootOf.get(s.id) ?? s.address,
			label: [s.printedNumber, s.title ?? s.address].filter(Boolean).join(' '),
			state: states.get(s.id) ?? 'new',
			updatedAt: s.updatedAt?.getTime() ?? null,
			by: s.updatedBy ? (people[s.updatedBy]?.name ?? null) : null,
		}))
	})

export interface LibraryEntry {
	slug: string
	kind: 'core' | 'pathway'
	audience: 'cancer' | 'population' | 'principles'
	name: string
	title: string
	accent: string | null
	versionNo: number
	label: string | null
	publishedAt: number | null
	/** The first line of the edition's release notes. */
	note: string | null
	/** Whether the pathway has sections marked for the quick reference guide. */
	guide: boolean
}

/** The public front door: every published document. No sign-in. */
export const publicLibrary = createServerFn({ method: 'GET' }).handler(async (): Promise<LibraryEntry[]> => {
	const { d } = await envOf()
	const published = await d.select().from(schema.publishedVersions)
	const guides = new Set(
		(
			await d
				.selectDistinct({ documentId: schema.publishedSections.documentId })
				.from(schema.publishedSections)
				.where(eq(schema.publishedSections.pointOfCare, true))
		).map((g) => g.documentId),
	)
	const accents = new Map(
		(await d.select({ id: schema.documents.id, accent: schema.documents.accent }).from(schema.documents)).map((a) => [a.id, a.accent]),
	)
	return published
		.filter((p) => p.kind === 'pathway' || p.audience === 'principles')
		.map((p) => ({
			slug: p.slug,
			kind: p.kind,
			audience: p.audience,
			name: documentName(p),
			title: p.title,
			accent: accents.get(p.documentId) ?? null,
			versionNo: p.versionNo,
			label: p.label,
			publishedAt: p.publishedAt?.getTime() ?? null,
			note: p.releaseNotes?.split('\n').find((line) => line.trim())?.trim() ?? null,
			guide: guides.has(p.documentId),
		}))
})

export interface JumpDocument {
	id: string | null
	slug: string
	name: string
	title: string
	subject: string
	kind: 'core' | 'pathway'
	published: boolean
}

/** What the jump lists before anything is typed: the documents the caller can open, and
 *  every published page. Signed out, the published pages only. */
export const jumpIndex = createServerFn({ method: 'GET' }).handler(async ({ context }): Promise<JumpDocument[]> => {
	const { d } = await envOf()
	const published = await d.select().from(schema.publishedVersions)
	const publishedSlugs = new Set(published.map((p) => p.slug))
	if (!context.userId)
		return published.map((p) => ({
			id: null,
			slug: p.slug,
			name: documentName(p),
			title: p.title,
			subject: p.subject,
			kind: p.kind,
			published: true,
		}))
	const { documents } = await visibleDocuments(context.userId)
	return documents.map(({ row }) => ({
		id: row.id,
		slug: row.slug,
		name: documentName(row),
		title: row.title,
		subject: row.subject,
		kind: row.kind,
		published: publishedSlugs.has(row.slug),
	}))
})
