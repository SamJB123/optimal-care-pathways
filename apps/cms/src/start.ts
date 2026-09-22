/**
 * TanStack Start entry — auto-discovered by the plugin, never imported directly.
 * Injects `wsFetch` as the serverFn transport so server functions and loaders
 * tunnel over the capnweb WebSocket.
 */
import { createCsrfMiddleware, createStart } from '@tanstack/solid-start'
import { wsFetch } from '#/ws.ts'
import { authMiddleware } from './lib/auth-fn.ts'

// CSRF-check serverFn calls over plain HTTP, but NOT those tunneled over the
// WebSocket: a Request serialized over the socket carries no Origin header, and the
// /api/ws upgrade itself rejects cross-origin handshakes.
const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === 'serverFn' && !ctx.context?.viaWsTunnel,
})

export const startInstance = createStart(() => ({
	serverFns: { fetch: wsFetch },
	requestMiddleware: [csrfMiddleware],
	// Resolves the verified caller into `context.userId` inside every server function.
	functionMiddleware: [authMiddleware],
}))
