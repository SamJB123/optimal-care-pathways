/**
 * Server functions over documents: the first-run bootstrap of the central organisation,
 * the SSR snapshots the live topics take over from, and creating a pathway from the
 * template's core document.
 *
 * Every function runs behind the kit's auth middleware (context.userId is the verified
 * caller) and re-checks the caller's role per call through the auth worker.
 */

import { createServerFn } from '@tanstack/solid-start'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import {
	citationNumbers,
	type DerivedView,
	pathwayMapView,
	timeframeRows,
} from '#/content/derived.ts'
import type { JsonNode } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import { publishDocumentRows } from '#/lib/live-publish.ts'
import {
	type DocumentWireRow,
	documentWireRow,
	type SectionWireRow,
	sectionWireRow,
} from '#/lib/live-topics.ts'
import { OCP_NAMESPACE, ROLE_LADDER, type Role, roles } from '#/lib/roles.ts'
import { TEMPLATES } from '#/template/templates.ts'
import { envOf, requireUser } from './env.ts'

/** The central organisation: Cancer Australia, owner of core content and of publishing. */
export const CENTRAL_ORG_SLUG = 'cancer-australia'
export const CENTRAL_ORG_NAME = 'Cancer Australia'

/** The central organisation's id, from the core documents it owns; null before bootstrap. */
async function centralOrgId(): Promise<string | null> {
	const { env, d } = await envOf()
	const core = (
		await d
			.select({ orgId: schema.documents.orgId })
			.from(schema.documents)
			.where(eq(schema.documents.kind, 'core'))
			.limit(1)
	)[0]
	if (!core) return null
	// The seed may have written a placeholder; only a real organisation counts.
	const org = await env.AUTH.ensureOrganization({
		slug: CENTRAL_ORG_SLUG,
		name: CENTRAL_ORG_NAME,
		namespace: OCP_NAMESPACE,
	})
	return org.id === core.orgId ? org.id : null
}

export async function roleOn(userId: string, orgId: string): Promise<Role | null> {
	const { env } = await envOf()
	return roles.roleOf(env.AUTH, userId, orgId)
}

export async function requireCentralMember(userId: string): Promise<string> {
	const central = await centralOrgId()
	if (!central) throw new Error('The central organisation has not been set up yet.')
	const role = await roleOn(userId, central)
	if (!role) throw new Error('Only members of the central organisation may do that.')
	return central
}

/**
 * First run: the caller's email is listed in ADMIN_EMAILS, so they create the central
 * organisation, become its owner, and the core documents become its own. Idempotent:
 * later admins listed in the var are added as members.
 */
export const bootstrapCentral = createServerFn({ method: 'POST' }).handler(async ({ context }) => {
	const userId = requireUser(context.userId)
	const { env, d } = await envOf()
	const user = await env.AUTH.getUserById(userId)
	const admins = (env.ADMIN_EMAILS ?? '')
		.split(',')
		.map((email) => email.trim().toLowerCase())
		.filter(Boolean)
	if (!user?.email || !admins.includes(user.email.toLowerCase())) {
		throw new Error('Your email is not listed as an administrator of this deployment.')
	}
	const org = await env.AUTH.ensureOrganization({
		slug: CENTRAL_ORG_SLUG,
		name: CENTRAL_ORG_NAME,
		namespace: OCP_NAMESPACE,
	})
	// Membership of the central organisation is what makes a publisher (decision 11);
	// the better-auth role inside it is not load-bearing for this application, and the
	// auth worker's member door grants 'member'.
	const membership = await env.AUTH.getOrgMembershipById(userId, org.id, OCP_NAMESPACE)
	if (!membership) await env.AUTH.addOrgMember(userId, CENTRAL_ORG_SLUG, OCP_NAMESPACE)
	const adopted = await d
		.update(schema.documents)
		.set({ orgId: org.id })
		.where(eq(schema.documents.kind, 'core'))
		.returning()
	void publishDocumentRows(adopted)
	return { organizationId: org.id, adoptedCoreDocuments: adopted.length }
})

/** Where a document stands, for a list: its published version and whether a review is open. */
export type DocumentListState = { publishedVersionNo: number | null; reviewOpen: boolean }

