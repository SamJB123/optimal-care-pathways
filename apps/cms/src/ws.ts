/**
 * The browser↔worker WebSocket used for the serverFn tunnel, and its single
 * capnweb session over the worker's `CoreRpcRoot`. A module-level singleton that
 * survives route changes; every realtime feature layers a managed session over it.
 *
 * SINGLE-SPECIFIER RULE: import this module as `#/ws.ts` ONLY. A relative import
 * alongside the alias makes Vite instantiate it twice — two sockets, two auth
 * subscriptions.
 */

import {
	bindSocketToAuth,
	type CapnwebSocketStatus,
	createSharedCapnwebSocket,
	type SharedCapnwebSocket,
} from '@aicolab/room-service/client/capnweb'
import { authClient } from '#/lib/auth-client.ts'
import type { CoreRpcRoot } from '#/worker.ts'

export type WsStatus = CapnwebSocketStatus

function getWsUrl(): string {
	return `${window.location.origin.replace(/^http/, 'ws')}/api/ws`
}

// Keepalive doubles as a half-open liveness probe; ping() terminates in the worker.
const socket = createSharedCapnwebSocket<CoreRpcRoot>({
	url: getWsUrl,
	reconnectDelayMs: 1000,
	keepAlive: (api) => api.ping(),
	keepAliveMs: 25_000,
	probeTimeoutMs: 10_000,
	maxProbeMisses: 2,
	// The connection's sealed identity, asked of the connection itself — powers the
	// stateless reconcile in bindSocketToAuth.
	sealedIdentity: (api) => api.whoami(),
})

/** The shared socket, for any feature layering a managed session over it. */
export const sharedSocket: SharedCapnwebSocket<CoreRpcRoot> = socket

/**
 * Bind the socket's lifecycle to authentication state, statelessly: every session
 * emission is reconciled against the connection's own sealed identity. Signed out →
 * closed; mismatch or dead session → re-seal; match → ensure open.
 */
let authUnsubscribe: (() => void) | null = null
export function startAuthDrivenSocket(): void {
	if (typeof window === 'undefined' || authUnsubscribe) return
	authUnsubscribe = bindSocketToAuth(socket, authClient.useSession)
}

/** Fetch routed over the WS tunnel, with HTTP fallback when not connected. */
export const wsFetch: typeof globalThis.fetch = async (input, init) => {
	const api = socket.current()
	if (api) return api.fetch(new Request(input, init))
	return fetch(input, init)
}

export function getStatusSnapshot(): WsStatus {
	return socket.status()
}

export function subscribeStatus(callback: () => void): () => void {
	return socket.subscribeStatus(callback)
}
