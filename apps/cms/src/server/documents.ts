/**
 * Server functions over documents: the first-run bootstrap of the central organisation,
 * the SSR snapshots the live topics take over from, and creating a pathway from the
 * template's core document.
 *
 * Every function runs behind the kit's auth middleware (context.userId is the verified
 * caller) and re-checks the caller's role per call through the auth worker.
 */

import { createServerFn } from '@tanstack/solid-start'
import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
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

async function roleOn(userId: string, orgId: string): Promise<Role | null> {
	const { env } = await envOf()
	return roles.roleOf(env.AUTH, userId, orgId)
}

async function requireCentralMember(userId: string): Promise<string> {
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

/** The caller's documents for first paint; the live documents topic takes over. */
export const documentsSnapshot = createServerFn({ method: 'GET' }).handler(
	async ({
		context,
	}): Promise<{ documents: DocumentWireRow[]; central: boolean; roles: Record<string, Role> }> => {
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
		return {
			documents: rows.map(documentWireRow),
			central: isCentral,
			roles: Object.fromEntries(roleEntries),
		}
	},
)

/** One document's outline for first paint; the live sections topic takes over. */
export const sectionsSnapshot = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: z.string().min(1).max(64) }))
	.handler(
		async ({
			data,
			context,
		}): Promise<{ document: DocumentWireRow; sections: SectionWireRow[]; role: Role }> => {
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
			return { document: documentWireRow(document), sections: sections.map(sectionWireRow), role }
		},
	)

/** The resting body of a section the caller may read: its own, or, for a shared
 *  section, the core section it renders. */
export const sectionBody = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ sectionId: z.string().min(1).max(64) }))
	.handler(async ({ data, context }): Promise<{ body: JsonNode | null; resolvedFrom: string }> => {
		const userId = requireUser(context.userId)
		const { d } = await envOf()
		const section = (
			await d.select().from(schema.sections).where(eq(schema.sections.id, data.sectionId)).limit(1)
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
			return { body: section.bodyJson ?? null, resolvedFrom: section.id }
		const core = (
			await d
				.select()
				.from(schema.sections)
				.where(eq(schema.sections.id, section.coreSectionId))
				.limit(1)
		)[0]
		return { body: core?.bodyJson ?? null, resolvedFrom: section.coreSectionId }
	})

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

		// The copied bodies point at the copied references, so the ids are minted first.
		const coreReferences = await d
			.select()
			.from(schema.references)
			.where(eq(schema.references.documentId, core.id))
		const referenceIds = new Map(coreReferences.map((r) => [r.id, crypto.randomUUID()]))
		const referenceRows = coreReferences.map((r) => ({
			id: referenceIds.get(r.id) ?? r.id,
			documentId,
			citation: r.citation,
			url: r.url,
			printedNumber: r.printedNumber,
		}))

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
				bodyJson: shared || !s.bodyJson ? null : remapCitations(s.bodyJson, referenceIds),
			}
		})
		// One atomic D1 batch: the document, its references, its sections — all or nothing.
		// D1 binds at most 100 parameters per statement, so rows go in small groups.
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
				...chunk(referenceRows, 16).map((group) => d.insert(schema.references).values(group)),
				...chunk(rows, 6).map((group) => d.insert(schema.sections).values(group)),
			])
			.then(([first]) => first)

		if (document) void publishDocumentRows([document])
		return { documentId, organizationId: created.organizationId }
	})

function remapCitations(node: JsonNode, referenceIds: ReadonlyMap<string, string>): JsonNode {
	const attrs =
		node.type === 'citation' && typeof node.attrs?.referenceId === 'string'
			? {
					...node.attrs,
					referenceId: referenceIds.get(node.attrs.referenceId) ?? node.attrs.referenceId,
				}
			: node.attrs
	const content = node.content?.map((child) => remapCitations(child, referenceIds))
	return { ...node, ...(attrs ? { attrs } : {}), ...(content ? { content } : {}) }
}