/** The caller's documents for first paint; the live documents topic takes over. */
export const documentsSnapshot = createServerFn({ method: 'GET' }).handler(
	async ({
		context,
	}): Promise<{
		documents: DocumentWireRow[]
		central: boolean
		roles: Record<string, Role>
		states: Record<string, DocumentListState>
	}> => {
		const userId = requireUser(context.userId)
		const { env, d } = await envOf()
		const memberships = await env.AUTH.listUserOrgs(userId, OCP_NAMESPACE)
		const orgIds = memberships.map((m) => m.organizationId)
		const central = await centralOrgId()
		const isCentral = central !== null && orgIds.includes(central)
		const rows = isCentral
			? await d.select().from(schema.documents)
			: orgIds.length === 0
				? []
				: await d.select().from(schema.documents).where(inArray(schema.documents.orgId, orgIds))
		const roleByOrg = new Map(
			memberships.map((m) => [m.organizationId, ROLE_LADDER.find((r) => r === m.role) ?? null]),
		)
		const roleEntries: [string, Role][] = []
		for (const row of rows) {
			const role = roleByOrg.get(row.orgId) ?? (isCentral ? 'admin' : null)
			if (role) roleEntries.push([row.id, role])
		}
		const published = await d
			.select({
				documentId: schema.publishedVersions.documentId,
				versionNo: schema.publishedVersions.versionNo,
			})
			.from(schema.publishedVersions)
		const openReviews = await d
			.select({ documentId: schema.reviewState.documentId })
			.from(schema.reviewState)
			.innerJoin(schema.versions, eq(schema.versions.id, schema.reviewState.versionId))
			.where(
				and(
					eq(schema.versions.status, 'draft'),
					isNull(schema.reviewState.decision),
					eq(schema.reviewState.superseded, 0),
				),
			)
		const open = new Set(openReviews.map((r) => r.documentId))
		const publishedNo = new Map(published.map((p) => [p.documentId, p.versionNo]))
		return {
			documents: rows.map(documentWireRow),
			central: isCentral,
			roles: Object.fromEntries(roleEntries),
			states: Object.fromEntries(
				rows.map((row) => [
					row.id,
					{ publishedVersionNo: publishedNo.get(row.id) ?? null, reviewOpen: open.has(row.id) },
				]),
			),
		}
	},
)

type SectionRow = typeof schema.sections.$inferSelect

/** The Principles core document's principle sections (the ones with an icon), for the
 *  map's footer cards (decision 73); null before the Principles document exists. */
async function principlesCards(): Promise<{
	documentId: string
	sections: { address: string; title: string | null; icon: string | null }[]
} | null> {
	const { d } = await envOf()
	const template = TEMPLATES.find((t) => t.kind === 'principles')
	if (!template) return null
	const doc = (
		await d
			.select({ id: schema.documents.id })
			.from(schema.documents)
			.where(
				and(
					eq(schema.documents.kind, 'core'),
					eq(schema.documents.templateId, template.templateId),
				),
			)
			.limit(1)
	)[0]
	if (!doc) return null
	const rows = await d
		.select({
			address: schema.sections.address,
			title: schema.sections.title,
			icon: schema.sections.icon,
			orderIndex: schema.sections.orderIndex,
			parentId: schema.sections.parentId,
		})
		.from(schema.sections)
		.where(eq(schema.sections.documentId, doc.id))
	return {
		documentId: doc.id,
		sections: rows
			.filter((r) => r.parentId === null && r.icon !== null)
			.sort((a, b) => a.orderIndex - b.orderIndex)
			.map((r) => ({ address: r.address, title: r.title, icon: r.icon })),
	}
}

/** The views a page derives from a document's bodies (decisions 15, 50, 72), computed
 *  over the RESOLVED bodies — a shared section counts its core section's citations and
 *  timeframes — in outline order. */
