/**
 * People management over the real runtime (test D1 with the migrations applied, the
 * DocumentRoom DO for re-tiers, the auth fixture's mail log), with the auth worker's
 * membership and TEAM DOORS played by an in-memory auth that applies the same team rule
 * the real doors do (lib/team-rule.ts):
 *   - the roster: sorted, no email address, members and the central team only;
 *   - who may change whom: lead, reviewer, drafter, the central team, the last lead;
 *   - every direct add (by email, by member code, from the search) emails the person; an
 *     unknown address is invited, and the invitation is accepted on the invitation page;
 *   - the search finds only people on some OCP team, and returns no address;
 *   - invite links: create, list, revoke, expire, redeem, and a maker who lost the right;
 *   - a change re-tiers the person's editors from the access rule, and is announced;
 *   - the bootstrap makes its caller the central team's lead, once.
 *
 * What this cannot reach: the real doors' SQL in apps/auth (proved in the browser).
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env } from 'cloudflare:test'
import type { DocTier } from '@aicolab/app-kit/doc-room'
import { memberCodeOf } from '@aicolab/better-auth/cloudflare/shared/user-tag'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { db, schema } from '#/db/index.ts'
import { OCP_NAMESPACE, type Role } from '#/lib/roles.ts'
import { mayChange, mayGrant, roleFrom, standingOf, type TeamStanding } from '#/lib/team-rule.ts'
import type { TeamMemberWireRow } from '#/lib/team-topic.ts'
import { sentMail } from '../../test/worker-runtime-entry.ts'
import * as team from './team.ts'

const run = crypto.randomUUID().slice(0, 8)
const CENTRAL = `central-${run}`
const PATHWAY = `org-${run}`
const OTHER = `other-${run}`
const PATHWAY_DOC = `bc-${run}`
const OTHER_DOC = `lung-${run}`
const CORE_DOC = `core-${run}`

interface Person {
	id: string
	name: string
	email: string
}
const person = (key: string, name: string): Person => ({
	id: `${key}-${run}`,
	name,
	email: `${key}-${run}@example.org`,
})
const lead = person('lead', 'Lena Lead')
const reviewer = person('reviewer', 'Rae Reviewer')
const drafter = person('drafter', 'Dev Drafter')
const viewer = person('viewer', 'Vi Viewer')
const steward = person('steward', 'Sam Steward')
const elsewhere = person('elsewhere', 'Eli Elsewhere')
const stranger = person('stranger', 'Stan Stranger')
const newcomer = person('newcomer', 'Nia Newcomer')

/**
 * The auth worker in memory: users, memberships, invitations; the base reads the team
 * functions use, and the four team doors applying the team rule as the real ones do.
 */
class MemoryAuth implements team.TeamAuth, team.TeamDoors {
	users = new Map<string, Person>()
	members = new Map<string, Map<string, { role: Role; createdAt: Date }>>()
	invitations = new Map<
		string,
		{ orgId: string; email: string; role: Role; status: string; expiresAt: number }
	>()

