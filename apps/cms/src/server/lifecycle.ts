/**
 * The review and publish lifecycle (decisions 95–99, 107–121), as plain functions over
 * the content database and the worker's bindings so the workerd tests exercise them
 * directly; `lifecycle-fns.ts` wraps them as server functions with the caller's identity.
 *
 * THE MODEL. A document always has one DRAFT version whose content is the live
 * `sections` rows; publishing freezes those (resolved, rendered) into `version_sections`,
 * marks the draft published, archives the incumbent and opens the next draft. A review
 * is of the draft and covers the sections whose RESOLVED body differs from the published
 * version; it pins each such section's body hash, and its decision is the roll-up of the
 * sections' (the `review_state` view). Publishing requires the latest review approved
 * with every pinned hash still matching, no blocking placeholder, and — for a pathway —
 * a published core. Review cycles ARE publish cycles: the diff and the change set are
 * always against the published version, never against an earlier review.
 *
 * SHARED CONTENT IS READ, NEVER COPIED. A pathway's shared section resolves to the core
 * section's PUBLISHED body (its draft while the core has never published, so authors can
 * see something); citations name reference rows by id wherever they live.
 */

import { and, desc, eq, inArray } from 'drizzle-orm'
import { cacheTagFor, PUBLISHED_CACHE_TAG } from '#/api/published.ts'
import {
	citationNumbers,
	citedBody,
	type DerivedView,
	openChoicesIn,
	openItemsIn,
	timeframeRows,
} from '#/content/derived.ts'
import { type AnnotatedBody, annotateChanges, bodyHash } from '#/content/diff.ts'
import { bodyToMarkdown } from '#/content/markdown.ts'
import {
	blockingPlaceholders,
	publishAsFor,
	publishableHash,
	publishBody,
} from '#/content/publish.ts'
import type { JsonNode } from '#/content/schema.ts'
import type { Db } from '#/db/index.ts'
import { inGroups, schema } from '#/db/index.ts'
import type { ReviewChange } from '#/db/schema.ts'
import { publishDocumentRows, publishSectionRows } from '#/lib/live-publish.ts'
import { outlineOrder } from '#/lib/outline.ts'
import { OCP_NAMESPACE, ROLE_LADDER, type Role } from '#/lib/roles.ts'
import { documentRoomName } from '#/rooms/document-room.ts'
import { documentRole, type MembershipAuth } from './access.ts'
import { indexPublishedVersion } from './search-index.ts'

type DocumentRow = typeof schema.documents.$inferSelect
type SectionRow = typeof schema.sections.$inferSelect
type VersionRow = typeof schema.versions.$inferSelect
export type ReviewStateRow = typeof schema.reviewState.$inferSelect
export type CommentRow = typeof schema.comments.$inferSelect

/** What the lifecycle needs from the worker: the database, the auth service for roles and
 *  mail, and the document rooms to fold live bodies before a snapshot. */
export interface Lifecycle {
	d: Db
	auth: MembershipAuth & {
		getUserById(userId: string): Promise<{ id: string; name: string; email: string } | null>
		listOrgMembers(
			organizationId: string,
			namespace?: string,
		): Promise<{ userId: string; role: string; name: string; email: string }[]>
		sendNotification(mail: { to: string[]; subject: string; text: string }): Promise<unknown>
	}
	rooms: {
		get(id: DurableObjectId): { foldAll(): Promise<number> }
		idFromName(name: string): DurableObjectId
	}
	/** The central organisation's id (the publisher); null before bootstrap. */
	centralOrgId(): Promise<string | null>
	/** Where the site lives, for links in mail. */
	origin: string
	/** A body as published HTML (decision 97): the site's own renderer, run to a string.
	 *  Injected so this module stays free of the view layer and the runtime tests can
	 *  run it without compiling Solid. */
	renderHtml(body: JsonNode, derived: DerivedView): string
	/** Drop cached responses carrying these tags (the document's PDF, decision 126);
	 *  best-effort, after the publish has committed. */
	purge?(tags: string[]): Promise<void>
}

export class LifecycleRefusal extends Error {}

/** A declaration, not an arrow: only so does a call narrow what follows it (`if (!row)
 *  refuse(…)` leaves `row` defined). */
export function refuse(message: string): never {
	throw new LifecycleRefusal(message)
}

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

/** The one access rule (access.ts), with the lifecycle's own central-organisation source. */
export async function roleOn(
	lc: Lifecycle,
	userId: string,
	document: DocumentRow,
): Promise<Role | null> {
	return documentRole(lc.auth, userId, document.orgId, await lc.centralOrgId())
}

const atLeast = (role: Role | null, floor: Role): boolean =>
	role !== null && ROLE_LADDER.indexOf(role) >= ROLE_LADDER.indexOf(floor)

export async function requireRole(
	lc: Lifecycle,
	userId: string,
	document: DocumentRow,
	floor: Role,
	what: string,
): Promise<Role> {
	const role = await roleOn(lc, userId, document)
	if (role === null || !atLeast(role, floor))
		refuse(`Only a ${floor === 'member' ? 'drafter' : 'reviewer'} or above may ${what}.`)
	return role
}

async function requireCentral(lc: Lifecycle, userId: string, what: string): Promise<string> {
	const central = await lc.centralOrgId()
	if (!central) refuse('The central organisation has not been set up yet.')
	const membership = await lc.auth.getOrgMembershipById(userId, central, OCP_NAMESPACE)
	if (!membership) refuse(`Only members of the central organisation may ${what}.`)
	return central
}

export async function documentOf(lc: Lifecycle, documentId: string): Promise<DocumentRow> {
	const row = (
		await lc.d.select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1)
	)[0]
	if (!row) refuse('Document not found.')
	return row
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

/** The document's draft version, opened now if it has none (a seeded core document, a
 *  document created before versions existed). */
export async function ensureDraft(
	lc: Lifecycle,
	documentId: string,
	userId: string,
): Promise<VersionRow> {
	const existing = (
		await lc.d
			.select()
			.from(schema.versions)
			.where(and(eq(schema.versions.documentId, documentId), eq(schema.versions.status, 'draft')))
			.limit(1)
	)[0]
	if (existing) return existing
	const latest = (
		await lc.d
			.select({ versionNo: schema.versions.versionNo })
			.from(schema.versions)
			.where(eq(schema.versions.documentId, documentId))
			.orderBy(desc(schema.versions.versionNo))
			.limit(1)
	)[0]
	const inserted = await lc.d
		.insert(schema.versions)
		.values({
			id: crypto.randomUUID(),
			documentId,
			status: 'draft',
			versionNo: (latest?.versionNo ?? 0) + 1,
			createdBy: userId,
		})
		.returning()
	const row = inserted[0]
	if (!row) refuse('Could not open a draft version.')
	return row
}

