/**
 * Server-only helpers for server functions: the worker's bindings and the drizzle
 * handle, and the auth-context guard. Never import from client code.
 */

import { db } from '#/db/index.ts'

export async function envOf() {
	// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
	const { env } = await import('cloudflare:workers')
	return { env, d: db(env.DB) }
}

/** The kit's auth middleware injects the verified user id; a missing one is a refusal. */
export function requireUser(userId: string | null | undefined): string {
	if (!userId) throw new Error('Sign in to continue.')
	return userId
}
