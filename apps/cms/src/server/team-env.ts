/**
 * The team functions bound to this worker's bindings: what every server function in
 * team-fns.ts hands `team.ts`. Server-only, and kept out of the server-function module
 * (see lifecycle-env.ts for why).
 *
 * THE ONE PLACE THE TEAM DOORS ARE BOUND: `doors: env.AUTH` needs the auth worker's
 * manageTeamMember, grantTeamMember, inviteTeamMember and claimTeamLead
 * (apps/auth/src/worker.ts), and this file type-checks only once they exist there and
 * `pnpm cf-typegen` has regenerated the binding's type.
 */

import { getRequest } from '@tanstack/solid-start/server'
import { publishTeamChange } from '#/lib/team-topic.ts'
import { centralOrgId } from './access.ts'
import { envOf } from './env.ts'
import type { Team } from './team.ts'

/** The links a page shows (and mails) open the site the reader is on: the request's own
 *  origin, else the deployment's public one. */
export async function teamOfEnv(): Promise<Team> {
	const { env, d } = await envOf()
	const origin = URL.parse(getRequest().url)?.origin
	let central: Promise<string | null> | null = null
	return {
		d,
		auth: env.AUTH,
		doors: env.AUTH,
		rooms: env.DOCUMENT_ROOM,
		centralOrgId: () => {
			central ??= centralOrgId(env.AUTH, d)
			return central
		},
		origin: origin ?? env.PUBLIC_ORIGIN ?? 'https://ocp-cms.aicolab.workers.dev',
		announce: publishTeamChange,
	}
}