/** The document's published version, or null. */
export async function publishedVersion(lc: Lifecycle, documentId: string) {
	return (
		(
			await lc.d
				.select()
				.from(schema.publishedVersions)
				.where(eq(schema.publishedVersions.documentId, documentId))
				.limit(1)
		)[0] ?? null
	)
}

/** Section id → body as published, for the document's published version. */
async function publishedBodies(
	lc: Lifecycle,
	documentId: string,
): Promise<Map<string, JsonNode | null>> {
	const rows = await lc.d
		.select({
			sectionId: schema.publishedSections.sectionId,
			bodyJson: schema.publishedSections.bodyJson,
		})
		.from(schema.publishedSections)
		.where(eq(schema.publishedSections.documentId, documentId))
	return new Map(rows.map((r) => [r.sectionId, r.bodyJson ?? null]))
}

// ---------------------------------------------------------------------------
// Resolving bodies
// ---------------------------------------------------------------------------

export interface ResolvedSection {
	row: SectionRow
	/** The body this section renders: its own, or its core section's. */
	body: JsonNode | null
	/** The body as it would publish (guidance stripped, subject filled): what "changed
	 *  since the published version", a review's pin and the diff are all measured on, so
	 *  ticking guidance done or filling the subject is never a change to review. */
	publishable: JsonNode | null
	/** For a shared section: whether the core body is the core's published one or, the
	 *  core never having published, its draft. */
	coreSource: 'published' | 'draft' | null
}

/**
 * Every section of a document with its resolved body. A shared section takes the core
 * section's body as PUBLISHED (decision 98); while the core has never published it takes
 * the core's draft, flagged, so a pathway can be authored against a core still in work.
 */
export async function resolveSections(
	lc: Lifecycle,
	documentId: string,
): Promise<ResolvedSection[]> {
	const document = await documentOf(lc, documentId)
	const rows = await lc.d
		.select()
		.from(schema.sections)
		.where(eq(schema.sections.documentId, documentId))
	const coreIds = rows.flatMap((r) =>
		r.ownership === 'shared' && r.coreSectionId ? [r.coreSectionId] : [],
	)
	const cores = new Map<string, { body: JsonNode | null; source: 'published' | 'draft' }>()
	if (coreIds.length > 0) {
		const published = await inGroups(coreIds, (group) =>
			lc.d
				.select({
					sectionId: schema.publishedSections.sectionId,
					bodyJson: schema.publishedSections.bodyJson,
				})
				.from(schema.publishedSections)
				.where(inArray(schema.publishedSections.sectionId, group)),
		)
		for (const p of published)
			cores.set(p.sectionId, { body: p.bodyJson ?? null, source: 'published' })
		const missing = coreIds.filter((id) => !cores.has(id))
		if (missing.length > 0) {
			const drafts = await inGroups(missing, (group) =>
				lc.d
					.select({ id: schema.sections.id, bodyJson: schema.sections.bodyJson })
					.from(schema.sections)
					.where(inArray(schema.sections.id, group)),
			)
			for (const c of drafts) cores.set(c.id, { body: c.bodyJson ?? null, source: 'draft' })
		}
	}
	return outlineOrder(rows).map((row) => {
		const shared =
			row.ownership === 'shared' && row.coreSectionId ? cores.get(row.coreSectionId) : undefined
		const body =
			row.ownership === 'shared' && row.coreSectionId
				? (shared?.body ?? null)
				: (row.bodyJson ?? null)
		return {
			row,
			body,
			publishable: publishBody(body, document.subject, publishAsFor(document.kind)),
			coreSource:
				row.ownership === 'shared' && row.coreSectionId ? (shared?.source ?? 'draft') : null,
		}
	})
}

export const live = (s: ResolvedSection): boolean => !s.row.hidden && !s.row.apparatus

const sameBody = (a: JsonNode | null, b: JsonNode | null): boolean =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The live sections whose resolved body differs from the published version's. */
export async function changedSections(
	lc: Lifecycle,
	documentId: string,
): Promise<ResolvedSection[]> {
	return (await reviewableChanges(lc, documentId)).text
}

/** Section id → hidden, as the published version froze it; empty when never published. */
async function hiddenWhenPublished(
	lc: Lifecycle,
	documentId: string,
): Promise<Map<string, boolean>> {
	const published = await publishedVersion(lc, documentId)
	if (!published) return new Map()
	const frozen = await lc.d
		.select({ sectionId: schema.versionSections.sectionId, hidden: schema.versionSections.hidden })
		.from(schema.versionSections)
		.where(eq(schema.versionSections.versionId, published.versionId))
	return new Map(frozen.map((f) => [f.sectionId, f.hidden]))
}

/** A hidden section that stands for its subtree: hidden, and its parent is not. */
const topHidden = <T extends { hidden: boolean; parentId: string | null }>(
	row: T,
	byId: Map<string, T>,
): boolean => row.hidden && !(row.parentId !== null && byId.get(row.parentId)?.hidden)

/**
 * What a review decides and a publish carries, against the published version: the TEXT
 * changes (live sections whose resolved body differs) and the REMOVALS (sections hidden
 * since, each the top of its hidden subtree). A draft that only hides sections is still
 * a change to review and publish.
 */
export async function reviewableChanges(
	lc: Lifecycle,
	documentId: string,
): Promise<{
	text: ResolvedSection[]
	removals: ResolvedSection[]
	/** Both, in reading order. */
	all: { section: ResolvedSection; change: ReviewChange }[]
}> {
	const [resolved, published, before] = await Promise.all([
		resolveSections(lc, documentId),
		publishedBodies(lc, documentId),
		hiddenWhenPublished(lc, documentId),
	])
	const byId = new Map(resolved.map((s) => [s.row.id, s.row]))
	const all = resolved.flatMap((s): { section: ResolvedSection; change: ReviewChange }[] =>
		live(s) && !sameBody(s.publishable, published.get(s.row.id) ?? null)
			? [{ section: s, change: 'text' }]
			: !s.row.apparatus && topHidden(s.row, byId) && before.get(s.row.id) !== true
				? [{ section: s, change: 'removal' }]
				: [],
	)
	return {
		text: all.filter((c) => c.change === 'text').map((c) => c.section),
		removals: all.filter((c) => c.change === 'removal').map((c) => c.section),
		all,
	}
}

/** Fold every live body of the document's room into D1 before reading the draft. */
export async function foldRoom(lc: Lifecycle, documentId: string): Promise<void> {
	await lc.rooms.get(lc.rooms.idFromName(documentRoomName(documentId))).foldAll()
}

// ---------------------------------------------------------------------------
// Events and mail
// ---------------------------------------------------------------------------

export async function record(
	lc: Lifecycle,
	documentId: string,
	kind: string,
	actorId: string,
	detail: Record<string, unknown> = {},
): Promise<void> {
	const actor = await lc.auth.getUserById(actorId)
	await lc.d.insert(schema.events).values({
		id: crypto.randomUUID(),
		documentId,
		kind,
		actorId,
		actorName: actor?.name ?? actorId,
		detail,
	})
}

