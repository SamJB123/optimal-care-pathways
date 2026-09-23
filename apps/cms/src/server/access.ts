/**
 * WHO MAY SEE AND DO WHAT — defined once, used everywhere a document is opened.
 *
 * Two cohorts (decision 27): the CENTRAL organisation (Cancer Australia, owner of the
 * core content and of publishing), whose members see and review every document; and one
 * organisation per pathway, whose members work on that pathway with better-auth's roles.
 * A document's role for a user is therefore their own membership role on the document's
 * organisation, else 'admin' (a reviewer) when they belong to the central organisation,
 * else nothing.
 *
 * Every door goes through `documentRole`: the page loaders, the lifecycle, the live RPC
 * root, the document room's editing tier and the legacy import's provenance read. No
 * other file resolves a membership against a document.
 */

import type { OrgMembershipService } from '@aicolab/app-kit/org'
import { eq } from 'drizzle-orm'
import { type Db, schema } from '#/db/index.ts'
import { OCP_NAMESPACE, type Role, roles } from '#/lib/roles.ts'

/** The central organisation: Cancer Australia, owner of core content and of publishing. */
export const CENTRAL_ORG_SLUG = 'cancer-australia'
export const CENTRAL_ORG_NAME = 'Cancer Australia'

/** What the auth worker must answer: memberships for a role, and the organisation by
 *  slug for the central lookup. */
export type MembershipAuth = OrgMembershipService
export type OrganisationAuth = MembershipAuth & Pick<Cloudflare.Env['AUTH'], 'ensureOrganization'>

/**
 * The central organisation's id, or null before bootstrap. It is the organisation with the
 * central slug — and, so a seed's placeholder never counts, only once the core documents
 * are owned by it.
 */
export async function centralOrgId(auth: OrganisationAuth, d: Db): Promise<string | null> {
	const core = (
		await d
			.select({ orgId: schema.documents.orgId })
			.from(schema.documents)
			.where(eq(schema.documents.kind, 'core'))
			.limit(1)
	)[0]
	if (!core) return null
	const org = await auth.ensureOrganization({
		slug: CENTRAL_ORG_SLUG,
		name: CENTRAL_ORG_NAME,
		namespace: OCP_NAMESPACE,
	})
	return org.id === core.orgId ? org.id : null
}

/** A user's role on a document owned by `orgId`, given the central organisation's id. */
export async function documentRole(
	auth: MembershipAuth,
	userId: string,
	orgId: string,
	central: string | null,
): Promise<Role | null> {
	const own = await roles.roleOf(auth, userId, orgId)
	if (own) return own
	if (central && central !== orgId && (await roles.roleOf(auth, userId, central))) return 'admin'
	return null
}

/** `documentRole` with the central organisation looked up. */
export async function documentRoleOf(
	auth: OrganisationAuth,
	d: Db,
	userId: string,
	orgId: string,
): Promise<Role | null> {
	return documentRole(auth, userId, orgId, await centralOrgId(auth, d))
}

/** Whether the user belongs to the central organisation. */
export async function isCentralMember(
	auth: OrganisationAuth,
	d: Db,
	userId: string,
): Promise<boolean> {
	const central = await centralOrgId(auth, d)
	return central !== null && (await roles.roleOf(auth, userId, central)) !== null
}
