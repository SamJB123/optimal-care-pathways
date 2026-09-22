/**
 * Browser transport: the live documents list, and one pathway's live outline plus its
 * room (section bodies, presence, cursors), all over the app's shared socket.
 *
 * SSR: import only from client-gated code — touches the shared socket.
 */

import { createDocRoomClient, type DocRoomClient } from '@aicolab/app-kit/doc-room/client'
import { createManagedCapnwebSession } from '@aicolab/room-service/client/capnweb'
import { createSyncedCollection } from '@aicolab/room-service/collection-sync/client'
import type { RpcStub } from 'capnweb-experimental-hibernation'
import { type Accessor, createSignal } from 'solid-js'
import type { DocumentWireRow, SectionWireRow } from '#/lib/live-topics.ts'
import type { CoreRpcRoot } from '#/lib/rpc-root.ts'
import { sharedSocket } from '#/ws.ts'

type DocumentsCap = Awaited<ReturnType<RpcStub<CoreRpcRoot>['connectDocumentsTopic']>>
type SectionsCap = Awaited<ReturnType<RpcStub<CoreRpcRoot>['connectSectionsTopic']>>

export interface DocumentsClient {
	documents: ReturnType<typeof createSyncedCollection<DocumentWireRow>>['collection']
	ready: Accessor<boolean>
	selfId: Accessor<string | null>
	close(): void
}

/** The sealed user's live document list. */
export function createDocumentsClient(): DocumentsClient {
	const documents = createSyncedCollection<DocumentWireRow>({
		id: 'documents',
		getKey: (r) => r.id,
	})
	const [ready, setReady] = createSignal(false)
	const [selfId, setSelfId] = createSignal<string | null>(null)
	const managed = createManagedCapnwebSession<CoreRpcRoot, { cap: DocumentsCap }>({
		socket: sharedSocket,
		connect: async (api) => {
			const cap = await api.connectDocumentsTopic()
			await cap.subscribe(documents.writer)
			setSelfId(await api.whoami())
			setReady(true)
			return { cap }
		},
	})
	void managed
		.get()
		.catch((err) => console.error('[documents client] session acquire failed:', err))
	return { documents: documents.collection, ready, selfId, close: () => managed.invalidate() }
}

export interface PathwayClient {
	sections: ReturnType<typeof createSyncedCollection<SectionWireRow>>['collection']
	ready: Accessor<boolean>
	room: DocRoomClient
	close(): void
}

/** One document: its live outline and its room. */
export function createPathwayClient(
	documentId: string,
	nameOf: (userId: string) => string,
): PathwayClient {
	const sections = createSyncedCollection<SectionWireRow>({
		id: `sections:${documentId}`,
		getKey: (r) => r.id,
	})
	const [ready, setReady] = createSignal(false)
	const managed = createManagedCapnwebSession<CoreRpcRoot, { cap: SectionsCap }>({
		socket: sharedSocket,
		connect: async (api) => {
			const cap = await api.connectSectionsTopic({ documentId })
			await cap.subscribe(sections.writer)
			setReady(true)
			return { cap }
		},
	})
	void managed.get().catch((err) => console.error('[pathway client] outline session failed:', err))
	const room = createDocRoomClient({
		socket: sharedSocket,
		id: `document:${documentId}`,
		connect: (api) => api.connectDocumentRoom({ documentId }),
		nameOf,
	})
	return {
		sections: sections.collection,
		ready,
		room,
		close: () => {
			managed.invalidate()
			room.session.invalidate()
		},
	}
}
