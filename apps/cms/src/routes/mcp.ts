/**
 * /mcp — the MCP server for published content (decision 124): the SDK v2 stateless
 * handler over the same operation table the REST API serves. Every request is one POST
 * under the 2026-07-28 spec; 2025-era clients are served statelessly too (their GET
 * stream and DELETE get 405 from the handler, as the SDK specifies). Public, no auth:
 * the data is the published documents.
 */

import { createFileRoute } from '@tanstack/solid-router'
import { mcpHandler } from '#/api/server.ts'

const serve = async ({ request }: { request: Request }): Promise<Response> => {
	// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
	const { env } = await import('cloudflare:workers')
	return mcpHandler(env).fetch(request)
}

export const Route = createFileRoute('/mcp')({
	server: {
		handlers: {
			POST: serve,
			GET: serve,
			DELETE: serve,
			OPTIONS: serve,
		},
	},
})
