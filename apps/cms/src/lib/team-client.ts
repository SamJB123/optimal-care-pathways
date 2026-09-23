/**
 * Browser transport for a team's live roster (team-topic.ts), over the app's shared
 * socket, with the server-attested self id (whoami: identity is never a prop and never
 * read from the session atom for a self check).
 *
 * One client per organisation, cached for the life of the page (ocp-client.ts's rule:
 * route code subscribes and unsubscribes; it never creates or closes a session).
 *
 * SSR: import only from client-gated code — touches the shared socket.
 */

import { createManagedCapnwebSession } from '@aicolab/room-service/client/capnweb'
import { createSyncedCollection } from '@aicolab/room-service/collection-sync/client'
import type { RpcStub } from 'capnweb-experimental-hibernation'
import type { CoreRpcRoot } from '#/lib/rpc-root.ts'
import type { TeamMemberWireRow } from '#/lib/team-topic.ts'
import { sharedSocket } from '#/ws.ts'

type TeamCap = Awaited<ReturnType<RpcStub<CoreRpcRoot>['connectTeamTopic']>>

export interface TeamClient {
	members: ReturnType<typeof createSyncedCollection<TeamMemberWireRow>>['collection']
	/** True once the live snapshot has landed — before that, render the loader's roster. */
	ready(): boolean
	/** Server-attested self id. */
	selfId(): string | null
	/** Called on every roster change and when the client becomes ready (the snapshot can
	 *  land before the self id does, with no change after it). Returns the unsubscribe. */
	onChange(listener: () => void): () => void
}

function createTeamClient(orgId: string): TeamClient {
	const members = createSyncedCollection<TeamMemberWireRow>({
		id: `team:${orgId}`,
		getKey: (r) => r.userId,
	})
	let ready = false
	let selfId: string | null = null
	const listeners = new Set<() => void>()
	const emit = () => {
		for (const listener of listeners) listener()
	}
	members.collection.subscribeChanges(emit)
	const managed = createManagedCapnwebSession<CoreRpcRoot, { cap: TeamCap }>({
		socket: sharedSocket,
		connect: async (api) => {
			const cap = await api.connectTeamTopic({ organizationId: orgId })
			await cap.subscribe(members.writer)
			selfId = await api.whoami()
			ready = true
			emit()
			return { cap }
		},
	})
	void managed.get().catch((err) => console.error('[team client] session acquire failed:', err))
	return {
		members: members.collection,
		ready: () => ready,
		selfId: () => selfId,
		onChange(listener) {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
	}
}

const teamClients = new Map<string, TeamClient>()
export function teamClientFor(orgId: string): TeamClient {
	let client = teamClients.get(orgId)
	if (!client) {
		client = createTeamClient(orgId)
		teamClients.set(orgId, client)
	}
	return client
}