/** Members of the document's organisation at or above a role, as mail recipients. */
async function recipients(lc: Lifecycle, document: DocumentRow, floor: Role): Promise<string[]> {
	const members = await lc.auth.listOrgMembers(document.orgId, OCP_NAMESPACE)
	return members
		.filter((m) => atLeast(ROLE_LADDER.find((r) => r === m.role) ?? null, floor))
		.map((m) => m.email)
}

/** Best-effort: a notification never fails the action it reports. */
async function notify(lc: Lifecycle, to: string[], subject: string, text: string): Promise<void> {
	try {
		await lc.auth.sendNotification({ to, subject, text })
	} catch (error) {
		console.error(
			'[lifecycle] notification failed:',
			error instanceof Error ? error.message : error,
		)
	}
}

const documentLink = (lc: Lifecycle, documentId: string) => `${lc.origin}/d/${documentId}`

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

/** The latest review of the document's draft, with its derived state; null when none. */
export async function currentReview(
	lc: Lifecycle,
	documentId: string,
	draftId: string,
): Promise<ReviewStateRow | null> {
	const rows = await lc.d
		.select()
		.from(schema.reviewState)
		.where(
			and(eq(schema.reviewState.documentId, documentId), eq(schema.reviewState.versionId, draftId)),
		)
		.orderBy(desc(schema.reviewState.requestedAt))
		.limit(1)
	return rows[0] ?? null
}

/**
 * A drafter asks for review (decision 111): the live bodies are folded, the sections that
 * changed since the published version are pinned by hash, reviewers are told. A request
 * while a review is open supersedes it (the latest review per draft counts).
 */
export async function requestReview(
	lc: Lifecycle,
	input: { documentId: string; userId: string; note: string | null },
): Promise<{ reviewId: string; sections: number; hidden: number; added: number }> {
	const document = await documentOf(lc, input.documentId)
	await requireRole(lc, input.userId, document, 'member', 'request a review')
	await foldRoom(lc, document.id)
	const draft = await ensureDraft(lc, document.id, input.userId)
	const { text, removals } = await reviewableChanges(lc, document.id)
	if (text.length + removals.length === 0)
		refuse('Nothing has changed since the published version.')
	// The template asks teams to report the sections they removed and the subheadings they
	// added when they submit for review: the request says so, in the reviewers' mail.
	const structure = await structureChanges(lc, document.id)
	const reviewId = crypto.randomUUID()
	const pin = async (s: ResolvedSection, change: ReviewChange) => ({
		reviewId,
		sectionId: s.row.id,
		change,
		bodyHash: await bodyHash(s.publishable),
	})
	const pins = await Promise.all([
		...text.map((s) => pin(s, 'text')),
		...removals.map((s) => pin(s, 'removal')),
	])
	await lc.d.batch([
		lc.d.insert(schema.reviews).values({
			id: reviewId,
			documentId: document.id,
			versionId: draft.id,
			requestedBy: input.userId,
			note: input.note,
		}),
		...chunk(pins, 25).map((group) => lc.d.insert(schema.reviewSections).values(group)),
	])
	await record(lc, document.id, 'review.requested', input.userId, {
		reviewId,
		sections: text.length,
		hidden: structure.hidden.length,
		added: structure.added.length,
	})
	const listed = (label: string, items: StructureItem[]) =>
		items.length > 0 ? `\n\n${label}: ${items.map(structureLabel).join('; ')}.` : ''
	const changedLine =
		text.length > 0
			? ` (${text.length} changed section${text.length === 1 ? '' : 's'})`
			: ' (sections removed only)'
	await notify(
		lc,
		await recipients(lc, document, 'admin'),
		`Review requested: ${document.title}`,
		`A review of "${document.title}" has been requested${changedLine}.${listed('Sections removed', structure.hidden)}${listed('Subheadings added', structure.added)}${input.note ? `\n\n${input.note}` : ''}\n\n${documentLink(lc, document.id)}`,
	)
	return {
		reviewId,
		sections: text.length,
		hidden: structure.hidden.length,
		added: structure.added.length,
	}
}

/** A section a structure report names. */
export interface StructureItem {
	sectionId: string
	address: string
	title: string | null
}

/** How the document's structure differs from its published version, as the template asks
 *  a team to report it: the sections hidden since (every hidden one, if it has never
 *  published) and the subheadings the team added since. */
export interface StructureReport {
	hidden: StructureItem[]
	added: StructureItem[]
}

/** A section as a report names it: its heading with its address, else its address. */
const structureLabel = (item: StructureItem): string =>
	item.title ? `${item.title} (${item.address})` : item.address

/** The document's structure report against its published version, in reading order. A
 *  hidden subtree is reported by its top section alone; apparatus is template
 *  scaffolding, never shown, so it is never reported. */
export async function structureChanges(
	lc: Lifecycle,
	documentId: string,
): Promise<StructureReport> {
	const rows = await lc.d
		.select({
			id: schema.sections.id,
			parentId: schema.sections.parentId,
			orderIndex: schema.sections.orderIndex,
			address: schema.sections.address,
			title: schema.sections.title,
			hidden: schema.sections.hidden,
			added: schema.sections.added,
			apparatus: schema.sections.apparatus,
		})
		.from(schema.sections)
		.where(eq(schema.sections.documentId, documentId))
	const before = await hiddenWhenPublished(lc, documentId)
	const byId = new Map(rows.map((r) => [r.id, r]))
	const item = (r: (typeof rows)[number]): StructureItem => ({
		sectionId: r.id,
		address: r.address,
		title: r.title,
	})
	const ordered = outlineOrder(rows).filter((r) => !r.apparatus)
	return {
		hidden: ordered.filter((r) => topHidden(r, byId) && before.get(r.id) !== true).map(item),
		added: ordered.filter((r) => r.added && !before.has(r.id)).map(item),
	}
}

/** One section's decision by a reviewer (decision 95); the roll-up follows in the view. */
export async function decideSection(
	lc: Lifecycle,
	input: {
		reviewId: string
		sectionId: string
		decision: 'approved' | 'changes_requested'
		note: string | null
		userId: string
	},
): Promise<ReviewStateRow> {
	const review = (
		await lc.d
			.select()
			.from(schema.reviewState)
			.where(eq(schema.reviewState.reviewId, input.reviewId))
			.limit(1)
	)[0]
	if (!review) refuse('Review not found.')
	if (review.superseded !== 0) refuse('A later review request has replaced this one.')
	const document = await documentOf(lc, review.documentId)
	await requireRole(lc, input.userId, document, 'admin', 'decide a review')
	const updated = await lc.d
		.update(schema.reviewSections)
		.set({
			decision: input.decision,
			note: input.note,
			decidedBy: input.userId,
			decidedAt: new Date(),
		})
		.where(
			and(
				eq(schema.reviewSections.reviewId, input.reviewId),
				eq(schema.reviewSections.sectionId, input.sectionId),
			),
		)
		.returning()
	if (updated.length === 0) refuse('That section is not part of this review.')
	const after = (
		await lc.d
			.select()
			.from(schema.reviewState)
			.where(eq(schema.reviewState.reviewId, input.reviewId))
			.limit(1)
	)[0]
	if (!after) refuse('Review not found.')
	if (after.decision !== null && review.decision === null) {
		await record(lc, document.id, 'review.decided', input.userId, {
			reviewId: input.reviewId,
			decision: after.decision,
		})
		const requester = await lc.auth.getUserById(review.requestedBy)
		if (requester)
			await notify(
				lc,
				[requester.email],
				`Review ${after.decision === 'approved' ? 'approved' : 'needs changes'}: ${document.title}`,
				`The review of "${document.title}" is ${after.decision === 'approved' ? 'approved in full' : 'asking for changes'}.\n\n${documentLink(lc, document.id)}`,
			)
	}
	return after
}

