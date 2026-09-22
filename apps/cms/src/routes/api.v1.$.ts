/**
 * /api/v1/* — the public REST API (decision 122): chanfana on Hono, mounted in one
 * TanStack Start catch-all server route. OpenAPI at /api/v1/openapi.json, Scalar at
 * /api/v1/docs, the PDF at /api/v1/documents/{slug}.pdf. Public: published content only.
 */

import { createFileRoute } from '@tanstack/solid-router'
import { createApiApp } from '#/api/server.ts'

let app: ReturnType<typeof createApiApp> | null = null

const serve = async ({ request }: { request: Request }): Promise<Response> => {
	// biome-ignore lint/correctness/noUnresolvedImports: provided by the Workers runtime
	const { env } = await import('cloudflare:workers')
	app ??= createApiApp()
	return app.fetch(request, env)
}

export const Route = createFileRoute('/api/v1/$')({
	server: {
		handlers: {
			GET: serve,
			HEAD: serve,
			OPTIONS: serve,
		},
	},
})