async function derivedFor(
	document: { id: string; templateId: string },
	rows: SectionRow[],
): Promise<DerivedView> {
	const { d } = await envOf()
	const coreIds = rows.flatMap((r) =>
		r.ownership === 'shared' && r.coreSectionId ? [r.coreSectionId] : [],
	)
	const coreBodies = new Map<string, JsonNode | null>()
	if (coreIds.length > 0) {
		const cores = await d
			.select({ id: schema.sections.id, bodyJson: schema.sections.bodyJson })
			.from(schema.sections)
			.where(inArray(schema.sections.id, coreIds))
		for (const c of cores) coreBodies.set(c.id, c.bodyJson ?? null)
	}
	const ordered = outlineOrder(rows)
		.filter((r) => !r.hidden && !r.apparatus)
		.map((r) => ({
			stepNumber: r.stepNumber,
			address: r.address,
			printedNumber: r.printedNumber,
			title: r.title,
			titleCitations: r.titleCitations ?? [],
			body:
				r.ownership === 'shared' && r.coreSectionId
					? (coreBodies.get(r.coreSectionId) ?? null)
					: (r.bodyJson ?? null),
		}))
	// A heading's own citations come first in its section's citation order.
	const cited = ordered.map((s): JsonNode | null =>
		s.titleCitations.length === 0
			? s.body
			: {
					type: 'doc',
					content: [
						{
							type: 'paragraph',
							content: s.titleCitations.map((id) => ({
								type: 'citation',
								attrs: { referenceId: id },
							})),
						},
						...(s.body?.content ?? []),
					],
				},
	)
	const topology = TEMPLATES.find((t) => t.templateId === document.templateId)?.map ?? null
	const resolvedBody = (r: SectionRow) =>
		r.ownership === 'shared' && r.coreSectionId
			? (coreBodies.get(r.coreSectionId) ?? null)
			: (r.bodyJson ?? null)
	const map = topology
		? pathwayMapView({
				documentId: document.id,
				topology,
				sections: rows
					.filter((r) => !r.hidden && !r.apparatus)
					.map((r) => ({
						id: r.id,
						parentId: r.parentId,
						address: r.address,
						title: r.title,
						printedNumber: r.printedNumber,
						stepNumber: r.stepNumber,
						ownership: r.ownership,
						updatedAt: r.updatedAt?.getTime() ?? null,
						body: resolvedBody(r),
					})),
				principles: await principlesCards(),
			})
		: null
	return {
		referenceNumbers: citationNumbers(cited),
		timeframes: timeframeRows(ordered),
		map,
	}
}

/** One document's outline for first paint; the live sections topic takes over. */
export const sectionsSnapshot = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: z.string().min(1).max(64) }))
	.handler(
		async ({
			data,
			context,
		}): Promise<{
			document: DocumentWireRow
			sections: SectionWireRow[]
			role: Role
			derived: DerivedView
		}> => {
			const userId = requireUser(context.userId)
			const { d } = await envOf()
			const document = (
				await d
					.select()
					.from(schema.documents)
					.where(eq(schema.documents.id, data.documentId))
					.limit(1)
			)[0]
			if (!document) throw new Error('Document not found.')
			const role = await roleOn(userId, document.orgId)
			if (!role) throw new Error('You are not a member of this document.')
			const sections = await d
				.select()
				.from(schema.sections)
				.where(eq(schema.sections.documentId, data.documentId))
			return {
				document: documentWireRow(document),
				sections: sections.map(sectionWireRow),
				role,
				derived: await derivedFor(document, sections),
			}
		},
	)

/** The resting body of a section the caller may read: its own, or, for a shared
 *  section, the core section's body as PUBLISHED (its draft while the core has never
 *  published — decision 98). */
