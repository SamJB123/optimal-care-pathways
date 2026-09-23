/**
 * What the workspace's margin reads besides a section's own row: the template's
 * instructions to authors (a pathway's "For the whole document"), which pathways took
 * their own copy of a core section, and the names of the people in the room.
 */

import { createServerFn } from '@tanstack/solid-start'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { JsonNode } from '#/content/schema.ts'
import { schema } from '#/db/index.ts'
import { documentName } from '#/lib/labels.ts'
import { outlineOrder } from '#/lib/outline.ts'
import { OCP_NAMESPACE } from '#/lib/roles.ts'
import { centralOrgId, documentRoleOf } from './access.ts'
import { envOf, requireUser } from './env.ts'

const idSchema = z.string().min(1).max(64)

async function requireMemberOf(userId: string, documentId: string) {
	const { env, d } = await envOf()
	const document = (await d.select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1))[0]
	if (!document || !(await documentRoleOf(env.AUTH, d, userId, document.orgId))) throw new Error('You are not a member of this document.')
	return document
}

export interface InstructionsSection {
	address: string
	printedNumber: string | null
	title: string | null
	body: JsonNode | null
	depth: number
}

/** The template's instructions to authors for a document: its own instructions part (a
 *  core template), or its template's (a pathway reads them by reference). */
export const instructionsFor = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: idSchema }))
	.handler(async ({ data, context }): Promise<{ source: string; sections: InstructionsSection[] }> => {
		const document = await requireMemberOf(requireUser(context.userId), data.documentId)
		const { d } = await envOf()
		const core =
			document.kind === 'core'
				? document
				: (
						await d
							.select()
							.from(schema.documents)
							.where(and(eq(schema.documents.kind, 'core'), eq(schema.documents.templateId, document.templateId)))
							.limit(1)
					)[0]
		if (!core) return { source: '', sections: [] }
		// Ordered over the whole outline: the instructions subtree hangs under a part, so
		// ordered alone it would have no top to start from.
		const rows = outlineOrder(await d.select().from(schema.sections).where(eq(schema.sections.documentId, core.id))).filter((r) => r.instructions)
		const byId = new Map(rows.map((r) => [r.id, r]))
		const depthOf = (r: (typeof rows)[number]) => {
			let depth = 0
			for (let p = r.parentId ? byId.get(r.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) depth++
			return depth
		}
		return {
			source: documentName(core),
			sections: rows.map((r) => ({ address: r.address, printedNumber: r.printedNumber, title: r.title, body: r.bodyJson ?? null, depth: depthOf(r) })),
		}
	})

/** The pathways that took their own copy of a core section (for the core's margin). */
export const divergedFrom = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ sectionId: idSchema }))
	.handler(async ({ data, context }): Promise<{ documentId: string; name: string; sectionId: string }[]> => {
		const userId = requireUser(context.userId)
		const { d } = await envOf()
		const section = (await d.select({ documentId: schema.sections.documentId }).from(schema.sections).where(eq(schema.sections.id, data.sectionId)).limit(1))[0]
		if (!section) throw new Error('Section not found.')
		await requireMemberOf(userId, section.documentId)
		const rows = await d
			.select({ sectionId: schema.sections.id, documentId: schema.documents.id, kind: schema.documents.kind, audience: schema.documents.audience, subject: schema.documents.subject })
			.from(schema.sections)
			.innerJoin(schema.documents, eq(schema.documents.id, schema.sections.documentId))
			.where(and(eq(schema.sections.coreSectionId, data.sectionId), eq(schema.sections.ownership, 'owned')))
		return rows.map((r) => ({ documentId: r.documentId, sectionId: r.sectionId, name: documentName(r) })).sort((a, b) => a.name.localeCompare(b.name))
	})

/** Who a comment on this document may name with @: its own team, then the central team
 *  (reviewers of every document). Names only — never an address. */
export const mentionable = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: idSchema }))
	.handler(async ({ data, context }): Promise<{ userId: string; name: string; team: 'document' | 'central' }[]> => {
		const document = await requireMemberOf(requireUser(context.userId), data.documentId)
		const { env, d } = await envOf()
		const central = await centralOrgId(env.AUTH, d)
		const [own, centre] = await Promise.all([
			env.AUTH.listOrgMembers(document.orgId, OCP_NAMESPACE),
			central && central !== document.orgId ? env.AUTH.listOrgMembers(central, OCP_NAMESPACE) : Promise.resolve([]),
		])
		const out: { userId: string; name: string; team: 'document' | 'central' }[] = []
		const add = (members: { userId: string; name: string }[], team: 'document' | 'central') => {
			for (const m of members) if (!out.some((o) => o.userId === m.userId)) out.push({ userId: m.userId, name: m.name, team })
		}
		add(own, 'document')
		add(centre, 'central')
		return out.sort((a, b) => (a.team === b.team ? a.name.localeCompare(b.name) : a.team === 'document' ? -1 : 1))
	})

/** The names of people in a document's room (its roster carries only their ids). */
export const namesIn = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: idSchema, userIds: z.array(idSchema).max(100) }))
	.handler(async ({ data, context }): Promise<Record<string, string>> => {
		await requireMemberOf(requireUser(context.userId), data.documentId)
		const { env } = await envOf()
		const people = await env.AUTH.getUsersByIds(data.userIds)
		return Object.fromEntries(Object.entries(people).map(([id, p]) => [id, p.name]))
	})
