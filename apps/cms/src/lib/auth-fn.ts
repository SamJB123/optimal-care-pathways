/**
 * Server-function auth middleware — resolves the verified caller on both transports:
 * the WebSocket tunnel (the worker injected the upgrade-verified id into the request
 * context) and plain HTTP (verify the session cookie via `env.AUTH`). Registered as
 * global functionMiddleware in start.ts, so `context.userId` exists everywhere.
 */
import { createMiddleware } from '@tanstack/solid-start'
import { getRequest } from '@tanstack/solid-start/server'

export const authMiddleware = createMiddleware({ type: 'function' }).server(
	async ({ context, next }) => {
		let userId = context?.userId ?? null

		if (!userId) {
			const cookie = getRequest().headers.get('cookie') ?? ''
			if (cookie) {
				// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
				const { env } = await import('cloudflare:workers')
				if (env.AUTH?.verifySession) {
					const { user } = await env.AUTH.verifySession(cookie)
					userId = user?.id ?? null
				}
			}
		}

		return next({ context: { userId } })
	},
)
