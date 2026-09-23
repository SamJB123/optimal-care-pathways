/**
 * People management as server functions: each binds the worker's environment and the
 * verified caller and hands off to `team.ts`, which the workerd tests exercise directly.
 * A refusal reaches the page as its message.
 */

import { createServerFn } from '@tanstack/solid-start'
import { z } from 'zod'
import { requireUser } from './env.ts'
import * as team from './team.ts'
import { teamOfEnv } from './team-env.ts'

const id = z.string().min(1).max(64)
const role = z.enum(['viewer', 'member', 'admin', 'owner'])
/** An invite link joins at most as a reviewer; the lead is appointed by name. */
const linkRole = z.enum(['viewer', 'member', 'admin'])

/** The team of a document, the reader's standing and the roster. */
export const documentTeam = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ documentId: id }))
	.handler(async ({ data, context }) => {
		const t = await teamOfEnv()
		const summary = await team.teamOfDocument(t, data.documentId)
		const view = await team.teamView(t, requireUser(context.userId), summary.orgId)
		return { ...view, team: summary }
	})

/** An organisation's team. */
export const organisationTeam = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ orgId: id }))
	.handler(async ({ data, context }) => team.teamView(await teamOfEnv(), requireUser(context.userId), data.orgId))

/** The central team (for /admin); null before the central organisation is set up. */
export const centralTeam = createServerFn({ method: 'GET' }).handler(async ({ context }) => {
	const t = await teamOfEnv()
	const central = await t.centralOrgId()
	return central ? team.teamView(t, requireUser(context.userId), central) : null
})

export const changeTeamMember = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ orgId: id, userId: id, role: role.nullable() }))
	.handler(async ({ data, context }) =>
		team.changeMember(await teamOfEnv(), { actorId: requireUser(context.userId), ...data }),
	)

export const addTeamMemberByEmail = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ orgId: id, email: z.string().trim().email().max(200), role }))
	.handler(async ({ data, context }) => team.addByEmail(await teamOfEnv(), { actorId: requireUser(context.userId), ...data }))

export const addTeamMemberByCode = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ orgId: id, code: z.string().trim().min(4).max(16), role }))
	.handler(async ({ data, context }) => team.addByCode(await teamOfEnv(), { actorId: requireUser(context.userId), ...data }))

export const addTeamPerson = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ orgId: id, userId: id, role }))
	.handler(async ({ data, context }) => team.addPerson(await teamOfEnv(), { actorId: requireUser(context.userId), ...data }))

export const searchTeamPeople = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ orgId: id, query: z.string().max(100) }))
	.handler(async ({ data, context }) => team.searchPeople(await teamOfEnv(), { actorId: requireUser(context.userId), ...data }))

export const createTeamInviteLink = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ orgId: id, role: linkRole }))
	.handler(async ({ data, context }) =>
		team.createInviteLink(await teamOfEnv(), { actorId: requireUser(context.userId), ...data }),
	)

export const teamInviteLinks = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ orgId: id }))
	.handler(async ({ data, context }) =>
		team.listInviteLinks(await teamOfEnv(), { actorId: requireUser(context.userId), orgId: data.orgId }),
	)

export const revokeTeamInviteLink = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ orgId: id, token: z.string().min(1).max(64) }))
	.handler(async ({ data, context }) => {
		await team.revokeInviteLink(await teamOfEnv(), { actorId: requireUser(context.userId), ...data })
		return { revoked: true }
	})

/** What /join/{token} shows: open to anyone holding the link. */
export const inviteLinkInfo = createServerFn({ method: 'GET' })
	.inputValidator(z.object({ token: z.string().min(1).max(64) }))
	.handler(async ({ data }) => team.inviteLinkInfo(await teamOfEnv(), { token: data.token }))

export const redeemInviteLink = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ token: z.string().min(1).max(64) }))
	.handler(async ({ data, context }) =>
		team.redeemInviteLink(await teamOfEnv(), { userId: requireUser(context.userId), token: data.token }),
	)

export const acceptTeamInvitation = createServerFn({ method: 'POST' })
	.inputValidator(z.object({ invitationId: z.string().min(1).max(64) }))
	.handler(async ({ data, context }) =>
		team.acceptInvitation(await teamOfEnv(), { userId: requireUser(context.userId), invitationId: data.invitationId }),
	)