/** A section's row in the current review, with its decision. */
export type ReviewSectionRow = typeof schema.reviewSections.$inferSelect

// ---------------------------------------------------------------------------
// Readiness and publish
// ---------------------------------------------------------------------------

export type GateLevel = 'block' | 'warn' | 'ok'

export interface GateItem {
	key: string
	level: GateLevel
	message: string
	/** Section addresses the item points at, when it is about sections. */
	sections?: string[]
}

/**
 * The publish gate (decision 99): what blocks, what warns, what is fine. Read by the
 * wizard's readiness step and enforced by `publish`.
 */
export async function publishReadiness(
	lc: Lifecycle,
	documentId: string,
	userId: string,
): Promise<{
	items: GateItem[]
	blocked: boolean
	changed: number
}> {
	const document = await documentOf(lc, documentId)
	const draft = await ensureDraft(lc, documentId, userId)
	const resolved = await resolveSections(lc, documentId)
	const { text, removals } = await reviewableChanges(lc, documentId)
	const changes = text.length + removals.length
	const items: GateItem[] = []

	// The text that publishes as written: a pathway's own sections; in a template, the
	// sections every pathway shares word for word. A template section a pathway writes for
	// itself (pathwayOwnership 'owned') is a scaffold: its placeholders and guidance are
	// for the pathway, and they gate the pathway's publish, not the template's.
	const asWritten = (s: ResolvedSection): boolean =>
		live(s) &&
		s.row.ownership === 'owned' &&
		(document.kind === 'pathway' || s.row.pathwayOwnership !== 'owned')
	// Measured on the body as it would publish: a placeholder in drafting guidance (which a
	// pathway publishes without) is not text readers would see.
	const placeholders = resolved.filter(
		(s) => asWritten(s) && blockingPlaceholders(s.publishable) > 0,
	)
	items.push(
		placeholders.length > 0
			? {
					key: 'placeholders',
					level: 'block',
					message: `${placeholders.length} section${placeholders.length === 1 ? ' still has' : 's still have'} placeholder text to replace.`,
					sections: placeholders.map((s) => s.row.address),
				}
			: { key: 'placeholders', level: 'ok', message: 'No placeholder text is left.' },
	)

	const guidance = resolved.filter((s) => asWritten(s) && openItemsIn(s.body) > 0)
	items.push(
		guidance.length > 0
			? {
					key: 'guidance',
					level: 'warn',
					message: `${guidance.length} section${guidance.length === 1 ? ' has' : 's have'} drafting guidance not yet ticked done.`,
					sections: guidance.map((s) => s.row.address),
				}
			: { key: 'guidance', level: 'ok', message: 'All drafting guidance is ticked done.' },
	)

	// Alternatives the template offered ("Or" rows) of which the team keeps one: while a
	// group stands, readers would be published both.
	const choices = resolved.filter((s) => asWritten(s) && openChoicesIn(s.body) > 0)
	items.push(
		choices.length > 0
			? {
					key: 'choices',
					level: 'warn',
					message: `${choices.length} section${choices.length === 1 ? ' still offers' : 's still offer'} alternatives to choose between.`,
					sections: choices.map((s) => s.row.address),
				}
			: {
					key: 'choices',
					level: 'ok',
					message: 'Every alternative the template offered has been chosen.',
				},
	)

	if (changes === 0)
		items.push({
			key: 'changes',
			level: 'block',
			message: 'Nothing has changed since the published version.',
		})
	else
		items.push({
			key: 'changes',
			level: 'ok',
			message: [
				text.length > 0 ? `${text.length} section${text.length === 1 ? '' : 's'} changed` : null,
				removals.length > 0
					? `${removals.length} section${removals.length === 1 ? '' : 's'} removed`
					: null,
			]
				.filter((part) => part !== null)
				.join(' and ')
				.concat(' since the published version.'),
			sections: [...text, ...removals].map((s) => s.row.address),
		})

	const review = await currentReview(lc, documentId, draft.id)
	if (!review)
		items.push({
			key: 'review',
			level: 'block',
			message: 'No review has been requested for this draft.',
		})
	else if (review.decision !== 'approved')
		items.push({
			key: 'review',
			level: 'block',
			message:
				review.decision === 'changes_requested'
					? 'The review asked for changes.'
					: `The review is open: ${review.decided} of ${review.total} sections decided.`,
		})
	else {
		const { stale, unreviewed } = await reviewDrift(lc, review.reviewId, resolved, {
			text,
			removals,
		})
		if (stale.length > 0)
			items.push({
				key: 'review',
				level: 'block',
				message: `${stale.length} approved section${stale.length === 1 ? ' has' : 's have'} changed since the review; ask for review again.`,
				sections: stale,
			})
		else if (unreviewed.length > 0)
			items.push({
				key: 'review',
				level: 'block',
				message: `${unreviewed.length} section${unreviewed.length === 1 ? ' has' : 's have'} changed since the review was requested; ask for review again.`,
				sections: unreviewed,
			})
		else items.push({ key: 'review', level: 'ok', message: 'The review is approved in full.' })
	}

	if (document.kind === 'pathway') {
		const shared = resolved.filter((s) => live(s) && s.row.ownership === 'shared')
		const unpublishedCore = shared.filter((s) => s.coreSource === 'draft')
		items.push(
			unpublishedCore.length > 0
				? {
						key: 'core',
						level: 'block',
						message: 'The core content this pathway shares has not been published yet.',
						sections: unpublishedCore.map((s) => s.row.address),
					}
				: {
						key: 'core',
						level: 'ok',
						message: 'Shared sections resolve to the published core content.',
					},
		)
	}

	return { items, blocked: items.some((i) => i.level === 'block'), changed: changes }
}

/**
 * How the draft has moved since a review pinned it. STALE: a pinned text change whose
 * body no longer matches its hash, or a pinned removal shown again. UNREVIEWED: a change
 * the review never saw (made after the request), or one it saw as the other kind (a
 * section edited under review and then hidden). Either means what would publish is not
 * what was approved. Addresses, in reading order.
 */
