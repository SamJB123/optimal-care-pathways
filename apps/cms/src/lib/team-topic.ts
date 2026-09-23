/**
 * A team's live roster: the reactive-D1 machinery of live-topics.ts and live-publish.ts
 * (the bell is data-less fan-out, the snapshot is correctness), over the auth worker
 * rather than the content database, because membership lives there.
 *
 *   team:{orgId}   the members of one organisation (a pathway's team, or the central
 *                  team). Authorised at the door: the root lets in members of the
 *                  organisation and members of the central organisation, so within the
 *                  topic every subscriber sees every row.
 *
 * The WIRE ROW carries display identity only: name, avatar, role, when they joined. Never
 * an email address, for anyone (the hive's rule). The member tag is derived client-side
 * from the id.
 *
 * Server-only (imports capnweb via d1-sync); clients import only the wire-row type.
 */

import type { BellCapability, ScopedWriter, WriterScope } from '@aicolab/room-service/d1-sync'
import { D1TopicCapability, publishToTopic } from '@aicolab/room-service/d1-sync'
import type { RpcStub } from 'capnweb-experimental-hibernation'
import { OCP_NAMESPACE, type Role } from '#/lib/roles.ts'
import { roleFrom } from '#/lib/team-rule.ts'

export const teamTopic = (orgId: string) => `team:${orgId}`

/** A member as the roster carries it. Type alias, not interface: the writer scope wants an
 *  index signature. */
export type TeamMemberWireRow = {
	userId: string
	role: Role
	name: string
	image: string | null
	joinedAt: number
}

/** A member as the auth worker lists it; the email is read here and never passed on. */
export interface ListedMember {
	userId: string
	role: string
	name: string
	image?: string
	createdAt: Date
}

/** The one mapper from the auth worker's row to the wire (snapshot and increments). A
 *  role outside the ladder is no member of this application's. */
export function teamMemberWireRow(member: ListedMember): TeamMemberWireRow | null {
	const role = roleFrom(member.role)
	return role
		? {
				userId: member.userId,
				role,
				name: member.name,
				image: member.image ?? null,
				joinedAt: new Date(member.createdAt).getTime(),
			}
		: null
}

/** What the topic needs from its hosting root. */
export interface TeamTopicHost {
	connectBell(topic: string, sink?: ScopedWriter): Promise<RpcStub<BellCapability>>
	readonly auth: {
		listOrgMembers(organizationId: string, namespace?: string): Promise<ListedMember[]>
	}
}

/** One organisation's roster, for everyone the door let in. */
export class TeamLiveTopic extends D1TopicCapability {
	readonly #host: TeamTopicHost
	readonly #orgId: string

	constructor(host: TeamTopicHost, orgId: string) {
		super()
		this.#host = host
		this.#orgId = orgId
	}

	protected bell(sink?: ScopedWriter): Promise<RpcStub<BellCapability>> {
		return this.#host.connectBell(teamTopic(this.#orgId), sink)
	}

	protected async querySnapshot(): Promise<readonly Record<string, unknown>[]> {
		const members = await this.#host.auth.listOrgMembers(this.#orgId, OCP_NAMESPACE)
		return members.flatMap((m) => teamMemberWireRow(m) ?? [])
	}

	protected scope(): WriterScope<TeamMemberWireRow> {
		return { keyOf: (row) => row.userId }
	}
}

/**
 * Announce a member's row (a join, a role change) or their removal on the team's topic.
 * Best-effort, as every publish is (live-publish.ts): the change has committed in the
 * auth worker, and the snapshot is correctness.
 */
export async function publishTeamChange(
	orgId: string,
	change: { row: TeamMemberWireRow } | { removed: string },
): Promise<void> {
	try {
		// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
		const { env } = await import('cloudflare:workers')
		await publishToTopic(env.OCP_BELL, teamTopic(orgId), [
			'row' in change
				? { type: 'insert', value: change.row }
				: { type: 'delete', key: change.removed },
		])
	} catch (error) {
		console.error(
			`[ocp live] publish to '${teamTopic(orgId)}' failed (change stands; snapshot is correctness)`,
			error instanceof Error ? error.message : error,
		)
	}
}
