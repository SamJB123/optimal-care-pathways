/**
 * The pathways' auth worker entry: the canonical `@aicolab/better-auth` D1 AuthService,
 * extended with the doors this application needs beyond authentication:
 *
 *   - notification email (decision 99). The auth worker already holds the Resend key and
 *     the sender address for its one-time codes, so it is the one worker that sends mail;
 *     the cms worker holds no mail credentials and calls this door over the service
 *     binding;
 *   - the TEAM DOORS (people management): the only way a team's membership changes. Each
 *     authorises the actor against their own memberships with the one team rule
 *     (apps/cms/src/lib/team-rule.ts, a leaf module both workers read), in which members
 *     of the steward organisation (the central organisation) manage every other team, a
 *     team may have several leads, and never loses its last one. The shared package's
 *     org doors cannot carry that rule (a steward is no member of a pathway's
 *     organisation; no door grants owner; an owner can never leave), and the rule is this
 *     application's, so it lives here and not in the package.
 *
 * The team doors write the auth database with plain statements: the package keeps its
 * drizzle handle private, and this app does not depend on drizzle. Each write that could
 * break the last-lead rule carries the rule in its own WHERE, so two concurrent changes
 * cannot both pass the check and leave a team leaderless.
 *
 * Portal uses the D1 path; the PG path lives at
 * `@aicolab/better-auth/cloudflare/pg/worker` for deployments that bind Hyperdrive.
 */

import { composeNsSlug, type OrgRole } from '@aicolab/better-auth/cloudflare/shared/org-access'
import type { OrgRef } from '@aicolab/better-auth/cloudflare/shared/types'
import { AuthService as BaseAuthService } from '@aicolab/better-auth/cloudflare/d1/worker'
import { Resend } from 'resend'
import {
	mayChange,
	mayGrant,
	roleFrom,
	standingOf,
	type TeamRefusal,
	type TeamStanding,
} from '../../cms/src/lib/team-rule.ts'

export interface NotificationMail {
	to: string[]
	subject: string
	text: string
}

export type NotificationResult =
	| { sent: number }
	| { sent: 0; skipped: 'no-recipients' | 'no-mail-key' }

/** A team door's answer: done, with its detail, or refused with a reason. */
export type TeamDoorResult<T> = ({ ok: true } & T) | { ok: false; reason: TeamRefusal }

/** How long an email invitation stays open. */
const INVITATION_DAYS = 7

export class AuthService extends BaseAuthService {
	/**
	 * Send one plain-text notification to each recipient. Without a Resend key (local
	 * dev) the mail is logged and reported skipped, never thrown: notifications are
	 * best-effort and the action that caused them has already committed.
	 */
	async sendNotification(mail: NotificationMail): Promise<NotificationResult> {
		const to = [...new Set(mail.to.map((a) => a.trim().toLowerCase()).filter(Boolean))]
		if (to.length === 0) return { sent: 0, skipped: 'no-recipients' }
		const key = this.env.RESEND_API_KEY
		if (!key) {
			console.log(`[DEV] notification to ${to.join(', ')}: ${mail.subject}\n${mail.text}`)
			return { sent: 0, skipped: 'no-mail-key' }
		}
		const resend = new Resend(key)
		const from = this.env.EMAIL_FROM_ADDRESS || 'noreply@aicolab.org'
		let sent = 0
		for (const recipient of to) {
			const result = await resend.emails.send({
				from,
				to: recipient,
				subject: mail.subject,
				text: mail.text,
			})
			if (result.error) console.error('[notification] send failed:', result.error)
			else sent++
		}
		return { sent }
	}

	// ---- team doors -------------------------------------------------------------------

