/**
 * What a caller may see, and in what role: the one visibility rule of the documents topic
 * (a member sees their organisations' documents; a central member sees all), for the
 * server functions that list documents (the atlas, the jump, search). Server-only, and
 * kept out of the server-function modules (see lifecycle-env.ts for why).
 */

import { inArray } from 'drizzle-orm'
import { inGroups, schema } from '#/db/index.ts'
import { OCP_NAMESPACE, ROLE_LADDER } from '#/lib/roles.ts'
import * as access from './access.ts'
import { envOf } from './env.ts'

export async function visibleDocuments(userId: string) {
	const { env, d } = await envOf()
	const memberships = await env.AUTH.listUserOrgs(userId, OCP_NAMESPACE)
	const orgIds = memberships.map((m) => m.organizationId)
	const central = await access.centralOrgId(env.AUTH, d)
	const isCentral = central !== null && orgIds.includes(central)
	const rows = isCentral
		? await d.select().from(schema.documents)
		: orgIds.length === 0
			? []
			: await inGroups(orgIds, (group) =>
					d.select().from(schema.documents).where(inArray(schema.documents.orgId, group)),
				)
	const roleByOrg = new Map(
		memberships.map((m) => [m.organizationId, ROLE_LADDER.find((r) => r === m.role) ?? null]),
	)
	const withRole = rows.flatMap((row) => {
		const role = roleByOrg.get(row.orgId) ?? (isCentral ? ('admin' as const) : null)
		return role ? [{ row, role }] : []
	})
	return { documents: withRole, central: isCentral, setUp: central === null }
}
