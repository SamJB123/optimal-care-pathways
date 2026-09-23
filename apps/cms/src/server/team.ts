/**
 * People management (the hive's members panel, named for this application): a team's
 * roster, role changes and removals, the ways in — by email, by member code, by searching
 * the people already on some OCP team, by invite link — and email invitations. Plain
 * functions over an injected `Team` so the workerd tests exercise them directly;
 * `team-fns.ts` wraps them as server functions with the caller's identity.
 *
 * AUTHORITY. The auth worker's team doors (TeamDoors) authorise every change against the
 * actor's real memberships with the one team rule (lib/team-rule.ts). The same rule runs
 * here first, so a refusal reaches the page in plain words, and the page offers only what
 * the reader may do. Reading a roster is for the team's members and the central team.
 *
 * AFTER A CHANGE. The team's live topic hears it (team-topic.ts); the person's open
 * editors are re-tiered at once in every document the change reaches (the team's own
 * documents, or every document for a change to the central team), from their role as the
 * one access rule now computes it; and a person someone else brought in is emailed, with a
 * link to the document (the lifecycle's notify pattern).
 *
 * NO EMAIL ADDRESS LEAVES HERE. Rosters, search results and results carry names, avatars
 * and ids; the member tag is derived from the id in the browser.
 */

import type { DocTier } from '@aicolab/app-kit/doc-room'
import { displayNameOf, normalizeMemberCode } from '@aicolab/better-auth/cloudflare/shared/user-tag'
import { and, eq, gt, isNull, not, like } from 'drizzle-orm'
import { type Db, schema } from '#/db/index.ts'
import { documentName, imprintDate } from '#/lib/labels.ts'
import { OCP_NAMESPACE, type Role, tierForRole } from '#/lib/roles.ts'
import {
	compareMembers,
	managesTeam,
	mayChange,
	mayGrant,
	roleFrom,
	standingOf,
	type TeamRefusal,
	type TeamStanding,
} from '#/lib/team-rule.ts'
import { roleWord } from '#/lib/team-labels.ts'
import { type ListedMember, type TeamMemberWireRow, teamMemberWireRow } from '#/lib/team-topic.ts'
import { documentRoomName } from '#/rooms/document-room.ts'
import { CENTRAL_ORG_NAME, CENTRAL_ORG_SLUG, documentRole } from './access.ts'

/** The central organisation, as the doors take it: its members are stewards of every
 *  other team. */
export const STEWARD = { slug: CENTRAL_ORG_SLUG, namespace: OCP_NAMESPACE }

/** A door's answer: done, with its detail, or refused with a reason. */
export type DoorResult<T> = ({ ok: true } & T) | { ok: false; reason: TeamRefusal }

/**
 * The auth worker's TEAM DOORS (apps/auth/src/worker.ts): each authorises the actor
 * against their own memberships with lib/team-rule.ts and the steward organisation, then
 * writes. The only way a team's membership changes.
 */
export interface TeamDoors {
	/** Change a member's role, or remove them (`role` null; the actor themself: leave). */
	manageTeamMember(
		actorUserId: string,
		organizationId: string,
		targetUserId: string,
		role: Role | null,
		namespace: string,
		steward: { slug: string; namespace: string },
	): Promise<DoorResult<{ role: Role | null }>>
	/** Bring an existing account in at a role; a member already is left as they are. */
	grantTeamMember(
		actorUserId: string,
		organizationId: string,
		targetUserId: string,
		role: Role,
		namespace: string,
		steward: { slug: string; namespace: string },
	): Promise<DoorResult<{ role: string; added: boolean }>>
	/** A pending invitation for an address with no account; the caller mails the link. */
	inviteTeamMember(
		actorUserId: string,
		organizationId: string,
		email: string,
		role: Role,
		namespace: string,
		steward: { slug: string; namespace: string },
	): Promise<DoorResult<{ invitationId: string; expiresAt: number }>>
	/** Make the user the lead of an organisation that has none; false once it has one. */
	claimTeamLead(userId: string, organizationId: string, namespace: string): Promise<boolean>
}