	/** Change a member's role, or remove them (`role` null; the actor themself: leave). */
	async manageTeamMember(
		actorUserId: string,
		organizationId: string,
		targetUserId: string,
		role: OrgRole | null,
		namespace: string,
		steward: OrgRef,
	): Promise<TeamDoorResult<{ role: OrgRole | null }>> {
		try {
			if (role !== null && roleFrom(role) === null) return { ok: false, reason: 'invalid' }
			if (!(await this.#teamExists(organizationId, namespace)))
				return { ok: false, reason: 'not-found' }
			const from = await this.#roleIn(targetUserId, organizationId)
			if (!from) return { ok: false, reason: 'not-member' }
			const verdict = mayChange({
				standing: await this.#standing(actorUserId, organizationId, steward),
				self: actorUserId === targetUserId,
				from,
				to: role,
				leads: await this.#leads(organizationId),
			})
			if (!verdict.ok) return verdict
			if (from === role) return { ok: true, role }
			// The last-lead rule again, inside the write: a lead leaves (or steps down) only
			// while another lead remains.
			const anotherLead = `(role <> 'owner' OR (SELECT count(*) FROM member WHERE organization_id = ?1 AND role = 'owner') > 1)`
			const write =
				role === null
					? this.env.AUTH_DB.prepare(
							`DELETE FROM member WHERE organization_id = ?1 AND user_id = ?2 AND ${anotherLead}`,
						).bind(organizationId, targetUserId)
					: this.env.AUTH_DB.prepare(
							`UPDATE member SET role = ?3 WHERE organization_id = ?1 AND user_id = ?2 AND (?3 = 'owner' OR ${anotherLead})`,
						).bind(organizationId, targetUserId, role)
			const result = await write.run()
			if (result.meta.changes === 0) return { ok: false, reason: 'last-lead' }
			return { ok: true, role }
		} catch (error) {
			console.error('[AuthService] manageTeamMember error:', error)
			return { ok: false, reason: 'invalid' }
		}
	}

	/** Bring an existing account into a team at a role the actor may grant. A member already
	 *  is left as they are (`added: false`): a link or an add never changes a role. */
	async grantTeamMember(
		actorUserId: string,
		organizationId: string,
		targetUserId: string,
		role: OrgRole,
		namespace: string,
		steward: OrgRef,
	): Promise<TeamDoorResult<{ role: string; added: boolean }>> {
		try {
			if (roleFrom(role) === null) return { ok: false, reason: 'invalid' }
			if (!(await this.#teamExists(organizationId, namespace)))
				return { ok: false, reason: 'not-found' }
			const verdict = mayGrant(await this.#standing(actorUserId, organizationId, steward), role)
			if (!verdict.ok) return verdict
			const user = await this.env.AUTH_DB.prepare('SELECT id FROM user WHERE id = ?1')
				.bind(targetUserId)
				.first<{ id: string }>()
			if (!user) return { ok: false, reason: 'not-found' }
			const inserted = await this.env.AUTH_DB.prepare(
				'INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT DO NOTHING',
			)
				.bind(crypto.randomUUID(), organizationId, targetUserId, role, Date.now())
				.run()
			if (inserted.meta.changes > 0) return { ok: true, role, added: true }
			return {
				ok: true,
				role: (await this.#roleIn(targetUserId, organizationId)) ?? role,
				added: false,
			}
		} catch (error) {
			console.error('[AuthService] grantTeamMember error:', error)
			return { ok: false, reason: 'invalid' }
		}
	}

	/**
	 * A pending invitation for an address (the cms mails its link, to its own invitation
	 * page, and accepts through `acceptOrgInvitation`). An earlier pending invitation for
	 * the same address and team is cancelled. Never at owner: acceptance grants at most a
	 * reviewer, and a lead is appointed by name.
	 */
	async inviteTeamMember(
		actorUserId: string,
		organizationId: string,
		email: string,
		role: OrgRole,
		namespace: string,
		steward: OrgRef,
	): Promise<TeamDoorResult<{ invitationId: string; expiresAt: number }>> {
		try {
			const address = email.trim().toLowerCase()
			if (!address.includes('@') || roleFrom(role) === null || role === 'owner')
				return { ok: false, reason: 'invalid' }
			if (!(await this.#teamExists(organizationId, namespace)))
				return { ok: false, reason: 'not-found' }
			const verdict = mayGrant(await this.#standing(actorUserId, organizationId, steward), role)
			if (!verdict.ok) return verdict
			const invitationId = crypto.randomUUID()
			const now = Date.now()
			const expiresAt = now + INVITATION_DAYS * 24 * 60 * 60 * 1000
			await this.env.AUTH_DB.batch([
				this.env.AUTH_DB.prepare(
					"UPDATE invitation SET status = 'canceled' WHERE organization_id = ?1 AND lower(email) = ?2 AND status = 'pending'",
				).bind(organizationId, address),
				this.env.AUTH_DB.prepare(
					"INSERT INTO invitation (id, organization_id, email, role, status, team_id, expires_at, inviter_id, created_at) VALUES (?1, ?2, ?3, ?4, 'pending', NULL, ?5, ?6, ?7)",
				).bind(invitationId, organizationId, address, role, expiresAt, actorUserId, now),
			])
			return { ok: true, invitationId, expiresAt }
		} catch (error) {
			console.error('[AuthService] inviteTeamMember error:', error)
			return { ok: false, reason: 'invalid' }
		}
	}

	/** Make the user the lead of a team that has none (the deployment's bootstrap of the
	 *  central team); false once it has a lead. */
	async claimTeamLead(userId: string, organizationId: string, namespace: string): Promise<boolean> {
		try {
			if (!(await this.#teamExists(organizationId, namespace))) return false
			const claimed = await this.env.AUTH_DB.prepare(
				`INSERT INTO member (id, organization_id, user_id, role, created_at)
				 SELECT ?1, ?2, ?3, 'owner', ?4 WHERE EXISTS (SELECT 1 FROM user WHERE id = ?3)
				   AND NOT EXISTS (SELECT 1 FROM member WHERE organization_id = ?2 AND role = 'owner')
				 ON CONFLICT (organization_id, user_id) DO UPDATE SET role = 'owner'`,
			)
				.bind(crypto.randomUUID(), organizationId, userId, Date.now())
				.run()
			return claimed.meta.changes > 0
		} catch (error) {
			console.error('[AuthService] claimTeamLead error:', error)
			return false
		}
	}

	/** The organisation exists in the namespace. */
	async #teamExists(organizationId: string, namespace: string): Promise<boolean> {
		const row = await this.env.AUTH_DB.prepare(
			'SELECT 1 AS found FROM organization WHERE id = ?1 AND namespace = ?2',
		)
			.bind(organizationId, namespace)
			.first<{ found: number }>()
		return row !== null
	}

	/** A user's role in an organisation, as the ladder names it. */
	async #roleIn(userId: string, organizationId: string): Promise<OrgRole | null> {
		const row = await this.env.AUTH_DB.prepare(
			'SELECT role FROM member WHERE organization_id = ?1 AND user_id = ?2',
		)
			.bind(organizationId, userId)
			.first<{ role: string }>()
		return roleFrom(row?.role)
	}

	async #leads(organizationId: string): Promise<number> {
		const row = await this.env.AUTH_DB.prepare(
			"SELECT count(*) AS n FROM member WHERE organization_id = ?1 AND role = 'owner'",
		)
			.bind(organizationId)
			.first<{ n: number }>()
		return row?.n ?? 0
	}

	/** The actor's standing over a team: steward as a member of the steward organisation
	 *  (never over the steward organisation itself), else their own role. */
	async #standing(
		actorUserId: string,
		organizationId: string,
		steward: OrgRef,
	): Promise<TeamStanding> {
		const stewardOrg = await this.env.AUTH_DB.prepare(
			'SELECT id FROM organization WHERE slug = ?1 AND namespace = ?2',
		)
			.bind(composeNsSlug(steward.namespace, steward.slug), steward.namespace)
			.first<{ id: string }>()
		const stewardOfThis =
			stewardOrg !== null &&
			stewardOrg.id !== organizationId &&
			(await this.#roleIn(actorUserId, stewardOrg.id)) !== null
		return standingOf(await this.#roleIn(actorUserId, organizationId), stewardOfThis)
	}
}

export default AuthService
