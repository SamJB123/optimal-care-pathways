/**
 * Browser transport: the live documents list, and one pathway's live outline plus its
 * room (section bodies, presence, cursors), all over the app's shared socket.
 *
 * CLIENTS ARE MODULE-SCOPE SINGLETONS, one per document, cached for the life of the
 * page (the hive's `pmDocsClientFor` / `hiveClientFor` pattern). Route code subscribes
 * and unsubscribes; it never creates or closes a session. A session created per route
 * mount and invalidated on unmount is torn down while its doc subscribes are still
 * settling, the disposed-stub rejection reads as a transport break, the managed session
 * rebuilds on the same socket and re-opens facets through handles that are already gone
 * — the reopen storm (memory: hive-doc-reopen-storm). The cached client keeps its
 * socket warm after the user leaves the document, for an instant return.
 *
 * SSR: import only from client-gated code — touches the shared socket.
 */

import { createDocRoomClient, type DocRoomClient } from '@aicolab/app-kit/doc-room/client'
import { createManagedCapnwebSession } from '@aicolab/room-service/client/capnweb'
import { createSyncedCollection } from '@aicolab/room-service/collection-sync/client'
import type { RpcStub } from 'capnweb-experimental-hibernation'
import type { DocumentWireRow, SectionWireRow } from '#/lib/live-topics.ts'
import type { CoreRpcRoot } from '#/lib/rpc-root.ts'
import { sharedSocket } from '#/ws.ts'

type DocumentsCap = Awaited<ReturnType<RpcStub<CoreRpcRoot>['connectDocumentsTopic']>>
type SectionsCap = Awaited<ReturnType<RpcStub<CoreRpcRoot>['connectSectionsTopic']>>

export interface DocumentsClient {
	documents: ReturnType<typeof createSyncedCollection<DocumentWireRow>>['collection']
	/** True once the live snapshot has landed — before that, render SSR data. */
	ready(): boolean
	/** Server-attested self id (whoami — never a prop, never the session atom). */
	selfId(): string | null
}

function createDocumentsClient(): DocumentsClient {
	const documents = createSyncedCollection<DocumentWireRow>({
		id: 'documents',
		getKey: (r) => r.id,
	})
	let ready = false
	let selfId: string | null = null
	const managed = createManagedCapnwebSession<CoreRpcRoot, { cap: DocumentsCap }>({
		socket: sharedSocket,
		connect: async (api) => {
			const cap = await api.connectDocumentsTopic()
			await cap.subscribe(documents.writer)
			selfId = await api.whoami()
			ready = true
			return { cap }
		},
	})
	void managed
		.get()
		.catch((err) => console.error('[documents client] session acquire failed:', err))
	return { documents: documents.collection, ready: () => ready, selfId: () => selfId }
}

let documentsSingleton: DocumentsClient | null = null
/** The sealed user's live document list — one per page. */
export function documentsClient(): DocumentsClient {
	documentsSingleton ??= createDocumentsClient()
	return documentsSingleton
}

export interface PathwayClient {
	readonly documentId: string
	sections: ReturnType<typeof createSyncedCollection<SectionWireRow>>['collection']
	/** True once the outline snapshot has landed. */
	ready(): boolean
	room: DocRoomClient
}

function createPathwayClient(documentId: string): PathwayClient {
	const sections = createSyncedCollection<SectionWireRow>({
		id: `sections:${documentId}`,
		getKey: (r) => r.id,
	})
	let ready = false
	const managed = createManagedCapnwebSession<CoreRpcRoot, { cap: SectionsCap }>({
		socket: sharedSocket,
		connect: async (api) => {
			const cap = await api.connectSectionsTopic({ documentId })
			await cap.subscribe(sections.writer)
			ready = true
			return { cap }
		},
	})
	void managed.get().catch((err) => console.error('[pathway client] outline session failed:', err))
	const room = createDocRoomClient({
		socket: sharedSocket,
		id: `document:${documentId}`,
		connect: (api) => api.connectDocumentRoom({ documentId }),
		nameOf: (userId) => userId.slice(0, 8),
	})
	return { documentId, sections: sections.collection, ready: () => ready, room }
}

/** Per-document client cache: stable collections, writers and sessions per document. */
const pathwayClients = new Map<string, PathwayClient>()
export function pathwayClientFor(documentId: string): PathwayClient {
	let client = pathwayClients.get(documentId)
	if (!client) {
		client = createPathwayClient(documentId)
		pathwayClients.set(documentId, client)
	}
	return client
}
