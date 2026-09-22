/**
 * TanStack Start entry — auto-discovered by the plugin, never imported directly. The
 * options come from the kit: serverFns over the capnweb tunnel, CSRF over HTTP only, the
 * verified caller in `context.userId` inside every server function.
 *
 * This file is bundled for the client as well, so the session verifier — which reaches
 * this worker's AUTH service binding — is an isomorphic function: the server branch is
 * stripped from the client bundle, and the client branch never runs (the middleware only
 * verifies on the server).
 */
import { appStartOptions } from '@aicolab/app-kit/start'
import { createIsomorphicFn, createStart } from '@tanstack/solid-start'
import { wsFetch } from '#/ws.ts'

const verifySession = createIsomorphicFn()
	.server(async (cookie: string) => {
		// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
		const { env } = await import('cloudflare:workers')
		return env.AUTH.verifySession(cookie)
	})
	.client(async (_cookie: string) => ({ user: null }))

export const startInstance = createStart(() => appStartOptions({ wsFetch, verifySession }))