	seat(orgId: string, who: Person, role: Role) {
		this.users.set(who.id, who)
		const org = this.members.get(orgId) ?? new Map()
		org.set(who.id, { role, createdAt: new Date() })
		this.members.set(orgId, org)
	}
	#role(userId: string, orgId: string): Role | null {
		return this.members.get(orgId)?.get(userId)?.role ?? null
	}
	#standing(actor: string, orgId: string): TeamStanding {
		return standingOf(
			this.#role(actor, orgId),
			orgId !== CENTRAL && this.#role(actor, CENTRAL) !== null,
		)
	}

	// ---- base reads ----
	async getOrgMembershipById(userId: string, orgId: string) {
		const role = this.#role(userId, orgId)
		return role ? { role } : null
	}
	async listOrgMembers(orgId: string) {
		return [...(this.members.get(orgId) ?? new Map()).entries()].flatMap(([userId, m]) => {
			const user = this.users.get(userId)
			return user
				? [{ userId, role: m.role, name: user.name, email: user.email, createdAt: m.createdAt }]
				: []
		})
	}
	async listUserOrgs(userId: string) {
		return [...this.members.entries()]
			.filter(([, m]) => m.has(userId))
			.map(([organizationId]) => ({ organizationId }))
	}
	async getUserById(userId: string) {
		return this.users.get(userId) ?? null
	}
	async getUserByEmail(email: string) {
		return [...this.users.values()].find((u) => u.email === email.toLowerCase()) ?? null
	}
	async getUserByMemberCode(code: string) {
		return [...this.users.values()].find((u) => memberCodeOf(u.id) === code) ?? null
	}
	async acceptOrgInvitation(userId: string, invitationId: string) {
		const invitation = this.invitations.get(invitationId)
		const user = this.users.get(userId)
		if (!invitation) return { ok: false as const, error: 'not-found' as const }
		if (invitation.status !== 'pending')
			return { ok: false as const, error: 'already-handled' as const }
		if (!user || user.email !== invitation.email)
			return { ok: false as const, error: 'wrong-email' as const }
		invitation.status = 'accepted'
		if (!this.#role(userId, invitation.orgId)) this.seat(invitation.orgId, user, invitation.role)
		return {
			ok: true as const,
			organizationId: invitation.orgId,
			role: this.#role(userId, invitation.orgId) ?? invitation.role,
		}
	}
	/** Mail goes to the runtime fixture, which records it as `sentMail`. */
	async sendNotification(mail: { to: string[]; subject: string; text: string }) {
		return env.AUTH.sendNotification(mail)
	}

	// ---- the doors ----
	async manageTeamMember(actor: string, orgId: string, target: string, role: Role | null) {
		const from = this.#role(target, orgId)
		if (!from) return { ok: false as const, reason: 'not-member' as const }
		const leads = [...(this.members.get(orgId)?.values() ?? [])].filter(
			(m) => m.role === 'owner',
		).length
		const verdict = mayChange({
			standing: this.#standing(actor, orgId),
			self: actor === target,
			from,
			to: role,
			leads,
		})
		if (!verdict.ok) return verdict
		const org = this.members.get(orgId)
		if (role === null) org?.delete(target)
		else org?.set(target, { role, createdAt: org.get(target)?.createdAt ?? new Date() })
		return { ok: true as const, role }
	}
	async grantTeamMember(actor: string, orgId: string, target: string, role: Role) {
		const verdict = mayGrant(this.#standing(actor, orgId), role)
		if (!verdict.ok) return verdict
		const user = this.users.get(target)
		if (!user) return { ok: false as const, reason: 'not-found' as const }
		const existing = this.#role(target, orgId)
		if (existing) return { ok: true as const, role: existing, added: false }
		this.seat(orgId, user, role)
		return { ok: true as const, role, added: true }
	}
	async inviteTeamMember(actor: string, orgId: string, email: string, role: Role) {
		const verdict = mayGrant(this.#standing(actor, orgId), role)
		if (!verdict.ok) return verdict
		const invitationId = crypto.randomUUID()
		const expiresAt = Date.now() + 7 * 86_400_000
		this.invitations.set(invitationId, { orgId, email, role, status: 'pending', expiresAt })
		return { ok: true as const, invitationId, expiresAt }
	}
	async claimTeamLead(userId: string, orgId: string) {
		if (this.listOrgMembersSync(orgId).some((m) => m.role === 'owner')) return false
		const user = this.users.get(userId)
		if (!user) return false
		this.seat(orgId, user, 'owner')
		return true
	}
	listOrgMembersSync(orgId: string) {
		return [...(this.members.get(orgId)?.values() ?? [])]
	}
}

let auth: MemoryAuth
let announced: { orgId: string; change: { row: TeamMemberWireRow } | { removed: string } }[]
let retiered: { room: string; userId: string; tier: DocTier }[]

const teamEnv = (): team.Team => ({
	d: db(env.DB),
	auth,
	doors: auth,
	rooms: {
		idFromName: (name) => env.DOCUMENT_ROOM.idFromName(name),
		get: (id) => ({
			retierUser: async (userId, tier) => {
				retiered.push({ room: id.name ?? '', userId, tier })
				return env.DOCUMENT_ROOM.get(id).retierUser(userId, tier)
			},
		}),
	},
	centralOrgId: async () => CENTRAL,
	origin: 'http://test.local',
	announce: async (orgId, change) => {
		announced.push({ orgId, change })
	},
})

const mailTo = (who: { email: string }) => sentMail.filter((m) => m.to.includes(who.email))

beforeAll(async () => {
	const d = db(env.DB)
	await d
		.insert(schema.templates)
		.values({ id: 'cancer-test', kind: 'cancer', label: 'test', sourceFile: 'test.pdf' })
		.onConflictDoNothing()
	const doc = (id: string, orgId: string, kind: 'core' | 'pathway', subject: string) => ({
		id,
		kind,
		templateId: 'cancer-test',
		orgId,
		slug: id,
		title: `Optimal care pathway for ${subject}`,
		subject,
		audience: 'cancer' as const,
	})
	await d
		.insert(schema.documents)
		.values([
			doc(CORE_DOC, CENTRAL, 'core', 'cancer'),
			doc(PATHWAY_DOC, PATHWAY, 'pathway', 'breast cancer'),
			doc(OTHER_DOC, OTHER, 'pathway', 'lung cancer'),
		])
})

beforeEach(() => {
	auth = new MemoryAuth()
	auth.seat(PATHWAY, lead, 'owner')
	auth.seat(PATHWAY, reviewer, 'admin')
	auth.seat(PATHWAY, drafter, 'member')
	auth.seat(PATHWAY, viewer, 'viewer')
	auth.seat(CENTRAL, steward, 'member')
	auth.seat(OTHER, elsewhere, 'member')
	auth.users.set(stranger.id, stranger)
	auth.users.set(newcomer.id, newcomer)
	announced = []
	retiered = []
})

describe('the roster', () => {
	it('lists the team leads first, with no address, for members and the central team', async () => {
		const t = teamEnv()
		const view = await team.teamView(t, drafter.id, PATHWAY)
		expect(view.team).toEqual({
			orgId: PATHWAY,
			name: 'Breast cancer',
			central: false,
			documentId: PATHWAY_DOC,
		})
		expect(view.standing).toBe('member')
		expect(view.members.map((m) => m.name)).toEqual([
			'Lena Lead',
			'Rae Reviewer',
			'Dev Drafter',
			'Vi Viewer',
		])
		expect(JSON.stringify(view)).not.toContain('@example.org')
		expect((await team.teamView(t, steward.id, PATHWAY)).standing).toBe('steward')
		await expect(team.teamView(t, stranger.id, PATHWAY)).rejects.toThrow(
			'You are not on this team.',
		)
		await expect(team.teamView(t, elsewhere.id, PATHWAY)).rejects.toThrow(
			'You are not on this team.',
		)
	})

	it('names the central team, which a steward does not manage by being one', async () => {
		const t = teamEnv()
		const view = await team.teamView(t, steward.id, CENTRAL)
		expect(view.team).toEqual({
			orgId: CENTRAL,
			name: 'Cancer Australia',
			central: true,
			documentId: null,
		})
		expect(view.standing).toBe('member')
	})
})

describe('who may change whom', () => {
	it('a reviewer changes drafters and viewers only', async () => {
		const t = teamEnv()
		expect(
			await team.changeMember(t, {
				actorId: reviewer.id,
				orgId: PATHWAY,
				userId: drafter.id,
				role: 'viewer',
			}),
		).toEqual({
			name: 'Dev Drafter',
			role: 'viewer',
		})
		await expect(
			team.changeMember(t, {
				actorId: reviewer.id,
				orgId: PATHWAY,
				userId: drafter.id,
				role: 'admin',
			}),
		).rejects.toThrow('Reviewers can bring in and change drafters and viewers only.')
		await expect(
			team.changeMember(t, {
				actorId: reviewer.id,
				orgId: PATHWAY,
				userId: lead.id,
				role: 'member',
			}),
		).rejects.toThrow('Reviewers can bring in and change drafters and viewers only.')
	})

	it('a drafter changes no one', async () => {
		await expect(
			team.changeMember(teamEnv(), {
				actorId: drafter.id,
				orgId: PATHWAY,
				userId: viewer.id,
				role: 'member',
			}),
		).rejects.toThrow(
			'Only the pathway lead, a reviewer or the Cancer Australia team can change this team.',
		)
	})

	it('the lead appoints another lead, then hands over and leaves; the last lead cannot', async () => {
		const t = teamEnv()
		await expect(
			team.changeMember(t, { actorId: lead.id, orgId: PATHWAY, userId: lead.id, role: null }),
		).rejects.toThrow(
			'You are the only pathway lead. Appoint another pathway lead before you leave.',
		)
		await expect(
			team.changeMember(t, { actorId: lead.id, orgId: PATHWAY, userId: lead.id, role: 'admin' }),
		).rejects.toThrow(
			'You are the only pathway lead. Appoint another pathway lead before you change your role.',
		)
		await team.changeMember(t, {
			actorId: lead.id,
			orgId: PATHWAY,
			userId: reviewer.id,
			role: 'owner',
		})
		expect(
			await team.changeMember(t, { actorId: lead.id, orgId: PATHWAY, userId: lead.id, role: null }),
		).toEqual({ name: 'Lena Lead', role: null })
		await expect(
			team.changeMember(t, {
				actorId: steward.id,
				orgId: PATHWAY,
				userId: reviewer.id,
				role: null,
			}),
		).rejects.toThrow('Rae Reviewer is the only pathway lead. Appoint another pathway lead first.')
	})

	it('the central team manages any pathway team, appointing the lead included', async () => {
		const t = teamEnv()
		await team.changeMember(t, {
			actorId: steward.id,
			orgId: PATHWAY,
			userId: drafter.id,
			role: 'owner',
		})
		await team.changeMember(t, {
			actorId: steward.id,
			orgId: PATHWAY,
			userId: lead.id,
			role: 'viewer',
		})
		await team.changeMember(t, {
			actorId: steward.id,
			orgId: PATHWAY,
			userId: reviewer.id,
			role: null,
		})
		expect(
			(await team.teamView(t, drafter.id, PATHWAY)).members.map((m) => [m.name, m.role]),
		).toEqual([
			['Dev Drafter', 'owner'],
			['Lena Lead', 'viewer'],
			['Vi Viewer', 'viewer'],
		])
	})

	it('anyone may leave', async () => {
		const t = teamEnv()
		await team.changeMember(t, {
			actorId: viewer.id,
			orgId: PATHWAY,
			userId: viewer.id,
			role: null,
		})
		await team.changeMember(t, {
			actorId: reviewer.id,
			orgId: PATHWAY,
			userId: reviewer.id,
			role: null,
		})
		expect((await team.teamView(t, lead.id, PATHWAY)).members.map((m) => m.name)).toEqual([
			'Lena Lead',
			'Dev Drafter',
		])
	})
})

describe('after a change', () => {
	it('announces the row, or the removal, on the team topic', async () => {
		const t = teamEnv()
		await team.changeMember(t, {
			actorId: lead.id,
			orgId: PATHWAY,
			userId: drafter.id,
			role: 'admin',
		})
		await team.changeMember(t, { actorId: lead.id, orgId: PATHWAY, userId: viewer.id, role: null })
		expect(announced).toEqual([
			{
				orgId: PATHWAY,
				change: {
					row: expect.objectContaining({ userId: drafter.id, role: 'admin', name: 'Dev Drafter' }),
				},
			},
			{ orgId: PATHWAY, change: { removed: viewer.id } },
		])
	})

	it('re-tiers the person in the team’s documents from the access rule', async () => {
		const t = teamEnv()
		await team.changeMember(t, {
			actorId: lead.id,
			orgId: PATHWAY,
			userId: drafter.id,
			role: 'viewer',
		})
		expect(retiered).toEqual([
			{ room: `document:${PATHWAY_DOC}`, userId: drafter.id, tier: 'viewer' },
		])
		retiered = []
		// Removed from the pathway, a central member still reviews it: an editor still.
		auth.seat(PATHWAY, steward, 'viewer')
		await team.changeMember(t, { actorId: lead.id, orgId: PATHWAY, userId: steward.id, role: null })
		expect(retiered).toEqual([
			{ room: `document:${PATHWAY_DOC}`, userId: steward.id, tier: 'editor' },
		])
	})

	it('a change to the central team re-tiers every document', async () => {
		const t = teamEnv()
		auth.seat(CENTRAL, lead, 'owner')
		await team.changeMember(t, { actorId: lead.id, orgId: CENTRAL, userId: steward.id, role: null })
		const rooms = retiered.filter((r) => r.userId === steward.id).map((r) => r.room)
		expect(rooms).toEqual(
			expect.arrayContaining([
				`document:${CORE_DOC}`,
				`document:${PATHWAY_DOC}`,
				`document:${OTHER_DOC}`,
			]),
		)
		// No role anywhere now: every room drops them to reading.
		expect(retiered.filter((r) => r.room === `document:${OTHER_DOC}`)).toEqual([
			{ room: `document:${OTHER_DOC}`, userId: steward.id, tier: 'viewer' },
		])
	})
})

describe('the ways in', () => {
	it('by email: an account is added and emailed', async () => {
		const before = mailTo(elsewhere).length
		const result = await team.addByEmail(teamEnv(), {
			actorId: lead.id,
			orgId: PATHWAY,
			email: elsewhere.email.toUpperCase(),
			role: 'member',
		})
		expect(result).toEqual({ kind: 'added', name: 'Eli Elsewhere', role: 'member', emailed: true })
		const mail = mailTo(elsewhere).slice(before)
		expect(mail).toHaveLength(1)
		expect(mail[0]?.subject).toBe('You have been added to Breast cancer')
		expect(mail[0]?.text).toBe(
			`Lena Lead added you to Breast cancer as a drafter.\n\nhttp://test.local/d/${PATHWAY_DOC}`,
		)
	})

	it('by email: an unknown address is invited, and accepts on the invitation page', async () => {
		const t = teamEnv()
		const address = `new-${run}@example.org`
		const result = await team.addByEmail(t, {
			actorId: reviewer.id,
			orgId: PATHWAY,
			email: address,
			role: 'viewer',
		})
		expect(result).toEqual({ kind: 'invited', email: address, role: 'viewer' })
		const [invitationId] = [...auth.invitations.keys()]
		const mail = sentMail.filter((m) => m.to.includes(address)).at(-1)
		expect(mail?.subject).toBe('Invitation to Breast cancer')
		expect(mail?.text).toContain(`http://test.local/invite/${invitationId}`)
		expect(mail?.text).toContain(
			'Rae Reviewer has invited you to work on Breast cancer as a viewer.',
		)
		// Someone with another address cannot take it; the invited address can.
		await expect(
			team.acceptInvitation(t, { userId: stranger.id, invitationId: invitationId ?? '' }),
		).rejects.toThrow('different email address')
		const invited = { id: `invited-${run}`, name: 'Ivy Invited', email: address }
		auth.users.set(invited.id, invited)
		expect(
			await team.acceptInvitation(t, { userId: invited.id, invitationId: invitationId ?? '' }),
		).toEqual({
			documentId: PATHWAY_DOC,
			teamName: 'Breast cancer',
			role: 'viewer',
		})
		expect(announced.at(-1)).toEqual({
			orgId: PATHWAY,
			change: { row: expect.objectContaining({ userId: invited.id, role: 'viewer' }) },
		})
		await expect(
			team.acceptInvitation(t, { userId: invited.id, invitationId: invitationId ?? '' }),
		).rejects.toThrow('already been used')
	})

	it('by email: a lead cannot be invited, only appointed', async () => {
		await expect(
			team.addByEmail(teamEnv(), {
				actorId: lead.id,
				orgId: PATHWAY,
				email: `x-${run}@example.org`,
				role: 'owner',
			}),
		).rejects.toThrow('Someone new joins as a reviewer at most.')
	})

	it('by member code: added and emailed; a wrong code is refused', async () => {
		const before = mailTo(stranger).length
		const result = await team.addByCode(teamEnv(), {
			actorId: reviewer.id,
			orgId: PATHWAY,
			code: `#${memberCodeOf(stranger.id).toUpperCase()}`,
			role: 'member',
		})
		expect(result).toEqual({ kind: 'added', name: 'Stan Stranger', role: 'member', emailed: true })
		expect(
			mailTo(stranger)
				.slice(before)
				.map((m) => m.subject),
		).toEqual(['You have been added to Breast cancer'])
		await expect(
			team.addByCode(teamEnv(), {
				actorId: reviewer.id,
				orgId: PATHWAY,
				code: 'zzzzzzzz',
				role: 'member',
			}),
		).rejects.toThrow('No one has that member code.')
	})

	it('from the search: people on other OCP teams only, no address; added and emailed', async () => {
		const t = teamEnv()
		expect(await team.searchPeople(t, { actorId: lead.id, orgId: PATHWAY, query: 'eli' })).toEqual([
			{ id: elsewhere.id, name: 'Eli Elsewhere', image: null },
		])
		// By address too, never returned; not the stranger (on no team); not a member.
		expect(
			await team.searchPeople(t, { actorId: lead.id, orgId: PATHWAY, query: `elsewhere-${run}@` }),
		).toHaveLength(1)
		expect(await team.searchPeople(t, { actorId: lead.id, orgId: PATHWAY, query: 'stan' })).toEqual(
			[],
		)
		expect(await team.searchPeople(t, { actorId: lead.id, orgId: PATHWAY, query: 'dev' })).toEqual(
			[],
		)
		await expect(
			team.searchPeople(t, { actorId: drafter.id, orgId: PATHWAY, query: 'eli' }),
		).rejects.toThrow('Only someone who can bring people in')
		const before = mailTo(elsewhere).length
		expect(
			await team.addPerson(t, {
				actorId: steward.id,
				orgId: PATHWAY,
				userId: elsewhere.id,
				role: 'admin',
			}),
		).toEqual({
			kind: 'added',
			name: 'Eli Elsewhere',
			role: 'admin',
			emailed: true,
		})
		expect(mailTo(elsewhere).slice(before)[0]?.text).toContain('as a reviewer.')
		await expect(
			team.addPerson(t, { actorId: lead.id, orgId: PATHWAY, userId: stranger.id, role: 'member' }),
		).rejects.toThrow('That person is not on any pathway team yet.')
	})

	it('someone already on the team stays as they are, and is not emailed', async () => {
		const before = mailTo(drafter).length
		expect(
			await team.addByEmail(teamEnv(), {
				actorId: lead.id,
				orgId: PATHWAY,
				email: drafter.email,
				role: 'viewer',
			}),
		).toEqual({
			kind: 'already',
			name: 'Dev Drafter',
			role: 'member',
		})
		expect(mailTo(drafter).length).toBe(before)
	})

	it('a reviewer brings people in as drafters and viewers only', async () => {
		await expect(
			team.addByCode(teamEnv(), {
				actorId: reviewer.id,
				orgId: PATHWAY,
				code: memberCodeOf(stranger.id),
				role: 'admin',
			}),
		).rejects.toThrow('Reviewers can bring in and change drafters and viewers only.')
	})
})

describe('invite links', () => {
	it('are made, listed, redeemed and revoked by those who may bring people in', async () => {
		const t = teamEnv()
		const link = await team.createInviteLink(t, {
			actorId: reviewer.id,
			orgId: PATHWAY,
			role: 'member',
		})
		expect(link.url).toBe(`http://test.local/join/${link.token}`)
		expect(link.expiresAt - link.createdAt).toBe(14 * 86_400_000)
		await expect(
			team.createInviteLink(t, { actorId: reviewer.id, orgId: PATHWAY, role: 'admin' }),
		).rejects.toThrow('Reviewers can')
		await expect(
			team.createInviteLink(t, { actorId: drafter.id, orgId: PATHWAY, role: 'viewer' }),
		).rejects.toThrow()
		expect(
			(await team.listInviteLinks(t, { actorId: lead.id, orgId: PATHWAY })).map((l) => l.token),
		).toContain(link.token)
		await expect(team.listInviteLinks(t, { actorId: viewer.id, orgId: PATHWAY })).rejects.toThrow()

		expect(await team.inviteLinkInfo(t, { token: link.token })).toEqual({
			valid: true,
			teamName: 'Breast cancer',
			role: 'member',
			central: false,
		})
		expect(await team.redeemInviteLink(t, { userId: stranger.id, token: link.token })).toEqual({
			documentId: PATHWAY_DOC,
			teamName: 'Breast cancer',
			role: 'member',
			already: false,
		})
		expect(announced.at(-1)).toEqual({
			orgId: PATHWAY,
			change: { row: expect.objectContaining({ userId: stranger.id, role: 'member' }) },
		})
		// Redeemed again, or by a member: nothing changes.
		expect((await team.redeemInviteLink(t, { userId: lead.id, token: link.token })).already).toBe(
			true,
		)

		await team.revokeInviteLink(t, { actorId: reviewer.id, orgId: PATHWAY, token: link.token })
		expect(await team.inviteLinkInfo(t, { token: link.token })).toEqual({ valid: false })
		await expect(
			team.redeemInviteLink(t, { userId: newcomer.id, token: link.token }),
		).rejects.toThrow('no longer valid')
		expect(
			(await team.listInviteLinks(t, { actorId: lead.id, orgId: PATHWAY })).map((l) => l.token),
		).not.toContain(link.token)
	})

	it('expire after 14 days', async () => {
		const t = teamEnv()
		const made = Date.now() - 15 * 86_400_000
		const link = await team.createInviteLink(t, {
			actorId: lead.id,
			orgId: PATHWAY,
			role: 'viewer',
			now: made,
		})
		expect(await team.inviteLinkInfo(t, { token: link.token })).toEqual({ valid: false })
		expect(
			(await team.listInviteLinks(t, { actorId: lead.id, orgId: PATHWAY })).map((l) => l.token),
		).not.toContain(link.token)
		await expect(
			team.redeemInviteLink(t, { userId: newcomer.id, token: link.token }),
		).rejects.toThrow('no longer valid')
		expect(
			await team.inviteLinkInfo(t, { token: link.token, now: made + 13 * 86_400_000 }),
		).toMatchObject({ valid: true })
	})

	it('stop working when their maker loses the right to bring people in at their role', async () => {
		const t = teamEnv()
		const link = await team.createInviteLink(t, {
			actorId: reviewer.id,
			orgId: PATHWAY,
			role: 'member',
		})
		await team.changeMember(t, {
			actorId: lead.id,
			orgId: PATHWAY,
			userId: reviewer.id,
			role: 'viewer',
		})
		await expect(
			team.redeemInviteLink(t, { userId: newcomer.id, token: link.token }),
		).rejects.toThrow('no longer works')
	})

	it('only someone who may grant its role revokes a link', async () => {
		const t = teamEnv()
		const link = await team.createInviteLink(t, { actorId: lead.id, orgId: PATHWAY, role: 'admin' })
		await expect(
			team.revokeInviteLink(t, { actorId: reviewer.id, orgId: PATHWAY, token: link.token }),
		).rejects.toThrow('Reviewers can')
		await team.revokeInviteLink(t, { actorId: steward.id, orgId: PATHWAY, token: link.token })
		expect(await team.inviteLinkInfo(t, { token: link.token })).toEqual({ valid: false })
	})
})

describe('the central team’s first lead', () => {
	it('is the bootstrap’s caller, once', async () => {
		const t = teamEnv()
		expect(await team.claimCentralLead(t, steward.id, CENTRAL)).toBe(true)
		expect((await team.teamView(t, steward.id, CENTRAL)).members).toEqual([
			expect.objectContaining({ userId: steward.id, role: 'owner' }),
		])
		expect(await team.claimCentralLead(t, elsewhere.id, CENTRAL)).toBe(false)
		expect(roleFrom((await auth.getOrgMembershipById(elsewhere.id, CENTRAL))?.role)).toBeNull()
	})
})

describe('the namespace', () => {
	it('is the one the team functions ask the auth worker for', () => {
		expect(team.STEWARD).toEqual({ slug: 'cancer-australia', namespace: OCP_NAMESPACE })
	})
})