async function reviewDrift(
	lc: Lifecycle,
	reviewId: string,
	resolved: ResolvedSection[],
	current: { text: ResolvedSection[]; removals: ResolvedSection[] },
): Promise<{ stale: string[]; unreviewed: string[] }> {
	const pins = await lc.d
		.select()
		.from(schema.reviewSections)
		.where(eq(schema.reviewSections.reviewId, reviewId))
	const byId = new Map(resolved.map((s) => [s.row.id, s]))
	const stale: string[] = []
	for (const pin of pins) {
		const section = byId.get(pin.sectionId)
		if (!section) continue
		const moved =
			pin.change === 'removal'
				? !section.row.hidden
				: (await bodyHash(section.publishable)) !== pin.bodyHash
		if (moved) stale.push(section.row.address)
	}
	const pinned = new Map(pins.map((p) => [p.sectionId, p.change]))
	const unreviewed = new Set([
		...current.text.filter((s) => pinned.get(s.row.id) !== 'text').map((s) => s.row.id),
		...current.removals.filter((s) => pinned.get(s.row.id) !== 'removal').map((s) => s.row.id),
	])
	// `resolved` is in reading order; the two lists are read back through it.
	return {
		stale,
		unreviewed: resolved.filter((s) => unreviewed.has(s.row.id)).map((s) => s.row.address),
	}
}

/**
 * Publish the draft (decisions 98, 115): every gate item must be clear; the live bodies
 * are folded, resolved against the published core, stripped of guidance and rendered;
 * the draft becomes the published version, the incumbent is archived, the next draft
 * opens. Central members only.
 */
export async function publish(
	lc: Lifecycle,
	input: { documentId: string; userId: string; label: string | null; releaseNotes: string | null },
): Promise<{ versionId: string; versionNo: number }> {
	const document = await documentOf(lc, input.documentId)
	await requireCentral(lc, input.userId, 'publish')
	await foldRoom(lc, document.id)
	const readiness = await publishReadiness(lc, document.id, input.userId)
	if (readiness.blocked) {
		const blocks = readiness.items.filter((i) => i.level === 'block').map((i) => i.message)
		refuse(`Not ready to publish: ${blocks.join(' ')}`)
	}
	const draft = await ensureDraft(lc, document.id, input.userId)
	const incumbent = await publishedVersion(lc, document.id)
	// The incumbent edition's own rows, hidden ones included: a section is unchanged when
	// its body and its hidden flag are both as they were.
	const before = new Map<
		string,
		{ bodyJson: JsonNode | null; hidden: boolean; lastChangedVersionNo: number }
	>()
	if (incumbent) {
		const rows = await lc.d
			.select({
				sectionId: schema.versionSections.sectionId,
				bodyJson: schema.versionSections.bodyJson,
				hidden: schema.versionSections.hidden,
				lastChangedVersionNo: schema.versionSections.lastChangedVersionNo,
			})
			.from(schema.versionSections)
			.where(eq(schema.versionSections.versionId, incumbent.versionId))
		for (const r of rows)
			before.set(r.sectionId, {
				bodyJson: r.bodyJson ?? null,
				hidden: r.hidden,
				lastChangedVersionNo: r.lastChangedVersionNo,
			})
	}
	const resolved = await resolveSections(lc, document.id)
	const publishedResolved = resolved.map((s) => ({ ...s, body: s.publishable }))
	const derived: DerivedView = {
		referenceNumbers: citationNumbers(
			publishedResolved.filter(live).map((s) => citedBody(s.row.titleCitations, s.body)),
		),
		// The published snapshot is drawn from the timeframe boxes being published.
		timeframes: timeframeRows(
			publishedResolved.filter(live).map((s) => ({
				stepNumber: s.row.stepNumber,
				address: s.row.address,
				printedNumber: s.row.printedNumber,
				title: s.row.title,
				body: s.body,
			})),
		),
		map: null,
	}
	const coreVersionId = document.kind === 'pathway' ? await coreVersionFor(lc, resolved) : null
	const addressOf = new Map(resolved.map((s) => [s.row.id, s.row.address]))
	const now = new Date()
	const rows = await Promise.all(
		publishedResolved.map(async (s) => {
			const hidden = s.row.hidden || s.row.apparatus
			const was = before.get(s.row.id)
			const unchanged = was !== undefined && was.hidden === hidden && sameBody(s.body, was.bodyJson)
			return {
				versionId: draft.id,
				sectionId: s.row.id,
				parentAddress: s.row.parentId ? (addressOf.get(s.row.parentId) ?? null) : null,
				address: s.row.address,
				title: s.row.title,
				titleCitations: s.row.titleCitations ?? null,
				printedNumber: s.row.printedNumber,
				orderIndex: s.row.orderIndex,
				ownership: s.row.ownership,
				hidden,
				pointOfCare: s.row.pointOfCare,
				bodyJson: s.body,
				bodyHash: await bodyHash(s.body),
				html: s.body ? lc.renderHtml(s.body, derived) : null,
				markdown: s.body ? bodyToMarkdown(s.body, derived) : null,
				lastChangedVersionNo: unchanged ? was.lastChangedVersionNo : draft.versionNo,
			}
		}),
	)
	const nextDraftId = crypto.randomUUID()
	await lc.d.batch([
		lc.d
			.update(schema.versions)
			.set({
				status: 'published',
				label: input.label,
				releaseNotes: input.releaseNotes,
				coreVersionId,
				publishedAt: now,
				publishedBy: input.userId,
			})
			.where(eq(schema.versions.id, draft.id)),
		...(incumbent
			? [
					lc.d
						.update(schema.versions)
						.set({ status: 'archived' })
						.where(eq(schema.versions.id, incumbent.versionId)),
				]
			: []),
		...chunk(rows, 4).map((group) => lc.d.insert(schema.versionSections).values(group)),
		lc.d.insert(schema.versions).values({
			id: nextDraftId,
			documentId: document.id,
			status: 'draft',
			versionNo: draft.versionNo + 1,
			createdBy: input.userId,
		}),
	])
	await record(lc, document.id, 'version.published', input.userId, {
		versionId: draft.id,
		versionNo: draft.versionNo,
		label: input.label,
	})
	// The public search index holds this edition now, the document's earlier one gone.
	await indexPublishedVersion(lc.d, document.id, draft.id, rows)
	// A core document's published bodies are what the pathways' shared sections render:
	// their draft hashes move with it.
	if (document.kind === 'core')
		await refreshSharedHashes(lc, new Map(rows.map((r) => [r.sectionId, r.bodyJson])))
	void publishDocumentRows([document])
	if (lc.purge) {
		const tags = [
			PUBLISHED_CACHE_TAG,
			...[document.slug, ...(document.partnerSlug ? [document.partnerSlug] : [])].map(cacheTagFor),
		]
		try {
			await lc.purge(tags)
		} catch (error) {
			console.error(
				'[lifecycle] cache purge failed:',
				error instanceof Error ? error.message : error,
			)
		}
	}
	await notify(
		lc,
		await recipients(lc, document, 'viewer'),
		`Published: ${document.title}, version ${draft.versionNo}`,
		`Version ${draft.versionNo}${input.label ? ` (${input.label})` : ''} of "${document.title}" is published.${input.releaseNotes ? `\n\n${input.releaseNotes}` : ''}\n\n${documentLink(lc, document.id)}`,
	)
	return { versionId: draft.id, versionNo: draft.versionNo }
}

