/**
 * WHO MAY CHANGE WHOM IN A TEAM, defined once. The auth worker's team doors enforce it
 * against the actor's real memberships; the cms reads the same functions to word its
 * refusals and to offer only what the reader may do. A leaf: it imports only the shared
 * organisation roles, so the browser bundle and the auth worker (apps/auth) both take it
 * as it is.
 *
 * A team is a better-auth organisation (a pathway's, or the central organisation's), and
 * its roles are better-auth's ladder, which lib/roles.ts names: viewer, drafter (member),
 * reviewer (admin), pathway lead (owner). The actor's STANDING over a team is their own
 * role in it, or 'steward' when they belong to the central organisation and the team is
 * another one. A steward's standing never applies to the central organisation itself: the
 * central team is managed by its own roles.
 *
 *   - a lead, or a steward, changes anyone to any role, lead included, and removes anyone;
 *   - a reviewer changes and removes drafters and viewers, and only to drafter or viewer;
 *   - anyone may leave;
 *   - a team never loses its last lead: the last lead can neither leave, nor be removed,
 *     nor be given another role. A team may have more than one lead, so a lead hands over
 *     by appointing another first.
 */

import { ORG_ROLES, type OrgRole } from '@aicolab/better-auth/cloudflare/shared/org-access'

/** The ladder, lowest first. */
export const TEAM_ROLES: readonly OrgRole[] = ORG_ROLES.toReversed()

/** What the actor is to a team: a steward, one of its roles, or nothing. */
export type TeamStanding = 'steward' | OrgRole | null

/** Why a team door refused. */
export type TeamRefusal = 'forbidden' | 'last-lead' | 'not-member' | 'not-found' | 'invalid'

export type TeamVerdict = { ok: true } | { ok: false; reason: TeamRefusal }

/** A stored role as the ladder names it; anything else is no role. */
export const roleFrom = (value: string | null | undefined): OrgRole | null =>
	TEAM_ROLES.find((role) => role === value) ?? null

/** The actor's standing, from their own role in the team and whether they belong to the
 *  central organisation (`stewardOfThis` is false when the team IS the central one). */
export const standingOf = (ownRole: OrgRole | null, stewardOfThis: boolean): TeamStanding =>
	stewardOfThis ? 'steward' : ownRole

/** Leads and stewards manage everyone; reviewers manage drafters and viewers. */
const managesEveryone = (standing: TeamStanding): boolean =>
	standing === 'steward' || standing === 'owner'
const baseRole = (role: OrgRole | null): boolean => role === 'member' || role === 'viewer'

/** The roles an actor may bring someone in at, lowest first. */
export function grantableRoles(standing: TeamStanding): OrgRole[] {
	if (managesEveryone(standing)) return [...TEAM_ROLES]
	if (standing === 'admin') return ['viewer', 'member']
	return []
}

/** Whether the actor may manage the team at all: bring people in, make links. */
export const managesTeam = (standing: TeamStanding): boolean => grantableRoles(standing).length > 0

/**
 * Whether the actor may take a member from one role to another (`to` null: remove them).
 * `leads` is how many leads the team has now; `self` is true when the actor is the member.
 */
export function mayChange(input: {
	standing: TeamStanding
	self: boolean
	from: OrgRole
	to: OrgRole | null
	leads: number
}): TeamVerdict {
	if (input.from === input.to) return { ok: true }
	const allowed =
		(input.self && input.to === null) ||
		managesEveryone(input.standing) ||
		(input.standing === 'admin' &&
			baseRole(input.from) &&
			(input.to === null || baseRole(input.to)))
	if (!allowed) return { ok: false, reason: 'forbidden' }
	if (input.from === 'owner' && input.to !== 'owner' && input.leads <= 1)
		return { ok: false, reason: 'last-lead' }
	return { ok: true }
}

/** Whether the actor may bring someone in at a role. */
export function mayGrant(standing: TeamStanding, role: OrgRole): TeamVerdict {
	return grantableRoles(standing).includes(role) ? { ok: true } : { ok: false, reason: 'forbidden' }
}

/** The roles an actor may move a member to (their current one included), lowest first,
 *  for the role picker; empty when the member is not theirs to change. */
export function rolesFor(input: {
	standing: TeamStanding
	self: boolean
	from: OrgRole
	leads: number
}): OrgRole[] {
	const allowed = TEAM_ROLES.filter((to) => mayChange({ ...input, to }).ok)
	return allowed.length > 1 ? allowed : []
}

/** Roster order: leads, reviewers, drafters, viewers, then by name. */
export const compareMembers = (
	a: { role: OrgRole; name: string },
	b: { role: OrgRole; name: string },
): number => TEAM_ROLES.indexOf(b.role) - TEAM_ROLES.indexOf(a.role) || a.name.localeCompare(b.name)