/** What the team functions read from the auth worker besides the doors. */
export interface TeamAuth {
	getOrgMembershipById(userId: string, organizationId: string, namespace: string): Promise<{ role: string } | null>
	listOrgMembers(organizationId: string, namespace?: string): Promise<(ListedMember & { email: string })[]>
	listUserOrgs(userId: string, namespace?: string): Promise<{ organizationId: string }[]>
	getUserById(userId: string): Promise<{ id: string; name: string; email: string } | null>
	getUserByEmail(email: string): Promise<{ id: string; name: string; email: string } | null>
	getUserByMemberCode(code: string): Promise<{ id: string; name: string; email: string } | null>
	acceptOrgInvitation(
		userId: string,
		invitationId: string,
		namespace?: string,
	): Promise<
		| { ok: true; organizationId: string; role: string }
		| { ok: false; error: 'not-found' | 'expired' | 'wrong-email' | 'already-handled' | 'invalid' }
	>
	sendNotification(mail: { to: string[]; subject: string; text: string }): Promise<unknown>
}

/** What the team functions need from the worker. */
export interface Team {
	d: Db
	auth: TeamAuth
	doors: TeamDoors
	rooms: {
		get(id: DurableObjectId): { retierUser(userId: string, tier: DocTier): Promise<number> }
		idFromName(name: string): DurableObjectId
	}
	/** The central organisation's id; null before bootstrap. */
	centralOrgId(): Promise<string | null>
	/** Where the site lives, for links in mail and invite links. */
	origin: string
	/** Tell the team's live roster (team-topic.ts's publishTeamChange); best-effort. */
	announce(orgId: string, change: { row: TeamMemberWireRow } | { removed: string }): Promise<void>
}

export class TeamRefusalError extends Error {}

const refuse = (message: string): never => {
	throw new TeamRefusalError(message)
}

// ---------------------------------------------------------------------------
// The team, and where the reader stands in it
// ---------------------------------------------------------------------------

/** A team as the page names it: the central team, or the team of a pathway (or of a core
 *  document, whose organisation is the central one). */
export interface TeamSummary {
	orgId: string
	name: string
	central: boolean
	/** The document the team works on, where its links and mail land; null for the
	 *  central team. */
	documentId: string | null
}

export async function teamOf(t: Team, orgId: string): Promise<TeamSummary> {
	const central = await t.centralOrgId()
	if (orgId === central) return { orgId, name: CENTRAL_ORG_NAME, central: true, documentId: null }
	const docs = await t.d.select().from(schema.documents).where(eq(schema.documents.orgId, orgId))
	const doc = docs.find((d) => d.kind === 'pathway') ?? docs[0]
	if (!doc) return refuse('Team not found.')
	return { orgId, name: documentName(doc), central: false, documentId: doc.id }
}

/** The team of a document. */
export async function teamOfDocument(t: Team, documentId: string): Promise<TeamSummary> {
	const doc = (await t.d.select().from(schema.documents).where(eq(schema.documents.id, documentId)).limit(1))[0]
	if (!doc) return refuse('Document not found.')
	const team = await teamOf(t, doc.orgId)
	return team.central ? team : { ...team, name: documentName(doc), documentId: doc.id }
}

/** Where a user stands over a team: their own role in it, or steward as a member of the
 *  central organisation (never over the central team itself). */
export async function standingIn(t: Team, userId: string, orgId: string): Promise<TeamStanding> {
	const central = await t.centralOrgId()
	const own = roleFrom((await t.auth.getOrgMembershipById(userId, orgId, OCP_NAMESPACE))?.role)
	const steward =
		central !== null && central !== orgId && (await t.auth.getOrgMembershipById(userId, central, OCP_NAMESPACE)) !== null
	return standingOf(own, steward)
}

async function membersOf(t: Team, orgId: string): Promise<TeamMemberWireRow[]> {
	const listed = await t.auth.listOrgMembers(orgId, OCP_NAMESPACE)
	return listed.flatMap((m) => teamMemberWireRow(m) ?? []).sort(compareMembers)
}

export interface TeamView {
	team: TeamSummary
	standing: TeamStanding
	members: TeamMemberWireRow[]
}

/** The roster, for a member of the team or of the central team. */
export async function teamView(t: Team, userId: string, orgId: string): Promise<TeamView> {
	const team = await teamOf(t, orgId)
	const standing = await standingIn(t, userId, orgId)
	if (standing === null) refuse('You are not on this team.')
	return { team, standing, members: await membersOf(t, orgId) }
}

// ---------------------------------------------------------------------------
// Refusals in plain words
// ---------------------------------------------------------------------------