/** The core's published version a pathway's shared sections were resolved against. */
async function coreVersionFor(lc: Lifecycle, resolved: ResolvedSection[]): Promise<string | null> {
	const coreSectionId = resolved.find((s) => s.row.ownership === 'shared' && s.row.coreSectionId)
		?.row.coreSectionId
	if (!coreSectionId) return null
	const core = (
		await lc.d
			.select({ documentId: schema.sections.documentId })
			.from(schema.sections)
			.where(eq(schema.sections.id, coreSectionId))
			.limit(1)
	)[0]
	if (!core) return null
	return (await publishedVersion(lc, core.documentId))?.versionId ?? null
}

/** After a core document publishes: every pathway section sharing one of its sections
 *  re-hashes against the body just published (`coreBodies`: core section id → body). */
async function refreshSharedHashes(
	lc: Lifecycle,
	coreBodies: Map<string, JsonNode | null>,
): Promise<void> {
	const ids = [...coreBodies.keys()]
	const shared = await inGroups(ids, (group) =>
		lc.d
			.select({
				id: schema.sections.id,
				coreSectionId: schema.sections.coreSectionId,
				draftHash: schema.sections.draftHash,
				subject: schema.documents.subject,
			})
			.from(schema.sections)
			.innerJoin(schema.documents, eq(schema.documents.id, schema.sections.documentId))
			.where(
				and(eq(schema.sections.ownership, 'shared'), inArray(schema.sections.coreSectionId, group)),
			),
	)
	const updates = []
	for (const s of shared) {
		if (!s.coreSectionId) continue
		const hash = await publishableHash(coreBodies.get(s.coreSectionId) ?? null, s.subject)
		if (hash !== s.draftHash)
			updates.push(
				lc.d.update(schema.sections).set({ draftHash: hash }).where(eq(schema.sections.id, s.id)),
			)
	}
	for (const group of chunk(updates, 50)) {
		const [first, ...rest] = group
		if (first) await lc.d.batch([first, ...rest])
	}
}

/** The body a shared section renders: its core section's as published, else its draft. */
async function coreBodyOf(lc: Lifecycle, coreSectionId: string): Promise<JsonNode | null> {
	const published = (
		await lc.d
			.select({ bodyJson: schema.publishedSections.bodyJson })
			.from(schema.publishedSections)
			.where(eq(schema.publishedSections.sectionId, coreSectionId))
			.limit(1)
	)[0]
	if (published) return published.bodyJson ?? null
	const draft = (
		await lc.d
			.select({ bodyJson: schema.sections.bodyJson })
			.from(schema.sections)
			.where(eq(schema.sections.id, coreSectionId))
			.limit(1)
	)[0]
	return draft?.bodyJson ?? null
}

// ---------------------------------------------------------------------------
// The state a page reads
// ---------------------------------------------------------------------------

/** A section's decision in the current review, as the page carries it. */
export interface SectionDecisionWire {
	decision: 'approved' | 'changes_requested' | null
	note: string | null
	decidedBy: string | null
	decidedAt: number | null
}

export interface SectionChange {
	sectionId: string
	address: string
	/** New or changed text, or the section removed (hidden since the published version). */
	change: ReviewChange
	/** The body annotated against the published version; for a removal, the text readers
	 *  lose, struck through. */
	annotated: AnnotatedBody
	/** The section's row in the current review, when it is under review. */
	decision: SectionDecisionWire | null
}

export interface DocumentState {
	draft: { versionId: string; versionNo: number }
	published: {
		versionId: string
		versionNo: number
		label: string | null
		releaseNotes: string | null
		publishedAt: number | null
	} | null
	review:
		| (Omit<ReviewStateRow, 'requestedAt'> & { requestedAt: number; requestedByName: string })
		| null
	/** What changed since the published version — text changes and removals, in reading
	 *  order — with their annotated bodies and review decisions: what review mode paints
	 *  (decision 108, 112). */
	changes: SectionChange[]
	/** Sections removed and subheadings added since the published version: what a review
	 *  request reports, as the template asks. */
	structure: StructureReport
	role: Role
	central: boolean
}

/** Everything the workspace needs about where the document stands. */
export async function documentState(
	lc: Lifecycle,
	documentId: string,
	userId: string,
): Promise<DocumentState> {
	const document = await documentOf(lc, documentId)
	const role = await roleOn(lc, userId, document)
	if (!role) refuse('You are not a member of this document.')
	const central = await lc.centralOrgId()
	const isCentral =
		central !== null &&
		(await lc.auth.getOrgMembershipById(userId, central, OCP_NAMESPACE)) !== null
	const draft = await ensureDraft(lc, documentId, userId)
	const published = await publishedVersion(lc, documentId)
	const review = await currentReview(lc, documentId, draft.id)
	const decisions = review
		? await lc.d
				.select()
				.from(schema.reviewSections)
				.where(eq(schema.reviewSections.reviewId, review.reviewId))
		: []
	const decisionOf = new Map(
		decisions.map((d): [string, SectionDecisionWire] => [
			d.sectionId,
			{
				decision: d.decision,
				note: d.note,
				decidedBy: d.decidedBy,
				decidedAt: d.decidedAt?.getTime() ?? null,
			},
		]),
	)
	const previous = await publishedBodies(lc, documentId)
	const changes = (await reviewableChanges(lc, documentId)).all.map(
		({ section: s, change }): SectionChange => ({
			sectionId: s.row.id,
			address: s.row.address,
			change,
			annotated:
				change === 'removal'
					? annotateChanges(previous.get(s.row.id) ?? s.publishable, null)
					: annotateChanges(previous.get(s.row.id) ?? null, s.publishable),
			decision: decisionOf.get(s.row.id) ?? null,
		}),
	)
	const requester = review ? await lc.auth.getUserById(review.requestedBy) : null
	return {
		draft: { versionId: draft.id, versionNo: draft.versionNo },
		published: published
			? {
					versionId: published.versionId,
					versionNo: published.versionNo,
					label: published.label,
					releaseNotes: published.releaseNotes,
					publishedAt: published.publishedAt?.getTime() ?? null,
				}
			: null,
		review: review
			? {
					...review,
					requestedAt: review.requestedAt.getTime(),
					requestedByName: requester?.name ?? 'Someone',
				}
			: null,
		changes,
		structure: await structureChanges(lc, documentId),
		role,
		central: isCentral,
	}
}