export const sectionBody = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ sectionId: z.string().min(1).max(64) }))
	.handler(
		async ({
			data,
			context,
		}): Promise<{
			body: JsonNode | null
			resolvedFrom: string
			coreSource: 'published' | 'draft' | null
		}> => {
			const userId = requireUser(context.userId)
			const { d } = await envOf()
			const section = (
				await d
					.select()
					.from(schema.sections)
					.where(eq(schema.sections.id, data.sectionId))
					.limit(1)
			)[0]
			if (!section) throw new Error('Section not found.')
			const document = (
				await d
					.select()
					.from(schema.documents)
					.where(eq(schema.documents.id, section.documentId))
					.limit(1)
			)[0]
			if (!document || !(await roleOn(userId, document.orgId)))
				throw new Error('You are not a member of this document.')
			if (section.ownership === 'owned' || !section.coreSectionId)
				return { body: section.bodyJson ?? null, resolvedFrom: section.id, coreSource: null }
			const published = (
				await d
					.select({ bodyJson: schema.publishedSections.bodyJson })
					.from(schema.publishedSections)
					.where(eq(schema.publishedSections.sectionId, section.coreSectionId))
					.limit(1)
			)[0]
			if (published)
				return {
					body: published.bodyJson ?? null,
					resolvedFrom: section.coreSectionId,
					coreSource: 'published',
				}
			const core = (
				await d
					.select()
					.from(schema.sections)
					.where(eq(schema.sections.id, section.coreSectionId))
					.limit(1)
			)[0]
			return {
				body: core?.bodyJson ?? null,
				resolvedFrom: section.coreSectionId,
				coreSource: 'draft',
			}
		},
	)

/** A section as the review page shows it: the outline row with its resting body. */
export type ReviewSectionRow = SectionWireRow & { body: JsonNode | null }

/**
 * Everything the review page needs in one call: a core document's sections with their
 * bodies, in outline order, and the template PDF they were extracted from. Central
 * members only — the page compares core content with Cancer Australia's own templates.
 */
export const reviewSnapshot = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: z.string().min(1).max(64) }))
	.handler(
		async ({
			data,
			context,
		}): Promise<{
			document: DocumentWireRow
			sourceFile: string
			pageCount: number | null
			sections: ReviewSectionRow[]
			derived: DerivedView
		}> => {
			const userId = requireUser(context.userId)
			await requireCentralMember(userId)
			const { d } = await envOf()
			const document = (
				await d
					.select()
					.from(schema.documents)
					.where(eq(schema.documents.id, data.documentId))
					.limit(1)
			)[0]
			if (!document) throw new Error('Document not found.')
			if (document.kind !== 'core')
				throw new Error(
					'The review page compares core documents with the templates they came from.',
				)
			const template = (
				await d
					.select()
					.from(schema.templates)
					.where(eq(schema.templates.id, document.templateId))
					.limit(1)
			)[0]
			if (!template) throw new Error('The document names a template that does not exist.')
			const rows = await d
				.select()
				.from(schema.sections)
				.where(eq(schema.sections.documentId, data.documentId))
			return {
				document: documentWireRow(document),
				sourceFile: template.sourceFile,
				pageCount: template.pageCount,
				sections: outlineOrder(rows).map((row) => ({
					...sectionWireRow(row),
					body: row.bodyJson ?? null,
				})),
				derived: await derivedFor(document, rows),
			}
		},
	)

/** What an event records beside its kind: plain JSON values. */
export type EventDetail = Record<string, string | number | boolean | null>

/** An activity line, as the hub's feed shows it. */
export type ActivityRow = {
	id: string
	kind: string
	actorName: string
	at: number
	detail: EventDetail | null
}

const eventDetail = (value: unknown): EventDetail | null => {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
	const out: EventDetail = {}
	for (const [key, v] of Object.entries(value))
		if (v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
			out[key] = v
	return out
}

/**
 * The hub's activity beside the map (decision 78); the document's versions and review
 * come from `documentState` (lifecycle-fns.ts). Members of the document only.
 */
export const hubSnapshot = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: z.string().min(1).max(64) }))
	.handler(async ({ data, context }): Promise<{ activity: ActivityRow[] }> => {
		const userId = requireUser(context.userId)
		const { d } = await envOf()
		const document = (
			await d
				.select({ orgId: schema.documents.orgId })
				.from(schema.documents)
				.where(eq(schema.documents.id, data.documentId))
				.limit(1)
		)[0]
		if (!document) throw new Error('Document not found.')
		if (!(await roleOn(userId, document.orgId)))
			throw new Error('You are not a member of this document.')
		const activity = await d
			.select()
			.from(schema.events)
			.where(eq(schema.events.documentId, data.documentId))
			.orderBy(desc(schema.events.at))
			.limit(30)
		return {
			activity: activity.map((e) => ({
				id: e.id,
				kind: e.kind,
				actorName: e.actorName,
				at: e.at.getTime(),
				detail: eventDetail(e.detail),
			})),
		}
	})