function refusalText(
	reason: TeamRefusal,
	context: { team: TeamSummary; standing: TeamStanding; self: boolean; name: string; leaving: boolean },
): string {
	const lead = roleWord('owner', context.team.central)
	switch (reason) {
		case 'last-lead':
			return context.self
				? `You are the only ${lead}. Appoint another ${lead} before you ${context.leaving ? 'leave' : 'change your role'}.`
				: `${context.name} is the only ${lead}. Appoint another ${lead} first.`
		case 'forbidden':
			return context.standing === 'admin'
				? 'Reviewers can bring in and change drafters and viewers only.'
				: context.team.central
					? 'Only the lead or a reviewer can change the Cancer Australia team.'
					: `Only the ${lead}, a reviewer or the Cancer Australia team can change this team.`
		case 'not-member':
			return `${context.name} is not on this team.`
		case 'not-found':
			return 'Team not found.'
		case 'invalid':
			return 'That change could not be made.'
	}
}

// ---------------------------------------------------------------------------
// After a change: the roster, the open editors, the mail
// ---------------------------------------------------------------------------

/** Re-tier the user's open editors in every document the team's change reaches, from
 *  their role as the access rule now computes it. A user left with no role drops to
 *  reading: the room has no lower tier, and their next connect is refused. Best-effort:
 *  the change has committed. */
async function retier(t: Team, orgId: string, userId: string): Promise<void> {
	try {
		const central = await t.centralOrgId()
		const docs = await (orgId === central
			? t.d.select({ id: schema.documents.id, orgId: schema.documents.orgId }).from(schema.documents)
			: t.d.select({ id: schema.documents.id, orgId: schema.documents.orgId }).from(schema.documents).where(eq(schema.documents.orgId, orgId)))
		await Promise.all(
			docs.map(async (doc) => {
				const tier = tierForRole(await documentRole(t.auth, userId, doc.orgId, central)) ?? 'viewer'
				await t.rooms.get(t.rooms.idFromName(documentRoomName(doc.id))).retierUser(userId, tier)
			}),
		)
	} catch (error) {
		console.error('[team] re-tier failed (the change stands):', error instanceof Error ? error.message : error)
	}
}

/** Tell the roster about a member as the auth worker now lists them. */
async function announceMember(t: Team, orgId: string, userId: string): Promise<TeamMemberWireRow | null> {
	const row = (await membersOf(t, orgId)).find((m) => m.userId === userId) ?? null
	await t.announce(orgId, row ? { row } : { removed: userId })
	return row
}

/** Best-effort: a notification never fails the change it reports. */
async function notify(t: Team, to: string, subject: string, text: string): Promise<boolean> {
	try {
		await t.auth.sendNotification({ to: [to], subject, text })
		return true
	} catch (error) {
		console.error('[team] notification failed:', error instanceof Error ? error.message : error)
		return false
	}
}

const teamLink = (t: Team, team: TeamSummary): string => (team.documentId ? `${t.origin}/d/${team.documentId}` : `${t.origin}/`)

// ---------------------------------------------------------------------------
// Role changes and removals
// ---------------------------------------------------------------------------

/** Change a member's role, or remove them (`role` null). The actor removing themself
 *  leaves. */
export async function changeMember(
	t: Team,
	input: { actorId: string; orgId: string; userId: string; role: Role | null },
): Promise<{ name: string; role: Role | null }> {
	const team = await teamOf(t, input.orgId)
	const members = await membersOf(t, input.orgId)
	const target = members.find((m) => m.userId === input.userId)
	const standing = await standingIn(t, input.actorId, input.orgId)
	const self = input.actorId === input.userId
	const name = target ? displayNameOf({ id: target.userId, name: target.name }) : 'That person'
	const words = { team, standing, self, name, leaving: input.role === null }
	if (!target) return refuse(refusalText('not-member', words))
	const verdict = mayChange({
		standing,
		self,
		from: target.role,
		to: input.role,
		leads: members.filter((m) => m.role === 'owner').length,
	})
	if (!verdict.ok) return refuse(refusalText(verdict.reason, words))
	if (target.role === input.role) return { name, role: target.role }
	const done = await t.doors.manageTeamMember(input.actorId, input.orgId, input.userId, input.role, OCP_NAMESPACE, STEWARD)
	if (!done.ok) return refuse(refusalText(done.reason, words))
	await t.announce(input.orgId, done.role === null ? { removed: input.userId } : { row: { ...target, role: done.role } })
	await retier(t, input.orgId, input.userId)
	return { name, role: done.role }
}

