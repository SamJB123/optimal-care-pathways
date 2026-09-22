/**
 * Test stand-in for `#/ws.ts` (the browser's app-wide socket singleton), for the
 * workerd pool. `vi.mock('#/ws.ts', () => import('../../test/ws-test-socket.ts'))` in a
 * suite swaps it in underneath the PRODUCTION clients (lib/ocp-client.ts), which then
 * run unchanged over a real browser→worker WebSocket obtained from
 * `SELF.fetch('/api/ws')`. The hive's harness (platform/zones/hive/test/ws-test-socket.ts),
 * ported verbatim.
 *
 * Only socket ACQUISITION differs from ws.ts: `createWebSocket` is synchronous (like the
 * platform constructor), so a test pre-provisions real upgraded sockets with
 * `provisionBrowserSockets` and each (re)connect takes the next. Every lifecycle
 * decision — reconnect, backoff, keepalive, onPeerLost, managed-session recovery — is
 * the production code path.
 */

// biome-ignore lint/correctness/noUnresolvedImports: provided by the vitest workers pool
import { SELF } from 'cloudflare:test'
import { createSharedCapnwebSocket } from '@aicolab/room-service/client/capnweb'
import type { CoreRpcRoot } from '../src/lib/rpc-root.ts'

const ORIGIN = 'https://ocp.test'

const provisioned: WebSocket[] = []
/** Every socket handed to the shared socket owner, in dial order. */
export const dialled: WebSocket[] = []

/** Open `count` real `/api/ws` sockets sealed as `userId` (the fixture's cookie IS the
 *  user id — see TestAuth.verifySession) for future dials. */
export async function provisionBrowserSockets(userId: string, count: number): Promise<void> {
	for (let i = 0; i < count; i += 1) {
		const response = await SELF.fetch(`${ORIGIN}/api/ws`, {
			headers: { Cookie: userId, Origin: ORIGIN, Upgrade: 'websocket' },
		})
		if (response.status !== 101 || !response.webSocket) {
			throw new Error(`/api/ws upgrade failed: ${response.status}`)
		}
		provisioned.push(response.webSocket)
	}
}

export const sharedSocket = createSharedCapnwebSocket<CoreRpcRoot>({
	url: () => `${ORIGIN.replace(/^http/, 'ws')}/api/ws`,
	createWebSocket: () => {
		const next = provisioned.shift()
		if (!next) throw new Error('the client dialled more sockets than the test provisioned')
		next.accept()
		dialled.push(next)
		return next
	},
	reconnectDelayMs: 1000,
	keepAlive: (api) => api.ping(),
	keepAliveMs: 25_000,
	probeTimeoutMs: 10_000,
	maxProbeMisses: 2,
	sealedIdentity: (api) => api.whoami(),
})

export function startAuthDrivenSocket(): void {}

export const wsFetch: typeof globalThis.fetch = async (input, init) => {
	const api = sharedSocket.current()
	if (api) return api.fetch(new Request(input, init))
	return fetch(input, init)
}

export function getStatusSnapshot() {
	return sharedSocket.status()
}

export function subscribeStatus(callback: () => void): () => void {
	return sharedSocket.subscribeStatus(callback)
}
