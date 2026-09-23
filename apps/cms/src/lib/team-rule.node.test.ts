/**
 * The team rule, case by case: what a lead, a reviewer, a drafter, a viewer, a steward (a
 * member of the central organisation) and an outsider may do to whom; leaving; the last
 * lead; appointing and handing over the lead; and what the pickers offer.
 */

import { describe, expect, it } from 'vitest'
import {
	compareMembers,
	grantableRoles,
	managesTeam,
	mayChange,
	mayGrant,
	roleFrom,
	rolesFor,
	standingOf,
	TEAM_ROLES,
	type TeamStanding,
} from './team-rule.ts'

const change = (
	standing: TeamStanding,
	from: (typeof TEAM_ROLES)[number],
	to: (typeof TEAM_ROLES)[number] | null,
	opts: { self?: boolean; leads?: number } = {},
) => mayChange({ standing, self: opts.self ?? false, from, to, leads: opts.leads ?? 2 })

describe('standing', () => {
	it('is the own role, or steward for a central member over another team', () => {
		expect(standingOf('member', false)).toBe('member')
		expect(standingOf(null, false)).toBeNull()
		expect(standingOf(null, true)).toBe('steward')
		// A central member who is also a viewer of the pathway still manages it.
		expect(standingOf('viewer', true)).toBe('steward')
	})
	it('reads stored roles fail-closed', () => {
		expect(roleFrom('owner')).toBe('owner')
		expect(roleFrom('superuser')).toBeNull()
		expect(roleFrom(null)).toBeNull()
		expect(TEAM_ROLES).toEqual(['viewer', 'member', 'admin', 'owner'])
	})
})

describe('the lead', () => {
	it('changes anyone to anything, the lead included', () => {
		for (const from of TEAM_ROLES)
			for (const to of TEAM_ROLES)
				expect(change('owner', from, to, { leads: 2 }).ok, `${from} → ${to}`).toBe(true)
	})
	it('removes anyone while another lead remains', () => {
		for (const from of TEAM_ROLES) expect(change('owner', from, null, { leads: 2 }).ok).toBe(true)
	})
	it('appoints another lead, then hands over and leaves', () => {
		expect(change('owner', 'admin', 'owner', { leads: 1 }).ok).toBe(true)
		expect(change('owner', 'owner', 'member', { self: true, leads: 2 }).ok).toBe(true)
		expect(change('owner', 'owner', null, { self: true, leads: 2 }).ok).toBe(true)
	})
})

describe('the last lead', () => {
	it('cannot leave, be removed or be given another role, by anyone', () => {
		for (const standing of ['owner', 'steward'] as const) {
			expect(change(standing, 'owner', null, { leads: 1 })).toEqual({
				ok: false,
				reason: 'last-lead',
			})
			expect(change(standing, 'owner', 'admin', { leads: 1 })).toEqual({
				ok: false,
				reason: 'last-lead',
			})
		}
		// A reviewer may not touch a lead at all: that is the refusal they hear.
		expect(change('admin', 'owner', null, { leads: 1 })).toEqual({ ok: false, reason: 'forbidden' })
		expect(change('owner', 'owner', null, { self: true, leads: 1 })).toEqual({
			ok: false,
			reason: 'last-lead',
		})
		expect(change('owner', 'owner', 'viewer', { self: true, leads: 1 })).toEqual({
			ok: false,
			reason: 'last-lead',
		})
	})
	it('stays a lead: no change at all is fine', () => {
		expect(change('owner', 'owner', 'owner', { leads: 1 }).ok).toBe(true)
	})
})

describe('a reviewer', () => {
	it('changes drafters and viewers, between drafter and viewer only', () => {
		expect(change('admin', 'member', 'viewer').ok).toBe(true)
		expect(change('admin', 'viewer', 'member').ok).toBe(true)
		expect(change('admin', 'member', 'admin')).toEqual({ ok: false, reason: 'forbidden' })
		expect(change('admin', 'viewer', 'owner')).toEqual({ ok: false, reason: 'forbidden' })
	})
	it('removes drafters and viewers, not reviewers or leads', () => {
		expect(change('admin', 'member', null).ok).toBe(true)
		expect(change('admin', 'viewer', null).ok).toBe(true)
		expect(change('admin', 'admin', null)).toEqual({ ok: false, reason: 'forbidden' })
		expect(change('admin', 'owner', null, { leads: 2 })).toEqual({ ok: false, reason: 'forbidden' })
	})
	it('cannot demote themself, but may leave', () => {
		expect(change('admin', 'admin', 'member', { self: true })).toEqual({
			ok: false,
			reason: 'forbidden',
		})
		expect(change('admin', 'admin', null, { self: true }).ok).toBe(true)
	})
	it('brings people in as drafters and viewers', () => {
		expect(grantableRoles('admin')).toEqual(['viewer', 'member'])
		expect(mayGrant('admin', 'admin')).toEqual({ ok: false, reason: 'forbidden' })
	})
})

describe('the central team (a steward)', () => {
	it('manages every role of a pathway team, appointing the lead included', () => {
		expect(change('steward', 'member', 'owner', { leads: 1 }).ok).toBe(true)
		expect(change('steward', 'admin', null).ok).toBe(true)
		expect(change('steward', 'owner', 'admin', { leads: 2 }).ok).toBe(true)
		expect(grantableRoles('steward')).toEqual(['viewer', 'member', 'admin', 'owner'])
	})
})

describe('drafters, viewers and outsiders', () => {
	it('change no one, but may leave', () => {
		for (const standing of ['member', 'viewer', null] as const) {
			expect(change(standing, 'viewer', 'member')).toEqual({ ok: false, reason: 'forbidden' })
			expect(change(standing, 'member', null)).toEqual({ ok: false, reason: 'forbidden' })
			expect(managesTeam(standing)).toBe(false)
		}
		expect(change('member', 'member', null, { self: true }).ok).toBe(true)
		expect(change('viewer', 'viewer', null, { self: true }).ok).toBe(true)
		expect(change('member', 'member', 'admin', { self: true })).toEqual({
			ok: false,
			reason: 'forbidden',
		})
	})
})

describe('the pickers', () => {
	it('offer a role list only where the reader may change the member', () => {
		expect(rolesFor({ standing: 'admin', self: false, from: 'member', leads: 1 })).toEqual([
			'viewer',
			'member',
		])
		expect(rolesFor({ standing: 'admin', self: false, from: 'admin', leads: 1 })).toEqual([])
		expect(rolesFor({ standing: 'owner', self: true, from: 'owner', leads: 1 })).toEqual([])
		expect(rolesFor({ standing: 'owner', self: true, from: 'owner', leads: 2 })).toEqual([
			'viewer',
			'member',
			'admin',
			'owner',
		])
		expect(rolesFor({ standing: 'viewer', self: true, from: 'viewer', leads: 1 })).toEqual([])
	})
	it('sort the roster leads first, then by name', () => {
		const sorted = [
			{ role: 'viewer' as const, name: 'Ava' },
			{ role: 'owner' as const, name: 'Zed' },
			{ role: 'member' as const, name: 'Bo' },
			{ role: 'admin' as const, name: 'Cy' },
			{ role: 'member' as const, name: 'Al' },
		].sort(compareMembers)
		expect(sorted.map((m) => m.name)).toEqual(['Zed', 'Cy', 'Al', 'Bo', 'Ava'])
	})
})