// ---------------------------------------------------------------------------
// The ways in
// ---------------------------------------------------------------------------

export type AddResult =
	| { kind: 'added'; name: string; role: Role; emailed: boolean }
	| { kind: 'already'; name: string; role: Role | null }
	| { kind: 'invited'; email: string; role: Role }

/** Bring an existing account in, then tell the roster, re-tier and email them. */
async function bringIn(
	t: Team,
	input: { actorId: string; team: TeamSummary; standing: TeamStanding; person: { id: string; name: string; email: string }; role: Role },
): Promise<AddResult> {
	const name = displayNameOf({ id: input.person.id, name: input.person.name })
	const words = { team: input.team, standing: input.standing, self: input.actorId === input.person.id, name, leaving: false }
	const done = await t.doors.grantTeamMember(input.actorId, input.team.orgId, input.person.id, input.role, OCP_NAMESPACE, STEWARD)
	if (!done.ok) return refuse(refusalText(done.reason, words))
	if (!done.added) return { kind: 'already', name, role: roleFrom(done.role) }
	await announceMember(t, input.team.orgId, input.person.id)
	await retier(t, input.team.orgId, input.person.id)
	const actor = await t.auth.getUserById(input.actorId)
	const by = actor ? displayNameOf(actor) : 'Someone'
	const emailed = await notify(
		t,
		input.person.email,
		`You have been added to ${input.team.name}`,
		`${by} added you to ${input.team.name} as a ${roleWord(input.role, input.team.central)}.\n\n${teamLink(t, input.team)}`,
	)
	return { kind: 'added', name, role: input.role, emailed }
}

/** The team and the actor's standing, refused unless they may bring people in at `role`. */
async function mayBringIn(t: Team, actorId: string, orgId: string, role: Role) {
	const team = await teamOf(t, orgId)
	const standing = await standingIn(t, actorId, orgId)
	const verdict = mayGrant(standing, role)
	if (!verdict.ok) return refuse(refusalText(verdict.reason, { team, standing, self: false, name: '', leaving: false }))
	return { team, standing }
}

/**
 * By email: an address with an account is added directly (and emailed); an unknown one
 * is invited — a pending invitation in the auth worker, and an email whose link opens
 * this site's invitation page. Account existence is never reported apart from a
 * membership resulting.
 */
export async function addByEmail(t: Team, input: { actorId: string; orgId: string; email: string; role: Role }): Promise<AddResult> {
	const { team, standing } = await mayBringIn(t, input.actorId, input.orgId, input.role)
	const email = input.email.trim().toLowerCase()
	const person = await t.auth.getUserByEmail(email)
	if (person) return bringIn(t, { actorId: input.actorId, team, standing, person, role: input.role })
	if (input.role === 'owner')
		refuse(`Someone new joins as a reviewer at most. Invite them, then make them ${roleWord('owner', team.central)} once they have joined.`)
	const invited = await t.doors.inviteTeamMember(input.actorId, input.orgId, email, input.role, OCP_NAMESPACE, STEWARD)
	if (!invited.ok) return refuse(refusalText(invited.reason, { team, standing, self: false, name: email, leaving: false }))
	const actor = await t.auth.getUserById(input.actorId)
	const by = actor ? displayNameOf(actor) : 'Someone'
	await notify(
		t,
		email,
		`Invitation to ${team.name}`,
		`${by} has invited you to work on ${team.name} as a ${roleWord(input.role, team.central)}.\n\nOpen the link, sign in with this email address, and you will join the team. The invitation expires on ${imprintDate(invited.expiresAt)}.\n\n${t.origin}/invite/${invited.invitationId}`,
	)
	return { kind: 'invited', email, role: input.role }
}

/** By member code: the one the person reads from their account menu. */
export async function addByCode(t: Team, input: { actorId: string; orgId: string; code: string; role: Role }): Promise<AddResult> {
	const { team, standing } = await mayBringIn(t, input.actorId, input.orgId, input.role)
	const person = await t.auth.getUserByMemberCode(normalizeMemberCode(input.code))
	if (!person) return refuse('No one has that member code. Check it and try again.')
	return bringIn(t, { actorId: input.actorId, team, standing, person, role: input.role })
}