/** The document's versions, newest first. */
export async function versionsOf(lc: Lifecycle, documentId: string) {
	const rows = await lc.d
		.select()
		.from(schema.versions)
		.where(eq(schema.versions.documentId, documentId))
		.orderBy(desc(schema.versions.versionNo))
	return rows.map((v) => ({
		id: v.id,
		status: v.status,
		versionNo: v.versionNo,
		label: v.label,
		releaseNotes: v.releaseNotes,
		createdAt: v.createdAt.getTime(),
		publishedAt: v.publishedAt?.getTime() ?? null,
		publishedBy: v.publishedBy,
	}))
}

// ---------------------------------------------------------------------------
// Comments and suggestions (decisions 99, 110, 120)
// ---------------------------------------------------------------------------

export async function listComments(
	lc: Lifecycle,
	documentId: string,
	userId: string,
): Promise<CommentRow[]> {
	const document = await documentOf(lc, documentId)
	if (!(await roleOn(lc, userId, document))) refuse('You are not a member of this document.')
	return lc.d
		.select()
		.from(schema.comments)
		.where(eq(schema.comments.documentId, documentId))
		.orderBy(schema.comments.createdAt)
}

export async function addComment(
	lc: Lifecycle,
	input: {
		documentId: string
		sectionId: string
		kind: 'comment' | 'suggestion'
		body: string
		userId: string
		/** The comment this answers, in the same section's thread. */
		replyTo?: string | null
		/** People the comment names with @: each is emailed, if they may read the document. */
		mentions?: string[]
	},
): Promise<CommentRow> {
	const document = await documentOf(lc, input.documentId)
	await requireRole(lc, input.userId, document, 'member', 'comment')
	const section = (
		await lc.d
			.select({
				ownership: schema.sections.ownership,
				documentId: schema.sections.documentId,
				address: schema.sections.address,
				printedNumber: schema.sections.printedNumber,
				title: schema.sections.title,
			})
			.from(schema.sections)
			.where(eq(schema.sections.id, input.sectionId))
			.limit(1)
	)[0]
	if (!section || section.documentId !== document.id) return refuse('Section not found.')
	if (input.kind === 'suggestion' && section.ownership !== 'shared')
		refuse('A suggestion is for a shared section; comment on an owned one instead.')
	if (input.replyTo) {
		const parent = (
			await lc.d
				.select()
				.from(schema.comments)
				.where(eq(schema.comments.id, input.replyTo))
				.limit(1)
		)[0]
		if (!parent || parent.sectionId !== input.sectionId)
			refuse('That comment is not in this section’s thread.')
	}
	const body = input.body.trim()
	if (body.length === 0) refuse('Write something first.')
	const actor = await lc.auth.getUserById(input.userId)
	const inserted = await lc.d
		.insert(schema.comments)
		.values({
			id: crypto.randomUUID(),
			documentId: document.id,
			sectionId: input.sectionId,
			kind: input.kind,
			replyTo: input.replyTo ?? null,
			body,
			authorId: input.userId,
			authorName: actor?.name ?? input.userId,
		})
		.returning()
	const row = inserted[0]
	if (!row) refuse('Could not save the comment.')
	await notifyMentioned(lc, {
		document,
		section,
		body,
		authorName: actor?.name ?? 'Someone',
		mentions: (input.mentions ?? []).filter((id) => id !== input.userId),
	})
	if (input.kind === 'suggestion') {
		await record(lc, document.id, 'suggestion.made', input.userId, { sectionId: input.sectionId })
		const central = await lc.centralOrgId()
		if (central) {
			const members = await lc.auth.listOrgMembers(central, OCP_NAMESPACE)
			await notify(
				lc,
				members.map((m) => m.email),
				`Suggested change to shared content: ${document.title}`,
				`${actor?.name ?? 'A drafter'} suggests a change to a shared section of "${document.title}":\n\n${body}\n\n${documentLink(lc, document.id)}`,
			)
		}
	}
	return row
}

export async function resolveComment(
	lc: Lifecycle,
	input: { commentId: string; userId: string; resolved: boolean },
): Promise<CommentRow> {
	const comment = (
		await lc.d
			.select()
			.from(schema.comments)
			.where(eq(schema.comments.id, input.commentId))
			.limit(1)
	)[0]
	if (!comment) refuse('Comment not found.')
	const document = await documentOf(lc, comment.documentId)
	await requireRole(lc, input.userId, document, 'member', 'resolve a comment')
	const updated = (
		await lc.d
			.update(schema.comments)
			.set(
				input.resolved
					? { resolvedAt: new Date(), resolvedBy: input.userId }
					: { resolvedAt: null, resolvedBy: null },
			)
			.where(eq(schema.comments.id, input.commentId))
			.returning()
	)[0]
	if (!updated) refuse('Comment not found.')
	return updated
}

/** A section as mail names it: its number and title. */
const sectionName = (s: {
	printedNumber: string | null
	title: string | null
	address: string
}): string => [s.printedNumber, s.title].filter((part) => part).join(' ') || s.address

/** Email each person a comment names (with @), if they may read the document. Best-effort,
 *  like every notification. */
async function notifyMentioned(
	lc: Lifecycle,
	input: {
		document: DocumentRow
		section: { printedNumber: string | null; title: string | null; address: string }
		body: string
		authorName: string
		mentions: string[]
	},
): Promise<void> {
	const addresses: string[] = []
	for (const userId of new Set(input.mentions)) {
		if (!(await roleOn(lc, userId, input.document))) continue
		const person = await lc.auth.getUserById(userId)
		if (person?.email) addresses.push(person.email)
	}
	if (addresses.length === 0) return
	await notify(
		lc,
		addresses,
		`${input.authorName} mentioned you: ${input.document.title}`,
		`${input.authorName} mentioned you in a comment on ${sectionName(input.section)} of "${input.document.title}":\n\n${input.body}\n\n${documentLink(lc, input.document.id)}`,
	)
}

/**
 * The central team answers a suggestion (decision 26): the reply joins the suggestion's
 * own thread, on the pathway's section, where its drafter reads it in their margin; it may
 * resolve the suggestion in the same act. The drafter is emailed.
 */
