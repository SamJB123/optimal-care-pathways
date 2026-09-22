/**
 * Roles. Every document belongs to a better-auth organisation (one per pathway, plus
 * the central organisation that owns core content), and better-auth's fixed ladder is
 * NAMED here rather than remapped: viewer, member (a drafter), admin (a reviewer),
 * owner (the pathway lead). Publishing is membership of the central organisation, not
 * a role.
 */

import type { DocTier } from '@aicolab/app-kit/doc-room'
import { createOrgRoles } from '@aicolab/app-kit/org'

/** The organisation namespace this application partitions memberships under. */
export const OCP_NAMESPACE = 'ocp'

export const ROLE_LADDER = ['viewer', 'member', 'admin', 'owner'] as const
export type Role = (typeof ROLE_LADDER)[number]

/** What each better-auth role is called in this application. */
export const ROLE_LABELS: Record<Role, string> = {
	viewer: 'Viewer',
	member: 'Drafter',
	admin: 'Reviewer',
	owner: 'Pathway lead',
}

export const roles = createOrgRoles<Role>({ namespace: OCP_NAMESPACE, ladder: ROLE_LADDER })

/** Editing tier for a role: drafters and above edit, viewers read. */
export const tierForRole = (role: Role | null): DocTier | null =>
	role === null ? null : role === 'viewer' ? 'viewer' : 'editor'