/** Everyone on some OCP team or on the central team: the people search's pool. */
async function ocpPeople(t: Team): Promise<Map<string, ListedMember & { email: string }>> {
	const central = await t.centralOrgId()
	const orgs = await t.d
		.selectDistinct({ orgId: schema.documents.orgId })
		.from(schema.documents)
		.where(not(like(schema.documents.orgId, 'pending:%')))
	const orgIds = [...new Set([...orgs.map((o) => o.orgId), ...(central ? [central] : [])])]
	const lists = await Promise.all(orgIds.map((orgId) => t.auth.listOrgMembers(orgId, OCP_NAMESPACE)))
	const people = new Map<string, ListedMember & { email: string }>()
	for (const member of lists.flat()) people.set(member.userId, member)
	return people
}

/** A person the search found: name and avatar only. */
export interface PersonHit {
	id: string
	name: string
	image: string | null
}

/** Search the people already on some OCP team (never the whole directory), by name or
 *  address; the address is matched here and never returned. Those already on this team
 *  are left out. */
export async function searchPeople(t: Team, input: { actorId: string; orgId: string; query: string }): Promise<PersonHit[]> {
	const standing = await standingIn(t, input.actorId, input.orgId)
	if (!managesTeam(standing)) return refuse('Only someone who can bring people in may search.')
	const query = input.query.trim().toLowerCase()
	if (query.length < 2) return []
	const [people, members] = await Promise.all([ocpPeople(t), membersOf(t, input.orgId)])
	const onTeam = new Set(members.map((m) => m.userId))
	return [...people.values()]
		.filter((p) => !onTeam.has(p.userId) && (p.name.toLowerCase().includes(query) || p.email.toLowerCase().includes(query)))
		.map((p) => ({ id: p.userId, name: displayNameOf({ id: p.userId, name: p.name }), image: p.image ?? null }))
		.sort((a, b) => a.name.localeCompare(b.name))
		.slice(0, 10)
}

/** From the search: someone already on an OCP team. */
export async function addPerson(t: Team, input: { actorId: string; orgId: string; userId: string; role: Role }): Promise<AddResult> {
	const { team, standing } = await mayBringIn(t, input.actorId, input.orgId, input.role)
	const listed = (await ocpPeople(t)).get(input.userId)
	if (!listed) return refuse('That person is not on any pathway team yet. Add them by email or member code.')
	return bringIn(t, { actorId: input.actorId, team, standing, person: { id: listed.userId, name: listed.name, email: listed.email }, role: input.role })
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

export const INVITE_LINK_DAYS = 14
const INVITE_LINK_TTL_MS = INVITE_LINK_DAYS * 24 * 60 * 60 * 1000

export interface InviteLinkWire {
	token: string
	url: string
	role: Role
	createdAt: number
	expiresAt: number
}

type InviteLinkRow = typeof schema.inviteLinks.$inferSelect

const linkWire = (t: Team, row: InviteLinkRow): InviteLinkWire => ({
	token: row.token,
	url: `${t.origin}/join/${row.token}`,
	role: row.role,
	createdAt: row.createdAt.getTime(),
	expiresAt: row.expiresAt.getTime(),
})

/** 24 random bytes, URL-safe. */
function newToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24))
	return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A link at a role the maker may bring people in at, for 14 days. */
export async function createInviteLink(
	t: Team,
	input: { actorId: string; orgId: string; role: Role; now?: number },
): Promise<InviteLinkWire> {
	const { team } = await mayBringIn(t, input.actorId, input.orgId, input.role)
	const now = input.now ?? Date.now()
	const inserted = await t.d
		.insert(schema.inviteLinks)
		.values({
			token: newToken(),
			orgId: input.orgId,
			teamName: team.name,
			role: input.role,
			documentId: team.documentId,
			createdBy: input.actorId,
			createdAt: new Date(now),
			expiresAt: new Date(now + INVITE_LINK_TTL_MS),
		})
		.returning()
	const row = inserted[0]
	if (!row) return refuse('The link could not be made.')
	return linkWire(t, row)
}

/** The team's live links (not revoked, not expired), newest first. */
export async function listInviteLinks(t: Team, input: { actorId: string; orgId: string; now?: number }): Promise<InviteLinkWire[]> {
	const standing = await standingIn(t, input.actorId, input.orgId)
	if (!managesTeam(standing)) return refuse('Only someone who can bring people in may see the invite links.')
	const rows = await t.d
		.select()
		.from(schema.inviteLinks)
		.where(
			and(
				eq(schema.inviteLinks.orgId, input.orgId),
				isNull(schema.inviteLinks.revokedAt),
				gt(schema.inviteLinks.expiresAt, new Date(input.now ?? Date.now())),
			),
		)
	return rows.map((row) => linkWire(t, row)).sort((a, b) => b.createdAt - a.createdAt)
}

