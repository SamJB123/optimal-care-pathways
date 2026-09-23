/**
 * A team's live roster end to end over the real browser door: the PRODUCTION team client
 * (lib/team-client.ts) on a real `/api/ws` socket, the root's connectTeamTopic, the bell,
 * and the publish the team functions make after a change (`publishTeamChange`). A member
 * of the organisation subscribes and hears a join and a removal; the door refuses anyone
 * outside the organisation (the fixture's user ids are `<role>@<orgId>`).
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CoreRpcRoot } from './rpc-root.ts'
import { teamClientFor } from './team-client.ts'
import { publishTeamChange, TeamLiveTopic } from './team-topic.ts'
import { provisionBrowserSockets } from '../../test/ws-test-socket.ts'

vi.mock('#/ws.ts', () => import('../../test/ws-test-socket.ts'))

const ORG = `org-team-${crypto.randomUUID().slice(0, 8)}`
const MEMBER = `member@${ORG}`

const until = async (check: () => boolean, what: string) => {
	for (let i = 0; i < 100; i++) {
		if (check()) return
		await new Promise((r) => setTimeout(r, 50))
	}
	throw new Error(`timed out waiting for ${what}`)
}

beforeAll(async () => {
	await provisionBrowserSockets(MEMBER, 1)
})

describe('the team topic', () => {
	it('carries a join and a removal to a member watching the roster', async () => {
		const client = teamClientFor(ORG)
		await until(() => client.ready(), 'the snapshot')
		expect(client.selfId()).toBe(MEMBER)
		expect([...client.members.values()]).toEqual([])

		const row = { userId: `member@${ORG}-2`, role: 'member' as const, name: 'Nia Newcomer', image: null, joinedAt: 1 }
		await publishTeamChange(ORG, { row })
		await until(() => client.members.has(row.userId), 'the join')
		expect(client.members.get(row.userId)).toMatchObject(row)

		await publishTeamChange(ORG, { removed: row.userId })
		await until(() => !client.members.has(row.userId), 'the removal')
	})

	it('lets in no one from outside the organisation', async () => {
		// The root as the upgrade seals it, for a user of another organisation, who is on no
		// central team either: the door stays shut.
		const outsider = new CoreRpcRoot({ env, userId: 'member@org-elsewhere' })
		await expect(outsider.connectTeamTopic({ organizationId: ORG })).rejects.toThrow()
		await expect(outsider.connectTeamTopic({ organizationId: 'not an id' })).rejects.toThrow('invalid organizationId')
		const member = new CoreRpcRoot({ env, userId: MEMBER })
		expect(await member.connectTeamTopic({ organizationId: ORG })).toBeInstanceOf(TeamLiveTopic)
	})
})
