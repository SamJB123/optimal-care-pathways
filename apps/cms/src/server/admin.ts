/**
 * The administration page's data (decision S11): what the deployment still needs done —
 * the central organisation set up, legacy imports finalised — for any signed-in caller
 * (setting up is open to the deployment's listed administrators, whoever they are); the
 * rest of the page is the central team's.
 */

import { createServerFn } from '@tanstack/solid-start'
import { like } from 'drizzle-orm'
import { schema } from '#/db/index.ts'
import { documentName } from '#/lib/labels.ts'
import { roles } from '#/lib/roles.ts'
import * as access from './access.ts'
import { envOf, requireUser } from './env.ts'

export interface AdminSnapshot {
	/** No central organisation owns the core documents yet. */
	setUp: boolean
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
	}[]
}

export const adminSnapshot = createServerFn({ method: 'GET' }).handler(async ({ context }): Promise<AdminSnapshot> => {
	const userId = requireUser(context.userId)
	const { env, d } = await envOf()
	const central = await access.centralOrgId(env.AUTH, d)
	const isCentral = central !== null && (await roles.roleOf(env.AUTH, userId, central)) !== null
	const pending = await d
		.select({ slug: schema.documents.slug, subject: schema.documents.subject, kind: schema.documents.kind, audience: schema.documents.audience })
		.from(schema.documents)
		.where(like(schema.documents.orgId, 'pending:%'))
	const documents = isCentral ? await d.select().from(schema.documents) : []
	return {
		setUp: central === null,
		central: isCentral,
		pending: isCentral ? pending.filter((p) => p.kind === 'pathway').map((p) => ({ slug: p.slug, name: documentName(p) })) : [],
		documents: documents.map((doc) => ({
			id: doc.id,
			kind: doc.kind,
			audience: doc.audience,
			slug: doc.slug,
			name: documentName(doc),
			accent: doc.accent,
		})),
	}
})