/** Depth-first reading order over the section tree. */
function outlineOrder<T extends { id: string; parentId: string | null; orderIndex: number }>(
	rows: T[],
): T[] {
	const byParent = new Map<string | null, T[]>()
	for (const row of rows) {
		const list = byParent.get(row.parentId) ?? []
		list.push(row)
		byParent.set(row.parentId, list)
	}
	const out: T[] = []
	const walk = (parentId: string | null) => {
		for (const row of (byParent.get(parentId) ?? []).sort((a, b) => a.orderIndex - b.orderIndex)) {
			out.push(row)
			walk(row.id)
		}
	}
	walk(null)
	return out
}

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A new pathway from the template kind's core document: its own organisation (the
 * caller becomes its lead), the core spine copied section for section — shared
 * sections by reference, owned sections with the core body as the starting draft —
 * and the core references copied so citations keep pointing at something.
 */
export const createPathway = createServerFn({ method: 'POST' })
	.inputValidator(
		z.object({
			kind: z.enum(['cancer', 'population']),
			title: z.string().trim().min(1).max(200),
			subject: z.string().trim().min(1).max(120),
			slug: z.string().trim().regex(slugPattern).min(2).max(64),
		}),
	)
	.handler(async ({ data, context }) => {
		const userId = requireUser(context.userId)
		await requireCentralMember(userId)
		const { env, d } = await envOf()
		const core = (
			await d
				.select()
				.from(schema.documents)
				.where(and(eq(schema.documents.kind, 'core'), eq(schema.documents.audience, data.kind)))
				.limit(1)
		)[0]
		if (!core) throw new Error(`No core document for ${data.kind} pathways has been seeded.`)
		const created = await env.AUTH.createOrganizationForUser(userId, {
			name: data.title,
			slug: data.slug,
			namespace: OCP_NAMESPACE,
		})
		if (!created.ok)
			throw new Error(`Could not create the pathway's organisation: ${created.error}.`)

		const documentId = crypto.randomUUID()

		// Shared content is stored once (decision 118): the pathway copies NO references —
		// its bodies cite the core's rows by id — and no shared body. The only copy is the
		// template scaffold of the sections the template hands the pathway to write.
		const coreSections = (
			await d.select().from(schema.sections).where(eq(schema.sections.documentId, core.id))
		).filter((s) => !s.apparatus)
		const sectionIds = new Map(coreSections.map((s) => [s.id, crypto.randomUUID()]))
		const rows = coreSections.map((s) => {
			const shared = s.pathwayOwnership === 'shared'
			return {
				id: sectionIds.get(s.id) ?? s.id,
				documentId,
				parentId: s.parentId ? (sectionIds.get(s.parentId) ?? null) : null,
				address: s.address,
				canonical: s.canonical,
				printedNumber: s.printedNumber,
				title: s.title,
				headingLevel: s.headingLevel,
				orderIndex: s.orderIndex,
				stepNumber: s.stepNumber,
				ownership: shared ? ('shared' as const) : ('owned' as const),
				coreSectionId: shared ? s.id : null,
				pointOfCare: s.pointOfCare,
				bodyJson: shared ? null : (s.bodyJson ?? null),
			}
		})
		// One atomic D1 batch: the document, its first draft version, its sections — all or
		// nothing. D1 binds at most 100 parameters per statement, so rows go in small groups.
		const chunk = <T>(items: T[], size: number): T[][] => {
			const out: T[][] = []
			for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
			return out
		}
		const [document] = await d
			.batch([
				d
					.insert(schema.documents)
					.values({
						id: documentId,
						kind: 'pathway',
						templateId: core.templateId,
						orgId: created.organizationId,
						slug: data.slug,
						title: data.title,
						subject: data.subject,
						audience: data.kind,
					})
					.returning(),
				d.insert(schema.versions).values({
					id: crypto.randomUUID(),
					documentId,
					status: 'draft',
					versionNo: 1,
					createdBy: userId,
				}),
				...chunk(rows, 6).map((group) => d.insert(schema.sections).values(group)),
			])
			.then(([first]) => first)

		if (document) void publishDocumentRows([document])
		return { documentId, organizationId: created.organizationId }
	})
