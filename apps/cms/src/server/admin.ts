/**
 * The administration page's data (decision S11): what the deployment still needs done —
 * the central organisation set up, legacy imports finalised — for any signed-in caller
 * (setting up is open to the deployment's listed administrators, whoever they are); the
 * rest of the page is the central team's.
 */

import { createServerFn } from '@tanstack/solid-start'
import { eq, like } from 'drizzle-orm'
import { z } from 'zod'
import { cacheTagFor } from '#/api/published.ts'
import { schema } from '#/db/index.ts'
import { isHexColour } from '#/lib/family.ts'
import { documentName } from '#/lib/labels.ts'
import { publishDocumentRows } from '#/lib/live-publish.ts'
import { OCP_NAMESPACE, roles } from '#/lib/roles.ts'
import * as access from './access.ts'
import { envOf, requireUser } from './env.ts'
import { lifecycleOf } from './lifecycle-env.ts'

export interface AdminSnapshot {
	/** No central organisation owns the core documents yet. */
	setUp: boolean
	/** The central organisation has no lead (a deployment set up before the first
	 *  administrator became one): nobody may review core content or manage its team. */
	leadless: boolean
	central: boolean
	/** Imported pathways waiting for their organisations. */
	pending: { slug: string; name: string }[]
	/** Every document with its colour, for the colour register. */
	documents: {
		id: string
		kind: 'core' | 'pathway'
		audience: 'cancer' | 'population' | 'principles'
		slug: string
		name: string
		accent: string | null
		/** The print's own colour, to return to. */
		printAccent: string | null
		/** It has a published edition readers can open. */
		published: boolean
	}[]
}

export const adminSnapshot = createServerFn({ method: 'GET' }).handler(async ({ context }): Promise<AdminSnapshot> => {
	const userId = requireUser(context.userId)
	const { env, d } = await envOf()
	const central = await access.centralOrgId(env.AUTH, d)
	const isCentral = central !== null && (await roles.roleOf(env.AUTH, userId, central)) !== null
	const leadless =
		central !== null && !(await env.AUTH.listOrgMembers(central, OCP_NAMESPACE)).some((member) => member.role === 'owner')
	const pending = await d
		.select({ slug: schema.documents.slug, subject: schema.documents.subject, kind: schema.documents.kind, audience: schema.documents.audience })
		.from(schema.documents)
		.where(like(schema.documents.orgId, 'pending:%'))
	const documents = isCentral ? await d.select().from(schema.documents) : []
	const published = new Set(
		isCentral ? (await d.select({ documentId: schema.publishedVersions.documentId }).from(schema.publishedVersions)).map((p) => p.documentId) : [],
	)
	return {
		setUp: central === null,
		leadless,
		central: isCentral,
		pending: isCentral ? pending.filter((p) => p.kind === 'pathway').map((p) => ({ slug: p.slug, name: documentName(p) })) : [],
		documents: documents.map((doc) => ({
			id: doc.id,
			kind: doc.kind,
			audience: doc.audience,
			slug: doc.slug,
			name: documentName(doc),
			accent: doc.accent,
			printAccent: doc.printAccent,
			published: published.has(doc.id),
		})),
	}
})

/**
 * A document's family colour (decisions U21, U25), set by the central team from the
 * register on /admin or from the document's overview. Every page that shows the document
 * retints: the atlas row live, the published pages on their next read (their PDFs are
 * dropped from the cache).
 */
export const setDocumentAccent = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ documentId: z.string().min(1).max(64), accent: z.string().refine(isHexColour, 'Write the colour as # and six hex digits.') }))
	.handler(async ({ data, context }) => {
		const userId = requireUser(context.userId)
		const { env, d } = await envOf()
		const central = await access.centralOrgId(env.AUTH, d)
		if (!central || (await roles.roleOf(env.AUTH, userId, central)) === null) throw new Error('Only the central team may change a document’s colour.')
		const updated = await d
			.update(schema.documents)
			.set({ accent: data.accent.toLowerCase() })
			.where(eq(schema.documents.id, data.documentId))
			.returning()
		const row = updated[0]
		if (!row) throw new Error('Document not found.')
		void publishDocumentRows([row])
		const lc = await lifecycleOf()
		try {
			await lc.purge?.([cacheTagFor(row.slug), ...(row.partnerSlug ? [cacheTagFor(row.partnerSlug)] : [])])
		} catch (error) {
			console.error('[admin] cache purge after a colour change failed:', error instanceof Error ? error.message : error)
		}
		return { accent: row.accent }
	})