export async function replyToSuggestion(
	lc: Lifecycle,
	input: { suggestionId: string; body: string | null; resolve: boolean; userId: string },
): Promise<CommentRow | null> {
	await requireCentral(lc, input.userId, 'answer a suggestion')
	const suggestion = (
		await lc.d
			.select()
			.from(schema.comments)
			.where(eq(schema.comments.id, input.suggestionId))
			.limit(1)
	)[0]
	if (!suggestion || suggestion.kind !== 'suggestion') return refuse('Suggestion not found.')
	const body = input.body?.trim() ?? ''
	if (body.length === 0 && !input.resolve) refuse('Write a reply, or resolve the suggestion.')
	const document = await documentOf(lc, suggestion.documentId)
	const actor = await lc.auth.getUserById(input.userId)
	const reply =
		body.length > 0
			? ((
					await lc.d
						.insert(schema.comments)
						.values({
							id: crypto.randomUUID(),
							documentId: suggestion.documentId,
							sectionId: suggestion.sectionId,
							kind: 'comment',
							replyTo: suggestion.id,
							body,
							authorId: input.userId,
							authorName: actor?.name ?? input.userId,
						})
						.returning()
				)[0] ?? null)
			: null
	if (input.resolve && !suggestion.resolvedAt)
		await lc.d
			.update(schema.comments)
			.set({ resolvedAt: new Date(), resolvedBy: input.userId })
			.where(eq(schema.comments.id, suggestion.id))
	await record(lc, document.id, 'suggestion.answered', input.userId, {
		suggestionId: suggestion.id,
		resolved: input.resolve,
	})
	const drafter = await lc.auth.getUserById(suggestion.authorId)
	if (drafter?.email)
		await notify(
			lc,
			[drafter.email],
			`${input.resolve ? 'Your suggestion is resolved' : 'A reply to your suggestion'}: ${document.title}`,
			`You suggested a change to shared content in "${document.title}":\n\n${suggestion.body}\n\n${
				body.length > 0 ? `${actor?.name ?? 'The central team'} replied:\n\n${body}\n\n` : ''
			}${input.resolve ? 'The central team has marked it resolved.\n\n' : ''}${documentLink(lc, document.id)}`,
		)
	return reply
}

/** A suggestion as the central team reads it: who, where, the words, and its thread. */
export interface SuggestionWire {
	id: string
	body: string
	authorName: string
	createdAt: number
	resolvedAt: number | null
	/** The core section it is about. */
	coreSectionId: string | null
	/** The pathway it came from, and its section there (for its own copy, if it has one). */
	pathway: { documentId: string; title: string; sectionId: string; diverged: boolean }
	replies: { id: string; body: string; authorName: string; createdAt: number }[]
}

/** Suggestions made on any pathway's shared sections that render this core document's
 *  sections, for the central team (decision 26), newest first, with their replies. */
export async function suggestionsForCore(
	lc: Lifecycle,
	coreDocumentId: string,
	userId: string,
): Promise<SuggestionWire[]> {
	await requireCentral(lc, userId, 'read suggestions')
	const shared = lc.d
		.select({ id: schema.sections.id })
		.from(schema.sections)
		.where(eq(schema.sections.documentId, coreDocumentId))
	const rows = await lc.d
		.select({
			comment: schema.comments,
			coreSectionId: schema.sections.coreSectionId,
			ownership: schema.sections.ownership,
			pathwayTitle: schema.documents.title,
		})
		.from(schema.comments)
		.innerJoin(schema.sections, eq(schema.sections.id, schema.comments.sectionId))
		.innerJoin(schema.documents, eq(schema.documents.id, schema.comments.documentId))
		.where(
			and(eq(schema.comments.kind, 'suggestion'), inArray(schema.sections.coreSectionId, shared)),
		)
		.orderBy(desc(schema.comments.createdAt))
	const ids = rows.map((r) => r.comment.id)
	const replies =
		ids.length > 0
			? await inGroups(ids, (group) =>
					lc.d
						.select()
						.from(schema.comments)
						.where(inArray(schema.comments.replyTo, group))
						.orderBy(schema.comments.createdAt),
				)
			: []
	return rows.map((r) => ({
		id: r.comment.id,
		body: r.comment.body,
		authorName: r.comment.authorName,
		createdAt: r.comment.createdAt.getTime(),
		resolvedAt: r.comment.resolvedAt?.getTime() ?? null,
		coreSectionId: r.coreSectionId,
		pathway: {
			documentId: r.comment.documentId,
			title: r.pathwayTitle,
			sectionId: r.comment.sectionId,
			diverged: r.ownership === 'owned',
		},
		replies: replies
			.filter((reply) => reply.replyTo === r.comment.id)
			.map((reply) => ({
				id: reply.id,
				body: reply.body,
				authorName: reply.authorName,
				createdAt: reply.createdAt.getTime(),
			})),
	}))
}

// ---------------------------------------------------------------------------
// Diverge and revert (decision 26, 118)
// ---------------------------------------------------------------------------

/** A pathway takes a shared section as its own: the core body — as the pathway currently
 *  renders it — becomes the section's starting draft, citations intact. Revertable. */
export async function divergeSection(lc: Lifecycle, input: { sectionId: string; userId: string }) {
	const row = (
		await lc.d
			.select()
			.from(schema.sections)
			.where(eq(schema.sections.id, input.sectionId))
			.limit(1)
	)[0]
	if (!row) refuse('Section not found.')
	const document = await documentOf(lc, row.documentId)
	await requireRole(lc, input.userId, document, 'member', 'diverge a section')
	if (row.ownership !== 'shared' || !row.coreSectionId)
		refuse('This section is already the pathway’s own.')
	const body = row.coreSectionId ? await coreBodyOf(lc, row.coreSectionId) : null
	const updated = await lc.d
		.update(schema.sections)
		.set({
			ownership: 'owned',
			bodyJson: body,
			draftHash: await publishableHash(body, document.subject, publishAsFor(document.kind)),
			updatedAt: new Date(),
			updatedBy: input.userId,
		})
		.where(eq(schema.sections.id, row.id))
		.returning()
	await record(lc, document.id, 'section.diverged', input.userId, {
		sectionId: row.id,
		address: row.address,
	})
	void publishSectionRows(document.id, updated)
	return updated[0]
}

/** Back to the core's version: the pathway's own body is dropped. */
export async function revertSection(lc: Lifecycle, input: { sectionId: string; userId: string }) {
	const row = (
		await lc.d
			.select()
			.from(schema.sections)
			.where(eq(schema.sections.id, input.sectionId))
			.limit(1)
	)[0]
	if (!row) refuse('Section not found.')
	const document = await documentOf(lc, row.documentId)
	await requireRole(lc, input.userId, document, 'member', 'revert a section')
	const coreSectionId = row.coreSectionId
	if (row.ownership !== 'owned' || !coreSectionId)
		return refuse('This section has no shared version to return to.')
	const core = await coreBodyOf(lc, coreSectionId)
	const updated = await lc.d
		.update(schema.sections)
		.set({
			ownership: 'shared',
			bodyJson: null,
			draftHash: await publishableHash(core, document.subject),
			updatedAt: new Date(),
			updatedBy: input.userId,
		})
		.where(eq(schema.sections.id, row.id))
		.returning()
	await record(lc, document.id, 'section.reverted', input.userId, {
		sectionId: row.id,
		address: row.address,
	})
	void publishSectionRows(document.id, updated)
	return updated[0]
}

function chunk<T>(items: T[], size: number): T[][] {
	const out: T[][] = []
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
	return out
}