/** Revoke a link: whoever may bring people in at its role. */
export async function revokeInviteLink(t: Team, input: { actorId: string; orgId: string; token: string }): Promise<void> {
	const row = (
		await t.d
			.select()
			.from(schema.inviteLinks)
			.where(and(eq(schema.inviteLinks.token, input.token), eq(schema.inviteLinks.orgId, input.orgId)))
			.limit(1)
	)[0]
	if (!row) return refuse('That link was not found.')
	await mayBringIn(t, input.actorId, input.orgId, row.role)
	await t.d.update(schema.inviteLinks).set({ revokedAt: new Date() }).where(eq(schema.inviteLinks.token, row.token))
}

async function liveLink(t: Team, token: string, now: number): Promise<InviteLinkRow | null> {
	const row = (await t.d.select().from(schema.inviteLinks).where(eq(schema.inviteLinks.token, token)).limit(1))[0]
	return row && !row.revokedAt && row.expiresAt.getTime() > now ? row : null
}

/** What /join/{token} shows before anyone commits: open to anyone holding the link. */
export async function inviteLinkInfo(
	t: Team,
	input: { token: string; now?: number },
): Promise<{ valid: false } | { valid: true; teamName: string; role: Role; central: boolean }> {
	const row = await liveLink(t, input.token, input.now ?? Date.now())
	if (!row) return { valid: false }
	return { valid: true, teamName: row.teamName, role: row.role, central: row.documentId === null }
}

/**
 * Redeem a link for the signed-in user, with its maker's authority: the grant door
 * re-checks that the maker may still bring people in at the link's role, so a maker who
 * has since lost it makes the link fail. A member already on the team stays as they are.
 */
export async function redeemInviteLink(
	t: Team,
	input: { userId: string; token: string; now?: number },
): Promise<{ documentId: string | null; teamName: string; role: Role | null; already: boolean }> {
	const row = await liveLink(t, input.token, input.now ?? Date.now())
	if (!row) return refuse('This invite link is no longer valid. Ask for a fresh one.')
	const done = await t.doors.grantTeamMember(row.createdBy, row.orgId, input.userId, row.role, OCP_NAMESPACE, STEWARD)
	if (!done.ok) return refuse('This invite link no longer works. Ask the team for a fresh one.')
	if (done.added) {
		await announceMember(t, row.orgId, input.userId)
		await retier(t, row.orgId, input.userId)
	}
	return { documentId: row.documentId, teamName: row.teamName, role: roleFrom(done.role), already: !done.added }
}

// ---------------------------------------------------------------------------
// Email invitations
// ---------------------------------------------------------------------------

const INVITATION_REFUSALS = {
	'not-found': 'This invitation does not exist.',
	expired: 'This invitation has expired. Ask the team for a fresh one.',
	'wrong-email': 'This invitation was sent to a different email address. Sign in with that address to accept it.',
	'already-handled': 'This invitation has already been used.',
	invalid: 'This invitation could not be accepted.',
} as const

/** Accept an email invitation for the signed-in user (the auth worker checks the address,
 *  the expiry and the status), then tell the roster and re-tier. */
export async function acceptInvitation(
	t: Team,
	input: { userId: string; invitationId: string },
): Promise<{ documentId: string | null; teamName: string; role: Role | null }> {
	const accepted = await t.auth.acceptOrgInvitation(input.userId, input.invitationId, OCP_NAMESPACE)
	if (!accepted.ok) return refuse(INVITATION_REFUSALS[accepted.error])
	const team = await teamOf(t, accepted.organizationId)
	await announceMember(t, team.orgId, input.userId)
	await retier(t, team.orgId, input.userId)
	return { documentId: team.documentId, teamName: team.name, role: roleFrom(accepted.role) }
}

// ---------------------------------------------------------------------------
// The central team's first lead
// ---------------------------------------------------------------------------

/** Bootstrap: the deployment's first administrator becomes the central team's lead, while
 *  it has none. Returns whether they did. */
export async function claimCentralLead(t: Team, userId: string, centralId: string): Promise<boolean> {
	const claimed = await t.doors.claimTeamLead(userId, centralId, OCP_NAMESPACE)
	if (claimed) await announceMember(t, centralId, userId)
	return claimed
}
