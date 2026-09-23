/**
 * The lifecycle bound to this worker's bindings and the request's origin: what every
 * server function over the lifecycle (lifecycle-fns, structure-fns, references-fns)
 * hands the plain functions. Server-only, and kept out of the server-function modules:
 * a plain export from one of those keeps its imports (the worker's env) alive in the
 * client bundle, where they cannot load.
 */

import { renderBodyHtml } from '#/content/render-html.tsx'
import { centralOrgId } from './access.ts'
import { envOf } from './env.ts'
import type { Lifecycle } from './lifecycle.ts'

export async function lifecycleOf(): Promise<Lifecycle> {
	const { env, d } = await envOf()
	let central: Promise<string | null> | null = null
	return {
		d,
		auth: env.AUTH,
		rooms: env.DOCUMENT_ROOM,
		centralOrgId: () => {
			central ??= centralOrgId(env.AUTH, d)
			return central
		},
		origin: env.PUBLIC_ORIGIN ?? 'https://ocp-cms.aicolab.workers.dev',
		renderHtml: renderBodyHtml,
		purge: async (tags) => {
			// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
			const { cache } = await import('cloudflare:workers')
			await cache.purge({ tags })
		},
	}
}
