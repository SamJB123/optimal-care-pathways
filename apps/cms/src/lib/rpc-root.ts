/**
 * The capnweb host classes: OcpBell (the reactive-D1 fan-out Durable Object) and
 * CoreRpcRoot (the per-connection, browser-facing root). Housed here rather than in
 * worker.ts because the worker entry imports TanStack Start's build-only server entry,
 * which the workerd test pool cannot load, and these are the classes the tests exercise.
 *
 * IDENTITY is sealed before construction (the `/api/ws` upgrade verified the cookie).
 * EVERY document connector re-verifies the sealed user's membership of the document's
 * organisation through env.AUTH before minting a capability: the documentId argument
 * selects, membership authorises. The documents topic needs no argument: its scope is
 * the user's own view.
 */

import { CoreRpcRoot as WorkerRoot } from '@aicolab/room-service/base-worker'
import type { BellCapability, ScopedWriter } from '@aicolab/room-service/d1-sync'
import { D1BellServer } from '@aicolab/room-service/d1-sync'
import type { RpcStub } from 'capnweb-experimental-hibernation'
import { eq } from 'drizzle-orm'
import { PublishedApi } from '#/api/rpc.ts'
import { apiContext } from '#/api/server.ts'
import { db, schema } from '#/db/index.ts'
import { DocumentsLiveTopic, type LiveTopicHost, SectionsLiveTopic } from '#/lib/live-topics.ts'
import { OCP_NAMESPACE, type Role } from '#/lib/roles.ts'
import { TeamLiveTopic } from '#/lib/team-topic.ts'
import { documentRoleOf, isCentralMember } from '#/server/access.ts'
import { type DocRoomCapability, documentRoomName } from '#/rooms/document-room.ts'

/** Data-less fan-out for this worker's reactive-D1 topics: one instance per topic. */
export class OcpBell extends D1BellServer {}

export class CoreRpcRoot extends WorkerRoot<Cloudflare.Env> implements LiveTopicHost {
	readonly #sectionsTopics = new Map<string, SectionsLiveTopic>()
	readonly #teamTopics = new Map<string, TeamLiveTopic>()
	#documentsTopic: DocumentsLiveTopic | null = null
	readonly #roles = new Map<string, Promise<Role | null>>()

	/** LiveTopicHost: the pinned worker→bell tunnel for a topic. */
	connectBell(topic: string, sink?: ScopedWriter): Promise<RpcStub<BellCapability>> {
		return this.connect<BellCapability>(
			this.env.OCP_BELL,
			topic,
			sink ? { workerCallback: sink } : undefined,
		)
	}

	/** LiveTopicHost: D1 for topic snapshots. */
	get liveDb(): D1Database {
		return this.env.DB
	}

	/** LiveTopicHost: the auth worker for membership. */
	get auth() {
		return this.env.AUTH
	}

	/** The sealed user's role on a document's organisation, memoised per connection.
	 *  Live role changes are the room's business (retier) and every server function
	 *  re-checks per call; the memo only gates connects. */
	#roleOn(documentId: string): Promise<Role | null> {
		let cached = this.#roles.get(documentId)
		if (!cached) {
			cached = (async () => {
				const row = (
					await db(this.env.DB)
						.select({ orgId: schema.documents.orgId })
						.from(schema.documents)
						.where(eq(schema.documents.id, documentId))
						.limit(1)
				)[0]
				if (!row) return null
				return documentRoleOf(this.env.AUTH, db(this.env.DB), this.userId, row.orgId)
			})()
			this.#roles.set(documentId, cached)
		}
		return cached
	}

	async #requireMember(documentId: string): Promise<Role> {
		if (!/^[a-zA-Z0-9-]{1,64}$/.test(documentId)) {
			throw new Error(`[ocp] invalid documentId: ${JSON.stringify(documentId)}`)
		}
		const role = await this.#roleOn(documentId)
		if (!role) throw new Error('[ocp] not a member of this document')
		return role
	}

	/** The document's room: live section bodies, presence, cursors. Any role; the room
	 *  assigns the tier. */
	async connectDocumentRoom(input: { documentId: string }): Promise<RpcStub<DocRoomCapability>> {
		await this.#requireMember(input.documentId)
		return this.connect<DocRoomCapability>(
			this.env.DOCUMENT_ROOM,
			documentRoomName(input.documentId),
		)
	}

	/** The live outline of one document. Any role. */
	async connectSectionsTopic(input: { documentId: string }): Promise<SectionsLiveTopic> {
		await this.#requireMember(input.documentId)
		let topic = this.#sectionsTopics.get(input.documentId)
		if (!topic) {
			topic = new SectionsLiveTopic(this, input.documentId)
			this.#sectionsTopics.set(input.documentId, topic)
		}
		return topic
	}

	/** A team's live roster: for its members and the central team's (who review every
	 *  document). Outside the ocp namespace the auth worker lists no one. */
	async connectTeamTopic(input: { organizationId: string }): Promise<TeamLiveTopic> {
		const orgId = input.organizationId
		if (!/^[a-zA-Z0-9-]{1,64}$/.test(orgId)) throw new Error(`[ocp] invalid organizationId: ${JSON.stringify(orgId)}`)
		const own = await this.env.AUTH.getOrgMembershipById(this.userId, orgId, OCP_NAMESPACE)
		if (!own && !(await isCentralMember(this.env.AUTH, db(this.env.DB), this.userId))) {
			throw new Error('[ocp] not on this team')
		}
		let topic = this.#teamTopics.get(orgId)
		if (!topic) {
			topic = new TeamLiveTopic(this, orgId)
			this.#teamTopics.set(orgId, topic)
		}
		return topic
	}

	/** The sealed user's own live document list. No argument: identity-scoped. */
	connectDocumentsTopic(): DocumentsLiveTopic {
		this.#documentsTopic ??= new DocumentsLiveTopic(this, this.userId)
		return this.#documentsTopic
	}

	/** The published-content operations (decision 122) as a capnweb capability: the same
	 *  table the REST API and the MCP server serve, for first-party callers. Public data,
	 *  so any sealed user may hold it. */
	connectPublished(): PublishedApi {
		return new PublishedApi(apiContext(this.env))
	}
}
