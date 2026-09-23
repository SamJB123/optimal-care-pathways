/**
 * Cloudflare Worker entry — the request front door for the application.
 *
 * The capnweb host, the `/api/ws` upgrade, the `/api/auth/*` proxy to the AUTH
 * service and the TanStack Start fallback all come from
 * `@aicolab/room-service/base-worker`. The application's own classes live in
 * `lib/rpc-root.ts` (the root and the bell) and `rooms/document-room.ts` (one Durable
 * Object per document); this file only exports them for the runtime.
 *
 * IDENTITY is the server-attested signed-in user: `serveCapnweb` verifies the
 * session cookie once at the same-origin-checked `/api/ws` upgrade and seals the
 * id into `CoreRpcRoot`. The browser never sends an id.
 */

import { serveCapnweb } from '@aicolab/room-service/base-worker'
import handler from '@tanstack/solid-start/server-entry'
import { eq } from 'drizzle-orm'
import { cacheTagFor, PUBLIC_CACHE_CONTROL, PUBLISHED_CACHE_TAG } from '#/api/published.ts'
import { db, schema } from '#/db/index.ts'
import { CoreRpcRoot, OcpBell } from '#/lib/rpc-root.ts'
import { DocumentRoom } from '#/rooms/document-room.ts'

// The browser types its capnweb socket against this class (`import type` only).
export type { CoreRpcRoot }
// Durable Object classes, by the names wrangler.jsonc binds.
export { DocumentRoom, OcpBell }

/** The public read pages: a published document, a legacy edition as printed. */
const PUBLIC_PAGE = /^\/(p|legacy)\/([a-zA-Z0-9-]+)$/

/**
 * Workers Cache sits in front of this Worker (wrangler `cache.enabled`, decision 126).
 * With it on, a response WITHOUT a Cache-Control header is cached heuristically — a 200
 * for two hours — which once served the signed-out session and page to a user who had
 * just signed in. So caching is OPT-IN here: the public read pages and the public API
 * (api/server.ts) say they are public and carry the tags publishing purges; everything
 * else — pages and server functions that embed the caller's session, the auth proxy —
 * is `no-store`. A public page still renders the caller's own session in its shell, so
 * its cached copies vary by cookie: one shared copy for visitors, a private one per user.
 */
function withCachePolicy(request: Request, response: Response): Response {
	if (response.status === 101 || response.webSocket || response.headers.has('cache-control'))
		return response
	const headers = new Headers(response.headers)
	const page =
		request.method === 'GET' && response.ok ? PUBLIC_PAGE.exec(new URL(request.url).pathname) : null
	if (page) {
		headers.set('cache-control', PUBLIC_CACHE_CONTROL)
		headers.set(
			'cache-tag',
			`${PUBLISHED_CACHE_TAG},${page[1] === 'p' ? cacheTagFor(page[2] ?? '') : `legacy-${page[2]}`}`,
		)
		headers.append('vary', 'Cookie')
	} else headers.set('cache-control', 'no-store')
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	})
}

/**
 * A new deployment's first request purges the published cache, once. Publishing purges a
 * document's own pages and PDFs, but a deploy that changes how pages or PDFs are drawn (or
 * the scripts a cached page names) would otherwise leave readers the old ones for up to a
 * day. The version that last purged is kept in D1, so every instance of the new version
 * after the first finds it done; the purge runs beside the response, never in its way.
 */
let deploymentPurge: Promise<void> | null = null

async function purgeForDeployment(env: Cloudflare.Env): Promise<void> {
	const versionId = env.CF_VERSION_METADATA.id
	const d = db(env.DB)
	const last = (
		await d
			.select({ versionId: schema.cacheGenerations.versionId })
			.from(schema.cacheGenerations)
			.where(eq(schema.cacheGenerations.tag, PUBLISHED_CACHE_TAG))
			.limit(1)
	)[0]
	if (last?.versionId === versionId) return
	// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
	const { cache } = await import('cloudflare:workers')
	// Local development runs with no Workers Cache in front: nothing is cached to purge.
	if (typeof cache?.purge !== 'function') return
	await cache.purge({ tags: [PUBLISHED_CACHE_TAG] })
	const purgedAt = new Date()
	await d
		.insert(schema.cacheGenerations)
		.values({ tag: PUBLISHED_CACHE_TAG, versionId, purgedAt })
		.onConflictDoUpdate({ target: schema.cacheGenerations.tag, set: { versionId, purgedAt } })
	console.log(`[deploy] published cache purged for version ${versionId}`)
}

export default {
	async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
		deploymentPurge ??= purgeForDeployment(env).catch((error: unknown) => {
			console.error('[deploy] cache purge failed:', error instanceof Error ? error.message : error)
			// Tried again on the next request.
			deploymentPurge = null
		})
		ctx.waitUntil(deploymentPurge)
		return withCachePolicy(
			request,
			await serveCapnweb({ request, env, ctx, Root: CoreRpcRoot, handler }),
		)
	},
} satisfies ExportedHandler<Cloudflare.Env>
